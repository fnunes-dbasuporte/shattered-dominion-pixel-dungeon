import type { Rng } from "./rng.js";

/**
 * Bestiário dos esgotos (andares 1–5) — criaturas e números PRÓPRIOS
 * deste projeto, inspirados apenas no arquétipo clássico de roguelike.
 */

export type MobKind = "rat" | "gnoll" | "crab" | "sludge" | "boss";

export interface MobDef {
  kind: MobKind;
  /** Nome exibido (PT-BR). */
  name: string;
  maxHp: number;
  accuracy: number;
  evasion: number;
  damageMin: number;
  damageMax: number;
  /** Velocidade em tiles por unidade de tempo (caranguejo = 2 → anda 2×). */
  speed: number;
  /** XP concedido ao matador. */
  xpReward: number;
  /** Peso relativo na tabela de spawn. */
  spawnWeight: number;
}

export const MOB_DEFS: Record<MobKind, MobDef> = {
  rat: {
    kind: "rat",
    name: "Rato do Esgoto",
    maxHp: 6,
    accuracy: 6,
    evasion: 3,
    damageMin: 1,
    damageMax: 3,
    speed: 1,
    xpReward: 2,
    spawnWeight: 5,
  },
  gnoll: {
    kind: "gnoll",
    name: "Gnoll Batedor",
    maxHp: 10,
    accuracy: 9,
    evasion: 4,
    damageMin: 2,
    damageMax: 5,
    speed: 1,
    xpReward: 4,
    spawnWeight: 3,
  },
  crab: {
    kind: "crab",
    name: "Caranguejo das Fossas",
    maxHp: 12,
    accuracy: 8,
    evasion: 4,
    damageMin: 1,
    damageMax: 4,
    speed: 2,
    xpReward: 5,
    spawnWeight: 2,
  },

  sludge: {
    kind: "sludge",
    name: "Lodo Rastejante",
    maxHp: 4,
    accuracy: 6,
    evasion: 2,
    damageMin: 1,
    damageMax: 2,
    speed: 1,
    xpReward: 1,
    spawnWeight: 0, // só nasce pelo boss
  },
  boss: {
    kind: "boss",
    name: "Amálgama de Lodo",
    maxHp: 80, // base; +40 por jogador extra no spawn
    accuracy: 12,
    evasion: 2,
    damageMin: 3,
    damageMax: 8,
    speed: 1,
    xpReward: 50,
    spawnWeight: 0, // só no covil
  },
};

/** Espécies que aparecem em spawns aleatórios (boss e minion ficam de fora). */
export const ALL_MOB_KINDS: readonly MobKind[] = ["rat", "gnoll", "crab"];

/** Raio de visão dos mobs (menor que o do herói, 8). */
export const MOB_FOV_RADIUS = 6;

/** Quantidade de mobs por andar: 4–8, rolada na geração da partida. */
export const MOB_COUNT_MIN = 4;
export const MOB_COUNT_MAX = 8;

/** Respawn lento: 1 mob a cada 60s de jogo (600 ticks) até o teto do andar. */
export const MOB_RESPAWN_TICKS = 600;

export function rollMobCount(rng: Rng): number {
  return rng.nextInt(MOB_COUNT_MIN, MOB_COUNT_MAX);
}

/**
 * Escalonamento por andar: os esgotos ficam mais perigosos conforme o
 * grupo desce. Multiplicadores lineares suaves — a curva agressiva fica
 * para a fase de balanceamento (pós-08, decisão do Felipe).
 */
export interface ScaledMobStats {
  maxHp: number;
  accuracy: number;
  evasion: number;
  damageMin: number;
  damageMax: number;
  xpReward: number;
}

export function scaledMobStats(kind: MobKind, depth: number): ScaledMobStats {
  const def = MOB_DEFS[kind];
  const d = Math.max(0, depth - 1);
  return {
    maxHp: Math.round(def.maxHp * (1 + 0.35 * d)),
    accuracy: def.accuracy + d,
    evasion: def.evasion + Math.floor(d / 2),
    damageMin: def.damageMin + Math.floor(d / 2),
    damageMax: def.damageMax + Math.ceil(d / 2),
    xpReward: def.xpReward + d,
  };
}

/** Andares fundos têm mais mobs: 4–8 no andar 1, +1 no piso do intervalo por andar. */
export function rollMobCountForDepth(rng: Rng, depth: number): number {
  const bonus = Math.min(3, Math.max(0, depth - 1));
  return rng.nextInt(MOB_COUNT_MIN + bonus, MOB_COUNT_MAX + bonus);
}

/**
 * Sorteia a espécie pelo peso. Nos andares mais fundos dos esgotos os
 * pesos deslocam levemente para gnoll/caranguejo (depth 1–5).
 */
export function rollMobKind(rng: Rng, depth: number): MobKind {
  const bonus = Math.max(0, Math.min(depth - 1, 4)); // 0..4
  const weights = ALL_MOB_KINDS.map((kind) => {
    const base = MOB_DEFS[kind].spawnWeight;
    return kind === "rat" ? Math.max(1, base - bonus) : base + bonus;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.nextInt(1, total);
  for (let i = 0; i < ALL_MOB_KINDS.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return ALL_MOB_KINDS[i];
  }
  return "rat"; // inalcançável; satisfaz o compilador
}
