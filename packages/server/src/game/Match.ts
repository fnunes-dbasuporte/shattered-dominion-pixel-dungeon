import {
  FOV_RADIUS,
  HERO_SPEED,
  MOB_DEFS,
  MOB_RESPAWN_TICKS,
  Rng,
  RoomType,
  TICKS_PER_TIME_UNIT,
  TileType,
  canStep,
  computeFov,
  freshMind,
  generateLevel,
  heroStats,
  mobThink,
  moveCostTicks,
  rollMobCount,
  rollMobKind,
  xpToNextLevel,
  type Level,
  type MobKind,
  type MobMind,
  type Vec2,
  type VisibleActor,
  type VisionMessage,
  type YouState,
} from "@shattered-dominion/shared";

interface ActorBase {
  id: string;
  name: string;
  x: number;
  y: number;
  speed: number;
  /** tick a partir do qual a próxima ação pode executar. */
  nextActionAt: number;
  hp: number;
  maxHp: number;
  accuracy: number;
  evasion: number;
  damageMin: number;
  damageMax: number;
}

export interface PlayerActor extends ActorBase {
  kind: "player";
  alive: boolean;
  level: number;
  xp: number;
  /** buffer de 1 slot — a última intenção recebida vence. */
  intent: Vec2 | null;
  /** memória do mapa: índices de tiles já descobertos por ESTE jogador. */
  discovered: Set<number>;
  /** última visão enviada (sem o tick) para deduplicar mensagens. */
  lastVisionKey: string;
}

export interface MobActor extends ActorBase {
  kind: MobKind;
  mind: MobMind;
}

export type Actor = PlayerActor | MobActor;

const isPlayer = (a: Actor): a is PlayerActor => a.kind === "player";

/** Tiles onde um mob pode nascer (nunca em porta ou escada). */
const SPAWNABLE = new Set<number>([TileType.Floor, TileType.Water, TileType.Grass]);

/**
 * Núcleo autoritativo da partida — sem nenhuma dependência de rede/Colyseus,
 * para ser testável de forma síncrona e determinística. O GameRoom é só a
 * cola: repassa intenções para cá e envia as visões resultantes.
 */
export class Match {
  readonly level: Level;
  tick = 0;

  private readonly rng: Rng;
  private readonly actors = new Map<string, Actor>();
  private readonly occupancy = new Map<number, string>();
  private mobCap = 0;
  private mobSeq = 0;

  constructor(level: Level) {
    this.level = level;
    this.rng = new Rng(level.seed).fork("match");
  }

  /** Produção: gera o andar e povoa os mobs. */
  static fromSeed(seed: number, depth = 1): Match {
    const match = new Match(generateLevel(seed, depth));
    match.populateMobs();
    return match;
  }

  // ── jogadores ──────────────────────────────────────────────────────

  /** Posiciona o jogador no próximo spawn livre da sala de entrada. */
  addPlayer(id: string, name: string): Vec2 {
    const spawn = this.level.spawnPoints.find(
      (p) => !this.occupancy.has(this.level.grid.index(p.x, p.y)),
    );
    if (!spawn) throw new Error("Match.addPlayer: sem spawn livre");

    const stats = heroStats(1);
    const player: PlayerActor = {
      kind: "player",
      id,
      name,
      x: spawn.x,
      y: spawn.y,
      speed: HERO_SPEED,
      nextActionAt: 0,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      accuracy: stats.accuracy,
      evasion: stats.evasion,
      damageMin: stats.damageMin,
      damageMax: stats.damageMax,
      alive: true,
      level: 1,
      xp: 0,
      intent: null,
      discovered: new Set(),
      lastVisionKey: "",
    };
    this.actors.set(id, player);
    this.occupancy.set(this.level.grid.index(spawn.x, spawn.y), id);
    return { x: spawn.x, y: spawn.y };
  }

