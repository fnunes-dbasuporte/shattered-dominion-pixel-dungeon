import { Client, type Room } from "@colyseus/sdk";
import {
  MessageType,
  type ChatBroadcast,
  type MatchStartedMessage,
  type MoveMessage,
  type VisionMessage,
} from "@shattered-dominion/shared";

const endpoint = import.meta.env.VITE_WS_ENDPOINT ?? `${location.origin}/colyseus`;

/** sessionStorage: por aba, sobrevive a F5 — exatamente o escopo da reconexão. */
const RECONNECT_TOKEN_KEY = "sd:reconnect";

/**
 * Camada fina sobre o SDK do Colyseus. Registra os handlers de mensagem
 * imediatamente após entrar na sala (o SDK descarta mensagens sem handler)
 * e enfileira visões até a cena do jogo se conectar.
 */
export class GameConnection {
  private pendingVisions: VisionMessage[] = [];
  private visionHandler?: (v: VisionMessage) => void;
  private pendingChats: ChatBroadcast[] = [];
  private chatHandler?: (c: ChatBroadcast) => void;
  private leaveHandler?: (code: number) => void;
  private readonly startedPromise: Promise<MatchStartedMessage>;

  private constructor(readonly room: Room) {
    sessionStorage.setItem(RECONNECT_TOKEN_KEY, room.reconnectionToken);
    this.startedPromise = new Promise((resolve) => {
      room.onMessage(MessageType.MatchStarted, resolve);
    });
    room.onMessage(MessageType.Vision, (v: VisionMessage) => {
      if (this.visionHandler) this.visionHandler(v);
      else this.pendingVisions.push(v);
    });
    room.onMessage(MessageType.Chat, (c: ChatBroadcast) => {
      if (this.chatHandler) this.chatHandler(c);
      else this.pendingChats.push(c);
    });
    room.onLeave((code) => this.leaveHandler?.(code));
  }

  /**
   * Tenta retomar a sessão desta aba (F5 ou queda). Retorna null se não há
   * token ou o assento expirou — nesse caso o fluxo normal de lobby assume.
   */
  static async tryReconnect(): Promise<GameConnection | null> {
    const token = sessionStorage.getItem(RECONNECT_TOKEN_KEY);
    if (!token) return null;
    try {
      const client = new Client(endpoint);
      return new GameConnection(await client.reconnect(token));
    } catch {
      sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
      return null;
    }
  }

  /** Registra o observador de desconexão (queda ou saída). */
  onRoomLeave(cb: (code: number) => void): void {
    this.leaveHandler = cb;
  }

  static async createRoom(name: string): Promise<GameConnection> {
    const client = new Client(endpoint);
    return new GameConnection(await client.create("game", { name }));
  }

  static async joinByCode(code: string, name: string): Promise<GameConnection> {
    const client = new Client(endpoint);
    return new GameConnection(await client.joinById(code.trim().toUpperCase(), { name }));
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  get roomCode(): string {
    return this.room.roomId;
  }

  /** Registra o consumidor de visões e descarrega as que chegaram antes. */
  onVision(cb: (v: VisionMessage) => void): void {
    this.visionHandler = cb;
    const queued = this.pendingVisions;
    this.pendingVisions = [];
    for (const v of queued) cb(v);
  }

  waitForStart(): Promise<MatchStartedMessage> {
    return this.startedPromise;
  }

  sendStart(): void {
    this.room.send(MessageType.Start);
  }

  sendMove(dx: number, dy: number): void {
    const msg: MoveMessage = { dx, dy };
    this.room.send(MessageType.Move, msg);
  }

  sendPickup(): void {
    this.room.send(MessageType.Pickup);
  }

  sendEquip(uid: string): void {
    this.room.send(MessageType.Equip, { uid });
  }

  sendUse(uid: string, targetUid?: string): void {
    this.room.send(MessageType.Use, targetUid ? { uid, targetUid } : { uid });
  }

  sendDrop(uid: string): void {
    this.room.send(MessageType.Drop, { uid });
  }

  sendChat(text: string): void {
    this.room.send(MessageType.Chat, { text });
  }

  onChat(cb: (c: ChatBroadcast) => void): void {
    this.chatHandler = cb;
    const queued = this.pendingChats;
    this.pendingChats = [];
    for (const c of queued) cb(c);
  }
}
