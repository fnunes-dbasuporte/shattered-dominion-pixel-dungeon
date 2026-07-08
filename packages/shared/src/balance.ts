import type { Rng } from "./rng.js";

/**
 * Fórmulas de combate e progressão — estilo roguelike clássico, com números
 * e curvas PRÓPRIOS deste projeto (nada copiado do Pixel Dungeon original).
 */

export interface AttackerStats {
  accuracy: number;
  damageMin: number;
  damageMax: number;
}

export interface DefenderStats {
  evasion: number;
}

export interface AttackResult {
  hit: boolean;
  damage: number;
}

// ── herói (Guerreiro) ────────────────────────────────────────────────

export const HERO_BASE_HP = 20;
export const HERO_HP_PER_LEVEL = 5;
export const HERO_MAX_LEVEL = 30;

export interface HeroStats {
  maxHp: number;
  accuracy: number;
  evasion: number;
  /** Sem arma equipada: punhos (1–6). Armas chegam na sprint 04. */
  damageMin: number;
  damageMax: number;
}

export function heroStats(level: number): HeroStats {
  const lvl = Math.max(1, Math.min(level, HERO_MAX_LEVEL));
  return {
    maxHp: HERO_BASE_HP + HERO_HP_PER_LEVEL * (lvl - 1),
    accuracy: 8 + 2 * lvl,
    evasion: 4 + lvl,
    damageMin: 1,
    damageMax: 6,
  };
}

// ── progressão ───────────────────────────────────────────────────────

/** XP necessário para subir DO nível `level` para o seguinte. */
export function xpToNextLevel(level: number): number {
  return 6 + level * 4; // 1→2: 10 · 2→3: 14 · 3→4: 18 ...
}

export interface Progression {
  level: number;
  xp: number;
}

/** Concede XP, aplica level ups em cascata e retorna quantos níveis subiu. */
export function grantXp(prog: Progression, amount: number): number {
  prog.xp += amount;
  let ups = 0;
  while (prog.level < HERO_MAX_LEVEL && prog.xp >= xpToNextLevel(prog.level)) {
    prog.xp -= xpToNextLevel(prog.level);
    prog.level++;
    ups++;
  }
  return ups;
}

// ── combate ──────────────────────────────────────────────────────────

/** Chance de acerto: acc/(acc+eva), com piso 5% e teto 95%. */
export function hitChance(accuracy: number, evasion: number): number {
  const raw = accuracy / (accuracy + Math.max(0, evasion));
  return Math.min(0.95, Math.max(0.05, raw));
}

/** Rola um ataque: erro (damage 0) ou acerto com dano uniforme no intervalo da arma. */
export function attackRoll(
  rng: Rng,
  attacker: AttackerStats,
  defender: DefenderStats,
): AttackResult {
  if (!rng.chance(hitChance(attacker.accuracy, defender.evasion))) {
    return { hit: false, damage: 0 };
  }
  return { hit: true, damage: rng.nextInt(attacker.damageMin, attacker.damageMax) };
}
