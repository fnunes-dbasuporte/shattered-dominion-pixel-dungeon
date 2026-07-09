import { Room, type Client } from "@colyseus/core";
import { MapSchema, Schema, type } from "@colyseus/schema";
import {
  CHAT_MAX_LENGTH,
  MAX_PLAYERS,
  MessageType,
  PLAYER_COLORS,
  hashSeed,
  type ChatBroadcast,
  type GamePhase,
  type MatchStartedMessage,
  type VisionMessage,
} from "@shattered-dominion/shared";
import { Match } from "../game/Match.js";
import { generateRoomCode, randomSeed } from "../game/roomCode.js";

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("string") name = "";
  @type("uint8") colorIndex = 0;
}

export class GameState extends Schema {
  @type("string") phase: GamePhase = "lobby";
  @type("string") hostSessionId = "";
  @type("uint8") depth = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

interface CreateOptions {
  /** Somente em NODE_ENV=test: desliga o intervalo automático de simulação. */
  manualTicks?: boolean;
  /** Somente em NODE_ENV=test: seed fixa do andar para asserções determinísticas. */
  seed?: number;
}

const TICK_MS = 100; // 10 ticks/s

export class GameRoom extends Room {
  override maxClients = MAX_PLAYERS;
  override state = new GameState();

  private match?: Match;
  private testSeed?: number;
  /** durações dos últimos ticks (ms) — janela de ~20 min a 10 ticks/s. */
  private tickDurations: number[] = [];

  override onCreate(options: CreateOptions = {}): void {
    // O roomId É o código do lobby que os jogadores digitam.
    this.roomId = generateRoomCode();

    const isTest = process.env.NODE_ENV === "test";
    this.testSeed = isTest && typeof options.seed === "number" ? options.seed : undefined;
    if (!(isTest && options.manualTicks === true)) {
      this.setSimulationInterval(() => this.tickUpdate(), TICK_MS);
    }

    this.onMessage(MessageType.Start, (client) => this.handleStart(client));
    this.onMessage(MessageType.Move, (client, payload: unknown) => {
      if (this.state.phase !== "playing" || !this.match) return;
      const p = (payload ?? {}) as { dx?: unknown; dy?: unknown };
      this.match.queueIntent(client.sessionId, p.dx, p.dy);
    });
    this.onMessage(MessageType.Pickup, (client) => {
      if (this.state.phase === "playing") this.match?.pickup(client.sessionId);
    });
    this.onMessage(MessageType.Equip, (client, payload: unknown) => {
      if (this.state.phase !== "playing") return;
      this.match?.equip(client.sessionId, (payload as { uid?: unknown })?.uid);
    });
    this.onMessage(MessageType.Use, (client, payload: unknown) => {
      if (this.state.phase !== "playing") return;
      const p = (payload ?? {}) as { uid?: unknown; targetUid?: unknown };
      this.match?.use(client.sessionId, p.uid, p.targetUid);
    });
    this.onMessage(MessageType.Drop, (client, payload: unknown) => {
      if (this.state.phase !== "playing") return;
      this.match?.drop(client.sessionId, (payload as { uid?: unknown })?.uid);
    });
    this.onMessage(MessageType.Ping, (client, payload: unknown) => {
      client.send(MessageType.Pong, payload ?? {});
    });
    this.onMessage(MessageType.Chat, (client, payload: unknown) => {
      const raw = (payload as { text?: unknown })?.text;
      if (typeof raw !== "string") return;
      const text = raw.trim().slice(0, CHAT_MAX_LENGTH);
      if (text.length === 0) return;
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      const msg: ChatBroadcast = { senderId: client.sessionId, name: sender.name, text };
      this.broadcast(MessageType.Chat, msg);
    });

    console.log(`[GameRoom ${this.roomId}] lobby criado`);
  }

  override onJoin(client: Client, options?: { name?: unknown; color?: unknown }): void {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.name = sanitizeName(options?.name, client.sessionId);
    player.colorIndex = sanitizeColor(options?.color, client.sessionId);
    this.state.players.set(client.sessionId, player);

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }

    // entrada mid-run: nasce no andar do grupo com kit básico; a visão
    // inicial flui pelo próximo tick (jogador novo sempre recebe tudo)
    if (this.state.phase === "playing" && this.match) {
      this.match.addPlayerMidRun(client.sessionId, player.name, player.colorIndex);
      const started: MatchStartedMessage = {
        width: this.match.level.width,
        height: this.match.level.height,
        depth: this.state.depth,
      };
      client.send(MessageType.MatchStarted, started);
    }

    console.log(
      `[GameRoom ${this.roomId}] entrou: ${player.name} (${this.state.players.size}/${this.maxClients})`,
    );
  }

