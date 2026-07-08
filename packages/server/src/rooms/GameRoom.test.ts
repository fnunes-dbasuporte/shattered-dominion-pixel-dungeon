import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { MAX_PLAYERS, MessageType } from "@shattered-dominion/shared";
import { createGameServer } from "../app.js";
import type { GameRoom } from "./GameRoom.js";

describe("GameRoom — lobby, início de partida e visão", () => {
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

  const createLobby = () => colyseus.createRoom<GameRoom>("game", { manualTicks: true, seed: 42 });

  it("GET /health responde ok com versão e protocolo", async () => {
    const res = await colyseus.http.get("/health");
    expect(res.data).toMatchObject({ status: "ok", protocol: 1 });
  });

  it("cria sala com código de 6 caracteres e o criador vira host", async () => {
    const room = await createLobby();
    expect(room.roomId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    const c1 = await colyseus.connectTo(room, { name: "Ana" });
    expect(room.state.hostSessionId).toBe(c1.sessionId);
    expect(room.state.players.get(c1.sessionId)?.name).toBe("Ana");
    expect(room.state.phase).toBe("lobby");
  });

  it("segundo jogador entra pelo código (joinById)", async () => {
    const room = await createLobby();
    await colyseus.connectTo(room, { name: "Ana" });
    const c2 = await colyseus.sdk.joinById(room.roomId, { name: "Beto" });

    expect(room.state.players.size).toBe(2);
    expect(room.state.players.get(c2.sessionId)?.name).toBe("Beto");
    // host continua sendo o primeiro
    expect(room.state.hostSessionId).not.toBe(c2.sessionId);
  });

  it("nome vazio ganha apelido padrão; nome longo é cortado em 16", async () => {
    const room = await createLobby();
    const c1 = await colyseus.connectTo(room, { name: "   " });
    const c2 = await colyseus.connectTo(room, { name: "NomeExageradamenteComprido" });
    expect(room.state.players.get(c1.sessionId)?.name).toMatch(/^Aventureiro-/);
    expect(room.state.players.get(c2.sessionId)?.name).toHaveLength(16);
  });

  it(`aceita ${MAX_PLAYERS} jogadores e recusa o ${MAX_PLAYERS + 1}º`, async () => {
    const room = await createLobby();
    for (let i = 0; i < MAX_PLAYERS; i++) {
      await colyseus.connectTo(room, { name: `J${i + 1}` });
    }
    await expect(colyseus.sdk.joinById(room.roomId, { name: "Intruso" })).rejects.toThrow();
    expect(room.state.players.size).toBe(MAX_PLAYERS);
  });

  it("start de quem não é host é ignorado", async () => {
    const room = await createLobby();
    await colyseus.connectTo(room, { name: "Ana" });
    const c2 = await colyseus.connectTo(room, { name: "Beto" });

    c2.send(MessageType.Start);
    await room.waitForMessage(MessageType.Start);
    expect(room.state.phase).toBe("lobby");
  });

  it("host inicia: phase playing, matchStarted e visões iniciais em spawns distintos", async () => {
    const room = await createLobby();
    const c1 = await colyseus.connectTo(room, { name: "Ana" });
    const c2 = await colyseus.connectTo(room, { name: "Beto" });

    const started = c1.waitForMessage(MessageType.MatchStarted);
    const vision1 = c1.waitForMessage(MessageType.Vision);
    const vision2 = c2.waitForMessage(MessageType.Vision);
    c1.send(MessageType.Start);

    expect(await started).toMatchObject({ width: 32, height: 32, depth: 1 });
    const v1 = await vision1;
    const v2 = await vision2;

    expect(room.state.phase).toBe("playing");
    // spawns distintos e visão inicial populada
    expect(v1.you).not.toEqual(v2.you);
    expect(v1.discovered.length).toBeGreaterThan(0);
    expect(v1.visible.length).toBeGreaterThan(0);
    // ambos nasceram na mesma sala de entrada — devem se ver
    expect(v1.actors.map((a: { id: string }) => a.id).sort()).toEqual(
      [c1.sessionId, c2.sessionId].sort(),
    );
  });

  it("start duplicado não recria a partida", async () => {
    const room = await createLobby();
    const c1 = await colyseus.connectTo(room, { name: "Ana" });
    c1.send(MessageType.Start);
    await room.waitForMessage(MessageType.Start);
    const posAntes = room.state.depth;
    c1.send(MessageType.Start);
    await room.waitForMessage(MessageType.Start);
    expect(room.state.phase).toBe("playing");
    expect(room.state.depth).toBe(posAntes);
  });

  it("entrar depois do início é recusado (mid-run na sprint 05)", async () => {
    const room = await createLobby();
    const c1 = await colyseus.connectTo(room, { name: "Ana" });
    c1.send(MessageType.Start);
    await room.waitForMessage(MessageType.Start);

    await expect(colyseus.sdk.joinById(room.roomId, { name: "Atrasado" })).rejects.toThrow();
  });

  it("host que sai no lobby passa o bastão para o próximo", async () => {
    const room = await createLobby();
    const c1 = await colyseus.connectTo(room, { name: "Ana" });
    const c2 = await colyseus.connectTo(room, { name: "Beto" });

    await c1.leave();
    await vi.waitFor(() => {
      expect(room.state.hostSessionId).toBe(c2.sessionId);
    });
    expect(room.state.players.size).toBe(1);
  });
});