  removePlayer(id: string): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    this.occupancy.delete(this.level.grid.index(actor.x, actor.y));
    this.actors.delete(id);
  }

  get playerCount(): number {
    return [...this.actors.values()].filter(isPlayer).length;
  }

  positionOf(id: string): Vec2 | undefined {
    const a = this.actors.get(id);
    return a ? { x: a.x, y: a.y } : undefined;
  }

  /**
   * Registra a intenção de movimento (validação de forma aqui; validação de
   * regra acontece no tick). Payload inválido é descartado em silêncio —
   * nunca confiar no cliente.
   */
  queueIntent(id: string, dx: unknown, dy: unknown): void {
    const actor = this.actors.get(id);
    if (!actor || !isPlayer(actor) || !actor.alive) return;
    if (typeof dx !== "number" || typeof dy !== "number") return;
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) return;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return;
    actor.intent = { x: dx, y: dy };
  }

  // ── mobs ───────────────────────────────────────────────────────────

  get mobCount(): number {
    return this.actors.size - this.playerCount;
  }

  /** Povoa o andar com 4–8 mobs em salas que não sejam a de entrada. */
  populateMobs(): void {
    this.mobCap = rollMobCount(this.rng);
    for (let i = 0; i < this.mobCap; i++) this.trySpawnRandomMob();
  }

  /** Spawn direto — usado pelos testes e pelo respawn/população. */
  spawnMobAt(kind: MobKind, x: number, y: number): string {
    const def = MOB_DEFS[kind];
    const id = `mob-${++this.mobSeq}`;
    const mob: MobActor = {
      kind,
      id,
      name: def.name,
      x,
      y,
      speed: def.speed,
      nextActionAt: 0,
      hp: def.maxHp,
      maxHp: def.maxHp,
      accuracy: def.accuracy,
      evasion: def.evasion,
      damageMin: def.damageMin,
      damageMax: def.damageMax,
      mind: freshMind(),
    };
    this.actors.set(id, mob);
    this.occupancy.set(this.level.grid.index(x, y), id);
    return id;
  }

  /** Posições dos mobs — apenas para asserções em testes. */
  mobPositionsForTest(): Map<string, Vec2> {
    const out = new Map<string, Vec2>();
    for (const a of this.actors.values()) {
      if (!isPlayer(a)) out.set(a.id, { x: a.x, y: a.y });
    }
    return out;
  }

  private trySpawnRandomMob(): boolean {
    const rooms = this.level.rooms.filter((r) => r.type !== RoomType.Entrance);
    if (rooms.length === 0) return false;

    for (let attempt = 0; attempt < 40; attempt++) {
      const room = this.rng.pick(rooms);
      const x = this.rng.nextInt(room.x, room.x + room.width - 1);
      const y = this.rng.nextInt(room.y, room.y + room.height - 1);
      const i = this.level.grid.index(x, y);
      if (this.occupancy.has(i) || !SPAWNABLE.has(this.level.grid.tiles[i])) continue;
      this.spawnMobAt(rollMobKind(this.rng, this.level.depth), x, y);
      return true;
    }
    return false;
  }

  // ── simulação ──────────────────────────────────────────────────────

  /**
   * Um tick da simulação: executa intenções cujos atores estão prontos
   * (fila de tempo) e devolve as mensagens de visão que mudaram, por jogador.
   */
  update(): Map<string, VisionMessage> {
    this.tick++;

    const playersSnapshot = [...this.actors.values()].filter(isPlayer).map((p) => ({
      id: p.id,
      pos: { x: p.x, y: p.y },
      alive: p.alive,
    }));

    for (const actor of this.actors.values()) {
      if (this.tick < actor.nextActionAt) continue;
      if (isPlayer(actor)) this.actPlayer(actor);
      else this.actMob(actor, playersSnapshot);
    }

    // respawn lento até o teto do andar
    if (this.tick % MOB_RESPAWN_TICKS === 0 && this.mobCount < this.mobCap) {
      this.trySpawnRandomMob();
    }

    return this.collectVisions();
  }

  private actPlayer(actor: PlayerActor): void {
    if (!actor.intent) return;
    const dir = actor.intent;
    actor.intent = null; // consome mesmo se inválida — sem feedback a cheats
    this.tryMove(actor, dir);
  }

  /** Mobs dormindo/esperando re-pensam a cada 5 ticks (0,5s) para poupar CPU. */
  private static readonly IDLE_RETHINK_TICKS = 5;

  private actMob(mob: MobActor, players: { id: string; pos: Vec2; alive: boolean }[]): void {
    const grid = this.level.grid;
    const action = mobThink(mob.mind, {
      grid,
      self: mob,
      tick: this.tick,
      players,
      rng: this.rng,
      isFree: (x, y) => !this.occupancy.has(grid.index(x, y)),
    });

    if (action.type === "move") {
      if (!this.tryMove(mob, action.dir)) {
        mob.nextActionAt = this.tick + Match.IDLE_RETHINK_TICKS;
      }
    } else if (action.type === "attack") {
      // resolução de dano chega na próxima tarefa — por ora só consome o turno
      mob.nextActionAt = this.tick + TICKS_PER_TIME_UNIT;
    } else {
      mob.nextActionAt = this.tick + Match.IDLE_RETHINK_TICKS;
    }
  }

  /** Passo validado + ocupação; cobra o custo de tempo se moveu. */
  private tryMove(actor: Actor, dir: Vec2): boolean {
    const grid = this.level.grid;
    if (!canStep(grid, actor, dir)) return false;
    const targetIndex = grid.index(actor.x + dir.x, actor.y + dir.y);
    if (this.occupancy.has(targetIndex)) return false;

    this.occupancy.delete(grid.index(actor.x, actor.y));
    this.occupancy.set(targetIndex, actor.id);
    actor.x += dir.x;
    actor.y += dir.y;
    actor.nextActionAt = this.tick + moveCostTicks(actor.speed);
    return true;
  }

  // ── visão ──────────────────────────────────────────────────────────

  /** Visões que mudaram desde o último envio (a primeira sempre é enviada). */
  private collectVisions(): Map<string, VisionMessage> {
    const out = new Map<string, VisionMessage>();
    for (const actor of this.actors.values()) {
      if (!isPlayer(actor)) continue;
      const message = this.buildVision(actor);
      const key = JSON.stringify([message.you, message.visible, message.actors]);
      if (key !== actor.lastVisionKey || message.discovered.length > 0) {
        actor.lastVisionKey = key;
        out.set(actor.id, message);
      }
    }
    return out;
  }

  private buildVision(player: PlayerActor): VisionMessage {
    const grid = this.level.grid;
    const fov = computeFov(grid, player, FOV_RADIUS);

    const discovered: [number, number][] = [];
    for (const i of fov) {
      if (!player.discovered.has(i)) {
        player.discovered.add(i);
        discovered.push([i, grid.tiles[i]]);
      }
    }

    const actorsInView: VisibleActor[] = [];
    for (const other of this.actors.values()) {
      if (fov.has(grid.index(other.x, other.y))) {
        actorsInView.push({
          id: other.id,
          name: other.name,
          kind: other.kind,
          x: other.x,
          y: other.y,
          hp: other.hp,
          maxHp: other.maxHp,
          moveTicks: moveCostTicks(other.speed),
          asleep: !isPlayer(other) && other.mind.state === "sleeping",
        });
      }
    }

    const you: YouState = {
      x: player.x,
      y: player.y,
      nextActionAt: player.nextActionAt,
      hp: player.hp,
      maxHp: player.maxHp,
      level: player.level,
      xp: player.xp,
      xpToNext: xpToNextLevel(player.level),
      alive: player.alive,
    };

    return {
      tick: this.tick,
      you,
      visible: [...fov].sort((a, b) => a - b),
      discovered: discovered.sort((a, b) => a[0] - b[0]),
      actors: actorsInView.sort((a, b) => a.id.localeCompare(b.id)),
    };
  }
}
