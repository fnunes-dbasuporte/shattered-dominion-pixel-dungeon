import type { Rng } from "./rng.js";

/**
 * Bestiário dos esgotos (andares 1–5) — criaturas e números PRÓPRIOS
 * deste projeto, inspirados apenas no arquétipo clássico de roguelike.
 */

export type MobKind = "rat" | "gnoll" | "crab";

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
};

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
