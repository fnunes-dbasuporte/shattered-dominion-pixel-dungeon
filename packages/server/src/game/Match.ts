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
  rollMobCount,
  rollMobKind,
  ARMORS,
  FOOD_HEAL,
  HEAL_POTION_AMOUNT,
  WEAPONS,
  applyArmor,
  POISON_DAMAGE_PER_UNIT,
  POISON_DURATION_UNITS,
  displayLabel,
  itemCategory,
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
  /** buffer de 1 slot — a última intenção recebida vence. */
  intent: Vec2 | null;
  /** memória do mapa: índices de tiles já descobertos por ESTE jogador. */
  discovered: Set<number>;
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
  private itemSeq = 0;
  readonly appearances: RunAppearances;
  private readonly floorEntities = new Map<string, FloorEntity>();
  /** índice do tile → uid do FloorEntity (um por tile). */
  private readonly itemsByTile = new Map<number, string>();
  /** eventos gerados neste tick — distribuídos e limpos em collectVisions. */
  private pendingEvents: GameEvent[] = [];

  constructor(level: Level) {
    this.level = level;
    this.rng = new Rng(level.seed).fork("match");
    this.appearances = rollAppearances(new Rng(level.seed).fork("appearances"));
  }

  /** Produção: gera o andar e povoa mobs e loot. */
  static fromSeed(seed: number, depth = 1): Match {
    const match = new Match(generateLevel(seed, depth));
    match.populateMobs();
    match.populateLoot();
    return match;
  }

  // ── jogadores ──────────────────────────────────────────────────────

  /** Posiciona o jogador no próximo spawn livre da sala de entrada (ou em `at`). */
  addPlayer(id: string, name: string, at?: Vec2, colorIndex = 0): Vec2 {
    const spawn =
      at ??
      this.level.spawnPoints.find((p) => !this.occupancy.has(this.level.grid.index(p.x, p.y)));
    if (!spawn) throw new Error("Match.addPlayer: sem spawn livre");

    const stats = heroStats(1);
    const player: PlayerActor = {
      kind: "player",
      colorIndex,
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
      intent: null,
      discovered: new Set(),
      lastVisionKey: "",
    };
    this.actors.set(id, player);
    this.occupancy.set(this.level.grid.index(spawn.x, spawn.y), id);
    return { x: spawn.x, y: spawn.y };
  }

  /**
   * Entrada mid-run: nasce na sala de entrada (spawn livre; senão o tile
   * livre mais próximo da escada ▲) com kit básico — Adaga equipada e uma
   * Ração — para não entrar de mãos vazias no meio da run.
   */
  addPlayerMidRun(id: string, name: string, colorIndex = 0): Vec2 {
    const livre = this.level.spawnPoints.find(
      (p) => !this.occupancy.has(this.level.grid.index(p.x, p.y)),
    );
    const spot = livre ?? this.findFreeTileNear(this.level.stairsUp);
    if (!spot) throw new Error("Match.addPlayerMidRun: sem tile livre");
    this.addPlayer(id, name, spot, colorIndex);
    const player = this.actors.get(id) as PlayerActor;

    const dagger: ItemInstance = { uid: `item-${++this.itemSeq}`, itemId: "dagger", upgrade: 0 };
    const ration: ItemInstance = { uid: `item-${++this.itemSeq}`, itemId: "ration", upgrade: 0 };
    player.inventory.push(dagger, ration);
    player.equippedWeapon = dagger.uid;
    this.applyEquipment(player);
    this.info(player, `${player.name} juntou-se ao grupo`);
    return { x: player.x, y: player.y };
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
    if (!actor || !isPlayer(actor) || !actor.alive || actor.conn !== "online") return;
    if (typeof dx !== "number" || typeof dy !== "number") return;
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) return;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return;
    actor.intent = { x: dx, y: dy };
  }

  // ── conexão (queda, dormência, reconexão) ──────────────────────────

  /** Carência antes de adormecer: 60s de jogo. */
  static readonly DORMANCY_TICKS = 60 * TICKS_PER_TIME_UNIT;

  /** Queda de conexão: herói fica em jogo, parado e vulnerável, por 60s. */
  setDropped(id: string): void {
    const p = this.actors.get(id);
    if (!p || !isPlayer(p) || p.conn !== "online") return;
    p.conn = "dropped";
    p.droppedAtTick = this.tick;
    p.intent = null;
  }

  /** Volta do jogador: acorda do estado atual e devolve o controle. */
  reconnectPlayer(id: string): void {
    const p = this.actors.get(id);
    if (!p || !isPlayer(p)) return;
    if (p.conn === "dormant") {
      // realoca: o tile original pode ter sido ocupado enquanto dormia
      const spot = this.findFreeTileNear(p) ?? p;
      p.x = spot.x;
      p.y = spot.y;
      this.occupancy.set(this.level.grid.index(p.x, p.y), p.id);
    }
    p.conn = "online";
    p.lastVisionKey = ""; // força reenvio da visão no próximo tick
  }

  /**
   * Visão completa para ressincronizar um cliente que voltou (possivelmente
   * com a página recarregada): inclui TODA a memória de mapa do jogador.
   */
  fullVisionFor(id: string): VisionMessage | null {
    const p = this.actors.get(id);
    if (!p || !isPlayer(p)) return null;
    const grid = this.level.grid;
    const fov = computeFov(grid, p, FOV_RADIUS);
    const message = this.buildVision(p, fov);
    message.discovered = [...p.discovered]
      .sort((a, b) => a - b)
      .map((i) => [i, grid.tiles[i]] as [number, number]);
    p.lastVisionKey = "";
    return message;
  }

  private processDormancy(): void {
    for (const p of this.actors.values()) {
      if (!isPlayer(p) || p.conn !== "dropped") continue;
      if (this.tick - p.droppedAtTick < Match.DORMANCY_TICKS) continue;
      // adormece: invulnerável (IA o ignora) e sem colisão (sai da ocupação)
      p.conn = "dormant";
      p.intent = null;
      this.occupancy.delete(this.level.grid.index(p.x, p.y));
      this.info(p, `${p.name} adormeceu`);
    }
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

  /** Spawna até n mobs extras (estresse do load test); retorna quantos nasceram. */
  spawnRandomMobs(n: number): number {
    let spawned = 0;
    for (let i = 0; i < n; i++) if (this.trySpawnRandomMob()) spawned++;
    this.mobCap = Math.max(this.mobCap, this.mobCount);
    return spawned;
  }

  /** Acesso direto ao ator — apenas para preparação de cenários em testes. */
  actorForTest(id: string): Actor | undefined {
    return this.actors.get(id);
  }

  /** Posições dos mobs — apenas para asserções em testes. */
  mobPositionsForTest(): Map<string, Vec2> {
    const out = new Map<string, Vec2>();
    for (const a of this.actors.values()) {
      if (!isPlayer(a)) out.set(a.id, { x: a.x, y: a.y });
    }
    return out;
  }

  // ── loot ───────────────────────────────────────────────────────────

  /** 3–6 itens/ouro em salas comuns + bônus nas salas de tesouro. */
  populateLoot(): void {
    const rooms = this.level.rooms.filter((r) => r.type !== RoomType.Entrance);
    if (rooms.length === 0) return;

    const count = rollFloorLootCount(this.rng);
    for (let i = 0; i < count; i++) {
      this.placeLootInRoom(this.rng.pick(rooms), rollFloorLoot(this.rng, this.level.depth));
    }
    for (const room of this.level.rooms) {
      if (room.type !== RoomType.Treasure) continue;
      for (let i = 0; i < TREASURE_BONUS_ITEMS; i++) {
        this.placeLootInRoom(room, rollFloorLoot(this.rng, this.level.depth));
      }
      this.placeLootInRoom(room, {
        kind: "gold",
        amount: rollTreasureGold(this.rng, this.level.depth),
      });
    }
  }

  get floorItemCount(): number {
    return this.floorEntities.size;
  }

  floorEntitiesForTest(): FloorEntity[] {
    return [...this.floorEntities.values()];
  }

  private placeLootInRoom(
    room: { x: number; y: number; width: number; height: number },
    roll: LootRoll,
  ): void {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = this.rng.nextInt(room.x, room.x + room.width - 1);
      const y = this.rng.nextInt(room.y, room.y + room.height - 1);
      if (this.placeLootAt(x, y, roll)) return;
    }
  }

  /** Coloca loot no tile se for spawnável e não houver outro item ali. */
  placeLootAt(x: number, y: number, roll: LootRoll): boolean {
    const i = this.level.grid.index(x, y);
    if (this.itemsByTile.has(i) || !SPAWNABLE.has(this.level.grid.tiles[i])) return false;

    const uid = `item-${++this.itemSeq}`;
    const entity: FloorEntity =
      roll.kind === "gold"
        ? { uid, x, y, kind: "gold", amount: roll.amount }
        : { uid, x, y, kind: "item", item: { uid, itemId: roll.itemId, upgrade: roll.upgrade } };
    this.floorEntities.set(uid, entity);
    this.itemsByTile.set(i, uid);
    return true;
  }

  private removeFloorEntity(entity: FloorEntity): void {
    this.floorEntities.delete(entity.uid);
    this.itemsByTile.delete(this.level.grid.index(entity.x, entity.y));
  }

  /** Rótulo público (seguro): nunca revela tipo de poção/pergaminho. */
  private safeLabel(item: ItemInstance): string {
    return displayLabel(item.itemId, item.upgrade, NO_IDENTIFICATION, this.appearances);
  }

  /** Pega tudo que estiver no tile do jogador (ouro sempre; item se couber). */
  private autoPickup(player: PlayerActor): void {
    const i = this.level.grid.index(player.x, player.y);
    const uid = this.itemsByTile.get(i);
    if (!uid) return;
    const entity = this.floorEntities.get(uid);
    if (!entity) return;

    if (entity.kind === "gold") {
      player.gold += entity.amount;
      this.removeFloorEntity(entity);
      this.info(player, `${player.name} pegou ${entity.amount} de ouro`);
      return;
    }
    if (player.inventory.length >= 16) {
      this.info(player, `inventário cheio — ${this.safeLabel(entity.item)} ficou no chão`);
      return;
    }
    player.inventory.push(entity.item);
    this.removeFloorEntity(entity);
    this.info(player, `${player.name} pegou ${this.safeLabel(entity.item)}`);
  }

  private info(actor: Actor, text: string): void {
    this.pendingEvents.push({ type: "info", actorId: actor.id, text, x: actor.x, y: actor.y });
  }

  // ── ações de inventário (validação total no servidor) ─────────────

  private livingPlayer(id: string): PlayerActor | null {
    const a = this.actors.get(id);
    return a && isPlayer(a) && a.alive ? a : null;
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

    const spot = this.findItemDropTile(p);
    if (!spot) {
      this.info(p, "não há espaço no chão para largar");
      return;
    }
    const [item] = p.inventory.splice(index, 1);
    if (p.equippedWeapon === uid) p.equippedWeapon = null;
    if (p.equippedArmor === uid) p.equippedArmor = null;
    this.applyEquipment(p);

    this.floorEntities.set(item.uid, { uid: item.uid, x: spot.x, y: spot.y, kind: "item", item });
    this.itemsByTile.set(this.level.grid.index(spot.x, spot.y), item.uid);
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
        // não consome: o cliente pede o alvo e reenvia
        this.info(p, "escolha um item ainda não identificado");
        return;
      }
      p.identified.add(alvo.itemId);
      this.consume(p, item);
      this.info(p, `${p.name} leu um pergaminho e identificou um item`);
    } else if (scroll === "teleport") {
      this.consume(p, item);
      const destino = pickTeleportTarget(this.level.grid, this.rng, (x, y) => {
        return !this.occupancy.has(this.level.grid.index(x, y));
      });
      if (destino) {
        this.occupancy.delete(this.level.grid.index(p.x, p.y));
        p.x = destino.x;
        p.y = destino.y;
        this.occupancy.set(this.level.grid.index(p.x, p.y), p.id);
        this.info(p, `${p.name} desapareceu num clarão!`);
        this.autoPickup(p);
      }
    } else {
      // melhoria: arma equipada tem prioridade; senão armadura
      const alvoUid = p.equippedWeapon ?? p.equippedArmor;
      const alvo = alvoUid ? p.inventory.find((i) => i.uid === alvoUid) : undefined;
      if (!alvo) {
        this.info(p, "nada equipado para melhorar");
        return; // não consome
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
    for (const actor of this.actors.values()) {
      if (!isPlayer(actor) || !actor.alive || actor.poisonedUntilTick <= this.tick) continue;
      actor.hp = Math.max(0, actor.hp - POISON_DAMAGE_PER_UNIT);
      this.pendingEvents.push({
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
  private findItemDropTile(origin: Vec2): Vec2 | null {
    const grid = this.level.grid;
    const visited = new Set<number>([grid.index(origin.x, origin.y)]);
    const queue: Vec2[] = [origin];
    while (queue.length > 0) {
      const current = queue.shift() as Vec2;
      const i = grid.index(current.x, current.y);
      if (!this.itemsByTile.has(i) && SPAWNABLE.has(grid.tiles[i])) return current;
      for (const n of grid.neighbors4(current.x, current.y)) {
        const ni = grid.index(n.x, n.y);
        if (visited.has(ni)) continue;
        visited.add(ni);
        if (grid.tiles[ni] !== TileType.Wall) queue.push(n);
      }
    }
    return null;
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

    this.processDormancy();

    // adormecidos são invisíveis para a IA (invulneráveis)
    const playersSnapshot = [...this.actors.values()].filter(isPlayer).map((p) => ({
      id: p.id,
      pos: { x: p.x, y: p.y },
      alive: p.alive && p.conn !== "dormant",
    }));

    for (const actor of this.actors.values()) {
      if (this.tick < actor.nextActionAt) continue;
      if (isPlayer(actor)) this.actPlayer(actor);
      else this.actMob(actor, playersSnapshot);
    }

    this.processStatuses();

    // respawn lento até o teto do andar
    if (this.tick % MOB_RESPAWN_TICKS === 0 && this.mobCount < this.mobCap) {
      this.trySpawnRandomMob();
    }

    return this.collectVisions();
  }

  private actPlayer(actor: PlayerActor): void {
    if (!actor.intent || !actor.alive) {
      actor.intent = null;
      return;
    }
    const dir = actor.intent;
    actor.intent = null; // consome mesmo se inválida — sem feedback a cheats

    if (!canStep(this.level.grid, actor, dir)) return;
    const targetIndex = this.level.grid.index(actor.x + dir.x, actor.y + dir.y);
    const occupantId = this.occupancy.get(targetIndex);
    const occupant = occupantId ? this.actors.get(occupantId) : undefined;

    // mover-se contra um mob = atacar (custo de 1 unidade de tempo)
    if (occupant && !isPlayer(occupant)) {
      this.resolveAttack(actor, occupant);
      actor.nextActionAt = this.tick + TICKS_PER_TIME_UNIT;
      return;
    }
    // sem friendly fire: tile com jogador só bloqueia
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
      const target = this.actors.get(action.targetId);
      // revalidação no servidor: alvo vivo e de fato adjacente
      const adjacente =
        target && Math.max(Math.abs(target.x - mob.x), Math.abs(target.y - mob.y)) === 1;
      if (target && isPlayer(target) && target.alive && target.conn !== "dormant" && adjacente) {
        this.resolveAttack(mob, target);
      }
      mob.nextActionAt = this.tick + TICKS_PER_TIME_UNIT;
    } else {
      mob.nextActionAt = this.tick + Match.IDLE_RETHINK_TICKS;
    }
  }

  // ── combate ────────────────────────────────────────────────────────

  private resolveAttack(attacker: Actor, defender: Actor): void {
    const result = attackRoll(this.rng, attacker, defender);
    if (!result.hit) {
      this.pendingEvents.push({
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
    this.pendingEvents.push({
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
    this.pendingEvents.push({
      type: "death",
      actorId: victim.id,
      name: victim.name,
      x: victim.x,
      y: victim.y,
    });
    this.occupancy.delete(this.level.grid.index(victim.x, victim.y));

    if (isPlayer(victim)) {
      // vira espectador: fica no mundo como fantasma (fora da ocupação),
      // sem agir; a visão passa a ser a união do que os vivos veem.
      victim.alive = false;
      victim.intent = null;
      return;
    }

    this.actors.delete(victim.id);
    if (isPlayer(killer)) this.awardXp(killer, MOB_DEFS[victim.kind].xpReward);

    // drop da espécie no tile onde caiu
    const drop = rollMobDrop(this.rng, victim.kind as MobKind);
    if (drop) this.placeLootAt(victim.x, victim.y, drop);
  }

  /** Rota de dano direta para preparar cenários de morte em testes. */
  damageForTest(id: string, amount: number): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    actor.hp = Math.max(0, actor.hp - amount);
    if (actor.hp === 0) this.onZeroHp(actor, actor);
  }

  /** Todos os mortos revivem com 50% do HP ao lado da escada de descida. */
  private reviveDeadPlayers(): void {
    const { grid } = this.level;
    for (const actor of this.actors.values()) {
      if (!isPlayer(actor) || actor.alive) continue;
      const spot = this.findFreeTileNear(this.level.stairsDown);
      if (!spot) continue; // sem espaço — tenta de novo no próximo uso da escada

      actor.x = spot.x;
      actor.y = spot.y;
      actor.alive = true;
      actor.hp = Math.ceil(actor.maxHp / 2);
      actor.poisonedUntilTick = 0;
      actor.nextActionAt = this.tick + TICKS_PER_TIME_UNIT;
      this.occupancy.set(grid.index(spot.x, spot.y), actor.id);
      this.pendingEvents.push({
        type: "revive",
        actorId: actor.id,
        name: actor.name,
        x: spot.x,
        y: spot.y,
      });
    }
  }

  /** BFS pelo tile passável e livre mais próximo (inclui o próprio ponto). */
  private findFreeTileNear(origin: Vec2): Vec2 | null {
    const grid = this.level.grid;
    const visited = new Set<number>([grid.index(origin.x, origin.y)]);
    const queue: Vec2[] = [origin];
    while (queue.length > 0) {
      const current = queue.shift() as Vec2;
      const i = grid.index(current.x, current.y);
      if (!this.occupancy.has(i) && SPAWNABLE.has(grid.tiles[i])) return current;
      for (const n of grid.neighbors4(current.x, current.y)) {
        const ni = grid.index(n.x, n.y);
        if (visited.has(ni)) continue;
        visited.add(ni);
        if (grid.tiles[ni] !== TileType.Wall) queue.push(n);
      }
    }
    return null;
  }

  private awardXp(player: PlayerActor, amount: number): void {
    const ups = grantXp(player, amount);
    if (ups === 0) return;
    // aplica os novos stats; o aumento de HP máximo também cura o delta
    const stats = heroStats(player.level);
    const ganhoHp = stats.maxHp - player.maxHp;
    player.maxHp = stats.maxHp;
    player.hp = Math.min(player.maxHp, player.hp + ganhoHp);
    player.accuracy = stats.accuracy;
    player.evasion = stats.evasion;
    this.pendingEvents.push({
      type: "levelup",
      actorId: player.id,
      name: player.name,
      level: player.level,
      x: player.x,
      y: player.y,
    });
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

    if (isPlayer(actor)) {
      this.autoPickup(actor);
      // "usar" a escada de descida = pisar nela; revive os mortos do grupo
      // (a descida real de andar chega na sprint 07)
      if (actor.x === this.level.stairsDown.x && actor.y === this.level.stairsDown.y) {
        this.reviveDeadPlayers();
      }
    }
    return true;
  }

  // ── visão ──────────────────────────────────────────────────────────

  /** Visões que mudaram desde o último envio (a primeira sempre é enviada). */
  private collectVisions(): Map<string, VisionMessage> {
    const grid = this.level.grid;

    // FOV dos vivos primeiro; espectadores enxergam a união do grupo
    const livingFovs = new Map<string, Set<number>>();
    for (const actor of this.actors.values()) {
      if (isPlayer(actor) && actor.alive) {
        livingFovs.set(actor.id, computeFov(grid, actor, FOV_RADIUS));
      }
    }
    const groupFov = new Set<number>();
    for (const fov of livingFovs.values()) for (const i of fov) groupFov.add(i);

    const out = new Map<string, VisionMessage>();
    for (const actor of this.actors.values()) {
      if (!isPlayer(actor)) continue;
      const fov = actor.alive ? livingFovs.get(actor.id)! : groupFov;
      const message = this.buildVision(actor, fov);
      const key = JSON.stringify([message.you, message.visible, message.actors, message.items]);
      if (
        key !== actor.lastVisionKey ||
        message.discovered.length > 0 ||
        message.events.length > 0
      ) {
        actor.lastVisionKey = key;
        out.set(actor.id, message);
      }
    }
    this.pendingEvents = [];
    return out;
  }

  private buildVision(player: PlayerActor, fov: Set<number>): VisionMessage {
    const grid = this.level.grid;

    const discovered: [number, number][] = [];
    for (const i of fov) {
      if (!player.discovered.has(i)) {
        player.discovered.add(i);
        discovered.push([i, grid.tiles[i]]);
      }
    }

    const actorsInView: VisibleActor[] = [];
    for (const other of this.actors.values()) {
      // fantasmas e adormecidos não aparecem
      if (isPlayer(other) && (!other.alive || other.conn === "dormant")) continue;
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
    }

    const itemsInView: VisibleItem[] = [];
    for (const entity of this.floorEntities.values()) {
      if (!fov.has(grid.index(entity.x, entity.y))) continue;
      itemsInView.push({
        id: entity.uid,
        x: entity.x,
        y: entity.y,
        category: entity.kind === "gold" ? "gold" : itemCategory(entity.item.itemId),
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

    // evento entra se a posição é visível OU se envolve o próprio jogador
    const involves = (e: GameEvent) =>
      ("attackerId" in e && e.attackerId === player.id) ||
      ("targetId" in e && e.targetId === player.id) ||
      ("actorId" in e && e.actorId === player.id);
    const events = this.pendingEvents.filter((e) => involves(e) || fov.has(grid.index(e.x, e.y)));

    return {
      tick: this.tick,
      you,
      visible: [...fov].sort((a, b) => a - b),
      discovered: discovered.sort((a, b) => a[0] - b[0]),
      actors: actorsInView.sort((a, b) => a.id.localeCompare(b.id)),
      items: itemsInView,
      events,
    };
  }

  /** Defesa efetiva do jogador (armadura equipada + melhoria). */
  private playerDefense(player: PlayerActor): number {
    if (!player.equippedArmor) return 0;
    const item = player.inventory.find((i) => i.uid === player.equippedArmor);
    if (!item) return 0;
    const def = ARMORS[item.itemId as ArmorId];
    return def ? def.defense + item.upgrade : 0;
  }
}
