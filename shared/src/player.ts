import { ARENA_RADIUS, DT } from "./constants";
import { turnToward, yawOf } from "./math";

/**
 * Hunter simulation. `stepPlayer` is the single source of truth for how a
 * hunter moves and acts: the server runs it once per received input, and the
 * client runs the very same function to predict and to replay unacknowledged
 * inputs. Keep it deterministic: no clocks, no randomness, no I/O.
 */

export enum Act {
  Idle = 0,
  Light1 = 1,
  Light2 = 2,
  Light3 = 3,
  Heavy = 4,
  Dodge = 5,
  Hit = 6,
  Eat = 7,
  Faint = 8,
}

/** Button bit flags. Each flag means "pressed during this input tick". */
export const Btn = { Attack: 1, Heavy: 2, Dodge: 4, Eat: 8 } as const;

export const PLAYER = {
  radius: 0.5,
  speed: 6.5,
  turnRate: 16,
  maxHp: 100,
  maxStamina: 100,
  staminaRegen: 22,
  dodgeCost: 25,
  dodgeDur: 0.5,
  dodgeIFrameEnd: 0.34,
  dodgeSpeed: 13,
  hitDur: 0.7,
  eatDur: 1.3,
  eatHeal: 45,
  eatSpeedFactor: 0.35,
  berries: 3,
} as const;

export interface AttackDef {
  /** Total length in seconds. */
  dur: number;
  /** Moment the mallet connects. */
  hitAt: number;
  /** From here a buffered button chains into the next action. */
  cancelAt: number;
  dmg: number;
  stun: number;
  /** Distance from the hunter's centre that the swing covers. */
  reach: number;
  /** Half-angle of the swing arc, radians. */
  arc: number;
  /** Forward speed while winding up. */
  lunge: number;
}

export const ATTACKS: Record<number, AttackDef> = {
  [Act.Light1]: { dur: 0.45, hitAt: 0.18, cancelAt: 0.28, dmg: 8, stun: 3, reach: 2.5, arc: 1.25, lunge: 3 },
  [Act.Light2]: { dur: 0.5, hitAt: 0.2, cancelAt: 0.32, dmg: 10, stun: 4, reach: 2.5, arc: 1.25, lunge: 3 },
  [Act.Light3]: { dur: 0.85, hitAt: 0.36, cancelAt: 0.62, dmg: 18, stun: 10, reach: 2.7, arc: 0.9, lunge: 4 },
  [Act.Heavy]: { dur: 1.15, hitAt: 0.62, cancelAt: 0.92, dmg: 32, stun: 24, reach: 2.9, arc: 0.9, lunge: 1.5 },
};

const NEXT_LIGHT: Record<number, Act> = {
  [Act.Light1]: Act.Light2,
  [Act.Light2]: Act.Light3,
  [Act.Light3]: Act.Light1,
  [Act.Heavy]: Act.Light1,
};

export function isAttack(act: number): boolean {
  return act >= Act.Light1 && act <= Act.Heavy;
}

/** The predicted part of a hunter. Mirrors the synced schema fields. */
export interface PlayerCore {
  x: number;
  z: number;
  yaw: number;
  act: number;
  /** Seconds elapsed in the current action. */
  actT: number;
  hp: number;
  stamina: number;
  berries: number;
  /** Dodge or knockback velocity. */
  kx: number;
  kz: number;
  /** Buttons buffered during an attack, consumed at its cancel point. */
  queued: number;
}

export interface PlayerInput {
  seq: number;
  /** World-space move direction, length 0..1. */
  mx: number;
  mz: number;
  buttons: number;
}

/** What a hunter can bump into. */
export interface StepWorld {
  monsterSolid: boolean;
  monsterX: number;
  monsterZ: number;
  monsterRadius: number;
}

export function newPlayerCore(x: number, z: number): PlayerCore {
  return {
    x,
    z,
    yaw: Math.PI,
    act: Act.Idle,
    actT: 0,
    hp: PLAYER.maxHp,
    stamina: PLAYER.maxStamina,
    berries: PLAYER.berries,
    kx: 0,
    kz: 0,
    queued: 0,
  };
}

export const CORE_KEYS = [
  "x", "z", "yaw", "act", "actT", "hp", "stamina", "berries", "kx", "kz", "queued",
] as const satisfies readonly (keyof PlayerCore)[];

export function copyCore(from: PlayerCore, to: PlayerCore): void {
  for (const k of CORE_KEYS) to[k] = from[k];
}

function toIdle(p: PlayerCore): void {
  p.act = Act.Idle;
  p.actT = 0;
  p.queued = 0;
}

function startAttack(p: PlayerCore, act: Act, mx: number, mz: number, moving: boolean): void {
  if (moving) p.yaw = yawOf(mx, mz);
  p.act = act;
  p.actT = 0;
  p.queued = 0;
}

function tryDodge(p: PlayerCore, mx: number, mz: number, moving: boolean): boolean {
  if (p.stamina < PLAYER.dodgeCost) return false;
  p.stamina -= PLAYER.dodgeCost;
  if (moving) p.yaw = yawOf(mx, mz);
  p.kx = Math.sin(p.yaw) * PLAYER.dodgeSpeed;
  p.kz = Math.cos(p.yaw) * PLAYER.dodgeSpeed;
  p.act = Act.Dodge;
  p.actT = 0;
  p.queued = 0;
  return true;
}

