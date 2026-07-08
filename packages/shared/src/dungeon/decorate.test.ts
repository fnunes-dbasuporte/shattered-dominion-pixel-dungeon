import { describe, expect, it } from "vitest";
import { TileType, isPassable } from "../types.js";
import { floodFill } from "./grid.js";
import { rectContains } from "./rect.js";
import { generateLevel } from "./generateLevel.js";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

describe("decorateSewers (via generateLevel, depth 1)", () => {
  it("água/grama só existem dentro do interior de salas (200 seeds)", () => {
    for (const seed of SEEDS) {
      const { grid, rooms } = generateLevel(seed, 1);
      for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          const t = grid.get(x, y);
          if (t === TileType.Water || t === TileType.Grass) {
            expect(rooms.some((r) => rectContains(r, x, y))).toBe(true);
          }
        }
      }
    }
  });

  it("decoração nunca bloqueia caminho: conectividade total preservada (200 seeds)", () => {
    for (const seed of SEEDS) {
      const { grid, stairsUp } = generateLevel(seed, 1);
      expect(floodFill(grid, stairsUp).count).toBe(grid.countIf(isPassable));
    }
  });

  it("spawns continuam em FLOOR e escadas intactas (200 seeds)", () => {
    for (const seed of SEEDS) {
      const { grid, stairsUp, stairsDown, spawnPoints } = generateLevel(seed, 1);
      expect(grid.get(stairsUp.x, stairsUp.y)).toBe(TileType.StairsUp);
      expect(grid.get(stairsDown.x, stairsDown.y)).toBe(TileType.StairsDown);
      for (const p of spawnPoints) {
        expect(grid.get(p.x, p.y)).toBe(TileType.Floor);
      }
    }
  });

  it("a decoração de fato acontece na maioria dos mapas", () => {
    let decorados = 0;
    for (const seed of SEEDS) {
      const { grid } = generateLevel(seed, 1);
      if (grid.count(TileType.Water) + grid.count(TileType.Grass) > 0) decorados++;
    }
    // com ~35% água + ~30% grama por sala e ≥6 salas, quase todo mapa decora
    expect(decorados / SEEDS.length).toBeGreaterThan(0.8);
  });

  it("andares fora do tema (depth > 5) não recebem decoração de esgotos", () => {
    const { grid } = generateLevel(123, 6);
    expect(grid.count(TileType.Water) + grid.count(TileType.Grass)).toBe(0);
  });
});
