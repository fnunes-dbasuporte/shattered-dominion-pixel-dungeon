import { TICKS_PER_TIME_UNIT } from "./constants.js";
import { MOB_FOV_RADIUS } from "./mobs.js";
import type { Rng } from "./rng.js";
import { isPassable, type Vec2 } from "./types.js";
import type { Grid } from "./dungeon/grid.js";
import { computeFov } from "./dungeon/fov.js";
import { DIRECTIONS8, canStep, findPath } from "./dungeon/pathfind.js";

/**
 * IA dos mobs — máquina de estados PURA (roda no servidor, vive no shared
 * como toda regra de jogo). O servidor fornece os sentidos (isFree =
 * ocupação) e aplica a ação devolvida.
 */

export type MobAiState = "sleeping" | "hunting" | "wandering";

export interface MobMind {
  state: MobAiState;
  targetId: string | null;
  /** último tick em que o alvo foi visto. */
  lastSeenTick: number;
  /** última posição conhecida do alvo (persegue até lá mesmo sem vê-lo). */
  lastKnownPos: Vec2 | null;
  wanderGoal: Vec2 | null;
}

export function freshMind(): MobMind {
  return {
    state: "sleeping",
    targetId: null,
    lastSeenTick: 0,
    lastKnownPos: null,
    wanderGoal: null,
  };
}

export type MobAction =
  { type: "wait" } | { type: "move"; dir: Vec2 } | { type: "attack"; targetId: string };

export interface MobSenses {
  grid: Grid;
  self: Vec2;
  tick: number;
  players: ReadonlyArray<{ id: string; pos: Vec2; alive: boolean }>;
  rng: Rng;
  /** true se o tile está livre para ocupar (conhecimento de ocupação do servidor). */
  isFree: (x: number, y: number) => boolean;
}

/** Desiste da caçada após 10 unidades de tempo (100 ticks) sem ver o alvo. */
export const GIVE_UP_TICKS = 10 * TICKS_PER_TIME_UNIT;

const chebyshev = (a: Vec2, b: Vec2) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Decide a próxima ação do mob, mutando `mind` (o estado pertence ao mob). */
export function mobThink(mind: MobMind, senses: MobSenses): MobAction {
  switch (mind.state) {
    case "sleeping":
      return thinkSleeping(mind, senses);
    case "hunting":
      return thinkHunting(mind, senses);
    case "wandering":
      return thinkWandering(mind, senses);
  }
}

function livingVisible(s: MobSenses): { id: string; pos: Vec2 }[] {
  const fov = computeFov(s.grid, s.self, MOB_FOV_RADIUS);
  return s.players.filter((p) => p.alive && fov.has(s.grid.index(p.pos.x, p.pos.y)));
}

function nearestOf(from: Vec2, players: { id: string; pos: Vec2 }[]): { id: string; pos: Vec2 } {
  let best = players[0];
  for (const p of players) if (chebyshev(from, p.pos) < chebyshev(from, best.pos)) best = p;
  return best;
}

function thinkSleeping(mind: MobMind, s: MobSenses): MobAction {
  // acorda ao ver alguém OU com barulho adjacente (mesmo sem linha de visão)
  const visiveis = livingVisible(s);
  const adjacente = s.players.find((p) => p.alive && chebyshev(s.self, p.pos) === 1);
  const alvo =
    visiveis.length > 0
      ? nearestOf(s.self, visiveis)
      : adjacente
        ? { id: adjacente.id, pos: adjacente.pos }
        : null;
  if (!alvo) return { type: "wait" };

  mind.state = "hunting";
  mind.targetId = alvo.id;
  mind.lastSeenTick = s.tick;
  mind.lastKnownPos = { ...alvo.pos };
  return { type: "wait" }; // acordar consome o turno — dá 1 turno de vantagem ao jogador
}

function thinkHunting(mind: MobMind, s: MobSenses): MobAction {
  const visiveis = livingVisible(s);
  let alvo = visiveis.find((p) => p.id === mind.targetId) ?? null;

  // alvo sumiu (morreu/saiu): retarget para o visível mais próximo, se houver
  if (!alvo && visiveis.length > 0) {
    alvo = nearestOf(s.self, visiveis);
    mind.targetId = alvo.id;
  }

  if (alvo) {
    mind.lastSeenTick = s.tick;
    mind.lastKnownPos = { ...alvo.pos };
    if (chebyshev(s.self, alvo.pos) === 1) {
      return { type: "attack", targetId: alvo.id };
    }
  } else if (s.tick - mind.lastSeenTick > GIVE_UP_TICKS) {
    mind.state = "wandering";
    mind.targetId = null;
    mind.wanderGoal = null;
    return { type: "wait" };
  }

  const destino = alvo?.pos ?? mind.lastKnownPos;
  if (!destino) return { type: "wait" };
  return stepToward(s, destino);
}

function thinkWandering(mind: MobMind, s: MobSenses): MobAction {
  const visiveis = livingVisible(s);
  if (visiveis.length > 0) {
    const alvo = nearestOf(s.self, visiveis);
    mind.state = "hunting";
    mind.targetId = alvo.id;
    mind.lastSeenTick = s.tick;
    mind.lastKnownPos = { ...alvo.pos };
    return { type: "wait" };
  }

  if (!mind.wanderGoal || (mind.wanderGoal.x === s.self.x && mind.wanderGoal.y === s.self.y)) {
    mind.wanderGoal = pickWanderGoal(s);
    if (!mind.wanderGoal) return { type: "wait" };
  }

  const action = stepToward(s, mind.wanderGoal);
  if (action.type === "wait") mind.wanderGoal = null; // caminho bloqueado — tenta outro depois
  return action;
}

function pickWanderGoal(s: MobSenses): Vec2 | null {
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = s.rng.nextInt(1, s.grid.width - 2);
    const y = s.rng.nextInt(1, s.grid.height - 2);
    if (isPassable(s.grid.get(x, y)) && (x !== s.self.x || y !== s.self.y)) return { x, y };
  }
  return null;
}

/** Primeiro passo do A*; se ocupado, tenta desvio guloso; senão espera. */
function stepToward(s: MobSenses, goal: Vec2): MobAction {
  const path = findPath(s.grid, s.self, goal, 128);
  if (path && path.length > 0) {
    const next = path[0];
    const dir = { x: next.x - s.self.x, y: next.y - s.self.y };
    if (s.isFree(next.x, next.y)) return { type: "move", dir };
  }
  // desvio guloso determinístico: direções que reduzem a distância, na ordem fixa
  const opcoes = DIRECTIONS8.filter((d) => {
    const nx = s.self.x + d.x;
    const ny = s.self.y + d.y;
    return (
      chebyshev({ x: nx, y: ny }, goal) < chebyshev(s.self, goal) &&
      canStep(s.grid, s.self, d) &&
      s.isFree(nx, ny)
    );
  });
  if (opcoes.length > 0) return { type: "move", dir: opcoes[0] };
  return { type: "wait" };
}
