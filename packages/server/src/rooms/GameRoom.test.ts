import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import {
  DIRECTIONS8,
  FOV_RADIUS,
  Grid,
  MAX_PLAYERS,
  MessageType,
  TileType,
  canStep,
  type Vec2,
  type VisionMessage,
} from "@shattered-dominion/shared";
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

  it("entrada mid-run: novato nasce no andar do grupo com kit básico e visão", async () => {
    const room = await createLobby();
    const c1 = await colyseus.connectTo(room, { name: "Ana" });
    c1.send(MessageType.Start);
    await room.waitForMessage(MessageType.Start);

    const c2 = await colyseus.sdk.joinById(room.roomId, { name: "Atrasada" });
    const started = await c2.waitForMessage(MessageType.MatchStarted);
    expect(started).toMatchObject({ width: 32, height: 32, depth: 1 });

    const vision = c2.waitForMessage(MessageType.Vision);
    room.tickUpdate(); // visão do novato flui pelo tick normal
    const v: VisionMessage = await vision;
    expect(v.discovered.length).toBeGreaterThan(0);
    // kit básico: Adaga equipada + Ração
    const labels = v.you.inventory.map((i) => `${i.label}${i.equipped ? "*" : ""}`);
    expect(labels).toContain("Adaga*");
    expect(labels).toContain("Ração de Viagem");
    expect(room.state.players.size).toBe(2);
  });

  it("mid-run ainda respeita o teto de 8 jogadores", async () => {
    const room = await createLobby();
    const c1 = await colyseus.connectTo(room, { name: "Host" });
    for (let i = 0; i < MAX_PLAYERS - 1; i++) {
      await colyseus.connectTo(room, { name: `J${i + 2}` });
    }
    c1.send(MessageType.Start);
    await room.waitForMessage(MessageType.Start);

    await expect(colyseus.sdk.joinById(room.roomId, { name: "Nono" })).rejects.toThrow();
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

  // ── movimento e visão pela rede (ticks manuais) ──────────────────────

  /** Reconstrói o mapa conhecido a partir das descobertas (como o cliente fará). */
  function knownGrid(visions: VisionMessage[]): { grid: Grid; discovered: Set<number> } {
    const grid = new Grid(32, 32); // parede por padrão = desconhecido bloqueia
    const discovered = new Set<number>();
    for (const v of visions) {
      for (const [i, t] of v.discovered) {
        grid.tiles[i] = t;
        discovered.add(i);
      }
    }
    return { grid, discovered };
  }

  async function startSolo() {
    const room = await createLobby();
    const c1 = await colyseus.connectTo(room, { name: "Ana" });
    const vision = c1.waitForMessage(MessageType.Vision);
    c1.send(MessageType.Start);
    await room.waitForMessage(MessageType.Start);
    const v0: VisionMessage = await vision;
    return { room, c1, v0 };
  }

  it("move válido avança 1 tile no tick e a visão reporta a nova posição", async () => {
    const { room, c1, v0 } = await startSolo();
    const { grid } = knownGrid([v0]);
    const from: Vec2 = { x: v0.you.x, y: v0.you.y };
    const dir = DIRECTIONS8.find((d) => canStep(grid, from, d));
    expect(dir).toBeDefined();

    const next = c1.waitForMessage(MessageType.Vision);
    c1.send(MessageType.Move, { dx: dir!.x, dy: dir!.y });
    await room.waitForMessage(MessageType.Move);
    room.tickUpdate();

    const v1: VisionMessage = await next;
    expect(v1.you.x).toBe(from.x + dir!.x);
    expect(v1.you.y).toBe(from.y + dir!.y);
    expect(v1.you.nextActionAt).toBeGreaterThan(0);
    // memória do mapa: nada é redescoberto
    const antes = new Set(v0.discovered.map(([i]) => i));
    for (const [i] of v1.discovered) expect(antes.has(i)).toBe(false);
  });

  it("move contra parede é rejeitado (posição só muda com o passo válido)", async () => {
    const { room, c1, v0 } = await startSolo();
    const { grid, discovered } = knownGrid([v0]);
    const from: Vec2 = { x: v0.you.x, y: v0.you.y };

    // direção cujo alvo é uma parede CONHECIDA
    const wallDir = DIRECTIONS8.find((d) => {
      const i = grid.index(from.x + d.x, from.y + d.y);
      return discovered.has(i) && grid.tiles[i] === TileType.Wall;
    });
    const validDir = DIRECTIONS8.find((d) => canStep(grid, from, d));
    expect(wallDir).toBeDefined();
    expect(validDir).toBeDefined();

    // 1º: intenção inválida — consumida sem efeito
    c1.send(MessageType.Move, { dx: wallDir!.x, dy: wallDir!.y });
    await room.waitForMessage(MessageType.Move);
    room.tickUpdate();

    // 2º: intenção válida — só ela desloca
    const next = c1.waitForMessage(MessageType.Vision);
    c1.send(MessageType.Move, { dx: validDir!.x, dy: validDir!.y });
    await room.waitForMessage(MessageType.Move);
    room.tickUpdate();

    const v1: VisionMessage = await next;
    expect(v1.you.x).toBe(from.x + validDir!.x);
    expect(v1.you.y).toBe(from.y + validDir!.y);
  });

  it("visão nunca vaza tiles além do raio de FOV", async () => {
    const { v0 } = await startSolo();
    for (const i of v0.visible) {
      const x = i % 32;
      const y = Math.floor(i / 32);
      const dist2 = (x - v0.you.x) ** 2 + (y - v0.you.y) ** 2;
      expect(dist2).toBeLessThanOrEqual(FOV_RADIUS * FOV_RADIUS);
    }
  });

  it("chat: broadcast com nome do remetente; vazio e não-string são descartados", async () => {
    const room = await createLobby();
    const c1 = await colyseus.connectTo(room, { name: "Ana" });
    const c2 = await colyseus.connectTo(room, { name: "Beto" });

    const recebido = c2.waitForMessage(MessageType.Chat);
    c1.send(MessageType.Chat, { text: "  olá grupo!  " });
    expect(await recebido).toMatchObject({
      senderId: c1.sessionId,
      name: "Ana",
      text: "olá grupo!",
    });

    // inválidos não derrubam nem broadcastam
    c1.send(MessageType.Chat, { text: "   " });
    c1.send(MessageType.Chat, { text: 42 });
    c1.send(MessageType.Chat, {});
    await room.waitForMessage(MessageType.Chat);

    // mensagem longa é truncada em 140
    const longo = "x".repeat(200);
    const truncado = c2.waitForMessage(MessageType.Chat);
    c1.send(MessageType.Chat, { text: longo });
    expect((await truncado).text).toHaveLength(140);
  });

  it("move antes do início da partida é ignorado sem crash", async () => {
    const room = await createLobby();
    const c1 = await colyseus.connectTo(room, { name: "Ana" });
    c1.send(MessageType.Move, { dx: 1, dy: 0 });
    await room.waitForMessage(MessageType.Move);
    expect(room.state.phase).toBe("lobby");
  });
});
