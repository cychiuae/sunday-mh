/** Fixed simulation step shared by client prediction and the server. */
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export const ROOM_NAME = "hunt";
export const SERVER_PORT = 2567;
export const MAX_PLAYERS = 4;

/** The meadow is a circle centred on the origin. */
export const ARENA_RADIUS = 36;
export const CAMP = { x: 0, z: 23 };
export const MONSTER_SPAWN = { x: 0, z: -12 };

export const HUNT_SECONDS = 8 * 60;
export const MAX_FAINTS = 3;
export const FAINT_SECONDS = 3.5;
export const RESULT_SECONDS = 14;

export const HUNTER_COLORS = [
  0xff8fab, // strawberry
  0x8ecae6, // sky
  0xffd166, // honey
  0xb8e986, // sprout
  0xcdb4ff, // lilac
  0xffa94d, // tangerine
] as const;
