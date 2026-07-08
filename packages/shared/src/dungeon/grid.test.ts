import { describe, expect, it } from "vitest";
import { TileType, isPassable } from "../types.js";
import { Grid, floodFill, fnv1a } from "./grid.js";
import { rectCenter, rectContains, rectsIntersect } from "./rect.js";

describe("Grid", () => {
  it("inicia preenchido com paredes e aceita get/set", () => {
    const g = new Grid(8, 4);
    expect(g.count(TileType.Wall)).toBe(32);
    g.set(3, 2, TileType.Floor);
    expect(g.get(3, 2)).toBe(TileType.Floor);
    expect(g.count(TileType.Floor)).toBe(1);
  });

  it("lança RangeError fora dos limites", () => {
    const g = new Grid(4, 4);
    expect(() => g.get(-1, 0)).toThrow(RangeError);
    expect(() => g.get(4, 0)).toThrow(RangeError);
    expect(() => g.set(0, 4, TileType.Floor)).toThrow(RangeError);
  });

  it("neighbors4 respeita bordas", () => {
    const g = new Grid(4, 4);
    expect(g.neighbors4(0, 0)).toHaveLength(2);
    expect(g.neighbors4(1, 0)).toHaveLength(3);
    expect(g.neighbors4(1, 1)).toHaveLength(4);
  });

  it("fillRect preenche exatamente o retângulo", () => {
    const g = new Grid(8, 8);
    g.fillRect({ x: 2, y: 3, width: 3, height: 2 }, TileType.Floor);
    expect(g.count(TileType.Floor)).toBe(6);
    expect(g.get(2, 3)).toBe(TileType.Floor);
    expect(g.get(4, 4)).toBe(TileType.Floor);
    expect(g.get(5, 4)).toBe(TileType.Wall);
  });
});

describe("floodFill", () => {
  it("alcança toda a área passável conexa e nada além", () => {
    const g = new Grid(8, 8);
    g.fillRect({ x: 1, y: 1, width: 3, height: 3 }, TileType.Floor); // área A (9)
    g.fillRect({ x: 5, y: 5, width: 2, height: 2 }, TileType.Floor); // área B isolada (4)
    const { reached, count } = floodFill(g, { x: 1, y: 1 });
    expect(count).toBe(9);
    expect(reached[g.index(2, 2)]).toBe(true);
    expect(reached[g.index(5, 5)]).toBe(false);
  });

  it("atravessa portas, água e grama (só parede bloqueia)", () => {
    const g = new Grid(5, 1);
    [TileType.Floor, TileType.Door, TileType.Water, TileType.Grass, TileType.Floor].forEach(
      (t, x) => g.set(x, 0, t),
    );
    expect(floodFill(g, { x: 0, y: 0 }).count).toBe(5);
  });

  it("retorna vazio se o início não é passável", () => {
    const g = new Grid(4, 4);
    expect(floodFill(g, { x: 0, y: 0 }).count).toBe(0);
  });
});

describe("isPassable", () => {
  it("apenas parede bloqueia", () => {
    expect(isPassable(TileType.Wall)).toBe(false);
    for (const t of [
      TileType.Floor,
      TileType.Door,
      TileType.StairsUp,
      TileType.StairsDown,
      TileType.Water,
      TileType.Grass,
      TileType.Embers,
    ]) {
      expect(isPassable(t)).toBe(true);
    }
  });
});

describe("Rect", () => {
  it("center e contains", () => {
    const r = { x: 2, y: 2, width: 3, height: 3 };
    expect(rectCenter(r)).toEqual({ x: 3, y: 3 });
    expect(rectContains(r, 2, 2)).toBe(true);
    expect(rectContains(r, 4, 4)).toBe(true);
    expect(rectContains(r, 5, 4)).toBe(false);
  });

  it("intersects com e sem margem", () => {
    const a = { x: 0, y: 0, width: 3, height: 3 };
    const b = { x: 4, y: 0, width: 3, height: 3 }; // 1 tile de vão
    expect(rectsIntersect(a, b)).toBe(false);
    expect(rectsIntersect(a, b, 1)).toBe(false); // margem 1 encosta mas não sobrepõe
    expect(rectsIntersect(a, b, 2)).toBe(true);
  });
});

describe("fnv1a", () => {
  it("é estável e sensível a mudanças", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    const c = new Uint8Array([1, 2, 3, 5]);
    expect(fnv1a(a)).toBe(fnv1a(b));
    expect(fnv1a(a)).not.toBe(fnv1a(c));
    expect(fnv1a(new Uint8Array([]))).toBe(0x811c9dc5);
  });
});
