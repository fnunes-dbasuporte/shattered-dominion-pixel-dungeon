import Phaser from "phaser";
import {
  Grid,
  TileType,
  hashSeed,
  type MatchStartedMessage,
  type VisibleActor,
  type VisionMessage,
} from "@shattered-dominion/shared";
import type { GameConnection } from "../net/connection.js";

export const TILE_PX = 24;

const TILE_COLORS: Record<number, number> = {
  [TileType.Wall]: 0x2e2842,
  [TileType.Floor]: 0x5c5570,
  [TileType.Door]: 0xc9a227,
  [TileType.StairsUp]: 0x4da3e8,
  [TileType.StairsDown]: 0xe8554d,
  [TileType.Water]: 0x3a6ea5,
  [TileType.Grass]: 0x4e9a51,
  [TileType.Embers]: 0xb3542e,
};

/** Cor escurecida para tiles descobertos mas fora de visão (fog of war). */
function dimColor(color: number, factor = 0.38): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

const CORES_JOGADOR = [
  0xe8554d, 0x4da3e8, 0x5fce6b, 0xe8c04d, 0xb35de8, 0x4de8d3, 0xe88a4d, 0xdd6fb1,
];

/** Centro do tile em pixels de mundo. */
export const tileToWorld = (tile: number) => tile * TILE_PX + TILE_PX / 2;

interface ActorSprite {
  container: Phaser.GameObjects.Container;
  x: number;
  y: number;
}

export interface GameSceneData {
  conn: GameConnection;
  started: MatchStartedMessage;
}

export class GameScene extends Phaser.Scene {
  protected conn!: GameConnection;
  /** Mapa conhecido — desconhecido permanece Wall (bloqueado p/ pathfinding). */
  protected grid!: Grid;
  protected discovered = new Set<number>();
  private visibleNow = new Set<number>();
  protected you = { x: 0, y: 0, nextActionAt: 0 };

  private mapGfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private atores = new Map<string, ActorSprite>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private lastSentAt = 0;
  private lastSentDir = "";

  constructor() {
    super("Game");
  }

  init(data: GameSceneData): void {
    this.conn = data.conn;
    this.grid = new Grid(data.started.width, data.started.height);
  }

  create(): void {
    const w = this.grid.width * TILE_PX;
    const h = this.grid.height * TILE_PX;
    this.cameras.main.setBounds(0, 0, w, h);
    this.cameras.main.setZoom(2);
    this.cameras.main.setBackgroundColor("#0b0a10");

    this.mapGfx = this.add.graphics();

    this.hud = this.add
      .text(8, 8, "", { fontFamily: "monospace", fontSize: "12px", color: "#9a96ad" })
      .setScrollFactor(0)
      .setDepth(100);

    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT") as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;

    this.conn.onVision((v) => this.onVision(v));
  }

  override update(time: number): void {
    const dir = this.readKeyboardDir();
    if (dir) {
      this.onManualInput();
      const key = `${dir.x},${dir.y}`;
      // segurar = repetir; o servidor guarda só a última intenção
      if (key !== this.lastSentDir || time - this.lastSentAt > 150) {
        this.conn.sendMove(dir.x, dir.y);
        this.lastSentDir = key;
        this.lastSentAt = time;
      }
    } else {
      this.lastSentDir = "";
    }
  }

  /** Hook para o clique-para-mover cancelar a caminhada em input manual. */
  protected onManualInput(): void {}

  /** Hook chamado a cada visão — a caminhada automática usa para dar o próximo passo. */
  protected onVisionExtra(_v: VisionMessage, _newActorIds: string[]): void {}

  private readKeyboardDir(): { x: number; y: number } | null {
    const k = this.keys;
    const dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    return dx === 0 && dy === 0 ? null : { x: dx, y: dy };
  }

  private onVision(v: VisionMessage): void {
    for (const [i, t] of v.discovered) {
      this.grid.tiles[i] = t;
      this.discovered.add(i);
    }
    this.visibleNow = new Set(v.visible);
    this.you = v.you;

    this.redrawMap();
    const newActorIds = this.syncActors(v.actors);
    this.updateHud(v.actors.length);
    this.onVisionExtra(v, newActorIds);
  }

  /**
   * Fog of war em 3 estados: não descoberto = nada (fundo escuro);
   * descoberto fora de visão = cor escurecida; visível = cor plena.
   */
  private redrawMap(): void {
    const g = this.mapGfx;
    g.clear();
    for (const i of this.discovered) {
      const base = TILE_COLORS[this.grid.tiles[i]] ?? 0xff00ff;
      g.fillStyle(this.visibleNow.has(i) ? base : dimColor(base));
      g.fillRect(
        (i % this.grid.width) * TILE_PX,
        Math.floor(i / this.grid.width) * TILE_PX,
        TILE_PX,
        TILE_PX,
      );
    }
  }

  /** Retorna os ids de atores que APARECERAM nesta visão (para o cancelamento do T7). */
  private syncActors(actors: VisibleActor[]): string[] {
    const present = new Set(actors.map((a) => a.id));
    for (const [id, sprite] of this.atores) {
      if (!present.has(id)) {
        sprite.container.destroy();
        this.atores.delete(id);
      }
    }

    const appeared: string[] = [];
    for (const actor of actors) {
      let sprite = this.atores.get(actor.id);
      if (!sprite) {
        sprite = this.createActorSprite(actor);
        this.atores.set(actor.id, sprite);
        appeared.push(actor.id);
      } else if (sprite.x !== actor.x || sprite.y !== actor.y) {
        sprite.x = actor.x;
        sprite.y = actor.y;
        this.tweens.add({
          targets: sprite.container,
          x: tileToWorld(actor.x),
          y: tileToWorld(actor.y),
          duration: actor.moveTicks * 100,
          ease: "Linear",
        });
      }
    }
    return appeared;
  }

  private createActorSprite(actor: VisibleActor): ActorSprite {
    const souEu = actor.id === this.conn.sessionId;
    const cor = CORES_JOGADOR[hashSeed(actor.id) % CORES_JOGADOR.length];

    const rect = this.add.rectangle(0, 0, TILE_PX - 8, TILE_PX - 8, cor);
    if (souEu) rect.setStrokeStyle(2, 0xffffff);
    const label = this.add
      .text(0, -TILE_PX + 6, actor.name, {
        fontFamily: "monospace",
        fontSize: "9px",
        color: souEu ? "#ffffff" : "#c9c5da",
      })
      .setOrigin(0.5, 0);

    const container = this.add
      .container(tileToWorld(actor.x), tileToWorld(actor.y), [rect, label])
      .setDepth(10);

    if (souEu) {
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
    return { container, x: actor.x, y: actor.y };
  }

  private updateHud(visiveis: number): void {
    const total = (this.conn.room.state as { players?: { size?: number } }).players?.size ?? "?";
    this.hud.setText(
      `sala ${this.conn.roomCode} · ${total} no grupo · ${visiveis} à vista · WASD/setas move · clique caminha`,
    );
  }
}
