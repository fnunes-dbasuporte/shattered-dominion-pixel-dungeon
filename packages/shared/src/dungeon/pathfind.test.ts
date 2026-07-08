import { describe, expect, it } from "vitest";
import { TileType, type Vec2 } from "../types.js";
import { Grid } from "./grid.js";
import { canStep, findPath, DIRECTIONS8 } from "./pathfind.js";
import { generateLevel } from "./generateLevel.js";

function openGrid(): Grid {
  const grid = new Grid(12, 12);
  grid.fillRect({ x: 1, y: 1, width: 10, height: 10 }, TileType.Floor);
  return grid;
}

/** Valida que o caminho é executável passo a passo pela regra canStep. */
function assertWalkable(grid: Grid, from: Vec2, path: Vec2[]): void {
  let pos = from;
  for (const next of path) {
    const dir = { x: next.x - pos.x, y: next.y - pos.y };
    expect(canStep(grid, pos, dir)).toBe(true);
    pos = next;
  }
}

describe("canStep", () => {
  it("rejeita direções inválidas", () => {
    const grid = openGrid();
    const from = { x: 5, y: 5 };
    expect(canStep(grid, from, { x: 0, y: 0 })).toBe(false);
    expect(canStep(grid, from, { x: 2, y: 0 })).toBe(false);
    expect(canStep(grid, from, { x: 0.5, y: 0 })).toBe(false);
  });

  it("rejeita parede e fora do grid", () => {
    const grid = openGrid();
    expect(canStep(grid, { x: 1, y: 1 }, { x: -1, y: 0 })).toBe(false); // parede
    expect(canStep(grid, { x: 1, y: 0 }, { x: 0, y: -1 })).toBe(false); // borda
  });

  it("diagonal não corta quina: exige os DOIS ortogonais livres", () => {
    const grid = openGrid();
    grid.set(6, 5, TileType.Wall);
    grid.set(5, 6, TileType.Wall);
    // (5,5) → (6,6): ambos os ortogonais bloqueados
    expect(canStep(grid, { x: 5, y: 5 }, { x: 1, y: 1 })).toBe(false);
    grid.set(6, 5, TileType.Floor); // um livre ainda não basta (regra estrita)
    expect(canStep(grid, { x: 5, y: 5 }, { x: 1, y: 1 })).toBe(false);
    grid.set(5, 6, TileType.Floor); // com os dois livres, passa
    expect(canStep(grid, { x: 5, y: 5 }, { x: 1, y: 1 })).toBe(true);
  });

  it("porta só é atravessada ortogonalmente", () => {
    const grid = openGrid();
    grid.set(6, 6, TileType.Door);
    expect(canStep(grid, { x: 5, y: 5 }, { x: 1, y: 1 })).toBe(false); // entrar na diagonal
    expect(canStep(grid, { x: 5, y: 6 }, { x: 1, y: 0 })).toBe(true); // entrar reto
    expect(canStep(grid, { x: 6, y: 6 }, { x: 1, y: 1 })).toBe(false); // sair na diagonal
    expect(canStep(grid, { x: 6, y: 6 }, { x: 1, y: 0 })).toBe(true); // sair reto
  });
});

describe("findPath", () => {
  it("linha reta em campo aberto tem comprimento Chebyshev", () => {
    const grid = openGrid();
    const path = findPath(grid, { x: 2, y: 2 }, { x: 8, y: 5 });
    expect(path).not.toBeNull();
    expect(path).toHaveLength(6); // max(6, 3)
    assertWalkable(grid, { x: 2, y: 2 }, path as Vec2[]);
    expect((path as Vec2[]).at(-1)).toEqual({ x: 8, y: 5 });
  });

  it("contorna paredes e o caminho é executável passo a passo", () => {
    const grid = openGrid();
    // muro vertical com fresta embaixo
    for (let y = 1; y <= 8; y++) grid.set(6, y, TileType.Wall);
    const path = findPath(grid, { x: 3, y: 3 }, { x: 9, y: 3 });
    expect(path).not.toBeNull();
    assertWalkable(grid, { x: 3, y: 3 }, path as Vec2[]);
    expect((path as Vec2[]).some((p) => p.y >= 9)).toBe(true); // desceu pela fresta
  });

  it("retorna null para alvo inalcançável ou parede", () => {
    const grid = openGrid();
    for (let y = 0; y < 12; y++) grid.set(6, y, TileType.Wall); // muro total
    expect(findPath(grid, { x: 3, y: 3 }, { x: 9, y: 3 })).toBeNull();
    expect(findPath(grid, { x: 3, y: 3 }, { x: 6, y: 3 })).toBeNull(); // alvo é parede
  });

  it("origem == destino retorna caminho vazio", () => {
    const grid = openGrid();
    expect(findPath(grid, { x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([]);
  });

  it("é determinístico", () => {
    const grid = openGrid();
    grid.set(5, 5, TileType.Wall);
    const a = findPath(grid, { x: 2, y: 2 }, { x: 9, y: 9 });
    const b = findPath(grid, { x: 2, y: 2 }, { x: 9, y: 9 });
    expect(a).toEqual(b);
  });

  it("acha caminho spawn → escada de descida em andares gerados (50 seeds)", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const level = generateLevel(seed, 1);
      const path = findPath(level.grid, level.spawnPoints[0], level.stairsDown);
      expect(path).not.toBeNull();
      assertWalkable(level.grid, level.spawnPoints[0], path as Vec2[]);
      expect((path as Vec2[]).at(-1)).toEqual(level.stairsDown);
    }
  });
});

describe("DIRECTIONS8", () => {
  it("tem 8 direções únicas e nenhuma nula", () => {
    const set = new Set(DIRECTIONS8.map((d) => `${d.x},${d.y}`));
    expect(set.size).toBe(8);
    expect(set.has("0,0")).toBe(false);
  });
});