  /**
   * Queda sem consentimento durante a partida: o herói fica em jogo (o Match
   * o adormece após 60s) e o assento fica reservado até a run acabar. No
   * lobby não há o que preservar — segue o fluxo padrão (onLeave remove).
   */
  override async onDrop(client: Client): Promise<void> {
    if (this.state.phase !== "playing" || !this.match) return;

    this.match.setDropped(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    console.log(`[GameRoom ${this.roomId}] caiu: ${player?.name ?? client.sessionId}`);

    try {
      const reconnected = await this.allowReconnection(client, 3600);
      this.match.reconnectPlayer(reconnected.sessionId);

      // ressincroniza um cliente possivelmente recarregado
      const started: MatchStartedMessage = {
        width: this.match.level.width,
        height: this.match.level.height,
        depth: this.state.depth,
      };
      reconnected.send(MessageType.MatchStarted, started);
      const full = this.match.fullVisionFor(reconnected.sessionId);
      if (full) reconnected.send(MessageType.Vision, full);
      console.log(`[GameRoom ${this.roomId}] reconectou: ${player?.name ?? client.sessionId}`);
    } catch {
      // reconexão expirou/cancelada — onLeave fará a limpeza definitiva
    }
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.match?.removePlayer(client.sessionId);

    if (this.state.hostSessionId === client.sessionId) {
      const next = this.state.players.keys().next();
      this.state.hostSessionId = next.done ? "" : next.value;
    }
    console.log(
      `[GameRoom ${this.roomId}] saiu: ${player?.name ?? client.sessionId} ` +
        `(${this.state.players.size}/${this.maxClients})`,
    );
  }

  override onDispose(): void {
    console.log(`[GameRoom ${this.roomId}] sala descartada`);
  }

  /** Só o host inicia; a seed nasce aqui e nunca vai ao cliente. */
  private handleStart(client: Client): void {
    if (client.sessionId !== this.state.hostSessionId) return;
    if (this.state.phase !== "lobby" || this.match) return;

    const seed = this.testSeed ?? randomSeed();
    this.match = Match.fromSeed(seed, 1);
    for (const [sessionId, player] of this.state.players) {
      this.match.addPlayer(sessionId, player.name, undefined, player.colorIndex);
    }

    this.state.phase = "playing";
    this.state.depth = 1;
    // sala continua aberta: entrada mid-run é permitida até o teto de 8

    const started: MatchStartedMessage = {
      width: this.match.level.width,
      height: this.match.level.height,
      depth: 1,
    };
    this.broadcast(MessageType.MatchStarted, started);
    this.flushVisions(this.match.update()); // visão inicial imediata

    console.log(
      `[GameRoom ${this.roomId}] partida iniciada (${this.state.players.size} jogadores)`,
    );
  }

  /** Um tick da simulação — público para os testes dirigirem manualmente. */
  tickUpdate(): void {
    if (this.state.phase !== "playing" || !this.match) return;
    const t0 = performance.now();
    this.flushVisions(this.match.update());
    this.tickDurations.push(performance.now() - t0);
    if (this.tickDurations.length > 12_000) this.tickDurations.shift();
  }

  /** Métricas da duração dos ticks — usadas pelo load test. */
  tickStats(): { count: number; avg: number; p95: number; max: number } {
    const n = this.tickDurations.length;
    if (n === 0) return { count: 0, avg: 0, p95: 0, max: 0 };
    const sorted = [...this.tickDurations].sort((a, b) => a - b);
    return {
      count: n,
      avg: sorted.reduce((a, b) => a + b, 0) / n,
      p95: sorted[Math.min(n - 1, Math.floor(n * 0.95))],
      max: sorted[n - 1],
    };
  }

  /** Acesso à simulação — usado pelo load test para popular o estresse. */
  get currentMatch(): Match | undefined {
    return this.match;
  }

  private flushVisions(visions: Map<string, VisionMessage>): void {
    if (visions.size === 0) return;
    for (const client of this.clients) {
      const message = visions.get(client.sessionId);
      if (message) client.send(MessageType.Vision, message);
    }
  }
}

function sanitizeName(raw: unknown, sessionId: string): string {
  const name = typeof raw === "string" ? raw.trim().slice(0, 16) : "";
  return name.length > 0 ? name : `Aventureiro-${sessionId.slice(0, 4)}`;
}

/** Cor escolhida no lobby; fora do intervalo cai num hash estável da sessão. */
function sanitizeColor(raw: unknown, sessionId: string): number {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw < PLAYER_COLORS.length) {
    return raw;
  }
  return hashSeed(sessionId) % PLAYER_COLORS.length;
}
