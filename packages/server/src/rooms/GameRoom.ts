import { Room, ServerError, type Client } from "@colyseus/core";
import { MapSchema, Schema, type } from "@colyseus/schema";
import { MAX_PLAYERS } from "@shattered-dominion/shared";

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("string") name = "";
}

export class GameState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

export class GameRoom extends Room {
  /**
   * Sala única global enquanto não existe lobby por código (sprint 02).
   * Sem esta trava o matchmaker criaria uma 2ª sala quando a 1ª enchesse,
   * e o 9º jogador entraria nela em vez de ser recusado.
   */
  private static ativa = false;

  override maxClients = MAX_PLAYERS;
  override state = new GameState();

  override onCreate(): void {
    if (GameRoom.ativa) {
      throw new ServerError(4001, "Partida já em andamento — aguarde os jogadores saírem.");
    }
    GameRoom.ativa = true;
    console.log(`[GameRoom ${this.roomId}] sala criada`);
  }

  override onJoin(client: Client): void {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.name = `Aventureiro-${client.sessionId.slice(0, 4)}`;
    this.state.players.set(client.sessionId, player);
    console.log(
      `[GameRoom ${this.roomId}] entrou: ${client.sessionId} (${this.state.players.size}/${this.maxClients})`,
    );
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    console.log(
      `[GameRoom ${this.roomId}] saiu: ${client.sessionId} (${this.state.players.size}/${this.maxClients})`,
    );
  }

  override onDispose(): void {
    GameRoom.ativa = false;
    console.log(`[GameRoom ${this.roomId}] sala descartada`);
  }
}