function walk(p: PlayerCore, mx: number, mz: number, moving: boolean, speed: number, dt: number): void {
  if (!moving) return;
  p.x += mx * speed * dt;
  p.z += mz * speed * dt;
  p.yaw = turnToward(p.yaw, yawOf(mx, mz), PLAYER.turnRate * dt);
}

function collide(p: PlayerCore, w: StepWorld): void {
  if (w.monsterSolid) {
    const dx = p.x - w.monsterX;
    const dz = p.z - w.monsterZ;
    const min = w.monsterRadius + PLAYER.radius;
    const d = Math.hypot(dx, dz);
    if (d < min) {
      if (d < 1e-4) {
        p.z += min;
      } else {
        p.x = w.monsterX + (dx / d) * min;
        p.z = w.monsterZ + (dz / d) * min;
      }
    }
  }
  const r = Math.hypot(p.x, p.z);
  const max = ARENA_RADIUS - PLAYER.radius;
  if (r > max) {
    p.x *= max / r;
    p.z *= max / r;
  }
}

/**
 * Advance one hunter by one input. Returns the attack whose hit moment was
 * crossed during this step (the server resolves the hit), or 0.
 */
export function stepPlayer(p: PlayerCore, input: PlayerInput, world: StepWorld, dt: number = DT): Act | 0 {
  let mx = Number.isFinite(input.mx) ? input.mx : 0;
  let mz = Number.isFinite(input.mz) ? input.mz : 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const moving = len > 0.01;
  const b = input.buttons | 0;
  let strike: Act | 0 = 0;

  if (p.act !== Act.Dodge && p.act !== Act.Faint) {
    p.stamina = Math.min(PLAYER.maxStamina, p.stamina + PLAYER.staminaRegen * dt);
  }

  switch (p.act) {
    case Act.Faint:
      return 0;

    case Act.Hit: {
      p.x += p.kx * dt;
      p.z += p.kz * dt;
      const damp = Math.max(0, 1 - 6 * dt);
      p.kx *= damp;
      p.kz *= damp;
      p.actT += dt;
      if (p.actT >= PLAYER.hitDur) toIdle(p);
      break;
    }

    case Act.Dodge: {
      const k = 1 - 0.7 * (p.actT / PLAYER.dodgeDur);
      p.x += p.kx * k * dt;
      p.z += p.kz * k * dt;
      p.actT += dt;
      if (p.actT >= PLAYER.dodgeDur) toIdle(p);
      break;
    }

    case Act.Eat: {
      if (b & Btn.Dodge && tryDodge(p, mx, mz, moving)) break;
      walk(p, mx, mz, moving, PLAYER.speed * PLAYER.eatSpeedFactor, dt);
      p.actT += dt;
      if (p.actT >= PLAYER.eatDur) {
        p.hp = Math.min(PLAYER.maxHp, p.hp + PLAYER.eatHeal);
        p.berries -= 1;
        toIdle(p);
      }
      break;
    }

    case Act.Idle: {
      if (b & Btn.Dodge && tryDodge(p, mx, mz, moving)) break;
      if (b & Btn.Heavy) {
        startAttack(p, Act.Heavy, mx, mz, moving);
        break;
      }
      if (b & Btn.Attack) {
        startAttack(p, Act.Light1, mx, mz, moving);
        break;
      }
      if (b & Btn.Eat && p.berries > 0 && p.hp < PLAYER.maxHp) {
        p.act = Act.Eat;
        p.actT = 0;
        break;
      }
      walk(p, mx, mz, moving, PLAYER.speed, dt);
      break;
    }

    default: {
      const def = ATTACKS[p.act];
      if (!def) {
        toIdle(p);
        break;
      }
      p.queued |= b & (Btn.Attack | Btn.Heavy | Btn.Dodge);
      const before = p.actT;
      p.actT += dt;
      if (before < def.hitAt) {
        p.x += Math.sin(p.yaw) * def.lunge * dt;
        p.z += Math.cos(p.yaw) * def.lunge * dt;
        if (p.actT >= def.hitAt) strike = p.act as Act;
      }
      if (p.actT >= def.cancelAt && p.queued) {
        const q = p.queued;
        if (q & Btn.Dodge) {
          if (tryDodge(p, mx, mz, moving)) break;
          p.queued &= ~Btn.Dodge;
        }
        if (q & Btn.Heavy) startAttack(p, Act.Heavy, mx, mz, moving);
        else if (q & Btn.Attack) startAttack(p, NEXT_LIGHT[p.act] ?? Act.Light1, mx, mz, moving);
      }
      if (isAttack(p.act) && p.actT >= ATTACKS[p.act].dur) toIdle(p);
      break;
    }
  }

  collide(p, world);
  return strike;
}

/** True while a monster attack passes through the hunter. */
export function isInvulnerable(p: PlayerCore): boolean {
  if (p.act === Act.Faint || p.act === Act.Hit) return true;
  return p.act === Act.Dodge && p.actT < PLAYER.dodgeIFrameEnd;
}

/** Server-side: apply monster damage and knockback away from a point. */
export function hurtPlayer(p: PlayerCore, dmg: number, fromX: number, fromZ: number, knock: number): void {
  p.hp = Math.max(0, p.hp - dmg);
  p.queued = 0;
  p.actT = 0;
  if (p.hp <= 0) {
    p.act = Act.Faint;
    p.kx = 0;
    p.kz = 0;
    return;
  }
  let dx = p.x - fromX;
  let dz = p.z - fromZ;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) {
    dx = 0;
    dz = 1;
  } else {
    dx /= d;
    dz /= d;
  }
  p.act = Act.Hit;
  p.kx = dx * knock;
  p.kz = dz * knock;
}
