# `@transcendence/game-server`

Serveur de jeu autoritaire **Bun + Colyseus** pour le mode multi de Transcendence.

## Stack

- **Bun** — runtime (plus rapide que Node, TS natif, pas de transpilation en dev).
- **Colyseus 0.16** — gestion des rooms, synchronisation d'état, schémas.
- **@colyseus/bun-websockets** — transport WebSocket optimisé pour Bun.

## Principes d'architecture (branche `feat/core-architecture`)

| Couche | Responsabilité unique | Modules |
|---|---|---|
| **bootstrap** | Charger config, démarrer le serveur. | `index.ts`, `core/Server.ts`, `core/ConfigLoader.ts` |
| **schemas** | Décrire la forme de l'état synchronisé. **Aucune logique.** | `schemas/GameState.ts`, `schemas/Player.ts` |
| **systems** | Faire avancer la simulation d'un tick. Pures fonctions `(state, dt) → state`. | `systems/MovementSystem.ts`, `systems/PhysicsSystem.ts` |
| **rooms** | Orchestrer : lifecycle Colyseus + message handlers + tick pipeline. | `rooms/GameRoom.ts` |
| **data** | Tous les paramètres de gameplay, en JSON. Chargés 1× au démarrage. | `data/physics.json`, `data/room.json` |

**Le serveur est autoritaire** : le client envoie des `InputCommand`, le serveur calcule la nouvelle position, Colyseus diffuse les diffs. Le client ne mute jamais sa propre position.

## Arborescence

```
src/
├── index.ts                       # Bun entry — bootstrap
├── core/
│   ├── Server.ts                  # Colyseus + BunWebSockets, enregistre les rooms
│   └── ConfigLoader.ts            # Lit src/data/*.json, valide, fige, expose loadConfig()
├── rooms/
│   └── GameRoom.ts                # onCreate / onJoin / onLeave / onMessage / tick
├── schemas/
│   ├── GameState.ts               # MapSchema<Player>
│   └── Player.ts                  # id, x/y/z (sync) + vx/vy/vz/inputs (server-only)
├── systems/
│   ├── MovementSystem.ts          # input → velocity
│   └── PhysicsSystem.ts           # gravité, jump, intégration, collision sol
└── data/
    ├── physics.json               # gravity, jumpForce, moveSpeed, groundY
    └── room.json                  # maxPlayers, tickRate, spawnHeight, spawnSpread
```

## Conventions

1. **Toute fonction publique est documentée en TSDoc.** Projet collaboratif.
2. **Aucune constante de gameplay dans le code.** Tout passe par `loadConfig()`.
3. **Un module = une responsabilité.** Ajouter une feature = nouveau system + nouveau message dans `game-shared`, jamais grossir `GameRoom`.
4. **Les schemas ne contiennent QUE des données.** Pas de méthode, pas de logique. La logique est dans les systems.

## Commandes

```bash
bun install              # installe Colyseus + bun-websockets + @transcendence/game-shared
bun run dev              # bun --watch src/index.ts (hot-reload)
bun run start            # production-ish (pas de watch)
bun run typecheck        # tsc --noEmit
```

Variables d'environnement (voir `.env.example`) :

| Var | Défaut | Rôle |
|---|---|---|
| `PORT` | `4000` | port d'écoute du serveur |

## Ajouter un nouveau message client→serveur

1. Dans `game-shared` : ajouter la clé dans `ClientMessage` + l'interface du payload dans `types/messages.ts`.
2. Dans `GameRoom.onCreate` : `this.onMessage<MyPayload>(ClientMessage.MyMessage, …)`.
3. Si ça modifie l'état, déléguer à un system (ne pas inliner dans la room).

## Ajouter un nouveau system

1. Créer `src/systems/MySystem.ts` exposant `update(state, dt): void`.
2. Instancier dans `GameRoom.onCreate` avec la config dont il a besoin.
3. L'appeler depuis `GameRoom.tick` dans le bon ordre.

## TODO (hors scope du jalon Socket Test)

- Tests unitaires sur les systems (vitest, déjà installable).
- Logger structuré (pino) à la place de `console.log`.
- Graceful shutdown sur SIGTERM/SIGINT.
- Lag compensation / interpolation côté serveur.
- Validation runtime des payloads (Zod) avant qu'ils n'atteignent les systems.
