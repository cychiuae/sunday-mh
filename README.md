# Pufflings

Cozy online co-op monster hunting in the browser. Team up with up to three friends, learn Grumblepuff's attacks, and bonk it with your mallet until it falls fast asleep.

## Play locally

```bash
npm install
npm run dev        # game server on :2567, client on http://localhost:5173
```

Open http://localhost:5173, pick a name and hood colour, and choose **Quick Hunt**. Open a second tab (or another computer on your network, using your machine's IP) to play together.

## Play with friends online

One Node process serves both the game and the multiplayer sockets:

```bash
npm run build
PORT=2567 npm start
```

Host that process anywhere that runs Node (built and tested on Node 24) and allows WebSockets, and share its URL. For a private hunt, choose **Host a private hunt** and send friends the invite link from the camp panel (**Copy link**); they can also paste the invite code into the menu.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse (click the game first) or arrow keys | Look around |
| Left click / `J` | Mallet swing (press again to chain a 3-hit combo) |
| Right click / `K` | Big smash (slow, strong, builds dizziness) |
| `Space` | Roll (briefly passes through attacks, costs stamina) |
| `E` | Eat a berry (heals; three per hunt) |
| `Enter` | Start the hunt from camp |

## How a hunt works

- Everyone gathers at camp. Anyone can start the hunt.
- Grumblepuff shows where each attack will land in pink before it happens: step out or roll through.
- Bonks to the face do extra damage and make it dizzy. If its roll hits the bramble wall, it bonks itself.
- Below half health it gets grumpy: faster and harder-hitting.
- Fill its Sleepiness bar to win and collect loot. The hunt fails after three dizzy hunters or eight minutes.

## Development

```bash
npm run typecheck          # all three packages
npm test                   # unit tests (hunter rules, monster AI, combat)
npm run playtest           # bot hunters play a full hunt against a running server
npm run playtest:browser   # two real clients in headless Chromium, with screenshots
```

`CLAUDE.md` describes the architecture and the studio of Claude Code subagents (`.claude/agents/`) that work on the game.
