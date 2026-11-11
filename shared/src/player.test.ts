import { describe, expect, it } from "vitest";
import {
  ARENA_RADIUS,
  Act,
  Btn,
  DT,
  PLAYER,
  copyCore,
  hurtPlayer,
  isInvulnerable,
  newPlayerCore,
  stepPlayer,
  type PlayerInput,
  type StepWorld,
} from "./index";

const EMPTY: StepWorld = { monsterSolid: false, monsterX: 0, monsterZ: 0, monsterRadius: 0 };
let seq = 0;
const input = (mx = 0, mz = 0, buttons = 0): PlayerInput => ({ seq: ++seq, mx, mz, buttons });

function run(p: ReturnType<typeof newPlayerCore>, seconds: number, make: () => PlayerInput, world = EMPTY) {
  const strikes: number[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const s = stepPlayer(p, make(), world);
    if (s) strikes.push(s);
  }
  return strikes;
}

describe("stepPlayer", () => {
  it("walks at the hunter's speed and turns to face the way it moves", () => {
    const p = newPlayerCore(0, 0);
    run(p, 1, () => input(1, 0));
    expect(p.x).toBeCloseTo(PLAYER.speed, 1);
    expect(p.yaw).toBeCloseTo(Math.PI / 2, 2);
  });

  it("never leaves the meadow", () => {
    const p = newPlayerCore(0, 0);
    run(p, 10, () => input(0, 1));
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(ARENA_RADIUS - PLAYER.radius + 1e-9);
  });

  it("chains the three-hit combo when attack is mashed, one strike per swing", () => {
    const p = newPlayerCore(0, 0);
    const strikes = run(p, 1.3, () => input(0, 0, Btn.Attack));
    expect(strikes.slice(0, 3)).toEqual([Act.Light1, Act.Light2, Act.Light3]);
  });

  it("returns to idle after a single swing", () => {
    const p = newPlayerCore(0, 0);
    stepPlayer(p, input(0, 0, Btn.Attack), EMPTY);
    const strikes = run(p, 1, () => input());
    expect(strikes).toEqual([Act.Light1]);
    expect(p.act).toBe(Act.Idle);
  });

  it("dodging costs stamina, is invulnerable early, and is refused when tired", () => {
    const p = newPlayerCore(0, 0);
    stepPlayer(p, input(1, 0, Btn.Dodge), EMPTY);
    expect(p.act).toBe(Act.Dodge);
    expect(p.stamina).toBeCloseTo(PLAYER.maxStamina - PLAYER.dodgeCost, 5);
    expect(isInvulnerable(p)).toBe(true);
    run(p, PLAYER.dodgeDur + DT, () => input());
    expect(p.act).toBe(Act.Idle);
    expect(p.x).toBeGreaterThan(3);

    p.stamina = PLAYER.dodgeCost - 5;
    stepPlayer(p, input(1, 0, Btn.Dodge), EMPTY);
    expect(p.act).toBe(Act.Idle);
  });

  it("eating a berry heals once and uses the berry; not allowed at full health", () => {
    const p = newPlayerCore(0, 0);
    stepPlayer(p, input(0, 0, Btn.Eat), EMPTY);
    expect(p.act).toBe(Act.Idle);

    p.hp = 30;
    stepPlayer(p, input(0, 0, Btn.Eat), EMPTY);
    expect(p.act).toBe(Act.Eat);
    run(p, PLAYER.eatDur + DT, () => input());
    expect(p.hp).toBe(30 + PLAYER.eatHeal);
    expect(p.berries).toBe(PLAYER.berries - 1);
  });

  it("cannot walk through the monster", () => {
    const world: StepWorld = { monsterSolid: true, monsterX: 5, monsterZ: 0, monsterRadius: 2 };
    const p = newPlayerCore(0, 0);
    run(p, 3, () => input(1, 0), world);
    expect(Math.hypot(p.x - 5, p.z)).toBeGreaterThanOrEqual(2 + PLAYER.radius - 1e-9);
  });

  it("is deterministic: replaying unacknowledged inputs from a snapshot matches the server", () => {
    // Same inputs, applied once straight through (server) and once as
    // snapshot-at-k + replay (client reconciliation).
    const inputs: PlayerInput[] = [];
    for (let i = 0; i < 120; i++) {
      const a = i * 0.21;
      const b = i % 17 === 3 ? Btn.Attack : i % 41 === 7 ? Btn.Dodge : i % 53 === 11 ? Btn.Heavy : 0;
      inputs.push(input(Math.cos(a), Math.sin(a), b));
    }
    const server = newPlayerCore(1, 2);
    const snapshot = newPlayerCore(0, 0);
    inputs.forEach((inp, i) => {
      stepPlayer(server, inp, EMPTY);
      if (i === 59) copyCore(server, snapshot);
    });
    const client = newPlayerCore(0, 0);
    copyCore(snapshot, client);
    for (const inp of inputs.slice(60)) stepPlayer(client, inp, EMPTY);
    expect(client).toEqual(server);
  });
});

describe("hurtPlayer", () => {
  it("knocks the hunter away from the blow", () => {
    const p = newPlayerCore(3, 0);
    hurtPlayer(p, 20, 0, 0, 10);
    expect(p.act).toBe(Act.Hit);
    expect(p.hp).toBe(PLAYER.maxHp - 20);
    expect(p.kx).toBeCloseTo(10);
    run(p, PLAYER.hitDur + DT, () => input());
    expect(p.act).toBe(Act.Idle);
    expect(p.x).toBeGreaterThan(3.5);
  });

  it("faints at zero health and then ignores input", () => {
    const p = newPlayerCore(0, 0);
    hurtPlayer(p, 999, 0, 0, 10);
    expect(p.act).toBe(Act.Faint);
    run(p, 1, () => input(1, 0, Btn.Attack));
    expect(p.act).toBe(Act.Faint);
    expect(p.x).toBe(0);
  });
});
