import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "colyseus";
import express from "express";
import { ROOM_NAME, SERVER_PORT } from "@pufflings/shared";
import { HuntRoom } from "./rooms/HuntRoom";

const port = Number(process.env.PORT) || SERVER_PORT;
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");

const server = new Server({
  express: (app) => {
    app.get("/health", (_req, res) => {
      res.json({ ok: true });
    });
    // After `npm run build`, this one process serves the game and the sockets.
    if (existsSync(clientDist)) app.use(express.static(clientDist));
  },
});

server.define(ROOM_NAME, HuntRoom);

await server.listen(port);
console.log(`[pufflings] game server listening on :${port}`);
