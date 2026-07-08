import { createRequire } from "node:module";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAME_NAME, PROTOCOL_VERSION } from "@shattered-dominion/shared";
import { GameRoom } from "./rooms/GameRoom.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

/** Fábrica do servidor — usada pelo entry point e pelos testes de integração. */
export function createGameServer(): Server {
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    express: (app) => {
      app.get("/health", (_req, res) => {
        res.json({
          status: "ok",
          version: pkg.version,
          game: GAME_NAME,
          protocol: PROTOCOL_VERSION,
        });
      });
    },
  });

  server.define("game", GameRoom);

  return server;
}
