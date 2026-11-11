import {
  ARENA_RADIUS,
  MONSTER,
  MState,
  angleDiff,
  clamp,
  dist,
  lerp,
  monsterDur,
  turnToward,
  yawOf,
  type Fx,
} from "@pufflings/shared";

/**
 * Grumblepuff's brain: a timed state machine that runs only on the server.
 * It is pure with respect to its context, so tests can drive it with a fake
 * `MonsterCtx` and a seeded rng.
 */

export interface MonsterCore {
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  state: number;
  /** Flop landing point (telegraphed to clients). */
  tx: number;
  tz: number;
  enraged: boolean;
}

/** Server-only bookkeeping that never reaches clients. */
export interface MonsterMind {
  stateT: number;
  targetId: string;
  stun: number;
  stunThreshold: number;
  /** Where a flop started. */
  sx: number;
  sz: number;
  idleFor: number;
  decideAt: number;
  /** Hunters already hit by the current roll. */
  rolled: Set<string>;
}

export interface Target {
  id: string;
  x: number;
  z: number;
}

export interface MonsterCtx {
  /** Hunters the monster can currently go after. */
  targets: Target[];
  /** Damage every vulnerable hunter inside the circle. Returns who was hit. */
  strike(x: number, z: number, r: number, dmg: number, knock: number, skip?: Set<string>): string[];
  fx(e: Fx): void;
  rng(): number;
}

export function newMind(): MonsterMind {
  return {
    stateT: 0,
    targetId: "",
    stun: 0,
    stunThreshold: MONSTER.stunBase,
    sx: 0,
    sz: 0,
    idleFor: 1,
    decideAt: 1,
    rolled: new Set(),
  };
}

export function setState(m: MonsterCore, mind: MonsterMind, state: MState): void {
  m.state = state;
  mind.stateT = 0;
}

function dmg(m: MonsterCore, base: number): number {
  return Math.round(base * (m.enraged ? MONSTER.enrageFactor : 1));
}

function pickTarget(m: MonsterCore, ctx: MonsterCtx): Target | undefined {
  const ts = ctx.targets;
  if (ts.length === 0) return undefined;
  if (ctx.rng() < 0.65) {
    let best = ts[0];
    for (const t of ts) if (dist(t.x, t.z, m.x, m.z) < dist(best.x, best.z, m.x, m.z)) best = t;
    return best;
  }
  return ts[Math.floor(ctx.rng() * ts.length) % ts.length];
}

function toIdle(m: MonsterCore, mind: MonsterMind, ctx: MonsterCtx): void {
  if (!m.enraged && m.hp < m.maxHp * MONSTER.enrageAt) {
    m.enraged = true;
    setState(m, mind, MState.Roar);
    ctx.fx({ t: "enrage" });
    return;
  }
  setState(m, mind, MState.Idle);
  mind.idleFor = (0.25 + ctx.rng() * 0.5) * (m.enraged ? 0.6 : 1);
}

function face(m: MonsterCore, t: Target, dt: number, rate: number = MONSTER.turnRate): void {
  m.yaw = turnToward(m.yaw, yawOf(t.x - m.x, t.z - m.z), rate * dt);
}

function beginFlop(m: MonsterCore, mind: MonsterMind, t: Target): void {
  let dx = t.x - m.x;
  let dz = t.z - m.z;
  const d = Math.hypot(dx, dz);
  if (d > MONSTER.flopMaxRange) {
    dx *= MONSTER.flopMaxRange / d;
    dz *= MONSTER.flopMaxRange / d;
  }
  m.tx = m.x + dx;
  m.tz = m.z + dz;
  // Land where the body can actually be, so the telegraph matches the landing.
  const edge = ARENA_RADIUS - MONSTER.radius;
  const r = Math.hypot(m.tx, m.tz);
  if (r > edge) {
    m.tx *= edge / r;
    m.tz *= edge / r;
  }
  mind.sx = m.x;
  mind.sz = m.z;
  setState(m, mind, MState.FlopWindup);
}

function chooseAttack(m: MonsterCore, mind: MonsterMind, t: Target, ctx: MonsterCtx): boolean {
  const d = dist(t.x, t.z, m.x, m.z);
  const r = ctx.rng();
  if (d < 6.5) {
    if (r < 0.45) setState(m, mind, MState.SpinWindup);
    else if (r < 0.85) beginFlop(m, mind, t);
    else setState(m, mind, MState.RollWindup);
    return true;
  }
  if (d < MONSTER.flopMaxRange) {
    if (r < 0.55) beginFlop(m, mind, t);
    else setState(m, mind, MState.RollWindup);
    return true;
  }
  if (r < 0.6 || mind.stateT > 4) {
    setState(m, mind, MState.RollWindup);
    return true;
  }
  return false;
}

