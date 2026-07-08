import { describe, expect, it } from "vitest";
import { TileType } from "../types.js";
import { Grid } from "./grid.js";
import { computeFov, blocksSight, FOV_RADIUS } from "./fov.js";
import { generateLevel } from "./generateLevel.js";

/** Sala aberta 21×21 com borda de parede, origem no centro. */
function openGrid(): { grid: Grid; center: { x: number; y: number } } {
  const grid = new Grid(21, 21);
  grid.fillRect({ x: 1, y: 1, width: 19, height: 19 }, TileType.Floor);
  return { grid, center: { x: 10, y: 10 } };
}

describe("computeFov", () => {
  it("a origem é sempre visível", () => {
    const { grid, center } = openGrid();
    expect(computeFov(grid, center, 0).has(grid.index(10, 10))).toBe(true);
  });

  it("em campo aberto, enxerga exatamente o disco euclidiano do raio", () => {
    const { grid, center } = openGrid();
    const fov = computeFov(grid, center, 5);
    for (let y = 4; y <= 16; y++) {
      for (let x = 4; x <= 16; x++) {
        const dist2 = (x - 10) ** 2 + (y - 10) ** 2;
        expect(fov.has(grid.index(x, y))).toBe(dist2 <= 25);
      }
    }
  });

  it("parede bloqueia: tile atrás da parede fica invisível, a parede não", () => {
    const { grid, center } = openGrid();
    grid.set(12, 10, TileType.Wall);
    const fov = computeFov(grid, center, 8);
    expect(fov.has(grid.index(12, 10))).toBe(true); // a própria parede
    expect(fov.has(grid.index(13, 10))).toBe(false); // sombra atrás
    expect(fov.has(grid.index(14, 10))).toBe(false);
  });

  it("porta bloqueia visão de fora, mas quem está NA porta vê os dois lados", () => {
    // corredor | porta | sala
    const grid = new Grid(9, 5);
    grid.fillRect({ x: 1, y: 2, width: 3, height: 1 }, TileType.Floor); // corredor
    grid.set(4, 2, TileType.Door);
    grid.fillRect({ x: 5, y: 1, width: 3, height: 3 }, TileType.Floor); // sala

    const deFora = computeFov(grid, { x: 1, y: 2 }, 8);
    expect(deFora.has(grid.index(4, 2))).toBe(true); // vê a porta
    expect(deFora.has(grid.index(6, 2))).toBe(false); // não vê dentro da sala

    const naPorta = computeFov(grid, { x: 4, y: 2 }, 8);
    expect(naPorta.has(grid.index(1, 2))).toBe(true); // corredor
    expect(naPorta.has(grid.index(6, 2))).toBe(true); // sala
  });

  it("é simétrico em campo aberto (A vê B ⇔ B vê A)", () => {
    const { grid } = openGrid();
    const a = { x: 6, y: 7 };
    const alvos = [
      { x: 10, y: 10 },
      { x: 12, y: 7 },
      { x: 6, y: 13 },
      { x: 9, y: 4 },
    ];
    for (const b of alvos) {
      const aVeB = computeFov(grid, a, FOV_RADIUS).has(grid.index(b.x, b.y));
      const bVeA = computeFov(grid, b, FOV_RADIUS).has(grid.index(a.x, a.y));
      expect(aVeB).toBe(bVeA);
    }
  });

  it("num andar gerado, o FOV da escada não vaza para tiles distantes (20 seeds)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { grid, stairsUp } = generateLevel(seed, 1);
      const fov = computeFov(grid, stairsUp, FOV_RADIUS);
      expect(fov.has(grid.index(stairsUp.x, stairsUp.y))).toBe(true);
      for (const i of fov) {
        const x = i % grid.width;
        const y = Math.floor(i / grid.width);
        const dist2 = (x - stairsUp.x) ** 2 + (y - stairsUp.y) ** 2;
        expect(dist2).toBeLessThanOrEqual(FOV_RADIUS * FOV_RADIUS);
      }
    }
  });
});

describe("blocksSight", () => {
  it("parede e porta bloqueiam; terrenos passáveis não", () => {
    expect(blocksSight(TileType.Wall)).toBe(true);
    expect(blocksSight(TileType.Door)).toBe(true);
    for (const t of [TileType.Floor, TileType.Water, TileType.Grass, TileType.StairsUp]) {
      expect(blocksSight(t)).toBe(false);
    }
  });
});
