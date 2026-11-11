import { describe, expect, it } from "vitest";
import { ATTACKS, Act, MONSTER } from "@pufflings/shared";
import { resolveStrike, rollLoot } from "./combat";

const monster = { x: 0, z: 0, yaw: 0 }; // facing +Z, so its head is at z = +headOffset

describe("resolveStrike", () => {
  it("hits the body when swinging at it from the side", () => {
    const hit = resolveStrike({ x: MONSTER.radius + 1.5, z: 0, yaw: -Math.PI / 2 }, Act.Light1, monster);
    expect(hit).toMatchObject({ dmg: ATTACKS[Act.Light1].dmg, head: false });
  });

  it("misses when facing away or out of reach", () => {
    expect(resolveStrike({ x: MONSTER.radius + 1.5, z: 0, yaw: Math.PI / 2 }, Act.Light1, monster)).toBeNull();
    expect(resolveStrike({ x: MONSTER.radius + 6, z: 0, yaw: -Math.PI / 2 }, Act.Light1, monster)).toBeNull();
  });

  it("scores bonus damage on the head from the front", () => {
    const hit = resolveStrike({ x: 0, z: MONSTER.headOffset + MONSTER.headRadius + 1.5, yaw: Math.PI }, Act.Heavy, monster);
    expect(hit?.head).toBe(true);
    expect(hit?.dmg).toBe(Math.round(ATTACKS[Act.Heavy].dmg * MONSTER.headDamageFactor));
  });
});

describe("rollLoot", () => {
  it("always drops fluff", () => {
    expect(rollLoot(() => 0.99)[0]).toMatchObject({ name: "Puff Fluff" });
  });
});
