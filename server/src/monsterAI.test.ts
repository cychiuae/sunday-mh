import { describe, expect, it } from "vitest";
import { ARENA_RADIUS, DT, MONSTER, MState, monsterDur, type Fx } from "@pufflings/shared";
import { damageMonster, newMind, setState, stepMonster, type MonsterCore, type MonsterCtx, type Target } from "./monsterAI";

function rngFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function setup(targets: Target[], seed = 1) {
  const m: MonsterCore = { x: 0, z: 0, yaw: 0, hp: 1000, maxHp: 1000, state: MState.Idle, tx: 0, tz: 0, enraged: false };
  const mind = newMind();
  const strikes: { x: number; z: number; r: number; dmg: number }[] = [];
  const fx: Fx[] = [];
  const ctx: MonsterCtx = {
    targets,
    rng: rngFrom(seed),
    fx: (e) => fx.push(e),
    strike: (x, z, r, dmg) => {
      strikes.push({ x, z, r, dmg });
      return [];
    },
  };
  return { m, mind, ctx, strikes, fx };
}

describe("stepMonster", () => {
  it("stays idle when there is nobody to hunt", () => {
    const { m, mind, ctx, strikes } = setup([]);
    for (let i = 0; i < 300; i++) stepMonster(m, mind, ctx, DT);
    expect(m.state).toBe(MState.Idle);
    expect(strikes).toHaveLength(0);
  });

  it.each([1, 2, 3, 4, 5])("keeps attacking a hunter and never gets stuck in a state (seed %i)", (seed) => {
    const { m, mind, ctx, strikes } = setup([{ id: "a", x: 6, z: 8 }], seed);
    let longest = 0;
    let since = 0;
    let last = m.state;
    for (let i = 0; i < 60 / DT; i++) {
      stepMonster(m, mind, ctx, DT);
      since = m.state === last ? since + DT : 0;
      last = m.state;
      longest = Math.max(longest, since);
      expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(ARENA_RADIUS - MONSTER.radius + 1e-6);
    }
    expect(strikes.length).toBeGreaterThan(5);
    expect(longest).toBeLessThan(6);
  });

  it("belly-flops onto the spot it telegraphed", () => {
    const { m, mind, ctx, strikes, fx } = setup([{ id: "a", x: 0, z: 9 }]);
    m.tx = 0;
    m.tz = 9;
    setState(m, mind, MState.FlopWindup);
    const total = monsterDur(MState.FlopWindup, false) + monsterDur(MState.FlopAir, false);
    for (let i = 0; i < total / DT + 2; i++) stepMonster(m, mind, ctx, DT);
    expect(m.state).toBe(MState.FlopLand);
    expect(strikes).toEqual([{ x: 0, z: 9, r: MONSTER.flopRadius, dmg: MONSTER.flopDamage }]);
    expect(fx).toContainEqual({ t: "land", x: 0, z: 9 });
    expect([m.x, m.z]).toEqual([0, 9]);
  });

  it("aims a flop at a spot inside the meadow even when the hunter hugs the wall", () => {
    const { m, mind, ctx, strikes } = setup([{ id: "a", x: 0, z: ARENA_RADIUS - 0.5 }], 3);
    m.z = ARENA_RADIUS - MONSTER.radius - 5;
    for (let i = 0; i < 40 / DT && strikes.length < 30; i++) stepMonster(m, mind, ctx, DT);
    const flops = strikes.filter((s) => s.r === MONSTER.flopRadius);
    expect(flops.length).toBeGreaterThan(0);
    for (const f of flops) expect(Math.hypot(f.x, f.z)).toBeLessThanOrEqual(ARENA_RADIUS - MONSTER.radius + 1e-6);
  });

  it("bonks itself dizzy when a roll hits the bramble wall", () => {
    const { m, mind, ctx, fx } = setup([{ id: "a", x: 0, z: 30 }]);
    m.z = ARENA_RADIUS - MONSTER.radius - 4;
    setState(m, mind, MState.Roll);
    for (let i = 0; i < 20; i++) stepMonster(m, mind, ctx, DT);
    expect(m.state).toBe(MState.Stunned);
    expect(fx.some((e) => e.t === "bonk")).toBe(true);
  });

  it("gets grumpy (enraged) once below half health", () => {
    const { m, mind, ctx, fx } = setup([{ id: "a", x: 0, z: 9 }]);
    m.hp = 400;
    setState(m, mind, MState.SpinRecover);
    for (let i = 0; i < 2 / DT; i++) stepMonster(m, mind, ctx, DT);
    expect(m.enraged).toBe(true);
    expect(fx.some((e) => e.t === "enrage")).toBe(true);
  });
});

describe("damageMonster", () => {
  it("head hits build up to a stun; the next stun needs more", () => {
    const { m, mind, ctx, fx } = setup([]);
    const hits = Math.ceil(MONSTER.stunBase / 10);
    for (let i = 0; i < hits; i++) damageMonster(m, mind, 1, 10, true, ctx);
    expect(m.state).toBe(MState.Stunned);
    expect(fx).toContainEqual({ t: "stun" });
    expect(mind.stunThreshold).toBe(MONSTER.stunBase + MONSTER.stunStep);
  });

  it("falls asleep at zero health and reports the win exactly once", () => {
    const { m, mind, ctx } = setup([]);
    expect(damageMonster(m, mind, 999, 0, false, ctx)).toBe(false);
    expect(damageMonster(m, mind, 1, 0, false, ctx)).toBe(true);
    expect(m.state).toBe(MState.Asleep);
    expect(damageMonster(m, mind, 50, 0, false, ctx)).toBe(false);
  });
});
