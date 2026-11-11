import { Room, type Client } from "colyseus";
import {
  Act,
  C2S,
  CAMP,
  DT,
  FAINT_SECONDS,
  HUNTER_COLORS,
  HUNT_SECONDS,
  MAX_FAINTS,
  MAX_PLAYERS,
  MONSTER,
  MONSTER_SPAWN,
  MState,
  PLAYER,
  RESULT_SECONDS,
  S2C,
  dist,
  hurtPlayer,
  isInvulnerable,
  monsterMaxHp,
  monsterSolid,
  stepPlayer,
  type Fx,
  type JoinOptions,
  type LootItem,
  type Phase,
  type PlayerInput,
  type ResultMsg,
  type StepWorld,
} from "@pufflings/shared";
import { resolveStrike, rollLoot } from "../combat";
import { damageMonster, newMind, setState, stepMonster, type MonsterCtx, type MonsterMind } from "../monsterAI";
import { HuntState, PlayerState } from "../schema";

const STEP_MS = 1000 * DT;
/** Inputs a hunter may bank; bounds how far a client can run ahead of real time. */
const INPUT_BURST = 8;
const INPUT_QUEUE_MAX = 30;
/**
 * A hunter is normally stepped once per input its client sends. If a client
 * goes quiet (closed laptop, background tab, stalled network) for this many
 * ticks, the server steps the hunter itself so its timers keep running and it
 * stays a normal, hittable hunter.
 */
const STARVED_TICKS = 10;
const IDLE_INPUT = { mx: 0, mz: 0, buttons: 0 };
/** Protection after joining or waking at camp, so nobody is hit on arrival. */
const GRACE_SECONDS = 3;

interface Seat {
  inputs: PlayerInput[];
  /** Token bucket: one token per server tick, one spent per applied input. */
  tokens: number;
  /** Seconds until a fainted hunter wakes at camp; 0 when not fainted. */
  wakeIn: number;
  /** Server ticks in a row with no input from this client. */
  starved: number;
  /** Seconds of protection left after joining or waking up at camp. */
  grace: number;
}

interface HuntRoomOptions {
  private?: boolean;
}

export class HuntRoom extends Room {
  maxClients = MAX_PLAYERS;
  state = new HuntState();

  private seats = new Map<string, Seat>();
  private mind: MonsterMind = newMind();
  private damage = new Map<string, number>();
  private acc = 0;
  private phaseT = 0;
  private huntT = 0;

  private monsterCtx: MonsterCtx = {
    targets: [],
    rng: Math.random,
    fx: (e) => this.fx(e),
    strike: (x, z, r, dmg, knock, skip) => this.strikeHunters(x, z, r, dmg, knock, skip),
  };

  onCreate(options: HuntRoomOptions = {}) {
    if (options.private) void this.setPrivate(true);
    this.setPatchRate(STEP_MS);

    this.onMessage(C2S.Input, (client, msg: PlayerInput) => {
      const seat = this.seats.get(client.sessionId);
      if (!seat || typeof msg !== "object" || msg === null) return;
      if (seat.inputs.length >= INPUT_QUEUE_MAX) seat.inputs.shift();
      seat.inputs.push({
        seq: Number(msg.seq) >>> 0,
        mx: Number(msg.mx) || 0,
        mz: Number(msg.mz) || 0,
        buttons: Number(msg.buttons) & 0xf,
      });
    });

    this.onMessage(C2S.StartHunt, () => {
      if (this.state.phase === "camp") this.startHunt();
    });

    this.setSimulationInterval((ms) => this.update(ms), STEP_MS);
  }

  onJoin(client: Client, options: JoinOptions = {}) {
    const p = new PlayerState();
    const name = String(options.name ?? "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 12);
    p.name = name || `Hunter ${this.state.players.size + 1}`;
    p.color = Math.abs(Number(options.color) | 0) % HUNTER_COLORS.length;
    this.placeAtCamp(p, this.state.players.size);
    this.state.players.set(client.sessionId, p);
    this.seats.set(client.sessionId, { inputs: [], tokens: INPUT_BURST, wakeIn: 0, starved: 0, grace: GRACE_SECONDS });
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.seats.delete(client.sessionId);
    this.damage.delete(client.sessionId);
  }

  // ---------------------------------------------------------------- loop

  private update(ms: number) {
    this.acc += ms;
    let steps = 0;
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      if (++steps > 5) {
        this.acc = 0;
        break;
      }
      this.tick();
    }
  }

  private tick() {
    const s = this.state;
    const m = s.monster;
    const hunting = s.phase === "hunt";

    const world: StepWorld = {
      monsterSolid: monsterSolid(m.state),
      monsterX: m.x,
      monsterZ: m.z,
      monsterRadius: MONSTER.radius,
    };

    s.players.forEach((p, id) => {
      const seat = this.seats.get(id);
      if (!seat) return;
      seat.tokens = Math.min(INPUT_BURST, seat.tokens + 1);
      seat.grace = Math.max(0, seat.grace - DT);
      seat.starved += 1;
      while (seat.inputs.length > 0 && seat.tokens >= 1) {
        seat.tokens -= 1;
        seat.starved = 0;
        const input = seat.inputs.shift()!;
        const strike = stepPlayer(p, input, world);
        p.seq = input.seq;
        if (strike && hunting) this.hunterStrikes(id, p, strike);
      }
      if (seat.starved > STARVED_TICKS) {
        const strike = stepPlayer(p, { seq: p.seq, ...IDLE_INPUT }, world);
        if (strike && hunting) this.hunterStrikes(id, p, strike);
      }
      if (seat.wakeIn > 0) {
        seat.wakeIn -= DT;
        if (seat.wakeIn <= 0) this.wake(id, p);
      }
    });

    if (hunting) {
      this.huntT += DT;
      s.timeLeft = Math.max(0, HUNT_SECONDS - this.huntT);
      const ctx = this.monsterCtx;
      ctx.targets = [];
      s.players.forEach((p, id) => {
        if (p.act !== Act.Faint) ctx.targets.push({ id, x: p.x, z: p.z });
      });
      stepMonster(m, this.mind, ctx, DT);
      if (s.phase === "hunt" && s.timeLeft <= 0) this.endHunt(false, "time");
      // A hunt can fail in the middle of the monster's own step (its strike
      // caused the last faint); make sure it has left once the step is over.
      if (s.phase === "failed" && m.state !== MState.Absent) setState(m, this.mind, MState.Absent);
    } else if (s.phase === "victory" || s.phase === "failed") {
      this.phaseT += DT;
      if (this.phaseT >= RESULT_SECONDS) this.backToCamp();
    }
  }

