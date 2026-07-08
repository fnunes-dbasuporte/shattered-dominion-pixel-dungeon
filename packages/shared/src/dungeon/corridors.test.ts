import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { TileType, isPassable, type Vec2 } from "../types.js";
import { Grid, floodFill } from "./grid.js";
import { rectCenter, rectContains } from "./rect.js";
import { LEVEL_HEIGHT, LEVEL_WIDTH, type Room } from "./level.js";
import { placeRooms } from "./rooms.js";
import { connectRooms } from "./corridors.js";

const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);

function buildConnected(seed: number): { grid: Grid; rooms: Room[]; doors: Vec2[] } {
  const grid = new Grid(LEVEL_WIDTH, LEVEL_HEIGHT);
  const rng = new Rng(seed);
  const rooms = placeRooms(grid, rng);
  const doors = connectRooms(grid, rooms, rng);
  return { grid, rooms, doors };
}

const inSomeRoom = (rooms: Room[], x: number, y: number) =>
  rooms.some((r) => rectContains(r, x, y));

describe("connectRooms", () => {
  it("flood fill a partir da 1ª sala alcança 100% dos tiles passáveis (100 seeds)", () => {
    for (const seed of SEEDS) {
      const { grid, rooms } = buildConnected(seed);
      const { count } = floodFill(grid, rectCenter(rooms[0]));
      expect(count).toBe(grid.countIf(isPassable));
      expect(count).toBeGreaterThan(0);
    }
  });

  it("toda porta liga interior de sala a corredor (100 seeds)", () => {
    for (const seed of SEEDS) {
      const { grid, rooms, doors } = buildConnected(seed);
      expect(doors.length).toBeGreaterThan(0);

      for (const door of doors) {
        expect(grid.get(door.x, door.y)).toBe(TileType.Door);
        // porta nunca dentro de uma sala
        expect(inSomeRoom(rooms, door.x, door.y)).toBe(false);

        const vizinhos = grid.neighbors4(door.x, door.y);
        const paraSala = vizinhos.filter(
          (n) => inSomeRoom(rooms, n.x, n.y) && isPassable(grid.get(n.x, n.y)),
        );
        const paraCorredor = vizinhos.filter(
          (n) => !inSomeRoom(rooms, n.x, n.y) && isPassable(grid.get(n.x, n.y)),
        );
        expect(paraSala.length).toBeGreaterThanOrEqual(1);
        expect(paraCorredor.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("nenhum tile passável na borda do mapa (100 seeds)", () => {
    for (const seed of SEEDS) {
      const { grid } = buildConnected(seed);
      for (let x = 0; x < grid.width; x++) {
        expect(isPassable(grid.get(x, 0))).toBe(false);
        expect(isPassable(grid.get(x, grid.height - 1))).toBe(false);
      }
      for (let y = 0; y < grid.height; y++) {
        expect(isPassable(grid.get(0, y))).toBe(false);
        expect(isPassable(grid.get(grid.width - 1, y))).toBe(false);
      }
    }
  });

  it("é determinístico por seed", () => {
    const a = buildConnected(31);
    const b = buildConnected(31);
    expect([...a.grid.tiles]).toEqual([...b.grid.tiles]);
    expect(a.doors).toEqual(b.doors);
  });
});
