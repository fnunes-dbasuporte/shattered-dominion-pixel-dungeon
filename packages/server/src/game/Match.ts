import {
  FOV_RADIUS,
  HERO_SPEED,
  MOB_DEFS,
  MOB_RESPAWN_TICKS,
  Rng,
  RoomType,
  TICKS_PER_TIME_UNIT,
  TileType,
  attackRoll,
  canStep,
  computeFov,
  freshMind,
  generateLevel,
  grantXp,
  heroStats,
  mobThink,
  moveCostTicks,
  rollMobCountForDepth,
  rollMobKind,
  scaledMobStats,
  ARMORS,
  FOOD_HEAL,
  HEAL_POTION_AMOUNT,
  WEAPONS,
  applyArmor,
  POISON_DAMAGE_PER_UNIT,
  POISON_DURATION_UNITS,
  displayLabel,
  itemCategory,
  itemIcon,
  itemTrueName,
  pickTeleportTarget,
  rollAppearances,
  rollFloorLoot,
  rollFloorLootCount,
  rollMobDrop,
  rollTreasureGold,
  TREASURE_BONUS_ITEMS,
  xpToNextLevel,
  type ArmorId,
  type GameEvent,
  type InventoryEntry,
  type ItemId,
  type ItemInstance,
  type Level,
  type LootRoll,
  type MatchStartedMessage,
  type MobKind,
  type MobMind,
  type PotionId,
  type RunAppearances,
  type ScrollId,
  type Vec2,
  type WeaponId,
  type VisibleActor,
  type VisibleItem,
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
  colorIndex: number;
  /** andar em que o jogador está. */
  depth: number;
  alive: boolean;
  level: number;
  xp: number;
  gold: number;
  /** pontos de Força (poções): +1 de dano corpo a corpo por ponto. */
  strength: number;
  /** tipos de poção/pergaminho que ESTE jogador já identificou. */
  identified: Set<ItemId>;
  inventory: ItemInstance[];
  equippedWeapon: string | null;
  equippedArmor: string | null;
  /** envenenado até este tick (0 = saudável). */
  poisonedUntilTick: number;
  /** online = jogando · dropped = caiu (60s de carência) · dormant = adormecido. */
  conn: "online" | "dropped" | "dormant";
  droppedAtTick: number;
  /** voto para descer em grupo (limpo ao descer/subir). */
  wantsDescend: boolean;
  /** buffer de 1 slot — a última intenção recebida vence. */
  intent: Vec2 | null;
  /** memória do mapa POR ANDAR: depth → índices descobertos. */
  discovered: Map<number, Set<number>>;
  /** última visão enviada (sem o tick) para deduplicar mensagens. */
  lastVisionKey: string;
}

/** Item ou pilha de ouro no chão — no máximo um por tile. */
type FloorEntity =
  | { uid: string; x: number; y: number; kind: "item"; item: ItemInstance }
  | { uid: string; x: number; y: number; kind: "gold"; amount: number };

const NO_IDENTIFICATION: ReadonlySet<ItemId> = new Set();

export interface MobActor extends ActorBase {
  kind: MobKind;
  mind: MobMind;
}

export type Actor = PlayerActor | MobActor;

const isPlayer = (a: Actor): a is PlayerActor => a.kind === "player";

/** Tiles onde um mob pode nascer (nunca em porta ou escada). */
const SPAWNABLE = new Set<number>([TileType.Floor, TileType.Water, TileType.Grass]);

/** Um andar da masmorra — estado persiste em memória durante a run. */
interface Floor {
  level: Level;
  mobs: Map<string, MobActor>;
  /** índice do tile → id do ator que o ocupa (jogadores E mobs do andar). */
  occupancy: Map<number, string>;
  floorEntities: Map<string, FloorEntity>;
  /** índice do tile → uid do FloorEntity (um por tile). */
  itemsByTile: Map<number, string>;
  mobCap: number;
}

/**
 * Núcleo autoritativo da run — multi-andar, sem dependência de rede.
 * Só andares com jogadores são simulados; os demais ficam congelados
 * (mobs, itens e ocupação persistem). O GameRoom é só a cola.
 */
export class Match {
  readonly seed: number;
  readonly startDepth: number;
  tick = 0;

  private readonly rng: Rng;
  readonly appearances: RunAppearances;
  private readonly floors = new Map<number, Floor>();
  private readonly players = new Map<string, PlayerActor>();
  private mobSeq = 0;
  private itemSeq = 0;
  /** eventos gerados neste tick, com o andar de origem. */
  private pendingEvents: { depth: number; event: GameEvent }[] = [];
  /** jogadores que trocaram de andar neste tick (GameRoom notifica e ressincroniza). */
  private readonly floorChanges = new Map<string, MatchStartedMessage>();

  constructor(level: Level) {
    this.seed = level.seed;
    this.startDepth = level.depth;
    this.rng = new Rng(level.seed).fork("match");
    this.appearances = rollAppearances(new Rng(level.seed).fork("appearances"));
    this.floors.set(level.depth, this.newFloor(level));
  }

  /** Produção: gera o andar inicial e povoa mobs e loot. */
  static fromSeed(seed: number, depth = 1): Match {
    const match = new Match(generateLevel(seed, depth));
    match.populateFloor(match.floors.get(depth)!);
    return match;
  }

  /** Nível do andar inicial — usado pelo GameRoom no matchStarted. */
  get level(): Level {
    return this.floors.get(this.startDepth)!.level;
  }

  // ── andares ────────────────────────────────────────────────────────

  private newFloor(level: Level): Floor {
    return {
      level,
      mobs: new Map(),
      occupancy: new Map(),
      floorEntities: new Map(),
      itemsByTile: new Map(),
      mobCap: 0,
    };
  }

