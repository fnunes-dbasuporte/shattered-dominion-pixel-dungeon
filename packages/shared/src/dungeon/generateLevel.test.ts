import { describe, expect, it } from "vitest";
import { TileType, isPassable } from "../types.js";
import { MAX_PLAYERS } from "../constants.js";
import { floodFill } from "./grid.js";
import { rectContains } from "./rect.js";
import { RoomType } from "./level.js";
import { MIN_ROOMS } from "./rooms.js";
import { generateLevel, levelFingerprint } from "./generateLevel.js";

describe("generateLevel — determinismo", () => {
  it("mesma seed+depth ⇒ mesmo fingerprint e mesmo grid (20 seeds × 3 depths)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (let depth = 1; depth <= 3; depth++) {
        const a = generateLevel(seed, depth);
        const b = generateLevel(seed, depth);
        expect(levelFingerprint(a)).toBe(levelFingerprint(b));
        expect([...a.grid.tiles]).toEqual([...b.grid.tiles]);
        expect(a.spawnPoints).toEqual(b.spawnPoints);
        expect(a.rooms).toEqual(b.rooms);
      }
    }
  });

  it("seeds ou depths diferentes ⇒ mapas diferentes", () => {
    const base = levelFingerprint(generateLevel(1, 1));
    expect(levelFingerprint(generateLevel(2, 1))).not.toBe(base);
    expect(levelFingerprint(generateLevel(1, 2))).not.toBe(base);
  });
});

describe("generateLevel — invariantes em 1000 seeds", () => {
  it("todo andar tem salas, escadas em salas distintas, 8 spawns e conectividade total", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const level = generateLevel(seed, 1);
      const { grid, rooms, stairsUp, stairsDown, spawnPoints } = level;

      // salas
      expect(rooms.length).toBeGreaterThanOrEqual(MIN_ROOMS);
      const entradas = rooms.filter((r) => r.type === RoomType.Entrance);
      const saidas = rooms.filter((r) => r.type === RoomType.Exit);
      expect(entradas).toHaveLength(1);
      expect(saidas).toHaveLength(1);

      // escadas: exatamente uma de cada, em salas distintas
      expect(grid.count(TileType.StairsUp)).toBe(1);
      expect(grid.count(TileType.StairsDown)).toBe(1);
      expect(rectContains(entradas[0], stairsUp.x, stairsUp.y)).toBe(true);
      expect(rectContains(saidas[0], stairsDown.x, stairsDown.y)).toBe(true);
      expect(entradas[0]).not.toBe(saidas[0]);

      // spawns: 8, únicos, em piso da sala de entrada
      expect(spawnPoints).toHaveLength(MAX_PLAYERS);
      const unicos = new Set(spawnPoints.map((p) => grid.index(p.x, p.y)));
      expect(unicos.size).toBe(MAX_PLAYERS);
      for (const p of spawnPoints) {
        expect(rectContains(entradas[0], p.x, p.y)).toBe(true);
        expect(grid.get(p.x, p.y)).toBe(TileType.Floor);
      }

      // conectividade: da escada de subida alcança-se todo tile passável
      const { count } = floodFill(grid, stairsUp);
      expect(count).toBe(grid.countIf(isPassable));
    }
  });
});
