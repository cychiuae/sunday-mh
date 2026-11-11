import { ATTACKS, MONSTER, angleDiff, yawOf, type LootItem } from "@pufflings/shared";

export interface StrikeResult {
  dmg: number;
  stun: number;
  head: boolean;
  /** Where the mallet landed, for effects. */
  x: number;
  z: number;
}

interface Pose {
  x: number;
  z: number;
  yaw: number;
}

function sweeps(p: Pose, reach: number, arc: number, cx: number, cz: number, cr: number): boolean {
  const dx = cx - p.x;
  const dz = cz - p.z;
  const d = Math.hypot(dx, dz);
  if (d > reach + cr) return false;
  if (d <= cr + 0.3) return true;
  const off = Math.abs(angleDiff(p.yaw, yawOf(dx, dz)));
  return off <= arc + Math.asin(Math.min(1, cr / d));
}

/**
 * Does a hunter's swing connect with the monster? Head hits score bonus
 * damage and build stun.
 */
export function resolveStrike(hunter: Pose, act: number, monster: Pose): StrikeResult | null {
  const def = ATTACKS[act];
  if (!def) return null;
  const hx = monster.x + Math.sin(monster.yaw) * MONSTER.headOffset;
  const hz = monster.z + Math.cos(monster.yaw) * MONSTER.headOffset;
  const head = sweeps(hunter, def.reach, def.arc, hx, hz, MONSTER.headRadius);
  const body = head || sweeps(hunter, def.reach, def.arc, monster.x, monster.z, MONSTER.radius);
  if (!body) return null;

  const cx = head ? hx : monster.x;
  const cz = head ? hz : monster.z;
  const cr = head ? MONSTER.headRadius : MONSTER.radius;
  const dx = hunter.x - cx;
  const dz = hunter.z - cz;
  const d = Math.hypot(dx, dz) || 1;
  return {
    dmg: Math.round(def.dmg * (head ? MONSTER.headDamageFactor : 1)),
    stun: def.stun,
    head,
    x: cx + (dx / d) * cr,
    z: cz + (dz / d) * cr,
  };
}

const LOOT_TABLE: { name: string; icon: string; chance: number; min: number; max: number }[] = [
  { name: "Puff Fluff", icon: "☁️", chance: 1, min: 2, max: 4 },
  { name: "Grumble Acorn", icon: "🌰", chance: 0.8, min: 1, max: 2 },
  { name: "Tiny Horn", icon: "🥕", chance: 0.45, min: 1, max: 1 },
  { name: "Sleepy Sprout", icon: "🌱", chance: 0.3, min: 1, max: 1 },
  { name: "Dream Pom", icon: "✨", chance: 0.08, min: 1, max: 1 },
];

export function rollLoot(rng: () => number): LootItem[] {
  const out: LootItem[] = [];
  for (const row of LOOT_TABLE) {
    if (rng() > row.chance) continue;
    out.push({ name: row.name, icon: row.icon, qty: row.min + Math.floor(rng() * (row.max - row.min + 1)) });
  }
  return out;
}