/** Advance the monster by `dt` seconds. */
export function stepMonster(m: MonsterCore, mind: MonsterMind, ctx: MonsterCtx, dt: number): void {
  if (m.state === MState.Absent || m.state === MState.Asleep) return;
  mind.stateT += dt;
  const t = mind.stateT;
  const dur = monsterDur(m.state, m.enraged);
  const target = ctx.targets.find((p) => p.id === mind.targetId);

  switch (m.state) {
    case MState.Enter:
    case MState.Roar:
    case MState.Stunned:
    case MState.FlopLand:
    case MState.RollRecover:
    case MState.SpinRecover:
      if (t >= dur) toIdle(m, mind, ctx);
      break;

    case MState.Idle: {
      if (t < mind.idleFor) break;
      const next = pickTarget(m, ctx);
      if (!next) {
        mind.stateT = 0;
        break;
      }
      mind.targetId = next.id;
      setState(m, mind, MState.Chase);
      mind.decideAt = 0.15 + ctx.rng() * 0.6;
      break;
    }

    case MState.Chase: {
      if (!target) {
        toIdle(m, mind, ctx);
        break;
      }
      face(m, target, dt);
      const d = dist(target.x, target.z, m.x, m.z);
      const facing = Math.abs(angleDiff(m.yaw, yawOf(target.x - m.x, target.z - m.z)));
      if (d > MONSTER.radius + 1.4 && facing < 1.2) {
        const speed = MONSTER.chaseSpeed * (m.enraged ? MONSTER.enrageFactor : 1);
        m.x += Math.sin(m.yaw) * speed * dt;
        m.z += Math.cos(m.yaw) * speed * dt;
      }
      if (t >= mind.decideAt && !chooseAttack(m, mind, target, ctx)) mind.decideAt = t + 0.8;
      break;
    }

    case MState.FlopWindup:
      if (target) face(m, { id: "", x: m.tx, z: m.tz }, dt, 6);
      if (t >= dur) setState(m, mind, MState.FlopAir);
      break;

    case MState.FlopAir: {
      const k = clamp(t / dur, 0, 1);
      m.x = lerp(mind.sx, m.tx, k);
      m.z = lerp(mind.sz, m.tz, k);
      if (t >= dur) {
        m.x = m.tx;
        m.z = m.tz;
        ctx.strike(m.x, m.z, MONSTER.flopRadius, dmg(m, MONSTER.flopDamage), 11);
        ctx.fx({ t: "land", x: m.x, z: m.z });
        setState(m, mind, MState.FlopLand);
      }
      break;
    }

    case MState.RollWindup:
      // Tracks the target, then commits to a direction for the last stretch.
      if (target && t < dur * 0.75) face(m, target, dt, 4);
      if (t >= dur) {
        mind.rolled.clear();
        setState(m, mind, MState.Roll);
      }
      break;

    case MState.Roll: {
      m.x += Math.sin(m.yaw) * MONSTER.rollSpeed * dt;
      m.z += Math.cos(m.yaw) * MONSTER.rollSpeed * dt;
      const hit = ctx.strike(m.x, m.z, MONSTER.radius + 0.7, dmg(m, MONSTER.rollDamage), 10, mind.rolled);
      for (const id of hit) mind.rolled.add(id);
      const edge = ARENA_RADIUS - MONSTER.radius;
      const r = Math.hypot(m.x, m.z);
      if (r > edge) {
        // Rolled into the bramble wall: bonk, and a free opening for hunters.
        m.x *= edge / r;
        m.z *= edge / r;
        ctx.fx({ t: "bonk", x: m.x, z: m.z });
        setState(m, mind, MState.Stunned);
      } else if (t >= dur) {
        setState(m, mind, MState.RollRecover);
      }
      break;
    }

    case MState.SpinWindup:
      if (t >= dur) {
        ctx.strike(m.x, m.z, MONSTER.spinRadius, dmg(m, MONSTER.spinDamage), 12);
        ctx.fx({ t: "spin", x: m.x, z: m.z });
        setState(m, mind, MState.Spin);
      }
      break;

    case MState.Spin:
      if (t >= dur) setState(m, mind, MState.SpinRecover);
      break;
  }

  // Keep the body inside the meadow whatever the state did.
  const r = Math.hypot(m.x, m.z);
  const edge = ARENA_RADIUS - MONSTER.radius;
  if (r > edge) {
    m.x *= edge / r;
    m.z *= edge / r;
  }
}

/** States in which stun buildup cannot topple the monster. */
const UNSTUNNABLE = new Set<number>([MState.Enter, MState.FlopAir, MState.Stunned, MState.Asleep, MState.Absent]);

/** Apply a hunter's hit. Returns true if this hit put the monster to sleep. */
export function damageMonster(
  m: MonsterCore,
  mind: MonsterMind,
  amount: number,
  stun: number,
  head: boolean,
  ctx: Pick<MonsterCtx, "fx">,
): boolean {
  if (m.state === MState.Absent || m.state === MState.Asleep || m.state === MState.Enter) return false;
  m.hp = Math.max(0, m.hp - amount);
  if (m.hp <= 0) {
    setState(m, mind, MState.Asleep);
    ctx.fx({ t: "sleep" });
    return true;
  }
  mind.stun += head ? stun : stun * 0.35;
  if (mind.stun >= mind.stunThreshold && !UNSTUNNABLE.has(m.state)) {
    mind.stun = 0;
    mind.stunThreshold += MONSTER.stunStep;
    setState(m, mind, MState.Stunned);
    ctx.fx({ t: "stun" });
  }
  return false;
}
