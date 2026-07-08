import { describe, expect, it } from "vitest";
import { Rng } from "./rng.js";
import {
  HERO_BASE_HP,
  HERO_MAX_LEVEL,
  attackRoll,
  grantXp,
  heroStats,
  hitChance,
  xpToNextLevel,
} from "./balance.js";

describe("heroStats", () => {
  it("nível 1: HP 20, punhos 1–6", () => {
    const s = heroStats(1);
    expect(s.maxHp).toBe(HERO_BASE_HP);
    expect(s.damageMin).toBe(1);
    expect(s.damageMax).toBe(6);
  });

  it("HP cresce +5 por nível e stats são monotônicos", () => {
    for (let lvl = 1; lvl < HERO_MAX_LEVEL; lvl++) {
      const a = heroStats(lvl);
      const b = heroStats(lvl + 1);
      expect(b.maxHp).toBe(a.maxHp + 5);
      expect(b.accuracy).toBeGreaterThan(a.accuracy);
      expect(b.evasion).toBeGreaterThan(a.evasion);
    }
  });

  it("clampa níveis fora do intervalo", () => {
    expect(heroStats(0)).toEqual(heroStats(1));
    expect(heroStats(99)).toEqual(heroStats(HERO_MAX_LEVEL));
  });
});

describe("xp e level up", () => {
  it("curva é positiva e crescente", () => {
    for (let lvl = 1; lvl < HERO_MAX_LEVEL; lvl++) {
      expect(xpToNextLevel(lvl)).toBeGreaterThan(0);
      expect(xpToNextLevel(lvl + 1)).toBeGreaterThan(xpToNextLevel(lvl));
    }
  });

  it("grantXp sobe um nível no threshold exato e carrega o excedente", () => {
    const prog = { level: 1, xp: 0 };
    expect(grantXp(prog, xpToNextLevel(1) - 1)).toBe(0);
    expect(prog.level).toBe(1);
    expect(grantXp(prog, 3)).toBe(1); // completa e sobra 2
    expect(prog.level).toBe(2);
    expect(prog.xp).toBe(2);
  });

  it("grantXp aplica múltiplos níveis em cascata", () => {
    const prog = { level: 1, xp: 0 };
    const total = xpToNextLevel(1) + xpToNextLevel(2) + 1;
    expect(grantXp(prog, total)).toBe(2);
    expect(prog.level).toBe(3);
    expect(prog.xp).toBe(1);
  });

  it("para no nível máximo", () => {
    const prog = { level: HERO_MAX_LEVEL, xp: 0 };
    expect(grantXp(prog, 100_000)).toBe(0);
    expect(prog.level).toBe(HERO_MAX_LEVEL);
  });
});

describe("hitChance", () => {
  it("é acc/(acc+eva) no caso comum", () => {
    expect(hitChance(10, 10)).toBeCloseTo(0.5);
    expect(hitChance(30, 10)).toBeCloseTo(0.75);
  });

  it("clampa em 5% e 95%", () => {
    expect(hitChance(1, 1000)).toBe(0.05);
    expect(hitChance(1000, 1)).toBe(0.95);
    expect(hitChance(10, 0)).toBe(0.95); // evasão zero não vira 100%
  });
});

describe("attackRoll", () => {
  it("dano sempre dentro do intervalo da arma; erros e acertos ocorrem", () => {
    const rng = new Rng(7);
    const atk = { accuracy: 10, damageMin: 1, damageMax: 6 };
    const def = { evasion: 8 };
    let hits = 0;
    let misses = 0;
    for (let i = 0; i < 2000; i++) {
      const r = attackRoll(rng, atk, def);
      if (r.hit) {
        hits++;
        expect(r.damage).toBeGreaterThanOrEqual(1);
        expect(r.damage).toBeLessThanOrEqual(6);
      } else {
        misses++;
        expect(r.damage).toBe(0);
      }
    }
    expect(hits).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
    // taxa observada perto da teórica (10/18 ≈ 0.556)
    expect(hits / 2000).toBeGreaterThan(0.45);
    expect(hits / 2000).toBeLessThan(0.65);
  });

  it("é determinístico por seed", () => {
    const roll = (seed: number) => {
      const rng = new Rng(seed);
      return Array.from({ length: 50 }, () =>
        attackRoll(rng, { accuracy: 10, damageMin: 1, damageMax: 6 }, { evasion: 5 }),
      );
    };
    expect(roll(3)).toEqual(roll(3));
    expect(roll(3)).not.toEqual(roll(4));
  });
});
