import Phaser from "phaser";
import {
  Grid,
  TileType,
  hashSeed,
  type ActorKind,
  type GameEvent,
  type MatchStartedMessage,
  type VisibleActor,
  type VisionMessage,
  type YouState,
} from "@shattered-dominion/shared";
import type { GameConnection } from "../net/connection.js";
import { InventoryPanel } from "../ui/inventory.js";
import { ChatBox } from "../ui/chat.js";

const ITEM_GLYPHS: Record<string, { char: string; color: string }> = {
  weapon: { char: "†", color: "#cfd2d8" },
  armor: { char: "▣", color: "#8f9bb3" },
  potion: { char: "!", color: "#b35de8" },
  scroll: { char: "?", color: "#e8c04d" },
  food: { char: "%", color: "#b3854d" },
  gold: { char: "$", color: "#ffd700" },
};

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

const CORES_MOB: Record<string, number> = {
  rat: 0x8a7a66,
  gnoll: 0x9aa14e,
  crab: 0xc4573b,
};

/** Centro do tile em pixels de mundo. */
export const tileToWorld = (tile: number) => tile * TILE_PX + TILE_PX / 2;

interface ActorSprite {
  container: Phaser.GameObjects.Container;
  rect: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Graphics;
  kind: ActorKind;
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
  protected you: YouState = {
    x: 0,
    y: 0,
    nextActionAt: 0,
    hp: 20,
    maxHp: 20,
    level: 1,
    xp: 0,
    xpToNext: 10,
    alive: true,
    gold: 0,
    strength: 0,
    defense: 0,
    statuses: [],
    inventory: [],
  };

  private mapGfx!: Phaser.GameObjects.Graphics;
  private hudGfx!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private topText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private logLines: string[] = [];
  private atores = new Map<string, ActorSprite>();
  private itensChao = new Map<string, Phaser.GameObjects.Text>();
  private invPanel!: InventoryPanel;
  private chat!: ChatBox;
  private balloons = new Map<string, Phaser.GameObjects.Text>();
  private statusText!: Phaser.GameObjects.Text;
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

    this.topText = this.add
      .text(8, 8, "", { fontFamily: "monospace", fontSize: "12px", color: "#9a96ad" })
      .setScrollFactor(0)
      .setDepth(100);

    this.hudGfx = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.hudText = this.add
      .text(12, 0, "", { fontFamily: "monospace", fontSize: "12px", color: "#e8e6f0" })
      .setScrollFactor(0)
      .setDepth(101);

    this.logText = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#9a96ad",
        align: "right",
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(100);

    this.banner = this.add
      .text(
        0,
        60,
        "VOCÊ MORREU — modo espectador\n(setas movem a câmera; um aliado na escada ▼ te revive)",
        {
          fontFamily: "monospace",
          fontSize: "14px",
          color: "#e8554d",
          align: "center",
        },
      )
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(102)
      .setVisible(false);

    this.reposicionarUi();
    this.scale.on("resize", () => this.reposicionarUi());

    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT") as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;

    this.statusText = this.add
      .text(12, 0, "", { fontFamily: "monospace", fontSize: "12px", color: "#b35de8" })
      .setScrollFactor(0)
      .setDepth(101);

    this.invPanel = new InventoryPanel(this.conn);
    this.input.keyboard!.on("keydown-I", () => this.invPanel.toggle());
    this.input.keyboard!.on("keydown-ESC", () => this.invPanel.close());

    this.chat = new ChatBox(
      (text) => this.conn.sendChat(text),
      (open) => {
        this.input.keyboard!.enabled = !open;
        if (open) this.input.keyboard!.resetKeys();
      },
    );
    this.input.keyboard!.on("keydown-ENTER", () => {
      if (!this.invPanel.isOpen) this.chat.open();
    });
    this.conn.onChat((c) => {
      this.pushLog(`${c.name}: ${c.text}`);
      this.showBalloon(c.senderId, c.text);
    });

    // queda de conexão: banner e reload — na volta, tryReconnect retoma a sessão
    this.conn.onRoomLeave(() => {
      this.banner.setText("Conexão perdida — reconectando...").setColor("#e8c04d").setVisible(true);
      this.time.delayedCall(1200, () => location.reload());
    });

