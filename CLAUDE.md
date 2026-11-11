# Pufflings

A cozy online co-op monster-hunting game for the browser. Up to four chibi hunters share a meadow, read a big grumpy monster's attacks, and bonk it with mallets until it falls asleep.

Stack: TypeScript everywhere. `shared/` (rules and wire contract), `server/` (Colyseus 0.18 authoritative room), `client/` (Vite + Three.js).

## Pillars

1. **Hunting action**: learn the monster, position, commit to a swing, dodge on the telegraph. Skill beats stats.
2. **Cute and gentle**: round pastel toy-box look. Nobody dies: hunters get dizzy, monsters get sleepy.
3. **Together online**: joining friends is one link. The game is designed for 2-4 and playable solo.
4. **Our own world**: every name, creature, look, and sound is original to Pufflings. Take inspiration from the hunting genre's mechanics; invent everything the player sees and hears.

## How the code is shaped

- **The server decides; the client draws.** `HuntRoom` owns all game state. The client sends inputs and intents.
- **`stepPlayer` (`shared/src/player.ts`) is the one hunter simulation.** The server runs it once per received input; the client runs it to predict its own hunter and to replay unacknowledged inputs. It stays pure and deterministic.
- **The wire contract is `shared/src/protocol.ts` + `server/src/schema.ts`.** Field names match between them; change both together.
- **Numbers live in shared tables** (`PLAYER`, `ATTACKS`, `MONSTER`, `DUR`). Server logic, client telegraphs, and animations all read the same table, which is what keeps a telegraph honest.
- **Monster AI is server-only** (`server/src/monsterAI.ts`). Clients see `state` + position and time their animation from when the state changed. One-shot moments are `Fx` messages.
- **Yaw convention:** forward = `(sin yaw, cos yaw)`; models are built facing +Z.
- **No asset files.** Models are code-built primitives (`client/src/render/toon.ts`), sounds are synthesised (`client/src/audio.ts`).

## Verify

Scripts are in the root `package.json`. A change is done when every gate that applies is green:

1. `npm run typecheck` and `npm test`.
2. Bot hunt over the real protocol: with the server running (`npm start`), `BOTS=3 SKILL=0.5 npm run playtest`.
3. Real clients: `npm run build`, restart the server, `npm run playtest:browser`, then look at the screenshots in `playtest-shots/`.

Gotchas no config will tell you:

- The server serves `client/dist` only if it existed when the server started. After the first build, restart it.
- Dev runs two ports: Vite on 5173, game server on 2567. A production build is one port (`PORT`, default 2567).
- If headless Chromium fails on a missing shared library, run `tools/setup-browser-libs.sh` once.
- To stop a server, kill the process listening on the port. `pkill -f` with the start command also matches your own shell.

## The studio

The main session is the studio director: it breaks a request into work for the owners below, delegates, and has `qa-playtester` verify the result. Each agent's file in `.claude/agents/` lists the code it owns.

| Agent | Call on it for |
| --- | --- |
| `game-designer` | Mechanics, hunt flow, loot, difficulty, tuning numbers |
| `gameplay-engineer` | Hunter movement, attacks, hit detection, controls, camera |
| `netcode-engineer` | Room, schema, protocol, prediction and sync, hosting |
| `monster-engineer` | Monster AI, attack patterns, new monsters |
| `tech-artist` | Models, animation, telegraphs, VFX, scenery, look |
| `ui-engineer` | HUD, menus, invite flow, result screens |
| `audio-designer` | Sound effects, music, mix |
| `qa-playtester` | Tests, bot hunts, browser playtests, bug reproduction |

A feature that crosses owners follows the data: designer specifies → engineers change `shared/` and `server/` → artist, UI, and audio make it visible and audible → QA verifies.
