/** Wire contract between client and server. Change both sides together. */

export type Phase = "camp" | "hunt" | "victory" | "failed";

/** Client -> server message types. */
export const C2S = {
  /** PlayerInput, one per client tick. */
  Input: "input",
  /** Anyone at camp may start the hunt. */
  StartHunt: "start",
} as const;

/** Server -> client message types. */
export const S2C = {
  Fx: "fx",
  Result: "result",
} as const;

export interface JoinOptions {
  name?: string;
  color?: number;
}

/** One-shot events the client turns into effects and sounds. */
export type Fx =
  | { t: "hit"; x: number; z: number; dmg: number; head: boolean; by: string }
  | { t: "hurt"; id: string; dmg: number }
  | { t: "faint"; id: string }
  | { t: "revive"; id: string }
  | { t: "roar" }
  | { t: "enrage" }
  | { t: "stun" }
  | { t: "bonk"; x: number; z: number }
  | { t: "land"; x: number; z: number }
  | { t: "spin"; x: number; z: number }
  | { t: "start" }
  | { t: "sleep" };

export interface LootItem {
  name: string;
  icon: string;
  qty: number;
}

export interface ResultMsg {
  victory: boolean;
  reason: "sleep" | "faints" | "time";
  seconds: number;
  /** Keyed by sessionId. */
  loot: Record<string, LootItem[]>;
  damage: Record<string, number>;
}

/** Shape of the synced room state as the client reads it. */
export interface PlayerView {
  name: string;
  color: number;
  x: number;
  z: number;
  yaw: number;
  act: number;
  actT: number;
  hp: number;
  stamina: number;
  berries: number;
  kx: number;
  kz: number;
  queued: number;
  /** Last input sequence number the server applied. */
  seq: number;
}

export interface MonsterView {
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  state: number;
  tx: number;
  tz: number;
  enraged: boolean;
}

export interface RoomView {
  phase: Phase;
  timeLeft: number;
  faints: number;
  players: {
    forEach(cb: (p: PlayerView, id: string) => void): void;
    get(id: string): PlayerView | undefined;
    size: number;
  };
  monster: MonsterView;
}
