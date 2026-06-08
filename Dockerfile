# syntax=docker/dockerfile:1

# --- Stage 1: compile the procedural terrain generator to wasm ---------------
# The generator (apps/game/terrain-gen) is a dependency-free wasm32 cdylib. We
# build it here so the runtime image needs no Rust toolchain, and so the wasm is
# reproducible from source rather than a committed binary.
FROM rust:1-slim AS wasm
WORKDIR /build
RUN rustup target add wasm32-unknown-unknown
COPY terrain-gen/ ./terrain-gen/
WORKDIR /build/terrain-gen
RUN cargo build --release --target wasm32-unknown-unknown

# --- Stage 2: Bun game server ------------------------------------------------
FROM oven/bun:1

WORKDIR /app

COPY shared-package/ ./shared-package/
COPY server/ ./server/

# Overwrite any checked-in dev copy with the freshly built wasm.
COPY --from=wasm /build/terrain-gen/target/wasm32-unknown-unknown/release/terrain_gen.wasm \
     ./server/src/wasm/terrain.wasm

WORKDIR /app/server

RUN bun install

EXPOSE 4000

CMD ["bun", "--watch", "src/index.ts"]
