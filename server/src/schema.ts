import { schema, t } from "@colyseus/schema";
import { MState, PLAYER } from "@pufflings/shared";

/**
 * Synced room state. Field names must match PlayerView / MonsterView /
 * RoomView in shared/src/protocol.ts, which is how the client reads them.
 * Hunter fields that feed client prediction are full doubles so a replay on
 * the client reproduces the server result exactly.
 */

export const PlayerState = schema(
  {
    name: t.string().default("Hunter"),
    color: t.uint8().default(0),
    x: t.float64().default(0),
    z: t.float64().default(0),
    yaw: t.float64().default(Math.PI),
    act: t.uint8().default(0),
    actT: t.float64().default(0),
    hp: t.float64().default(PLAYER.maxHp),
    stamina: t.float64().default(PLAYER.maxStamina),
    berries: t.uint8().default(PLAYER.berries),
    kx: t.float64().default(0),
    kz: t.float64().default(0),
    queued: t.uint8().default(0),
    seq: t.uint32().default(0),
  },
  "PlayerState",
);
export type PlayerState = InstanceType<typeof PlayerState>;

export const MonsterState = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    yaw: t.float32().default(0),
    hp: t.float32().default(0),
    maxHp: t.float32().default(1),
    state: t.uint8().default(MState.Absent),
    tx: t.float32().default(0),
    tz: t.float32().default(0),
    enraged: t.boolean().default(false),
  },
  "MonsterState",
);
export type MonsterState = InstanceType<typeof MonsterState>;

export const HuntState = schema(
  {
    phase: t.string().default("camp"),
    timeLeft: t.number().default(0),
    faints: t.uint8().default(0),
    players: t.map(PlayerState),
    monster: t.ref(MonsterState),
  },
  "HuntState",
);
export type HuntState = InstanceType<typeof HuntState>;