  // -------------------------------------------------------------- combat

  private hunterStrikes(id: string, p: PlayerState, act: number) {
    const m = this.state.monster;
    if (!monsterSolid(m.state) || m.state === MState.Asleep) return;
    const hit = resolveStrike(p, act, m);
    if (!hit) return;
    this.damage.set(id, (this.damage.get(id) ?? 0) + hit.dmg);
    this.fx({ t: "hit", x: hit.x, z: hit.z, dmg: hit.dmg, head: hit.head, by: id });
    if (damageMonster(m, this.mind, hit.dmg, hit.stun, hit.head, this.monsterCtx)) {
      this.endHunt(true, "sleep");
    }
  }

  private strikeHunters(x: number, z: number, r: number, dmg: number, knock: number, skip?: Set<string>): string[] {
    const hit: string[] = [];
    if (this.state.phase !== "hunt") return hit;
    this.state.players.forEach((p, id) => {
      if (skip?.has(id) || isInvulnerable(p)) return;
      if ((this.seats.get(id)?.grace ?? 0) > 0) return;
      if (dist(p.x, p.z, x, z) > r + PLAYER.radius) return;
      hurtPlayer(p, dmg, x, z, knock);
      hit.push(id);
      this.fx({ t: "hurt", id, dmg });
      if (p.act === Act.Faint) this.faint(id);
    });
    return hit;
  }

  private faint(id: string) {
    const seat = this.seats.get(id);
    if (seat) seat.wakeIn = FAINT_SECONDS;
    this.state.faints += 1;
    this.fx({ t: "faint", id });
    if (this.state.faints >= MAX_FAINTS) this.endHunt(false, "faints");
  }

  private wake(id: string, p: PlayerState) {
    const seat = this.seats.get(id);
    if (seat) {
      seat.wakeIn = 0;
      seat.grace = GRACE_SECONDS;
    }
    this.placeAtCamp(p, [...this.state.players.keys()].indexOf(id));
    p.hp = PLAYER.maxHp;
    p.stamina = PLAYER.maxStamina;
    p.act = Act.Idle;
    p.actT = 0;
    p.kx = 0;
    p.kz = 0;
    p.queued = 0;
    this.fx({ t: "revive", id });
  }

  // -------------------------------------------------------------- phases

  private setPhase(phase: Phase) {
    this.state.phase = phase;
    this.phaseT = 0;
  }

  private startHunt() {
    const s = this.state;
    const m = s.monster;
    m.maxHp = monsterMaxHp(s.players.size);
    m.hp = m.maxHp;
    m.x = MONSTER_SPAWN.x;
    m.z = MONSTER_SPAWN.z;
    m.yaw = 0;
    m.enraged = false;
    this.mind = newMind();
    setState(m, this.mind, MState.Enter);
    this.damage.clear();
    this.huntT = 0;
    s.faints = 0;
    s.timeLeft = HUNT_SECONDS;
    s.players.forEach((p) => {
      p.hp = PLAYER.maxHp;
      p.berries = PLAYER.berries;
    });
    this.setPhase("hunt");
    this.fx({ t: "start" });
    this.fx({ t: "roar" });
  }

  private endHunt(victory: boolean, reason: ResultMsg["reason"]) {
    if (this.state.phase !== "hunt") return;
    const m = this.state.monster;
    if (!victory) setState(m, this.mind, MState.Absent);
    const loot: Record<string, LootItem[]> = {};
    const damage: Record<string, number> = {};
    this.state.players.forEach((_p, id) => {
      loot[id] = victory ? rollLoot(Math.random) : [];
      damage[id] = this.damage.get(id) ?? 0;
    });
    this.setPhase(victory ? "victory" : "failed");
    const result: ResultMsg = { victory, reason, seconds: Math.round(this.huntT), loot, damage };
    this.broadcast(S2C.Result, result);
  }

  private backToCamp() {
    const s = this.state;
    setState(s.monster, this.mind, MState.Absent);
    s.faints = 0;
    s.timeLeft = 0;
    let slot = 0;
    s.players.forEach((p, id) => {
      if (p.act === Act.Faint) this.wake(id, p);
      // Everyone really does return to camp for the next hunt.
      this.placeAtCamp(p, slot++);
      p.hp = PLAYER.maxHp;
      p.stamina = PLAYER.maxStamina;
      p.berries = PLAYER.berries;
    });
    this.setPhase("camp");
  }

  // ------------------------------------------------------------- helpers

  private placeAtCamp(p: PlayerState, index: number) {
    const slot = Math.max(0, index) % MAX_PLAYERS;
    p.x = CAMP.x + (slot - (MAX_PLAYERS - 1) / 2) * 2.2;
    p.z = CAMP.z - 2;
    p.yaw = Math.PI;
  }

  private fx(e: Fx) {
    this.broadcast(S2C.Fx, e);
  }
}
