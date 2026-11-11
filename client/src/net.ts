import { Client, type Room } from "@colyseus/sdk";
import { ROOM_NAME, SERVER_PORT, type JoinOptions, type RoomView } from "@pufflings/shared";

export type HuntRoom = Room<any, RoomView>;

/**
 * In dev the client (Vite) and the game server run on different ports; in
 * production the game server serves the client, so they share an origin.
 * Set VITE_SERVER_URL to point a build at a server hosted elsewhere.
 */
function endpoint(): string {
  const override = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (override) return override;
  if (import.meta.env.DEV) return `ws://${location.hostname}:${SERVER_PORT}`;
  return location.origin.replace(/^http/, "ws");
}

const client = new Client(endpoint());

export type JoinMode = { kind: "quick" } | { kind: "host" } | { kind: "code"; code: string };

export async function joinHunt(mode: JoinMode, opts: JoinOptions): Promise<HuntRoom> {
  switch (mode.kind) {
    case "quick":
      return client.joinOrCreate(ROOM_NAME, opts);
    case "host":
      return client.create(ROOM_NAME, { ...opts, private: true });
    case "code":
      return client.joinById(mode.code, opts);
  }
}
