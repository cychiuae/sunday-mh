/**
 * Bot playtest: joins a room with N scripted hunters over the real network
 * protocol, runs one full hunt, and prints what happened.
 *
 *   npm run playtest                    # 2 bots against ws://localhost:2567
 *   BOTS=4 SKILL=0.9 npm run playtest   # 4 bots that dodge 90% of attacks
 *   URL=wss://example.com npm run playtest
 *
 * Exits 0 when the hunt reaches a result (win or loss), 1 on timeout/error.
 */
import { Client, type Room } from "@colyseus/sdk";
import {
  ATTACKS,
  Act,
  Btn,
  C2S,
  DT,
  MONSTER,
  MState,
  ROOM_NAME,
  S2C,
  SERVER_PORT,
  angleDiff,
  dist,
  yawOf,
  type Fx,
  type PlayerInput,
  type ResultMsg,
  type RoomView,
} from "@pufflings/shared";

const URL = process.env.URL ?? `ws://localhost:${SERVER_PORT}`;
const BOTS = Number(process.env.BOTS ?? 2);
const SKILL = Number(process.env.SKILL ?? 0.7);
const TIMEOUT_S = Number(process.env.TIMEOUT ?? 600);

const DANGER = new Set<number>([MState.FlopWindup, MState.RollWindup, MState.SpinWindup, MState.Roll, MState.FlopAir]);

interface Bot {
  room: Room<any, RoomView>;
  seq: number;
  /** Whether this bot decided to dodge the current monster attack. */
  willDodge: boolean;
  lastMonsterState: number;
  hurt: number;
}

const fxCount: Record<string, number> = {};
let result: ResultMsg | null = null;

async function spawn(i: number, roomId?: string): Promise<Bot> {
  const client = new Client(URL);
  const opts = { name: `Bot ${i + 1}`, color: i };
  const room: Room<any, RoomView> = roomId
    ? await client.joinById(roomId, opts)
    : await client.create(ROOM_NAME, { ...opts, private: true });
  const bot: Bot = { room, seq: 0, willDodge: false, lastMonsterState: -1, hurt: 0 };
  room.onMessage(S2C.Fx, (e: Fx) => {
    if (i === 0) fxCount[e.t] = (fxCount[e.t] ?? 0) + 1;
    if (e.t === "hurt" && e.id === room.sessionId) bot.hurt++;
  });
  room.onMessage(S2C.Result, (r: ResultMsg) => {
    result = r;
  });
  return bot;
}

function think(bot: Bot): PlayerInput {
  const s = bot.room.state;
  const input: PlayerInput = { seq: ++bot.seq, mx: 0, mz: 0, buttons: 0 };
  const me = s?.players?.get(bot.room.sessionId);
  if (!me || !s.monster) return input;
  const m = s.monster;

  if (s.phase !== "hunt" || m.state === MState.Absent || m.state === MState.Asleep) return input;

  if (m.state !== bot.lastMonsterState) {
    bot.lastMonsterState = m.state;
    bot.willDodge = Math.random() < SKILL;
  }

  const dx = m.x - me.x;
  const dz = m.z - me.z;
  const d = Math.hypot(dx, dz) || 1;

  if (me.hp < 45 && me.berries > 0 && d > 7 && me.act === Act.Idle) {
    input.buttons |= Btn.Eat;
    return input;
  }

  if (DANGER.has(m.state) && bot.willDodge) {
    // Run out of the telegraphed area; roll through it if it is about to land.
    let ax = -dx / d;
    let az = -dz / d;
    if (m.state === MState.FlopWindup || m.state === MState.FlopAir) {
      const fx = me.x - m.tx;
      const fz = me.z - m.tz;
      const fd = Math.hypot(fx, fz) || 1;
      if (fd > MONSTER.flopRadius + 1.5) return approach(input, me, m, d, dx, dz);
      ax = fx / fd;
      az = fz / fd;
    } else if (m.state === MState.RollWindup || m.state === MState.Roll) {
      // Step sideways out of the rolling lane.
      const side = Math.sign(Math.sin(m.yaw) * dz - Math.cos(m.yaw) * dx) || 1;
      ax = Math.cos(m.yaw) * side;
      az = -Math.sin(m.yaw) * side;
      const lateral = Math.abs(Math.sin(m.yaw) * -dz - Math.cos(m.yaw) * -dx);
      if (lateral > MONSTER.radius + 2) return approach(input, me, m, d, dx, dz);
    } else if (d > MONSTER.spinRadius + 1.5) {
      return input;
    }
    input.mx = ax;
    input.mz = az;
    if (me.stamina > 40 && Math.random() < 0.15) input.buttons |= Btn.Dodge;
    return input;
  }

  return approach(input, me, m, d, dx, dz);
}

