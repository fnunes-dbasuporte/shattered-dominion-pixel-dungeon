import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { Grid } from "../dungeon/grid.js";
import { TileType } from "../types.js";
import { applyArmor, pickTeleportTarget } from "./effects.js";

describe("applyArmor", () => {
  it("defesa 0 não altera o dano; nunca fica negativo; bloqueio ≤ defense", () => {
    const rng = new Rng(5);
    expect(applyArmor(rng, 6, 0)).toBe(6);
    for (let i = 0; i < 2000; i++) {
      const dano = applyArmor(rng, 5, 4);
      expect(dano).toBeGreaterThanOrEqual(1); // 5 - máx 4
      expect(dano).toBeLessThanOrEqual(5);
    }
    for (let i = 0; i < 500; i++) {
      expect(applyArmor(rng, 1, 10)).toBeGreaterThanOrEqual(0);
    }
  });

  it("é determinístico por seed", () => {
    const seq = (seed: number) => {
      const rng = new Rng(seed);
      return Array.from({ length: 50 }, () => applyArmor(rng, 8, 3));
    };
    expect(seq(9)).toEqual(seq(9));
  });
});

describe("pickTeleportTarget", () => {
  it("retorna tile passável e livre; respeita ocupação; é determinístico", () => {
    const grid = new Grid(12, 12);
    grid.fillRect({ x: 1, y: 1, width: 10, height: 10 }, TileType.Floor);
    const bloqueado = new Set(["5,5", "6,6"]);
    const isFree = (x: number, y: number) => !bloqueado.has(`${x},${y}`);

    const a = pickTeleportTarget(grid, new Rng(4), isFree);
    const b = pickTeleportTarget(grid, new Rng(4), isFree);
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
    expect(grid.get(a!.x, a!.y)).toBe(TileType.Floor);
    expect(bloqueado.has(`${a!.x},${a!.y}`)).toBe(false);
  });

  it("retorna null quando não há espaço", () => {
    const grid = new Grid(6, 6); // tudo parede
    expect(pickTeleportTarget(grid, new Rng(1), () => true)).toBeNull();
  });
});