    this.reposicionarUi(); // reposiciona incluindo o statusText recém-criado
    this.conn.onVision((v) => this.onVision(v));
  }

  /** Balão curto sobre o herói; some após 4s (morre junto se o ator sair do FOV). */
  private showBalloon(actorId: string, text: string): void {
    const sprite = this.atores.get(actorId);
    if (!sprite) return;
    this.balloons.get(actorId)?.destroy();
    const curto = text.length > 26 ? `${text.slice(0, 26)}…` : text;
    const balloon = this.add
      .text(0, -TILE_PX - 4, curto, {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#0b0a10",
        backgroundColor: "#e8e6f0",
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, 1);
    sprite.container.add(balloon);
    this.balloons.set(actorId, balloon);
    this.time.delayedCall(4000, () => {
      if (balloon.active) balloon.destroy();
    });
  }

  private reposicionarUi(): void {
    const cam = this.cameras.main;
    this.hudGfx.setPosition(0, cam.height - 54);
    this.hudText.setPosition(12, cam.height - 50);
    this.statusText?.setPosition(220, cam.height - 50);
    this.logText.setPosition(cam.width - 10, cam.height - 10);
    this.banner.setX(cam.width / 2);
  }

  override update(time: number): void {
    if (this.invPanel.isOpen || this.chat.isOpen) return; // UI aberta pausa o input do jogo
    const dir = this.readKeyboardDir();

    if (!this.you.alive) {
      // espectador: setas/WASD movem a câmera livremente
      if (dir) {
        this.cameras.main.stopFollow();
        this.cameras.main.scrollX += dir.x * 6;
        this.cameras.main.scrollY += dir.y * 6;
      }
      return;
    }

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
    const dyingIds = this.processEvents(v.events);
    const newActorIds = this.syncActors(v.actors, dyingIds);
    this.syncFloorItems(v);
    this.invPanel.update(v.you);
    this.drawHud();
    this.banner.setVisible(!v.you.alive);
    this.updateTopBar(v.actors.length);
    this.onVisionExtra(v, newActorIds);
  }

  /** Glifos coloridos por categoria para itens/ouro no chão. */
  private syncFloorItems(v: VisionMessage): void {
    const present = new Set(v.items.map((i) => i.id));
    for (const [id, sprite] of this.itensChao) {
      if (!present.has(id)) {
        sprite.destroy();
        this.itensChao.delete(id);
      }
    }
    for (const item of v.items) {
      if (this.itensChao.has(item.id)) continue;
      const glyph = ITEM_GLYPHS[item.category] ?? { char: "•", color: "#ffffff" };
      const t = this.add
        .text(tileToWorld(item.x), tileToWorld(item.y), glyph.char, {
          fontFamily: "monospace",
          fontSize: "14px",
          color: glyph.color,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(6);
      this.itensChao.set(item.id, t);
    }
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

  // ── eventos de combate ───────────────────────────────────────────────

  /** Processa eventos (números, flashes, log) e retorna ids que morreram. */
  private processEvents(events: GameEvent[]): Set<string> {
    const dying = new Set<string>();
    for (const e of events) {
      switch (e.type) {
        case "hit": {
          const paraMim = e.targetId === this.conn.sessionId;
          this.floatingText(e.x, e.y, `-${e.damage}`, paraMim ? "#e8554d" : "#e8c04d");
          this.flashActor(e.targetId);
          this.pushLog(`${e.attackerName} acertou ${e.targetName} (${e.damage})`);
          break;
        }
        case "miss":
          this.floatingText(e.x, e.y, "errou", "#9a96ad");
          this.pushLog(`${e.attackerName} errou ${e.targetName}`);
          break;
        case "death":
          dying.add(e.actorId);
          this.floatingText(e.x, e.y, "✝", "#e8554d");
          this.pushLog(e.actorId === this.conn.sessionId ? "VOCÊ morreu!" : `${e.name} morreu`);
          break;
        case "levelup":
          this.floatingText(e.x, e.y, `Nível ${e.level}!`, "#5fce6b");
          this.pushLog(`${e.name} subiu para o nível ${e.level}`);
          break;
        case "revive":
          this.floatingText(e.x, e.y, "reviveu!", "#4da3e8");
          this.pushLog(`${e.name} reviveu`);
          break;
        case "info":
          this.pushLog(e.text);
          break;
      }
    }
    return dying;
  }

  private floatingText(tileX: number, tileY: number, texto: string, cor: string): void {
    const t = this.add
      .text(tileToWorld(tileX), tileToWorld(tileY) - 10, texto, {
        fontFamily: "monospace",
        fontSize: "12px",
        color: cor,
        stroke: "#0b0a10",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.tweens.add({
      targets: t,
      y: t.y - 18,
      alpha: 0,
      duration: 900,
      ease: "Cubic.easeOut",
      onComplete: () => t.destroy(),
    });
  }

  private flashActor(id: string): void {
    const sprite = this.atores.get(id);
    if (!sprite) return;
    sprite.rect.setFillStyle(0xffffff);
    this.time.delayedCall(90, () => {
      if (sprite.container.active) sprite.rect.setFillStyle(this.actorColor(id, sprite.kind));
    });
  }

  private pushLog(linha: string): void {
    this.logLines.push(linha);
    if (this.logLines.length > 6) this.logLines.shift();
    this.logText.setText(this.logLines.join("\n"));
  }

  // ── atores ───────────────────────────────────────────────────────────

  /** Retorna os ids de atores que APARECERAM nesta visão. */
  private syncActors(actors: VisibleActor[], dyingIds: Set<string>): string[] {
    const present = new Set(actors.map((a) => a.id));
    for (const [id, sprite] of this.atores) {
      if (!present.has(id)) {
        if (dyingIds.has(id)) {
          // morte: fade antes de sumir
          this.tweens.add({
            targets: sprite.container,
            alpha: 0,
            duration: 350,
            onComplete: () => sprite.container.destroy(),
          });
        } else {
          sprite.container.destroy(); // saiu do FOV: some imediatamente
        }
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
      this.drawMiniHpBar(sprite, actor);
    }
    return appeared;
  }

  private actorColor(id: string, kind: ActorKind): number {
    if (kind === "player") return CORES_JOGADOR[hashSeed(id) % CORES_JOGADOR.length];
    return CORES_MOB[kind] ?? 0xffffff;
  }

  private createActorSprite(actor: VisibleActor): ActorSprite {
    const souEu = actor.id === this.conn.sessionId;
    const ehMob = actor.kind !== "player";
    const cor = this.actorColor(actor.id, actor.kind);

    const tamanho = ehMob ? TILE_PX - 12 : TILE_PX - 8;
    const rect = this.add.rectangle(0, 0, tamanho, tamanho, cor);
    if (souEu) rect.setStrokeStyle(2, 0xffffff);

    const label = this.add
      .text(0, -TILE_PX + 6, actor.asleep ? `${actor.name} 💤` : actor.name, {
        fontFamily: "monospace",
        fontSize: "9px",
        color: souEu ? "#ffffff" : ehMob ? "#c98a7a" : "#c9c5da",
      })
      .setOrigin(0.5, 0);

    const hpBar = this.add.graphics();

    const container = this.add
      .container(tileToWorld(actor.x), tileToWorld(actor.y), [rect, label, hpBar])
      .setDepth(10);

    if (souEu) {
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
    return { container, rect, hpBar, kind: actor.kind, x: actor.x, y: actor.y };
  }

  /** Mini-barra sobre atores feridos (some quando o HP está cheio). */
  private drawMiniHpBar(sprite: ActorSprite, actor: VisibleActor): void {
    const g = sprite.hpBar;
    g.clear();
    if (actor.hp >= actor.maxHp) return;
    const w = 20;
    const frac = actor.hp / actor.maxHp;
    g.fillStyle(0x0b0a10, 0.8);
    g.fillRect(-w / 2, -TILE_PX / 2 - 4, w, 3);
    g.fillStyle(frac > 0.5 ? 0x5fce6b : frac > 0.25 ? 0xe8c04d : 0xe8554d);
    g.fillRect(-w / 2, -TILE_PX / 2 - 4, w * frac, 3);
  }

  // ── HUD ──────────────────────────────────────────────────────────────

  private drawHud(): void {
    const g = this.hudGfx;
    const { hp, maxHp, xp, xpToNext, level } = this.you;
    g.clear();
    // fundo
    g.fillStyle(0x0b0a10, 0.75);
    g.fillRect(8, 0, 200, 46);
    // HP
    const hpFrac = Math.max(0, hp / maxHp);
    g.fillStyle(0x2c2740);
    g.fillRect(12, 18, 180, 10);
    g.fillStyle(hpFrac > 0.5 ? 0x5fce6b : hpFrac > 0.25 ? 0xe8c04d : 0xe8554d);
    g.fillRect(12, 18, 180 * hpFrac, 10);
    // XP
    g.fillStyle(0x2c2740);
    g.fillRect(12, 34, 180, 4);
    g.fillStyle(0xe8c04d);
    g.fillRect(12, 34, 180 * Math.min(1, xp / xpToNext), 4);

    this.hudText.setText(`HP ${hp}/${maxHp} · Nv ${level} · $${this.you.gold} · I inventário`);
    this.statusText.setText(this.you.statuses.includes("veneno") ? "☠ envenenado" : "");
  }

  private updateTopBar(visiveis: number): void {
    const total = (this.conn.room.state as { players?: { size?: number } }).players?.size ?? "?";
    this.topText.setText(`sala ${this.conn.roomCode} · ${total} no grupo · ${visiveis} à vista`);
  }
}
