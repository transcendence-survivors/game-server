import type { CombatEntity, WeaponKind } from '@transcendence/game-shared';

interface EntityCollection {
	forEach(callback: (entity: CombatEntity, id: string) => void): void;
}

interface OwnerEntities {
	readonly all: string[];
	readonly weapons: Map<WeaponKind, string[]>;
}

const removeId = (ids: string[], id: string): void => {
	const position = ids.indexOf(id);
	if (position >= 0) ids.splice(position, 1);
};

export class CombatEntityIndex {
	private readonly owners = new Map<string, OwnerEntities>();
	private readonly sortedIds: string[] = [];
	private orderDirty = true;

	add(entity: CombatEntity): void {
		this.orderDirty = true;
		const owner = this.ensureOwner(entity.ownerSessionId);
		owner.all.push(entity.id);
		this.list(owner.weapons, entity.weaponKind).push(entity.id);
	}

	delete(entity: CombatEntity): void {
		this.orderDirty = true;
		const owner = this.owners.get(entity.ownerSessionId);
		if (!owner) return;
		removeId(owner.all, entity.id);
		const weaponIds = owner.weapons.get(entity.weaponKind);
		if (weaponIds) {
			removeId(weaponIds, entity.id);
			if (!weaponIds.length) owner.weapons.delete(entity.weaponKind);
		}
		if (!owner.all.length) this.owners.delete(entity.ownerSessionId);
	}

	owner(id: string): Readonly<OwnerEntities> | undefined {
		return this.owners.get(id);
	}

	orderedIds(entities: EntityCollection): readonly string[] {
		if (!this.orderDirty) return this.sortedIds;
		this.sortedIds.length = 0;
		entities.forEach((_entity, id) => this.sortedIds.push(id));
		this.orderDirty = false;
		return this.sortedIds;
	}

	private ensureOwner(id: string): OwnerEntities {
		let owner = this.owners.get(id);
		if (!owner)
			this.owners.set(id, (owner = { all: [], weapons: new Map() }));
		return owner;
	}

	private list<K>(index: Map<K, string[]>, key: K): string[] {
		let ids = index.get(key);
		if (!ids) index.set(key, (ids = []));
		return ids;
	}
}
