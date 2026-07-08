import {
  FOV_RADIUS,
  HERO_SPEED,
  canStep,
  computeFov,
  generateLevel,
  moveCostTicks,
  type Level,
  type Vec2,
  type VisibleActor,
  type VisionMessage,
} from "@shattered-dominion/shared";

interface Actor {
  id: string;
  name: string;
  x: number;
  y: number;
  speed: number;
  /** tick a partir do qual a próxima ação pode executar. */
  nextActionAt: number;
  /** buffer de 1 slot — a última intenção recebida vence. */
  intent: Vec2 | null;
  /** memória do mapa: índices de tiles já descobertos por ESTE jogador. */
  discovered: Set<number>;
  /** última visão enviada (sem o tick) para deduplicar mensagens. */
  lastVisionKey: string;
}

/**
 * Núcleo autoritativo da partida — sem nenhuma dependência de rede/Colyseus,
 * para ser testável de forma síncrona e determinística. O GameRoom é só a
 * cola: repassa intenções para cá e envia as visões resultantes.
 */
export class Match {
  readonly level: Level;
  tick = 0;

  private readonly actors = new Map<string, Actor>();
  private readonly occupancy = new Map<number, string>();

  constructor(level: Level) {
    this.level = level;
  }

  static fromSeed(seed: number, depth = 1): Match {
    return new Match(generateLevel(seed, depth));
  }

  /** Posiciona o jogador no próximo spawn livre da sala de entrada. */
  addPlayer(id: string, name: string): Vec2 {
    const spawn = this.level.spawnPoints.find(
      (p) => !this.occupancy.has(this.level.grid.index(p.x, p.y)),
    );
    if (!spawn) throw new Error("Match.addPlayer: sem spawn livre");

    this.actors.set(id, {
      id,
      name,
      x: spawn.x,
      y: spawn.y,
      speed: HERO_SPEED,
      nextActionAt: 0,
      intent: null,
      discovered: new Set(),
      lastVisionKey: "",
    });
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
    return this.actors.size;
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
    if (!actor) return;
    if (typeof dx !== "number" || typeof dy !== "number") return;
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) return;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return;
    actor.intent = { x: dx, y: dy };
  }

  /**
   * Um tick da simulação: executa intenções cujos atores estão prontos
   * (fila de tempo) e devolve as mensagens de visão que mudaram, por jogador.
   */
  update(): Map<string, VisionMessage> {
    this.tick++;
    const grid = this.level.grid;

    for (const actor of this.actors.values()) {
      if (!actor.intent || this.tick < actor.nextActionAt) continue;
      const dir = actor.intent;
      actor.intent = null; // consome mesmo se inválida — sem feedback a cheats

      if (!canStep(grid, actor, dir)) continue;
      const targetIndex = grid.index(actor.x + dir.x, actor.y + dir.y);
      if (this.occupancy.has(targetIndex)) continue; // tile ocupado por outro ator

      this.occupancy.delete(grid.index(actor.x, actor.y));
      this.occupancy.set(targetIndex, actor.id);
      actor.x += dir.x;
      actor.y += dir.y;
      actor.nextActionAt = this.tick + moveCostTicks(actor.speed);
    }

    return this.collectVisions();
  }

  /** Visões que mudaram desde o último envio (a primeira sempre é enviada). */
  private collectVisions(): Map<string, VisionMessage> {
    const out = new Map<string, VisionMessage>();
    for (const actor of this.actors.values()) {
      const message = this.buildVision(actor);
      const key = JSON.stringify([message.you, message.visible, message.actors]);
      if (key !== actor.lastVisionKey || message.discovered.length > 0) {
        actor.lastVisionKey = key;
        out.set(actor.id, message);
      }
    }
    return out;
  }

  private buildVision(actor: Actor): VisionMessage {
    const grid = this.level.grid;
    const fov = computeFov(grid, actor, FOV_RADIUS);

    const discovered: [number, number][] = [];
    for (const i of fov) {
      if (!actor.discovered.has(i)) {
        actor.discovered.add(i);
        discovered.push([i, grid.tiles[i]]);
      }
    }

    const actorsInView: VisibleActor[] = [];
    for (const other of this.actors.values()) {
      if (fov.has(grid.index(other.x, other.y))) {
        actorsInView.push({
          id: other.id,
          name: other.name,
          x: other.x,
          y: other.y,
          moveTicks: moveCostTicks(other.speed),
        });
      }
    }

    return {
      tick: this.tick,
      you: { x: actor.x, y: actor.y, nextActionAt: actor.nextActionAt },
      visible: [...fov].sort((a, b) => a - b),
      discovered: discovered.sort((a, b) => a[0] - b[0]),
      actors: actorsInView.sort((a, b) => a.id.localeCompare(b.id)),
    };
  }
}
