import type { Rng } from "../rng.js";
import { isPassable, type Vec2 } from "../types.js";
import type { Grid } from "../dungeon/grid.js";

/** Números dos efeitos de consumíveis — próprios do projeto. */

export const HEAL_POTION_AMOUNT = 15;

/** Veneno: 1 de dano por unidade de tempo, durante 8 unidades. */
export const POISON_DURATION_UNITS = 8;
export const POISON_DAMAGE_PER_UNIT = 1;

/** Cada ponto de Força soma +1 ao dano corpo a corpo (mín. e máx.). */
export const STRENGTH_DAMAGE_BONUS = 1;

/**
 * Armadura bloqueia uma parte aleatória do dano: rola 0..defense e subtrai.
 * Nunca deixa o dano negativo; defesa 0 não altera nada.
 */
export function applyArmor(rng: Rng, damage: number, defense: number): number {
  if (defense <= 0) return damage;
  return Math.max(0, damage - rng.nextInt(0, defense));
}

/** Destino de teleporte: tile passável e livre, sorteado no grid. */
export function pickTeleportTarget(
  grid: Grid,
  rng: Rng,
  isFree: (x: number, y: number) => boolean,
): Vec2 | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = rng.nextInt(1, grid.width - 2);
    const y = rng.nextInt(1, grid.height - 2);
    if (isPassable(grid.get(x, y)) && isFree(x, y)) return { x, y };
  }
  return null;
}
