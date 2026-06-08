/**
 * @file Server-side terrain generator: loads the `terrain-gen` wasm module and
 * exposes deterministic chunk generation + height sampling.
 *
 * The wasm is a dependency-free `wasm32-unknown-unknown` `cdylib` (built from
 * `apps/game/terrain-gen`) with **no imports**, so Bun instantiates it with an
 * empty import object. It writes each chunk into a single static buffer in linear
 * memory and returns a pointer; we copy `CHUNK_BYTES` out of `memory` at that
 * pointer.
 *
 * One module instance is shared by every room (the generator is pure — output
 * depends only on `(seed, cx, cz)`), behind a lazily-initialised singleton.
 * Generated chunks are memoised in a small LRU so repeated `heightAt` sampling
 * during physics ticks and chunk streaming does not re-run the generator.
 */

import { CHUNK_BYTES, CHUNK_SIZE, CHUNK_AREA, chunkKey } from '@transcendence/game-shared';

/** Shape of the functions the wasm module exports (manual C ABI). */
interface TerrainExports {
	memory: WebAssembly.Memory;
	/** Number of bytes `generate_chunk` writes (== `CHUNK_BYTES`). */
	chunk_bytes(): number;
	/** Fill the static buffer for chunk `(cx, cz)` of `seed`; return its pointer. */
	generate_chunk(seed: number, cx: number, cz: number): number;
}

/** Absolute path to the compiled wasm, alongside this server's source tree. */
const WASM_PATH = `${import.meta.dir}/../wasm/terrain.wasm`;

/** Max generated chunks kept memoised. ~512 B each ⇒ a few hundred KB at this cap. */
const CACHE_CAP = 4096;

export class TerrainService {
	private readonly exports: TerrainExports;
	/** Memoised chunks keyed by `seed,cx,cz`; iteration order backs the LRU eviction. */
	private readonly cache = new Map<string, Uint8Array>();

	private constructor(exports: TerrainExports) {
		this.exports = exports;
		if (exports.chunk_bytes() !== CHUNK_BYTES) {
			throw new Error(
				`[TerrainService] wasm chunk size ${exports.chunk_bytes()} != shared CHUNK_BYTES ${CHUNK_BYTES}`,
			);
		}
	}

	/** Lazily load + instantiate the wasm once; subsequent calls reuse it. */
	private static pending: Promise<TerrainService> | null = null;
	static instance(): Promise<TerrainService> {
		if (this.pending === null) {
			this.pending = (async () => {
				const bytes = await Bun.file(WASM_PATH).arrayBuffer();
				const { instance } = await WebAssembly.instantiate(bytes, {});
				return new TerrainService(instance.exports as unknown as TerrainExports);
			})();
		}
		return this.pending;
	}

	/**
	 * Generate (or fetch from cache) chunk `(cx, cz)` for `seed`. Returns a copy
	 * of the packed `[heights | biomes]` buffer (`CHUNK_BYTES` long) — safe for the
	 * caller to keep, send, or mutate.
	 */
	chunk(seed: number, cx: number, cz: number): Uint8Array {
		const key = `${seed},${chunkKey(cx, cz)}`;
		const hit = this.cache.get(key);
		if (hit !== undefined) {
			// Refresh LRU recency.
			this.cache.delete(key);
			this.cache.set(key, hit);
			return hit;
		}

		const ptr = this.exports.generate_chunk(seed, cx, cz);
		// Copy out before any other call can reuse the static wasm buffer.
		const data = new Uint8Array(this.exports.memory.buffer, ptr, CHUNK_BYTES).slice();

		this.cache.set(key, data);
		if (this.cache.size > CACHE_CAP) {
			// Evict the least-recently-used entry (first in insertion order).
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) {
				this.cache.delete(oldest);
			}
		}
		return data;
	}

	/**
	 * Surface height (in blocks) of the world column at world coords `(wx, wz)`.
	 * Floors to the containing block and samples the generated chunk.
	 */
	heightAt(seed: number, wx: number, wz: number): number {
		const bx = Math.floor(wx);
		const bz = Math.floor(wz);
		const cx = Math.floor(bx / CHUNK_SIZE);
		const cz = Math.floor(bz / CHUNK_SIZE);
		// Local column index, wrapped into `0..CHUNK_SIZE` for negative coords.
		const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
		const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
		const data = this.chunk(seed, cx, cz);
		return data[lz * CHUNK_SIZE + lx];
	}
}

// Re-exported for callers that need to slice the height/biome halves of a chunk.
export { CHUNK_AREA };
