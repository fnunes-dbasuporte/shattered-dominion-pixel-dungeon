import { Room, ServerError, type Client } from "@colyseus/core";
import { MapSchema, Schema, type } from "@colyseus/schema";
import {
  MAX_PLAYERS,
  MessageType,
  type GamePhase,
  type MatchStartedMessage,
  type VisionMessage,
} from "@shattered-dominion/shared";
import { Match } from "../game/Match.js";
import { generateRoomCode, randomSeed } from "../game/roomCode.js";

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("string") name = "";
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

    console.log(`[GameRoom ${this.roomId}] lobby criado`);
  }

  override onJoin(client: Client, options?: { name?: unknown }): void {
    if (this.state.phase !== "lobby") {
      // Entrada mid-run chega na sprint 05.
      throw new ServerError(4002, "Partida já em andamento.");
    }
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.name = sanitizeName(options?.name, client.sessionId);
    this.state.players.set(client.sessionId, player);

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }
    console.log(
      `[GameRoom ${this.roomId}] entrou: ${player.name} (${this.state.players.size}/${this.maxClients})`,
    );
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
      this.match.addPlayer(sessionId, player.name);
    }

    this.state.phase = "playing";
    this.state.depth = 1;
    void this.lock(); // sem entrada mid-run por enquanto

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
    this.flushVisions(this.match.update());
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
