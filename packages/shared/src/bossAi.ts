import { TICKS_PER_TIME_UNIT } from "./constants.js";
import { MOB_DEFS } from "./mobs.js";
import type { Vec2 } from "./types.js";
import { computeFov } from "./dungeon/fov.js";
import { DIRECTIONS8, canStep, findPath } from "./dungeon/pathfind.js";
import type { MobSenses } from "./ai.js";

/**
 * Mente do Amálgama de Lodo — máquina de estados PURA (roda no servidor).
 * Fases: caça normal → ataque carregado telegrafado (2s, área 3×3,
 * esquivável) → fúria abaixo de 50% HP (mais rápido, cadência maior) →
 * invoca Lodos Rastejantes periodicamente.
 */

export const BOSS_BASE_HP = MOB_DEFS.boss.maxHp;
export const BOSS_HP_PER_EXTRA_PLAYER = 40;

/** HP do chefe escala com o tamanho do grupo. */
export function bossMaxHp(playerCount: number): number {
  return BOSS_BASE_HP + BOSS_HP_PER_EXTRA_PLAYER * Math.max(0, playerCount - 1);
}

/** Telegraph do ataque carregado: 2s piscando — dá para sair da área. */
export const CHARGE_TELEGRAPH_TICKS = 2 * TICKS_PER_TIME_UNIT;
/** Área do impacto: 3×3 (raio 1 em Chebyshev). */
export const CHARGE_RADIUS = 1;
export const CHARGE_DAMAGE_MIN = 8;
export const CHARGE_DAMAGE_MAX = 14;
/** Alcance para INICIAR o carregamento. */
export const CHARGE_RANGE = 4;
export const CHARGE_COOLDOWN_TICKS = 8 * TICKS_PER_TIME_UNIT;
export const CHARGE_COOLDOWN_ENRAGED_TICKS = 5 * TICKS_PER_TIME_UNIT;

export const MINION_INTERVAL_TICKS = 15 * TICKS_PER_TIME_UNIT;
export const MINION_INTERVAL_ENRAGED_TICKS = 10 * TICKS_PER_TIME_UNIT;
export const MINION_BATCH = 2;
export const MINION_CAP = 4;

/** Fúria: abaixo de 50% HP o Amálgama acelera. */
export const ENRAGE_HP_FRACTION = 0.5;
export const BOSS_ENRAGED_SPEED = 1.5;

/** O boss enxerga a arena toda (não dorme, não desiste). */
export const BOSS_FOV_RADIUS = 12;

export interface BossMind {
  targetId: string | null;
  /** centro da área carregada (null = não está carregando). */
  chargeCenter: Vec2 | null;
  /** tick em que o carregamento explode. */
  chargeEndTick: number;
  /** tick a partir do qual pode carregar de novo. */
  nextChargeAt: number;
  /** tick do próximo chamado de minions. */
  nextMinionAt: number;
  enraged: boolean;
}

export function freshBossMind(): BossMind {
  return {
    targetId: null,
    chargeCenter: null,
    chargeEndTick: 0,
    nextChargeAt: CHARGE_COOLDOWN_TICKS, // primeira carga só depois de aquecer
    nextMinionAt: MINION_INTERVAL_TICKS,
    enraged: false,
  };
}

export type BossAction =
  | { type: "wait" }
  | { type: "move"; dir: Vec2 }
  | { type: "attack"; targetId: string }
  | { type: "startCharge"; center: Vec2 }
  | { type: "explode"; center: Vec2 }
  | { type: "summon" }
  | { type: "enrage" };

export interface BossSenses extends MobSenses {
  /** fração de HP atual do boss (0..1). */
  hpFrac: number;
  /** quantos minions do boss estão vivos. */
  minionCount: number;
}

const chebyshev = (a: Vec2, b: Vec2) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Decide a próxima ação do chefe, mutando `mind`. */
export function bossThink(mind: BossMind, s: BossSenses): BossAction {
  // fúria dispara uma única vez, cruzando o limiar
  if (!mind.enraged && s.hpFrac < ENRAGE_HP_FRACTION) {
    mind.enraged = true;
    return { type: "enrage" };
  }

  // carregando: espera o telegraph terminar e explode
  if (mind.chargeCenter) {
    if (s.tick >= mind.chargeEndTick) {
      const center = mind.chargeCenter;
      mind.chargeCenter = null;
      mind.nextChargeAt =
        s.tick + (mind.enraged ? CHARGE_COOLDOWN_ENRAGED_TICKS : CHARGE_COOLDOWN_TICKS);
      return { type: "explode", center };
    }
    return { type: "wait" };
  }

  const fov = computeFov(s.grid, s.self, BOSS_FOV_RADIUS);
  const visiveis = s.players.filter((p) => p.alive && fov.has(s.grid.index(p.pos.x, p.pos.y)));
  if (visiveis.length === 0) return { type: "wait" }; // ninguém na arena ainda

  // invoca lodos periodicamente (respeitando o teto)
  if (s.tick >= mind.nextMinionAt && s.minionCount < MINION_CAP) {
    mind.nextMinionAt =
      s.tick + (mind.enraged ? MINION_INTERVAL_ENRAGED_TICKS : MINION_INTERVAL_TICKS);
    return { type: "summon" };
  }

  // alvo: o jogador visível mais próximo
  let alvo = visiveis[0];
  for (const p of visiveis) {
    if (chebyshev(s.self, p.pos) < chebyshev(s.self, alvo.pos)) alvo = p;
  }
  mind.targetId = alvo.id;
  const dist = chebyshev(s.self, alvo.pos);

  // ataque carregado: alvo no alcance e cooldown vencido
  if (s.tick >= mind.nextChargeAt && dist <= CHARGE_RANGE) {
    mind.chargeCenter = { ...alvo.pos };
    mind.chargeEndTick = s.tick + CHARGE_TELEGRAPH_TICKS;
    return { type: "startCharge", center: { ...alvo.pos } };
  }

  if (dist === 1) return { type: "attack", targetId: alvo.id };

  // persegue (A* com desvio guloso, como os mobs)
  const path = findPath(s.grid, s.self, alvo.pos, 128);
  if (path && path.length > 0) {
    const next = path[0];
    if (s.isFree(next.x, next.y)) {
      return { type: "move", dir: { x: next.x - s.self.x, y: next.y - s.self.y } };
    }
  }
  const opcoes = DIRECTIONS8.filter((d) => {
    const nx = s.self.x + d.x;
    const ny = s.self.y + d.y;
    return (
      chebyshev({ x: nx, y: ny }, alvo.pos) < dist && canStep(s.grid, s.self, d) && s.isFree(nx, ny)
    );
  });
  if (opcoes.length > 0) return { type: "move", dir: opcoes[0] };
  return { type: "wait" };
}