  private getOrCreateFloor(depth: number): Floor {
    let floor = this.floors.get(depth);
    if (!floor) {
      floor = this.newFloor(generateLevel(this.seed, depth));
      this.floors.set(depth, floor);
      this.populateFloor(floor);
    }
    return floor;
  }

  private populateFloor(floor: Floor): void {
    floor.mobCap = rollMobCountForDepth(this.rng, floor.level.depth);
    for (let i = 0; i < floor.mobCap; i++) this.trySpawnRandomMob(floor);
    this.populateLoot(floor);
  }

  private depthOfMob(id: string): number {
    for (const [depth, floor] of this.floors) if (floor.mobs.has(id)) return depth;
    throw new Error(`mob ${id} sem andar`);
  }

  /** Notificações de troca de andar deste tick (consumidas pelo GameRoom). */
  drainFloorChanges(): Map<string, MatchStartedMessage> {
    const out = new Map(this.floorChanges);
    this.floorChanges.clear();
    return out;
  }

  // ── jogadores ──────────────────────────────────────────────────────

  /** Posiciona o jogador no próximo spawn livre da sala de entrada (ou em `at`). */
  addPlayer(id: string, name: string, at?: Vec2, colorIndex = 0): Vec2 {
    const floor = this.floors.get(this.startDepth)!;
    const spawn =
      at ??
      floor.level.spawnPoints.find((p) => !floor.occupancy.has(floor.level.grid.index(p.x, p.y)));
    if (!spawn) throw new Error("Match.addPlayer: sem spawn livre");

    const stats = heroStats(1);
    const player: PlayerActor = {
      kind: "player",
      colorIndex,
      depth: this.startDepth,
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
      gold: 0,
      strength: 0,
      identified: new Set(),
      inventory: [],
      equippedWeapon: null,
      equippedArmor: null,
      poisonedUntilTick: 0,
      conn: "online",
      droppedAtTick: 0,
      wantsDescend: false,
      intent: null,
      discovered: new Map(),
      lastVisionKey: "",
    };
    this.players.set(id, player);
    floor.occupancy.set(floor.level.grid.index(spawn.x, spawn.y), id);
    return { x: spawn.x, y: spawn.y };
  }

  /**
   * Entrada mid-run: nasce no andar do líder (jogador vivo há mais tempo)
   * com kit básico — Adaga equipada e uma Ração.
   */
  addPlayerMidRun(id: string, name: string, colorIndex = 0): Vec2 {
    const leader = [...this.players.values()].find((p) => p.alive) ?? null;
    const depth = leader ? leader.depth : this.startDepth;
    const floor = this.getOrCreateFloor(depth);

    const livre = floor.level.spawnPoints.find(
      (p) => !floor.occupancy.has(floor.level.grid.index(p.x, p.y)),
    );
    const spot = livre ?? this.findFreeTileNear(floor, floor.level.stairsUp);
    if (!spot) throw new Error("Match.addPlayerMidRun: sem tile livre");

    this.addPlayer(id, name, undefined, colorIndex);
    const player = this.players.get(id)!;
    // move para o andar/posição corretos
    const startFloor = this.floors.get(this.startDepth)!;
    startFloor.occupancy.delete(startFloor.level.grid.index(player.x, player.y));
    player.depth = depth;
    player.x = spot.x;
    player.y = spot.y;
    floor.occupancy.set(floor.level.grid.index(spot.x, spot.y), id);

    const dagger: ItemInstance = { uid: `item-${++this.itemSeq}`, itemId: "dagger", upgrade: 0 };
    const ration: ItemInstance = { uid: `item-${++this.itemSeq}`, itemId: "ration", upgrade: 0 };
    player.inventory.push(dagger, ration);
    player.equippedWeapon = dagger.uid;
    this.applyEquipment(player);
    this.info(player, `${player.name} juntou-se ao grupo`);
    return { x: player.x, y: player.y };
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    const floor = this.floors.get(player.depth);
    floor?.occupancy.delete(floor.level.grid.index(player.x, player.y));
    this.players.delete(id);
  }

  get playerCount(): number {
    return this.players.size;
  }

  positionOf(id: string): Vec2 | undefined {
    const a = this.players.get(id) ?? this.findMob(id);
    return a ? { x: a.x, y: a.y } : undefined;
  }

  depthOf(id: string): number | undefined {
    return this.players.get(id)?.depth;
  }

  private findMob(id: string): MobActor | undefined {
    for (const floor of this.floors.values()) {
      const mob = floor.mobs.get(id);
      if (mob) return mob;
    }
    return undefined;
  }

