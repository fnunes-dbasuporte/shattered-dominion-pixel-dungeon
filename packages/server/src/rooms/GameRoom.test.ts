import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { MAX_PLAYERS } from "@shattered-dominion/shared";
import { createGameServer } from "../app.js";
import type { GameRoom } from "./GameRoom.js";

describe("GameRoom (integração servidor + SDK cliente)", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  });

  afterEach(async () => {
    await colyseus.cleanup();
  });

  afterAll(async () => {
    await colyseus.shutdown();
  });

  it("GET /health responde ok com versão e protocolo", async () => {
    const res = await colyseus.http.get("/health");
    expect(res.data).toMatchObject({ status: "ok", protocol: 1 });
    expect(res.data.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("join adiciona jogador ao estado e o cliente recebe o estado sincronizado", async () => {
    const room = await colyseus.createRoom<GameRoom>("game");
    const c1 = await colyseus.connectTo(room);
    const c2 = await colyseus.connectTo(room);

    expect(room.state.players.size).toBe(2);
    expect(room.state.players.has(c1.sessionId)).toBe(true);
    expect(room.state.players.has(c2.sessionId)).toBe(true);

    // O decoder do SDK precisa reconstruir o MapSchema — valida o protocolo
    // schema v4 (servidor) ⇄ SDK cliente de ponta a ponta.
    await vi.waitFor(() => {
      expect(c2.state.players.size).toBe(2);
    });
    expect(c2.state.players.get(c1.sessionId)?.name).toContain("Aventureiro");
  });

  it("leave remove o jogador do estado", async () => {
    const room = await colyseus.createRoom<GameRoom>("game");
    const c1 = await colyseus.connectTo(room);
    const c2 = await colyseus.connectTo(room);
    expect(room.state.players.size).toBe(2);

    await c1.leave();
    await vi.waitFor(() => {
      expect(room.state.players.size).toBe(1);
    });
    expect(room.state.players.has(c2.sessionId)).toBe(true);
  });

  it(`aceita ${MAX_PLAYERS} jogadores e recusa o ${MAX_PLAYERS + 1}º`, async () => {
    const clientes = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      clientes.push(await colyseus.sdk.joinOrCreate("game"));
    }

    // Sala cheia: o matchmaker tenta criar uma 2ª sala e a trava de sala
    // única a recusa — o 9º jogador não entra.
    await expect(colyseus.sdk.joinOrCreate("game")).rejects.toThrow();

    await Promise.all(clientes.map((c) => c.leave()));
  });
});
