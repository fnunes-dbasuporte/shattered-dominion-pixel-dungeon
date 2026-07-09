import Phaser from "phaser";
import {
  Grid,
  PLAYER_COLORS,
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
import {
  createCharacterAnims,
  facingFromDelta,
  playAnim,
  preloadCharacters,
  type Facing,
} from "./sprites.js";

/** Ícones de item gerados (assets/items/<slug>.png, 32px). */
export const ITEM_ICONS = [
  "dagger",
  "shortsword",
  "mace",
  "leather",
  "chainmail",
  "potion-vermelha",
  "potion-azul",
  "potion-esverdeada",
  "potion-turva",
  "potion-ambar",
  "potion-violeta",
  "scroll",
  "ration",
  "gold",
  "ankh",
];

export const TILE_PX = 16;

/** Texturas por TileType (chão tem 3 variações escolhidas por hash do índice). */
const TILE_TEXTURES: Record<number, string[]> = {
  [TileType.Wall]: ["tile-wall"],
  [TileType.Floor]: ["tile-floor-1", "tile-floor-2", "tile-floor-3"],
  [TileType.Door]: ["tile-door"],
  [TileType.StairsUp]: ["tile-stairs-up"],
  [TileType.StairsDown]: ["tile-stairs-down"],
  [TileType.Water]: ["tile-water"],
  [TileType.Grass]: ["tile-grass"],
  [TileType.Embers]: ["tile-embers"],
};

/** Tint multiplicativo do fog: descoberto mas fora de visão. */
const FOG_TINT = 0x555566;

/** Centro do tile em pixels de mundo. */
export const tileToWorld = (tile: number) => tile * TILE_PX + TILE_PX / 2;

interface ActorSprite {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  kind: ActorKind;
  texture: string;
  facing: Facing;
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

  private tileSprites = new Map<number, Phaser.GameObjects.Image>();
  private hudGfx!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private topText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private logLines: string[] = [];
  private atores = new Map<string, ActorSprite>();
  private itensChao = new Map<string, Phaser.GameObjects.Image>();
  private invPanel!: InventoryPanel;
  private chat!: ChatBox;
  private balloons = new Map<string, Phaser.GameObjects.Text>();
  private statusText!: Phaser.GameObjects.Text;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private lastSentAt = 0;
  private lastSentDir = "";
  /** compensação de jitter: visões seguram até 2 ticks (200ms) antes de aplicar. */
  private visionQueue: { v: VisionMessage; at: number }[] = [];

  constructor() {
    super("Game");
  }

  preload(): void {
    for (const names of Object.values(TILE_TEXTURES)) {
      for (const name of names) {
        this.load.image(name, `assets/tiles/${name.replace("tile-", "")}.png`);
      }
    }
    preloadCharacters(this);
    for (const slug of ITEM_ICONS) {
      this.load.image(`item-${slug}`, `assets/items/${slug}.png`);
    }
    for (const fx of ["slash", "poof", "sparkle"]) {
      this.load.image(`fx-${fx}`, `assets/fx/${fx}.png`);
    }
  }

  init(data: GameSceneData): void {
    this.conn = data.conn;
    this.grid = new Grid(data.started.width, data.started.height);
  }

  create(): void {
    createCharacterAnims(this);
    const w = this.grid.width * TILE_PX;
    const h = this.grid.height * TILE_PX;
    this.cameras.main.setBounds(0, 0, w, h);
    this.cameras.main.setZoom(3);
    this.cameras.main.setBackgroundColor("#0b0a10");

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
    this.conn.onVision((v) => this.visionQueue.push({ v, at: performance.now() }));
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
    this.drainVisionQueue();
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

  /** Aplica visões seguradas por 200ms (ou antes, se a fila acumular >2). */
  private drainVisionQueue(): void {
    const now = performance.now();
    while (
      this.visionQueue.length > 0 &&
      (now - this.visionQueue[0].at >= 200 || this.visionQueue.length > 2)
    ) {
      this.onVision(this.visionQueue.shift()!.v);
    }
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

  /** Ícones dos itens/ouro no chão (imagens 32px exibidas em 12px de mundo). */
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
      const texture = this.textures.exists(`item-${item.icon}`) ? `item-${item.icon}` : "item-gold";
      const img = this.add
        .image(tileToWorld(item.x), tileToWorld(item.y), texture)
        .setDisplaySize(12, 12)
        .setDepth(6);
      this.itensChao.set(item.id, img);
    }
  }

  /**
   * Fog of war em 3 estados: não descoberto = nada (fundo escuro);
   * descoberto fora de visão = tile com tint escuro; visível = tile pleno.
   */
  private redrawMap(): void {
    for (const i of this.discovered) {
      let sprite = this.tileSprites.get(i);
      if (!sprite) {
        const tile = this.grid.tiles[i];
        const names = TILE_TEXTURES[tile] ?? TILE_TEXTURES[TileType.Floor];
        const texture = names[hashSeed(`tile:${i}`) % names.length];
        sprite = this.add
          .image(
            tileToWorld(i % this.grid.width),
            tileToWorld(Math.floor(i / this.grid.width)),
            texture,
          )
          .setDepth(0);
        this.tileSprites.set(i, sprite);
      }
      if (this.visibleNow.has(i)) sprite.clearTint();
      else sprite.setTint(FOG_TINT);
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
          this.playAttackAnim(e.attackerId, e.x, e.y);
          this.spawnSlash(e.attackerId, e.x, e.y);
          this.pushLog(`${e.attackerName} acertou ${e.targetName} (${e.damage})`);
          break;
        }
        case "miss":
          this.floatingText(e.x, e.y, "errou", "#9a96ad");
          this.playAttackAnim(e.attackerId, e.x, e.y);
          this.pushLog(`${e.attackerName} errou ${e.targetName}`);
          break;
        case "death":
          dying.add(e.actorId);
          if (!e.actorId.startsWith("mob-")) this.floatingText(e.x, e.y, "✝", "#e8554d");
          this.spawnEffect("fx-poof", e.x, e.y, { from: 5, to: 16, duration: 380 });
          this.pushLog(e.actorId === this.conn.sessionId ? "VOCÊ morreu!" : `${e.name} morreu`);
          break;
        case "levelup":
          this.floatingText(e.x, e.y, `Nível ${e.level}!`, "#5fce6b");
          this.spawnEffect("fx-sparkle", e.x, e.y, { from: 8, to: 20, duration: 550, rise: 6 });
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

  /** Arco de slash sobre o alvo, rotacionado na direção do golpe. */
  private spawnSlash(attackerId: string, targetX: number, targetY: number): void {
    const atk = this.atores.get(attackerId);
    const angle = atk ? Math.atan2(targetY - atk.y, targetX - atk.x) : 0;
    const img = this.add
      .image(tileToWorld(targetX), tileToWorld(targetY), "fx-slash")
      .setDisplaySize(13, 13)
      .setRotation(angle)
      .setAlpha(0.95)
      .setDepth(30);
    this.tweens.add({
      targets: img,
      alpha: 0,
      scale: img.scale * 1.4,
      duration: 200,
      ease: "Cubic.easeOut",
      onComplete: () => img.destroy(),
    });
  }

  /** Efeito genérico: cresce e desvanece no tile. */
  private spawnEffect(
    texture: string,
    tileX: number,
    tileY: number,
    opts: { from: number; to: number; duration: number; rise?: number },
  ): void {
    const img = this.add
      .image(tileToWorld(tileX), tileToWorld(tileY), texture)
      .setDisplaySize(opts.from, opts.from)
      .setDepth(30);
    this.tweens.add({
      targets: img,
      displayWidth: opts.to,
      displayHeight: opts.to,
      y: img.y - (opts.rise ?? 0),
      alpha: 0,
      duration: opts.duration,
      ease: "Cubic.easeOut",
      onComplete: () => img.destroy(),
    });
  }

  /** Vira o atacante para o alvo e toca o golpe uma vez. */
  private playAttackAnim(attackerId: string, targetX: number, targetY: number): void {
    const atk = this.atores.get(attackerId);
    if (!atk) return;
    atk.facing = facingFromDelta(targetX - atk.x, targetY - atk.y, atk.facing);
    playAnim(atk.sprite, atk.texture, "attack", atk.facing, () => {
      if (atk.container.active) playAnim(atk.sprite, atk.texture, "idle", atk.facing);
    });
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
    const actor = this.atores.get(id);
    if (!actor) return;
    actor.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(90, () => {
      if (actor.container.active) {
        actor.sprite.clearTint();
        actor.sprite.setTintMode(Phaser.TintModes.MULTIPLY);
      }
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
          // morte: herói toca a animação; todos desvanecem
          if (sprite.kind === "player")
            playAnim(sprite.sprite, sprite.texture, "death", sprite.facing);
          this.tweens.add({
            targets: sprite.container,
            alpha: 0,
            duration: sprite.kind === "player" ? 700 : 350,
            delay: sprite.kind === "player" ? 300 : 0,
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
        const alvo = sprite; // captura para os callbacks do tween
        alvo.facing = facingFromDelta(actor.x - alvo.x, actor.y - alvo.y, alvo.facing);
        alvo.x = actor.x;
        alvo.y = actor.y;
        playAnim(alvo.sprite, alvo.texture, "walk", alvo.facing);
        this.tweens.add({
          targets: alvo.container,
          x: tileToWorld(actor.x),
          y: tileToWorld(actor.y),
          duration: actor.moveTicks * 100,
          ease: "Linear",
          onComplete: () => {
            if (alvo.container.active) playAnim(alvo.sprite, alvo.texture, "idle", alvo.facing);
          },
        });
      }
      this.drawMiniHpBar(sprite, actor);
      const nome = actor.asleep ? `${actor.name} 💤` : actor.name;
      if (sprite.label.text !== nome) sprite.label.setText(nome);
    }
    return appeared;
  }

  private createActorSprite(actor: VisibleActor): ActorSprite {
    const souEu = actor.id === this.conn.sessionId;
    const ehMob = actor.kind !== "player";
    const texture =
      actor.kind === "player" ? `hero-${actor.colorIndex % PLAYER_COLORS.length}` : actor.kind;

    const partes: Phaser.GameObjects.GameObject[] = [];
    if (souEu) {
      // anel sob os pés marca o próprio herói
      partes.push(this.add.ellipse(0, 7, 14, 6).setStrokeStyle(1, 0xffffff, 0.85));
    }

    const sprite = this.add.sprite(0, 0, texture);
    partes.push(sprite);

    // nome na cor do jogador — reforça a identidade além do tecido do sprite
    const corDoNome = ehMob
      ? "#c98a7a"
      : `#${PLAYER_COLORS[actor.colorIndex % PLAYER_COLORS.length].toString(16).padStart(6, "0")}`;
    const label = this.add
      .text(0, -15, actor.asleep ? `${actor.name} 💤` : actor.name, {
        fontFamily: "monospace",
        fontSize: "8px",
        color: corDoNome,
        stroke: "#0b0a10",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1);
    partes.push(label);

    const hpBar = this.add.graphics();
    partes.push(hpBar);

    const container = this.add
      .container(tileToWorld(actor.x), tileToWorld(actor.y), partes)
      .setDepth(10);

    const actorSprite: ActorSprite = {
      container,
      sprite,
      label,
      hpBar,
      kind: actor.kind,
      texture,
      facing: "south",
      x: actor.x,
      y: actor.y,
    };
    playAnim(sprite, texture, "idle", "south");

    if (souEu) {
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
    return actorSprite;
  }

  /** Mini-barra sobre atores feridos (some quando o HP está cheio). */
  private drawMiniHpBar(sprite: ActorSprite, actor: VisibleActor): void {
    const g = sprite.hpBar;
    g.clear();
    if (actor.hp >= actor.maxHp) return;
    const w = 16;
    const frac = actor.hp / actor.maxHp;
    g.fillStyle(0x0b0a10, 0.8);
    g.fillRect(-w / 2, -13, w, 2);
    g.fillStyle(frac > 0.5 ? 0x5fce6b : frac > 0.25 ? 0xe8c04d : 0xe8554d);
    g.fillRect(-w / 2, -13, w * frac, 2);
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