function approach(
  input: PlayerInput,
  me: { x: number; z: number; yaw: number; act: number },
  m: { x: number; z: number; state: number },
  d: number,
  dx: number,
  dz: number,
): PlayerInput {
  const reach = MONSTER.radius + ATTACKS[Act.Light1].reach - 0.6;
  if (d > reach) {
    input.mx = dx / d;
    input.mz = dz / d;
    return input;
  }
  const off = Math.abs(angleDiff(me.yaw, yawOf(dx, dz)));
  if (off > 0.5) {
    input.mx = (dx / d) * 0.3;
    input.mz = (dz / d) * 0.3;
  }
  input.buttons |= m.state === MState.Stunned && me.act === Act.Idle ? Btn.Heavy : Btn.Attack;
  return input;
}

async function main() {
  const bots: Bot[] = [await spawn(0)];
  for (let i = 1; i < BOTS; i++) bots.push(await spawn(i, bots[0].room.roomId));
  console.log(`[playtest] ${BOTS} bots joined room ${bots[0].room.roomId} at ${URL}`);

  await new Promise((r) => setTimeout(r, 500));
  const s0 = bots[0].room.state;
  if (s0.players.size !== BOTS) throw new Error(`expected ${BOTS} players in state, saw ${s0.players.size}`);
  bots[0].room.send(C2S.StartHunt);

  const started = Date.now();
  let maxSpread = 0;
  await new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      for (const bot of bots) bot.room.send(C2S.Input, think(bot));
      // Every client must agree on where the monster is.
      const xs = bots.map((b) => b.room.state.monster.x);
      maxSpread = Math.max(maxSpread, Math.max(...xs) - Math.min(...xs));
      if (result) {
        clearInterval(timer);
        resolve();
      } else if ((Date.now() - started) / 1000 > TIMEOUT_S) {
        clearInterval(timer);
        reject(new Error("timed out waiting for a hunt result"));
      }
    }, 1000 * DT);
  });

  const r = result!;
  const s = bots[0].room.state;
  console.log(`[playtest] result: ${r.victory ? "VICTORY" : "FAILED"} (${r.reason}) in ${r.seconds}s`);
  console.log(`[playtest] faints: ${s.faints}, monster hp: ${Math.round(s.monster.hp)}/${s.monster.maxHp}`);
  console.log(`[playtest] damage: ${JSON.stringify(r.damage)}`);
  console.log(`[playtest] times hurt per bot: ${bots.map((b) => b.hurt).join(", ")}`);
  console.log(`[playtest] fx seen: ${JSON.stringify(fxCount)}`);
  console.log(`[playtest] loot (bot 1): ${JSON.stringify(r.loot[bots[0].room.sessionId])}`);
  console.log(`[playtest] max monster-x disagreement between clients: ${maxSpread.toFixed(3)}`);
  const me = s.players.get(bots[0].room.sessionId)!;
  console.log(`[playtest] bot 1 ended at (${me.x.toFixed(1)}, ${me.z.toFixed(1)}), far from monster by ${dist(me.x, me.z, s.monster.x, s.monster.z).toFixed(1)}`);
  await Promise.all(bots.map((b) => b.room.leave()));
  process.exit(0);
}

main().catch((err) => {
  console.error("[playtest] error:", err);
  process.exit(1);
});
