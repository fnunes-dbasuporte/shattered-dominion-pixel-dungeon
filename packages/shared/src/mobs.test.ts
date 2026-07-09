import { describe, expect, it } from "vitest";
import { Rng } from "./rng.js";
import {
  ALL_MOB_KINDS,
  MOB_COUNT_MAX,
  MOB_COUNT_MIN,
  MOB_DEFS,
  rollMobCount,
  rollMobCountForDepth,
  rollMobKind,
  scaledMobStats,
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

describe("scaledMobStats", () => {
  it("andar 1 = stats base; andares fundos são mais fortes em tudo", () => {
    for (const kind of ALL_MOB_KINDS) {
      const base = scaledMobStats(kind, 1);
      const def = MOB_DEFS[kind];
      expect(base.maxHp).toBe(def.maxHp);
      expect(base.damageMax).toBe(def.damageMax);
      expect(base.xpReward).toBe(def.xpReward);

      const fundo = scaledMobStats(kind, 4);
      expect(fundo.maxHp).toBeGreaterThan(base.maxHp);
      expect(fundo.accuracy).toBeGreaterThan(base.accuracy);
      expect(fundo.damageMax).toBeGreaterThan(base.damageMax);
      expect(fundo.xpReward).toBeGreaterThan(base.xpReward);
    }
  });

  it("é monotônico entre andares 1→5", () => {
    for (let d = 1; d < 5; d++) {
      const a = scaledMobStats("rat", d);
      const b = scaledMobStats("rat", d + 1);
      expect(b.maxHp).toBeGreaterThanOrEqual(a.maxHp);
      expect(b.damageMax).toBeGreaterThanOrEqual(a.damageMax);
    }
  });
});

describe("rollMobCountForDepth", () => {
  it("andares fundos têm mais mobs, com teto no bônus", () => {
    const conta = (depth: number) => {
      const rng = new Rng(3);
      let total = 0;
      for (let i = 0; i < 500; i++) total += rollMobCountForDepth(rng, depth);
      return total / 500;
    };
    expect(conta(4)).toBeGreaterThan(conta(1));
    // bônus satura em +3
    const rng = new Rng(1);
    for (let i = 0; i < 500; i++) {
      expect(rollMobCountForDepth(rng, 9)).toBeLessThanOrEqual(MOB_COUNT_MAX + 3);
    }
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
