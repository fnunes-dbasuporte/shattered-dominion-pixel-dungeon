import { describe, expect, it } from "vitest";
import { Rng } from "./rng.js";
import {
  ALL_MOB_KINDS,
  MOB_COUNT_MAX,
  MOB_COUNT_MIN,
  MOB_DEFS,
  rollMobCount,
  rollMobKind,
} from "./mobs.js";

describe("MOB_DEFS", () => {
  it("todos os mobs têm stats válidos", () => {
    for (const kind of ALL_MOB_KINDS) {
      const def = MOB_DEFS[kind];
      expect(def.kind).toBe(kind);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.maxHp).toBeGreaterThan(0);
      expect(def.damageMin).toBeGreaterThanOrEqual(1);
      expect(def.damageMax).toBeGreaterThanOrEqual(def.damageMin);
      expect(def.speed).toBeGreaterThanOrEqual(1);
      expect(def.xpReward).toBeGreaterThan(0);
      expect(def.spawnWeight).toBeGreaterThan(0);
    }
  });

  it("caranguejo é o mais rápido; rato é o mais fraco", () => {
    expect(MOB_DEFS.crab.speed).toBeGreaterThan(MOB_DEFS.rat.speed);
    expect(MOB_DEFS.crab.speed).toBeGreaterThan(MOB_DEFS.gnoll.speed);
    expect(MOB_DEFS.rat.maxHp).toBeLessThan(MOB_DEFS.gnoll.maxHp);
    expect(MOB_DEFS.rat.xpReward).toBeLessThan(MOB_DEFS.crab.xpReward);
  });
});

describe("rollMobCount", () => {
  it(`fica sempre em [${MOB_COUNT_MIN}, ${MOB_COUNT_MAX}] e cobre os extremos`, () => {
    const rng = new Rng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = rollMobCount(rng);
      expect(n).toBeGreaterThanOrEqual(MOB_COUNT_MIN);
      expect(n).toBeLessThanOrEqual(MOB_COUNT_MAX);
      seen.add(n);
    }
    expect(seen.has(MOB_COUNT_MIN)).toBe(true);
    expect(seen.has(MOB_COUNT_MAX)).toBe(true);
  });
});

describe("rollMobKind", () => {
  it("todas as espécies aparecem no andar 1, com rato mais comum", () => {
    const rng = new Rng(5);
    const contagem: Record<string, number> = { rat: 0, gnoll: 0, crab: 0 };
    for (let i = 0; i < 3000; i++) contagem[rollMobKind(rng, 1)]++;
    expect(contagem.rat).toBeGreaterThan(0);
    expect(contagem.gnoll).toBeGreaterThan(0);
    expect(contagem.crab).toBeGreaterThan(0);
    expect(contagem.rat).toBeGreaterThan(contagem.gnoll);
    expect(contagem.gnoll).toBeGreaterThan(contagem.crab);
  });

  it("no fundo dos esgotos (depth 5) ratos ficam menos dominantes", () => {
    const conta = (depth: number) => {
      const rng = new Rng(9);
      let ratos = 0;
      for (let i = 0; i < 3000; i++) if (rollMobKind(rng, depth) === "rat") ratos++;
      return ratos;
    };
    expect(conta(5)).toBeLessThan(conta(1));
  });

  it("é determinístico por seed", () => {
    const seq = (seed: number) => {
      const rng = new Rng(seed);
      return Array.from({ length: 100 }, () => rollMobKind(rng, 3));
    };
    expect(seq(21)).toEqual(seq(21));
  });
});
