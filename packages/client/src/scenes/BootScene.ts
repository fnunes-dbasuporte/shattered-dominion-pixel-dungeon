import Phaser from "phaser";
import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import { GAME_NAME, hashSeed } from "@shattered-dominion/shared";

/** Espelho (somente leitura) do PlayerState sincronizado pelo servidor. */
interface PlayerLike {
  sessionId: string;
  name: string;
}

const CORES_JOGADOR = [0xe8554d, 0x4da3e8, 0x5fce6b, 0xe8c04d, 0xb35de8, 0x4de8d3, 0xe88a4d, 0xdd6fb1];

export class BootScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private room?: Room;
  private avatares = new Map<string, Phaser.GameObjects.Container>();

  constructor() {
    super("Boot");
  }

  create(): void {
    this.add
      .text(480, 40, GAME_NAME.toUpperCase(), {
        fontFamily: "monospace",
        fontSize: "28px",
        color: "#e8e6f0",
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(480, 90, "Conectando ao servidor...", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#9a96ad",
        align: "center",
      })
      .setOrigin(0.5);

    void this.conectar();
  }

  private async conectar(): Promise<void> {
    const endpoint = import.meta.env.VITE_WS_ENDPOINT ?? `${location.origin}/colyseus`;

    try {
      const client = new Client(endpoint);
      const room = await client.joinOrCreate("game");
      this.room = room;

      const $ = getStateCallbacks(room);
      $(room.state).players.onAdd((player: PlayerLike, sessionId: string) => {
        this.adicionarJogador(player, sessionId);
      });
      $(room.state).players.onRemove((_player: PlayerLike, sessionId: string) => {
        this.removerJogador(sessionId);
      });

      room.onLeave(() => {
        this.setStatus("Desconectado do servidor.", "#e8554d");
      });

      this.atualizarStatus();
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.setStatus(`Não foi possível entrar:\n${motivo}`, "#e8554d");
    }
  }

  private adicionarJogador(player: PlayerLike, sessionId: string): void {
    const cor = CORES_JOGADOR[hashSeed(sessionId) % CORES_JOGADOR.length];
    const souEu = sessionId === this.room?.sessionId;

    const rect = this.add.rectangle(0, 0, 48, 48, cor);
    if (souEu) rect.setStrokeStyle(3, 0xffffff);

    const label = this.add
      .text(0, 40, souEu ? `${player.name}\n(você)` : player.name, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: souEu ? "#ffffff" : "#9a96ad",
        align: "center",
      })
      .setOrigin(0.5, 0);

    this.avatares.set(sessionId, this.add.container(0, 0, [rect, label]));
    this.reposicionar();
    this.atualizarStatus();
  }

  private removerJogador(sessionId: string): void {
    this.avatares.get(sessionId)?.destroy();
    this.avatares.delete(sessionId);
    this.reposicionar();
    this.atualizarStatus();
  }

  /** Distribui os avatares em uma grade centralizada (até 2 linhas de 4). */
  private reposicionar(): void {
    const ids = [...this.avatares.keys()].sort();
    const porLinha = 4;
    ids.forEach((id, i) => {
      const linha = Math.floor(i / porLinha);
      const itensNaLinha = Math.min(porLinha, ids.length - linha * porLinha);
      const coluna = i % porLinha;
      const x = 480 + (coluna - (itensNaLinha - 1) / 2) * 120;
      const y = 250 + linha * 130;
      this.avatares.get(id)?.setPosition(x, y);
    });
  }

  private atualizarStatus(): void {
    if (!this.room) return;
    const n = this.avatares.size;
    this.setStatus(
      `Conectado — sala ${this.room.roomId} — ${n} jogador${n === 1 ? "" : "(es)"}`,
      "#5fce6b",
    );
  }

  private setStatus(texto: string, cor: string): void {
    this.statusText.setText(texto).setColor(cor);
  }
}
