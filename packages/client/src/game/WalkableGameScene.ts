import Phaser from "phaser";
import { findPath, isPassable, type Vec2, type VisionMessage } from "@shattered-dominion/shared";
import { GameScene, TILE_PX, tileToWorld } from "./GameScene.js";

/**
 * Estende a cena base com clique-para-mover: A* LOCAL sobre o mapa
 * conhecido (tiles não descobertos contam como parede) apenas para
 * preview e sequência de passos — o servidor valida cada passo.
 * A caminhada cancela quando: o jogador usa o teclado, clica de novo,
 * um ator novo aparece no FOV, ou um passo emperra (rejeitado).
 */
export class WalkableGameScene extends GameScene {
  private caminho: Vec2[] = [];
  private pathGfx!: Phaser.GameObjects.Graphics;
  private lastStepSentAt = 0;

  override create(): void {
    super.create();
    this.pathGfx = this.add.graphics().setDepth(5);
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.onClick(pointer));
  }

  override update(time: number): void {
    super.update(time);
    // passo rejeitado (ex.: tile ocupado por outro jogador) → não insiste
    if (this.caminho.length > 0 && time - this.lastStepSentAt > 2500) {
      this.cancelarCaminho();
    }
  }

  protected override onManualInput(): void {
    this.cancelarCaminho();
  }

  protected override onVisionExtra(v: VisionMessage, newActorIds: string[]): void {
    if (this.caminho.length === 0) return;

    // ator novo à vista (que não seja eu) interrompe a caminhada
    if (newActorIds.some((id) => id !== this.conn.sessionId)) {
      this.cancelarCaminho();
      return;
    }

    const proximo = this.caminho[0];
    if (v.you.x === proximo.x && v.you.y === proximo.y) {
      this.caminho.shift();
      this.desenharCaminho();
      this.enviarProximoPasso();
    }
  }

  private onClick(pointer: Phaser.Input.Pointer): void {
    const world = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const tx = Math.floor(world.x / TILE_PX);
    const ty = Math.floor(world.y / TILE_PX);
    if (!this.grid.inBounds(tx, ty)) return;

    const i = this.grid.index(tx, ty);
    if (!this.discovered.has(i) || !isPassable(this.grid.get(tx, ty))) return;

    const path = findPath(this.grid, { x: this.you.x, y: this.you.y }, { x: tx, y: ty });
    if (!path || path.length === 0) return;

    this.caminho = path;
    this.desenharCaminho();
    this.enviarProximoPasso();
  }

  private enviarProximoPasso(): void {
    const proximo = this.caminho[0];
    if (!proximo) {
      this.cancelarCaminho();
      return;
    }
    const dx = Math.sign(proximo.x - this.you.x);
    const dy = Math.sign(proximo.y - this.you.y);
    if (dx === 0 && dy === 0) {
      this.caminho.shift();
      this.enviarProximoPasso();
      return;
    }
    this.conn.sendMove(dx, dy);
    this.lastStepSentAt = this.time.now;
  }

  private desenharCaminho(): void {
    this.pathGfx.clear();
    this.pathGfx.fillStyle(0xffffff, 0.35);
    for (const p of this.caminho) {
      this.pathGfx.fillCircle(tileToWorld(p.x), tileToWorld(p.y), 3);
    }
  }

  private cancelarCaminho(): void {
    this.caminho = [];
    this.pathGfx.clear();
  }
}
