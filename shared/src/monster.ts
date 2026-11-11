/**
 * Grumblepuff: definitions shared by the server AI and the client renderer.
 * The AI itself lives in server/src/monsterAI.ts; the client only needs the
 * states and timings to draw telegraphs and animations.
 */

export enum MState {
  Absent = 0,
  Enter = 1,
  Idle = 2,
  Chase = 3,
  FlopWindup = 4,
  FlopAir = 5,
  FlopLand = 6,
  RollWindup = 7,
  Roll = 8,
  RollRecover = 9,
  SpinWindup = 10,
  Spin = 11,
  SpinRecover = 12,
  Stunned = 13,
  Roar = 14,
  Asleep = 15,
}

export const MONSTER = {
  name: "Grumblepuff",
  radius: 2.3,
  headOffset: 2.1,
  headRadius: 1.4,
  headDamageFactor: 1.5,
  baseHp: 2200,
  hpPerExtraPlayer: 0.7,
  chaseSpeed: 4.2,
  turnRate: 2.8,
  flopRadius: 4.6,
  flopMaxRange: 13,
  flopDamage: 28,
  rollSpeed: 15,
  rollDamage: 24,
  spinRadius: 5.4,
  spinDamage: 20,
  stunBase: 120,
  stunStep: 80,
  enrageAt: 0.5,
  enrageFactor: 1.25,
} as const;

const DUR: Record<number, number> = {
  [MState.Enter]: 2.2,
  [MState.FlopWindup]: 0.95,
  [MState.FlopAir]: 0.7,
  [MState.FlopLand]: 1.3,
  [MState.RollWindup]: 1.05,
  [MState.Roll]: 1.3,
  [MState.RollRecover]: 1.1,
  [MState.SpinWindup]: 0.75,
  [MState.Spin]: 0.5,
  [MState.SpinRecover]: 0.9,
  [MState.Stunned]: 4,
  [MState.Roar]: 1.8,
};

const WINDUPS = new Set<number>([MState.FlopWindup, MState.RollWindup, MState.SpinWindup]);

/** Length of a timed monster state in seconds. Windups shorten when enraged. */
export function monsterDur(state: number, enraged: boolean): number {
  const d = DUR[state] ?? 0;
  return enraged && WINDUPS.has(state) ? d * 0.8 : d;
}

/** Whether hunters collide with the monster's body in this state. */
export function monsterSolid(state: number): boolean {
  return state !== MState.Absent && state !== MState.FlopAir && state !== MState.Enter;
}

export function monsterMaxHp(players: number): number {
  return Math.round(MONSTER.baseHp * (1 + MONSTER.hpPerExtraPlayer * Math.max(0, players - 1)));
}
