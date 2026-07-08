import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { TileType } from "../types.js";
import { Grid } from "./grid.js";
import { rectsIntersect } from "./rect.js";
import { LEVEL_HEIGHT, LEVEL_WIDTH } from "./level.js";
import { MIN_ROOMS, ROOM_MAX_SIZE, ROOM_MIN_SIZE, placeRooms } from "./rooms.js";

const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);

describe("placeRooms", () => {
  it(`gera sempre ≥${MIN_ROOMS} salas dentro dos limites de tamanho (100 seeds)`, () => {
    for (const seed of SEEDS) {
      const grid = new Grid(LEVEL_WIDTH, LEVEL_HEIGHT);
      const rooms = placeRooms(grid, new Rng(seed));

      expect(rooms.length).toBeGreaterThanOrEqual(MIN_ROOMS);
      for (const r of rooms) {
        expect(r.width).toBeGreaterThanOrEqual(ROOM_MIN_SIZE);
        expect(r.width).toBeLessThanOrEqual(ROOM_MAX_SIZE);
        expect(r.height).toBeGreaterThanOrEqual(ROOM_MIN_SIZE);
        expect(r.height).toBeLessThanOrEqual(ROOM_MAX_SIZE);
        // Interior + anel de paredes contidos no grid, com borda externa de 1.
        expect(r.x).toBeGreaterThanOrEqual(2);
        expect(r.y).toBeGreaterThanOrEqual(2);
        expect(r.x + r.width).toBeLessThanOrEqual(LEVEL_WIDTH - 2);
        expect(r.y + r.height).toBeLessThanOrEqual(LEVEL_HEIGHT - 2);
      }
    }
  });

  it("salas nunca se sobrepõem e mantêm ≥2 paredes entre interiores (100 seeds)", () => {
    for (const seed of SEEDS) {
      const grid = new Grid(LEVEL_WIDTH, LEVEL_HEIGHT);
      const rooms = placeRooms(grid, new Rng(seed));
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          expect(rectsIntersect(rooms[i], rooms[j], 2)).toBe(false);
        }
      }
    }
  });

  it("cava exatamente os interiores das salas como FLOOR", () => {
    const grid = new Grid(LEVEL_WIDTH, LEVEL_HEIGHT);
    const rooms = placeRooms(grid, new Rng(42));
    const areaTotal = rooms.reduce((sum, r) => sum + r.width * r.height, 0);
    expect(grid.count(TileType.Floor)).toBe(areaTotal);
  });

  it("é determinístico por seed", () => {
    const run = (seed: number) => {
      const grid = new Grid(LEVEL_WIDTH, LEVEL_HEIGHT);
      return placeRooms(grid, new Rng(seed));
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });
});