  /**
   * Registra a intenção de movimento (validação de forma aqui; validação de
   * regra acontece no tick). Payload inválido é descartado em silêncio —
   * nunca confiar no cliente.
   */
  queueIntent(id: string, dx: unknown, dy: unknown): void {
    const actor = this.players.get(id);
    if (!actor || !actor.alive || actor.conn !== "online") return;
    if (typeof dx !== "number" || typeof dy !== "number") return;
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) return;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return;
    actor.intent = { x: dx, y: dy };
  }

  // ── escadas: descida em grupo por voto, subida individual ─────────

  /**
   * Interação com escadas: em cima da ▲ sobe sozinho; caso contrário,
   * alterna o voto de descida (se o andar tiver escada ▼).
   */
  stairsAction(id: string): void {
    const player = this.players.get(id);
    if (!player || !player.alive || player.conn !== "online") return;
    const floor = this.floors.get(player.depth)!;
    const grid = floor.level.grid;

    const onStairsUp = player.x === floor.level.stairsUp.x && player.y === floor.level.stairsUp.y;
    if (onStairsUp && player.depth > this.startDepth) {
      this.movePlayerToFloor(player, player.depth - 1, "up");
      return;
    }

    // andar do boss (sem ▼) não tem descida
    if (grid.count(TileType.StairsDown) === 0) {
      this.info(player, "não há descida neste andar");
      return;
    }

    player.wantsDescend = !player.wantsDescend;
    const { votes, needed } = this.descentVotes(player.depth);
    this.info(
      player,
      player.wantsDescend
        ? `${player.name} votou descer (${votes}/${needed})`
        : `${player.name} retirou o voto (${votes}/${needed})`,
    );
    if (votes >= needed && needed > 0) this.descendGroup(player.depth);
  }

  descentVotes(depth: number): { votes: number; needed: number } {
    const alive = [...this.players.values()].filter(
      (p) => p.depth === depth && p.alive && p.conn !== "dormant",
    );
    return { votes: alive.filter((p) => p.wantsDescend).length, needed: alive.length };
  }

  /** Todo o grupo do andar desce junto; mortos revivem com 50% no novo andar. */
  private descendGroup(depth: number): void {
    const group = [...this.players.values()].filter((p) => p.depth === depth);
    for (const p of group) {
      if (!p.alive) {
        p.alive = true;
        p.hp = Math.ceil(p.maxHp / 2);
        p.poisonedUntilTick = 0;
        this.pendingEvents.push({
          depth: depth + 1,
          event: { type: "revive", actorId: p.id, name: p.name, x: 0, y: 0 },
        });
      }
      this.movePlayerToFloor(p, depth + 1, "down");
    }
  }

  /** Move o jogador entre andares e registra a notificação de ressincronização. */
  private movePlayerToFloor(player: PlayerActor, targetDepth: number, via: "up" | "down"): void {
    const from = this.floors.get(player.depth)!;
    from.occupancy.delete(from.level.grid.index(player.x, player.y));

    const target = this.getOrCreateFloor(targetDepth);
    // desce → nasce na entrada (▲); sobe → aparece junto da ▼ do andar de cima
    const anchor = via === "down" ? target.level.stairsUp : target.level.stairsDown;
    const spawn =
      target.level.spawnPoints.find(
        (p) => via === "down" && !target.occupancy.has(target.level.grid.index(p.x, p.y)),
      ) ?? this.findFreeTileNear(target, anchor);
    if (!spawn) throw new Error("movePlayerToFloor: sem tile livre no destino");

    player.depth = targetDepth;
    player.x = spawn.x;
    player.y = spawn.y;
    player.wantsDescend = false;
    player.nextActionAt = this.tick + TICKS_PER_TIME_UNIT;
    player.lastVisionKey = "";
    if (player.alive) {
      target.occupancy.set(target.level.grid.index(spawn.x, spawn.y), player.id);
    }
    this.floorChanges.set(player.id, {
      width: target.level.width,
      height: target.level.height,
      depth: targetDepth,
    });
  }

  // ── conexão (queda, dormência, reconexão) ──────────────────────────

  /** Carência antes de adormecer: 60s de jogo. */
  static readonly DORMANCY_TICKS = 60 * TICKS_PER_TIME_UNIT;

  /** Queda de conexão: herói fica em jogo, parado e vulnerável, por 60s. */
  setDropped(id: string): void {
    const p = this.players.get(id);
    if (!p || p.conn !== "online") return;
    p.conn = "dropped";
    p.droppedAtTick = this.tick;
    p.intent = null;
  }

  /** Volta do jogador: acorda do estado atual e devolve o controle. */
  reconnectPlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    if (p.conn === "dormant") {
      const floor = this.floors.get(p.depth)!;
      const spot = this.findFreeTileNear(floor, p) ?? p;
      p.x = spot.x;
      p.y = spot.y;
      floor.occupancy.set(floor.level.grid.index(p.x, p.y), p.id);
    }
    p.conn = "online";
    p.lastVisionKey = "";
  }

  /**
   * Visão completa para ressincronizar um cliente (reconexão ou troca de
   * andar): inclui TODA a memória de mapa do jogador NAQUELE andar.
   */
  fullVisionFor(id: string): VisionMessage | null {
    const p = this.players.get(id);
    if (!p) return null;
    const floor = this.floors.get(p.depth)!;
    const fov = computeFov(floor.level.grid, p, FOV_RADIUS);
    const message = this.buildVision(p, floor, fov);
    const known = this.discoveredOn(p, p.depth);
    message.discovered = [...known]
      .sort((a, b) => a - b)
      .map((i) => [i, floor.level.grid.tiles[i]] as [number, number]);
    p.lastVisionKey = "";
    return message;
  }

  private processDormancy(): void {
    for (const p of this.players.values()) {
      if (p.conn !== "dropped") continue;
      if (this.tick - p.droppedAtTick < Match.DORMANCY_TICKS) continue;
      p.conn = "dormant";
      p.intent = null;
      const floor = this.floors.get(p.depth)!;
      floor.occupancy.delete(floor.level.grid.index(p.x, p.y));
      this.info(p, `${p.name} adormeceu`);
    }
  }

  // ── mobs ───────────────────────────────────────────────────────────

  get mobCount(): number {
    return this.floors.get(this.startDepth)!.mobs.size;
  }

  /** Spawn direto no andar inicial — usado por testes e respawn. */
  spawnMobAt(kind: MobKind, x: number, y: number, depth = this.startDepth): string {
    const floor = this.getOrCreateFloor(depth);
    const def = MOB_DEFS[kind];
    const stats = scaledMobStats(kind, floor.level.depth);
    const id = `mob-${++this.mobSeq}`;
    const mob: MobActor = {
      kind,
      id,
      name: def.name,
      x,
      y,
      speed: def.speed,
      nextActionAt: 0,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      accuracy: stats.accuracy,
      evasion: stats.evasion,
      damageMin: stats.damageMin,
      damageMax: stats.damageMax,
      mind: freshMind(),
    };
    floor.mobs.set(id, mob);
    floor.occupancy.set(floor.level.grid.index(x, y), id);
    return id;
  }

  /** Spawna até n mobs extras no andar inicial (estresse do load test). */
  spawnRandomMobs(n: number): number {
    const floor = this.floors.get(this.startDepth)!;
    let spawned = 0;
    for (let i = 0; i < n; i++) if (this.trySpawnRandomMob(floor)) spawned++;
    floor.mobCap = Math.max(floor.mobCap, floor.mobs.size);
    return spawned;
  }

  /** Acesso direto ao ator — apenas para preparação de cenários em testes. */
  actorForTest(id: string): Actor | undefined {
    return this.players.get(id) ?? this.findMob(id);
  }

  /** Posições dos mobs de um andar — apenas para asserções em testes. */
  mobPositionsForTest(depth = this.startDepth): Map<string, Vec2> {
    const out = new Map<string, Vec2>();
    const floor = this.floors.get(depth);
    if (floor) for (const m of floor.mobs.values()) out.set(m.id, { x: m.x, y: m.y });
    return out;
  }

  private trySpawnRandomMob(floor: Floor): boolean {
    const rooms = floor.level.rooms.filter((r) => r.type !== RoomType.Entrance);
    if (rooms.length === 0) return false;

    for (let attempt = 0; attempt < 40; attempt++) {
      const room = this.rng.pick(rooms);
      const x = this.rng.nextInt(room.x, room.x + room.width - 1);
      const y = this.rng.nextInt(room.y, room.y + room.height - 1);
      const i = floor.level.grid.index(x, y);
      if (floor.occupancy.has(i) || !SPAWNABLE.has(floor.level.grid.tiles[i])) continue;
      this.spawnMobAt(rollMobKind(this.rng, floor.level.depth), x, y, floor.level.depth);
      return true;
    }
    return false;
  }

  // ── loot ───────────────────────────────────────────────────────────

  /** 3–6 itens/ouro em salas comuns + bônus nas salas de tesouro. */
  private populateLoot(floor: Floor): void {
    const rooms = floor.level.rooms.filter((r) => r.type !== RoomType.Entrance);
    if (rooms.length === 0) return;

    const count = rollFloorLootCount(this.rng);
    for (let i = 0; i < count; i++) {
      this.placeLootInRoom(floor, this.rng.pick(rooms), rollFloorLoot(this.rng, floor.level.depth));
    }
    for (const room of floor.level.rooms) {
      if (room.type !== RoomType.Treasure) continue;
      for (let i = 0; i < TREASURE_BONUS_ITEMS; i++) {
        this.placeLootInRoom(floor, room, rollFloorLoot(this.rng, floor.level.depth));
      }
      this.placeLootInRoom(floor, room, {
        kind: "gold",
        amount: rollTreasureGold(this.rng, floor.level.depth),
      });
    }
  }

  get floorItemCount(): number {
    return this.floors.get(this.startDepth)!.floorEntities.size;
  }

  floorEntitiesForTest(depth = this.startDepth): FloorEntity[] {
    return [...(this.floors.get(depth)?.floorEntities.values() ?? [])];
  }

  private placeLootInRoom(
    floor: Floor,
    room: { x: number; y: number; width: number; height: number },
    roll: LootRoll,
  ): void {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = this.rng.nextInt(room.x, room.x + room.width - 1);
      const y = this.rng.nextInt(room.y, room.y + room.height - 1);
      if (this.placeLootAtFloor(floor, x, y, roll)) return;
    }
  }

  /** Coloca loot no tile do andar inicial (API de testes). */
  placeLootAt(x: number, y: number, roll: LootRoll): boolean {
    return this.placeLootAtFloor(this.floors.get(this.startDepth)!, x, y, roll);
  }

  private placeLootAtFloor(floor: Floor, x: number, y: number, roll: LootRoll): boolean {
    const i = floor.level.grid.index(x, y);
    if (floor.itemsByTile.has(i) || !SPAWNABLE.has(floor.level.grid.tiles[i])) return false;

    const uid = `item-${++this.itemSeq}`;
    const entity: FloorEntity =
      roll.kind === "gold"
        ? { uid, x, y, kind: "gold", amount: roll.amount }
        : { uid, x, y, kind: "item", item: { uid, itemId: roll.itemId, upgrade: roll.upgrade } };
    floor.floorEntities.set(uid, entity);
    floor.itemsByTile.set(i, uid);
    return true;
  }

  private removeFloorEntity(floor: Floor, entity: FloorEntity): void {
    floor.floorEntities.delete(entity.uid);
    floor.itemsByTile.delete(floor.level.grid.index(entity.x, entity.y));
  }

  /** Rótulo público (seguro): nunca revela tipo de poção/pergaminho. */
  private safeLabel(item: ItemInstance): string {
    return displayLabel(item.itemId, item.upgrade, NO_IDENTIFICATION, this.appearances);
  }

  /** Pega tudo que estiver no tile do jogador (ouro sempre; item se couber). */
  private autoPickup(player: PlayerActor): void {
    const floor = this.floors.get(player.depth)!;
    const i = floor.level.grid.index(player.x, player.y);
    const uid = floor.itemsByTile.get(i);
    if (!uid) return;
    const entity = floor.floorEntities.get(uid);
    if (!entity) return;

    if (entity.kind === "gold") {
      player.gold += entity.amount;
      this.removeFloorEntity(floor, entity);
      this.info(player, `${player.name} pegou ${entity.amount} de ouro`);
      return;
    }
    if (player.inventory.length >= 16) {
      this.info(player, `inventário cheio — ${this.safeLabel(entity.item)} ficou no chão`);
      return;
    }
    player.inventory.push(entity.item);
    this.removeFloorEntity(floor, entity);
    this.info(player, `${player.name} pegou ${this.safeLabel(entity.item)}`);
  }

  private info(actor: Actor, text: string): void {
    const depth = isPlayer(actor) ? actor.depth : this.depthOfMob(actor.id);
    this.pendingEvents.push({
      depth,
      event: { type: "info", actorId: actor.id, text, x: actor.x, y: actor.y },
    });
  }

  private event(depth: number, event: GameEvent): void {
    this.pendingEvents.push({ depth, event });
  }

  // ── ações de inventário (validação total no servidor) ─────────────

  private livingPlayer(id: string): PlayerActor | null {
    const a = this.players.get(id);
    return a && a.alive ? a : null;
  }

  /** Botão "pegar": mesmo efeito de pisar no tile. */
  pickup(id: string): void {
    const p = this.livingPlayer(id);
    if (p) this.autoPickup(p);
  }

  equip(id: string, uid: unknown): void {
    const p = this.livingPlayer(id);
    if (!p || typeof uid !== "string") return;
    const item = p.inventory.find((i) => i.uid === uid);
    if (!item) return;

    const cat = itemCategory(item.itemId);
    if (cat === "weapon") {
      p.equippedWeapon = p.equippedWeapon === uid ? null : uid;
      this.info(
        p,
        `${p.name} ${p.equippedWeapon ? "empunhou" : "guardou"} ${this.safeLabel(item)}`,
      );
    } else if (cat === "armor") {
      p.equippedArmor = p.equippedArmor === uid ? null : uid;
      this.info(p, `${p.name} ${p.equippedArmor ? "vestiu" : "tirou"} ${this.safeLabel(item)}`);
    } else {
      return; // consumíveis não se equipam
    }
    this.applyEquipment(p);
  }

  use(id: string, uid: unknown, targetUid?: unknown): void {
    const p = this.livingPlayer(id);
    if (!p || typeof uid !== "string") return;
    const item = p.inventory.find((i) => i.uid === uid);
    if (!item) return;

    const cat = itemCategory(item.itemId);
    if (cat === "food") {
      p.hp = Math.min(p.maxHp, p.hp + FOOD_HEAL);
      this.consume(p, item);
      this.info(p, `${p.name} comeu ${itemTrueName(item.itemId)} (+${FOOD_HEAL} HP)`);
    } else if (cat === "potion") {
      this.drinkPotion(p, item);
    } else if (cat === "scroll") {
      this.readScroll(p, item, targetUid);
    }
  }

  drop(id: string, uid: unknown): void {
    const p = this.livingPlayer(id);
    if (!p || typeof uid !== "string") return;
    const index = p.inventory.findIndex((i) => i.uid === uid);
    if (index < 0) return;

    const floor = this.floors.get(p.depth)!;
    const spot = this.findItemDropTile(floor, p);
    if (!spot) {
      this.info(p, "não há espaço no chão para largar");
      return;
    }
    const [item] = p.inventory.splice(index, 1);
    if (p.equippedWeapon === uid) p.equippedWeapon = null;
    if (p.equippedArmor === uid) p.equippedArmor = null;
    this.applyEquipment(p);

    floor.floorEntities.set(item.uid, {
      uid: item.uid,
      x: spot.x,
      y: spot.y,
      kind: "item",
      item,
    });
    floor.itemsByTile.set(floor.level.grid.index(spot.x, spot.y), item.uid);
    this.info(p, `${p.name} largou ${this.safeLabel(item)}`);
  }

  private consume(p: PlayerActor, item: ItemInstance): void {
    p.inventory = p.inventory.filter((i) => i.uid !== item.uid);
  }

  /** Beber identifica o tipo para o bebedor; efeitos são públicos e seguros. */
  private drinkPotion(p: PlayerActor, item: ItemInstance): void {
    const potion = item.itemId as PotionId;
    p.identified.add(potion);
    this.consume(p, item);

    if (potion === "healing") {
      p.hp = Math.min(p.maxHp, p.hp + HEAL_POTION_AMOUNT);
      this.info(p, `${p.name} bebeu uma poção e parece revigorado`);
    } else if (potion === "strength") {
      p.strength += 1;
      this.applyEquipment(p);
      this.info(p, `${p.name} bebeu uma poção e parece mais forte (FOR +1)`);
    } else {
      this.applyPoison(p);
      this.info(p, `${p.name} bebeu uma poção e ficou pálido... veneno!`);
    }
  }

  private readScroll(p: PlayerActor, item: ItemInstance, targetUid: unknown): void {
    const scroll = item.itemId as ScrollId;
    p.identified.add(scroll); // ler revela o que o pergaminho é

    if (scroll === "identify") {
      const alvo =
        typeof targetUid === "string" ? p.inventory.find((i) => i.uid === targetUid) : undefined;
      const precisa =
        alvo &&
        (itemCategory(alvo.itemId) === "potion" || itemCategory(alvo.itemId) === "scroll") &&
        !p.identified.has(alvo.itemId);
      if (!precisa) {
        this.info(p, "escolha um item ainda não identificado");
        return;
      }
      p.identified.add(alvo.itemId);
      this.consume(p, item);
      this.info(p, `${p.name} leu um pergaminho e identificou um item`);
    } else if (scroll === "teleport") {
      this.consume(p, item);
      const floor = this.floors.get(p.depth)!;
      const destino = pickTeleportTarget(floor.level.grid, this.rng, (x, y) => {
        return !floor.occupancy.has(floor.level.grid.index(x, y));
      });
      if (destino) {
        floor.occupancy.delete(floor.level.grid.index(p.x, p.y));
        p.x = destino.x;
        p.y = destino.y;
        floor.occupancy.set(floor.level.grid.index(p.x, p.y), p.id);
        this.info(p, `${p.name} desapareceu num clarão!`);
        this.autoPickup(p);
      }
    } else {
      const alvoUid = p.equippedWeapon ?? p.equippedArmor;
      const alvo = alvoUid ? p.inventory.find((i) => i.uid === alvoUid) : undefined;
      if (!alvo) {
        this.info(p, "nada equipado para melhorar");
        return;
      }
      alvo.upgrade += 1;
      this.applyEquipment(p);
      this.consume(p, item);
      this.info(p, `${p.name} fez ${this.safeLabel(alvo)} brilhar`);
    }
  }

  /** Envenena por 8 unidades de tempo (renova a duração se já ativo). */
  private applyPoison(p: PlayerActor): void {
    p.poisonedUntilTick = this.tick + POISON_DURATION_UNITS * TICKS_PER_TIME_UNIT;
  }

  /** Tique de veneno: 1 de dano por unidade de tempo, ignora armadura. */
  private processStatuses(): void {
    if (this.tick % TICKS_PER_TIME_UNIT !== 0) return;
    for (const actor of this.players.values()) {
      if (!actor.alive || actor.poisonedUntilTick <= this.tick) continue;
      actor.hp = Math.max(0, actor.hp - POISON_DAMAGE_PER_UNIT);
      this.event(actor.depth, {
        type: "hit",
        attackerId: actor.id,
        attackerName: "Veneno",
        targetId: actor.id,
        targetName: actor.name,
        x: actor.x,
        y: actor.y,
        damage: POISON_DAMAGE_PER_UNIT,
      });
      if (actor.hp === 0) this.onZeroHp(actor, actor);
    }
  }

  /** Recalcula os stats efetivos (nível + arma + força). */
  private applyEquipment(p: PlayerActor): void {
    const stats = heroStats(p.level);
    const weapon = p.equippedWeapon
      ? p.inventory.find((i) => i.uid === p.equippedWeapon)
      : undefined;
    const wdef = weapon ? WEAPONS[weapon.itemId as WeaponId] : undefined;

    p.accuracy = stats.accuracy + (wdef?.accuracyMod ?? 0);
    p.evasion = stats.evasion;
    p.damageMin = (wdef && weapon ? wdef.damageMin + weapon.upgrade : stats.damageMin) + p.strength;
    p.damageMax = (wdef && weapon ? wdef.damageMax + weapon.upgrade : stats.damageMax) + p.strength;
  }

  /** BFS por um tile passável sem item para receber um drop. */
  private findItemDropTile(floor: Floor, origin: Vec2): Vec2 | null {
    const grid = floor.level.grid;
    const visited = new Set<number>([grid.index(origin.x, origin.y)]);
    const queue: Vec2[] = [origin];
    while (queue.length > 0) {
      const current = queue.shift() as Vec2;
      const i = grid.index(current.x, current.y);
      if (!floor.itemsByTile.has(i) && SPAWNABLE.has(grid.tiles[i])) return current;
      for (const n of grid.neighbors4(current.x, current.y)) {
        const ni = grid.index(n.x, n.y);
        if (visited.has(ni)) continue;
        visited.add(ni);
        if (grid.tiles[ni] !== TileType.Wall) queue.push(n);
      }
    }
    return null;
  }

  // ── simulação ──────────────────────────────────────────────────────

  /**
   * Um tick da simulação: só andares com jogadores são simulados.
   * Devolve as mensagens de visão que mudaram, por jogador.
   */
  update(): Map<string, VisionMessage> {
    this.tick++;
    this.processDormancy();

    const activeDepths = new Set<number>();
    for (const p of this.players.values()) activeDepths.add(p.depth);

    for (const depth of activeDepths) {
      const floor = this.floors.get(depth);
      if (floor) this.updateFloor(floor);
    }

    this.processStatuses();
    return this.collectVisions();
  }

  private updateFloor(floor: Floor): void {
    // adormecidos são invisíveis para a IA (invulneráveis)
    const playersSnapshot = [...this.players.values()]
      .filter((p) => p.depth === floor.level.depth)
      .map((p) => ({
        id: p.id,
        pos: { x: p.x, y: p.y },
        alive: p.alive && p.conn !== "dormant",
      }));

    for (const p of this.players.values()) {
      if (p.depth !== floor.level.depth) continue;
      if (this.tick < p.nextActionAt) continue;
      this.actPlayer(floor, p);
    }
    for (const mob of floor.mobs.values()) {
      if (this.tick < mob.nextActionAt) continue;
      this.actMob(floor, mob, playersSnapshot);
    }

    // respawn lento até o teto do andar
    if (this.tick % MOB_RESPAWN_TICKS === 0 && floor.mobs.size < floor.mobCap) {
      this.trySpawnRandomMob(floor);
    }
  }

  private actPlayer(floor: Floor, actor: PlayerActor): void {
    if (!actor.intent || !actor.alive) {
      actor.intent = null;
      return;
    }
    const dir = actor.intent;
    actor.intent = null; // consome mesmo se inválida — sem feedback a cheats

    if (!canStep(floor.level.grid, actor, dir)) return;
    const targetIndex = floor.level.grid.index(actor.x + dir.x, actor.y + dir.y);
    const occupantId = floor.occupancy.get(targetIndex);
    const occupant = occupantId
      ? (this.players.get(occupantId) ?? floor.mobs.get(occupantId))
      : undefined;

    // mover-se contra um mob = atacar (custo de 1 unidade de tempo)
    if (occupant && !isPlayer(occupant)) {
      this.resolveAttack(floor, actor, occupant);
      actor.nextActionAt = this.tick + TICKS_PER_TIME_UNIT;
      return;
    }
    // sem friendly fire: tile com jogador só bloqueia
    this.tryMove(floor, actor, dir);
  }

  /** Mobs dormindo/esperando re-pensam a cada 5 ticks (0,5s) para poupar CPU. */
  private static readonly IDLE_RETHINK_TICKS = 5;

  private actMob(
    floor: Floor,
    mob: MobActor,
    players: { id: string; pos: Vec2; alive: boolean }[],
  ): void {
    const grid = floor.level.grid;
    const action = mobThink(mob.mind, {
      grid,
      self: mob,
      tick: this.tick,
      players,
      rng: this.rng,
      isFree: (x, y) => !floor.occupancy.has(grid.index(x, y)),
    });

    if (action.type === "move") {
      if (!this.tryMove(floor, mob, action.dir)) {
        mob.nextActionAt = this.tick + Match.IDLE_RETHINK_TICKS;
      }
    } else if (action.type === "attack") {
      const target = this.players.get(action.targetId);
      const adjacente =
        target && Math.max(Math.abs(target.x - mob.x), Math.abs(target.y - mob.y)) === 1;
      if (
        target &&
        target.depth === floor.level.depth &&
        target.alive &&
        target.conn !== "dormant" &&
        adjacente
      ) {
        this.resolveAttack(floor, mob, target);
      }
      mob.nextActionAt = this.tick + TICKS_PER_TIME_UNIT;
    } else {
      mob.nextActionAt = this.tick + Match.IDLE_RETHINK_TICKS;
    }
  }

  // ── combate ────────────────────────────────────────────────────────

  private resolveAttack(floor: Floor, attacker: Actor, defender: Actor): void {
    const result = attackRoll(this.rng, attacker, defender);
    const depth = floor.level.depth;
    if (!result.hit) {
      this.event(depth, {
        type: "miss",
        attackerId: attacker.id,
        attackerName: attacker.name,
        targetId: defender.id,
        targetName: defender.name,
        x: defender.x,
        y: defender.y,
      });
      return;
    }

    // armadura bloqueia parte do dano (só jogadores têm armadura por ora)
    const damage = isPlayer(defender)
      ? applyArmor(this.rng, result.damage, this.playerDefense(defender))
      : result.damage;

    defender.hp = Math.max(0, defender.hp - damage);
    this.event(depth, {
      type: "hit",
      attackerId: attacker.id,
      attackerName: attacker.name,
      targetId: defender.id,
      targetName: defender.name,
      x: defender.x,
      y: defender.y,
      damage,
    });
    if (defender.hp === 0) this.onZeroHp(defender, attacker);
  }

  private onZeroHp(victim: Actor, killer: Actor): void {
    const depth = isPlayer(victim) ? victim.depth : this.depthOfMob(victim.id);
    const floor = this.floors.get(depth)!;
    this.event(depth, {
      type: "death",
      actorId: victim.id,
      name: victim.name,
      x: victim.x,
      y: victim.y,
    });
    floor.occupancy.delete(floor.level.grid.index(victim.x, victim.y));

    if (isPlayer(victim)) {
      // vira espectador: fica no mundo como fantasma (fora da ocupação),
      // sem agir; a visão passa a ser a união do que os vivos veem.
      victim.alive = false;
      victim.intent = null;
      victim.wantsDescend = false;
      return;
    }

    floor.mobs.delete(victim.id);
    if (isPlayer(killer)) {
      this.awardXp(killer, scaledMobStats(victim.kind as MobKind, depth).xpReward);
    }

    // drop da espécie no tile onde caiu
    const drop = rollMobDrop(this.rng, victim.kind as MobKind);
    if (drop) this.placeLootAtFloor(floor, victim.x, victim.y, drop);
  }

  /** Rota de dano direta para preparar cenários de morte em testes. */
  damageForTest(id: string, amount: number): void {
    const actor = this.players.get(id) ?? this.findMob(id);
    if (!actor) return;
    actor.hp = Math.max(0, actor.hp - amount);
    if (actor.hp === 0) this.onZeroHp(actor, actor);
  }

  private awardXp(player: PlayerActor, amount: number): void {
    const ups = grantXp(player, amount);
    if (ups === 0) return;
    const stats = heroStats(player.level);
    const ganhoHp = stats.maxHp - player.maxHp;
    player.maxHp = stats.maxHp;
    player.hp = Math.min(player.maxHp, player.hp + ganhoHp);
    player.accuracy = stats.accuracy;
    player.evasion = stats.evasion;
    this.event(player.depth, {
      type: "levelup",
      actorId: player.id,
      name: player.name,
      level: player.level,
      x: player.x,
      y: player.y,
    });
  }

  /** Defesa efetiva do jogador (armadura equipada + melhoria). */
  private playerDefense(player: PlayerActor): number {
    if (!player.equippedArmor) return 0;
    const item = player.inventory.find((i) => i.uid === player.equippedArmor);
    if (!item) return 0;
    const def = ARMORS[item.itemId as ArmorId];
    return def ? def.defense + item.upgrade : 0;
  }

  /** Passo validado + ocupação; cobra o custo de tempo se moveu. */
  private tryMove(floor: Floor, actor: Actor, dir: Vec2): boolean {
    const grid = floor.level.grid;
    if (!canStep(grid, actor, dir)) return false;
    const targetIndex = grid.index(actor.x + dir.x, actor.y + dir.y);
    if (floor.occupancy.has(targetIndex)) return false;

    floor.occupancy.delete(grid.index(actor.x, actor.y));
    floor.occupancy.set(targetIndex, actor.id);
    actor.x += dir.x;
    actor.y += dir.y;
    actor.nextActionAt = this.tick + moveCostTicks(actor.speed);

    if (isPlayer(actor)) this.autoPickup(actor);
    return true;
  }

  /** BFS pelo tile passável e livre mais próximo (inclui o próprio ponto). */
  private findFreeTileNear(floor: Floor, origin: Vec2): Vec2 | null {
    const grid = floor.level.grid;
    const visited = new Set<number>([grid.index(origin.x, origin.y)]);
    const queue: Vec2[] = [origin];
    while (queue.length > 0) {
      const current = queue.shift() as Vec2;
      const i = grid.index(current.x, current.y);
      if (!floor.occupancy.has(i) && SPAWNABLE.has(grid.tiles[i])) return current;
      for (const n of grid.neighbors4(current.x, current.y)) {
        const ni = grid.index(n.x, n.y);
        if (visited.has(ni)) continue;
        visited.add(ni);
        if (grid.tiles[ni] !== TileType.Wall) queue.push(n);
      }
    }
    return null;
  }

  // ── visão ──────────────────────────────────────────────────────────

  private discoveredOn(player: PlayerActor, depth: number): Set<number> {
    let set = player.discovered.get(depth);
    if (!set) {
      set = new Set();
      player.discovered.set(depth, set);
    }
    return set;
  }

  /** Visões que mudaram desde o último envio (a primeira sempre é enviada). */
  private collectVisions(): Map<string, VisionMessage> {
    // FOV dos vivos por andar; espectadores enxergam a união do seu andar
    const livingFovs = new Map<string, Set<number>>();
    const groupFovByDepth = new Map<number, Set<number>>();
    for (const p of this.players.values()) {
      if (p.alive && p.conn !== "dormant") {
        const floor = this.floors.get(p.depth)!;
        const fov = computeFov(floor.level.grid, p, FOV_RADIUS);
        livingFovs.set(p.id, fov);
        let group = groupFovByDepth.get(p.depth);
        if (!group) {
          group = new Set();
          groupFovByDepth.set(p.depth, group);
        }
        for (const i of fov) group.add(i);
      }
    }

    const out = new Map<string, VisionMessage>();
    for (const p of this.players.values()) {
      const floor = this.floors.get(p.depth)!;
      const fov = p.alive
        ? (livingFovs.get(p.id) ?? new Set<number>())
        : (groupFovByDepth.get(p.depth) ?? new Set<number>());
      const message = this.buildVision(p, floor, fov);
      const key = JSON.stringify([message.you, message.visible, message.actors, message.items]);
      if (key !== p.lastVisionKey || message.discovered.length > 0 || message.events.length > 0) {
        p.lastVisionKey = key;
        out.set(p.id, message);
      }
    }
    this.pendingEvents = [];
    return out;
  }

  private buildVision(player: PlayerActor, floor: Floor, fov: Set<number>): VisionMessage {
    const grid = floor.level.grid;
    const depth = floor.level.depth;
    const known = this.discoveredOn(player, depth);

    const discovered: [number, number][] = [];
    for (const i of fov) {
      if (!known.has(i)) {
        known.add(i);
        discovered.push([i, grid.tiles[i]]);
      }
    }

    const actorsInView: VisibleActor[] = [];
    const pushActor = (other: Actor) => {
      if (fov.has(grid.index(other.x, other.y))) {
        actorsInView.push({
          id: other.id,
          name: other.name,
          kind: other.kind,
          colorIndex: isPlayer(other) ? other.colorIndex : 0,
          x: other.x,
          y: other.y,
          hp: other.hp,
          maxHp: other.maxHp,
          moveTicks: moveCostTicks(other.speed),
          asleep: !isPlayer(other) && other.mind.state === "sleeping",
        });
      }
    };
    for (const other of this.players.values()) {
      if (other.depth !== depth) continue;
      if (!other.alive || other.conn === "dormant") continue; // fantasmas/adormecidos
      pushActor(other);
    }
    for (const mob of floor.mobs.values()) pushActor(mob);

    const itemsInView: VisibleItem[] = [];
    for (const entity of floor.floorEntities.values()) {
      if (!fov.has(grid.index(entity.x, entity.y))) continue;
      itemsInView.push({
        id: entity.uid,
        x: entity.x,
        y: entity.y,
        category: entity.kind === "gold" ? "gold" : itemCategory(entity.item.itemId),
        icon: entity.kind === "gold" ? "gold" : itemIcon(entity.item.itemId, this.appearances),
        label:
          entity.kind === "gold"
            ? `${entity.amount} moedas`
            : displayLabel(
                entity.item.itemId,
                entity.item.upgrade,
                player.identified,
                this.appearances,
              ),
      });
    }
    itemsInView.sort((a, b) => a.id.localeCompare(b.id));

    const inventory: InventoryEntry[] = player.inventory.map((item) => ({
      uid: item.uid,
      label: displayLabel(item.itemId, item.upgrade, player.identified, this.appearances),
      icon: itemIcon(item.itemId, this.appearances),
      category: itemCategory(item.itemId),
      identified:
        itemCategory(item.itemId) !== "potion" && itemCategory(item.itemId) !== "scroll"
          ? true
          : player.identified.has(item.itemId),
      equipped: item.uid === player.equippedWeapon || item.uid === player.equippedArmor,
      upgrade: item.upgrade,
    }));

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
      gold: player.gold,
      strength: player.strength,
      defense: this.playerDefense(player),
      statuses: player.poisonedUntilTick > this.tick ? ["veneno"] : [],
      inventory,
    };

    // evento entra se: mesmo andar E (posição visível OU envolve o jogador)
    const involves = (e: GameEvent) =>
      ("attackerId" in e && e.attackerId === player.id) ||
      ("targetId" in e && e.targetId === player.id) ||
      ("actorId" in e && e.actorId === player.id);
    const events = this.pendingEvents
      .filter((pe) => pe.depth === depth)
      .map((pe) => pe.event)
      .filter((e) => involves(e) || fov.has(grid.index(e.x, e.y)));

    const { votes, needed } = this.descentVotes(depth);
    const hasStairsDown = grid.count(TileType.StairsDown) > 0;

    return {
      tick: this.tick,
      depth,
      descent: hasStairsDown && votes > 0 ? { votes, needed } : null,
      you,
      visible: [...fov].sort((a, b) => a - b),
      discovered: discovered.sort((a, b) => a[0] - b[0]),
      actors: actorsInView.sort((a, b) => a.id.localeCompare(b.id)),
      items: itemsInView,
      events,
    };
  }
}
