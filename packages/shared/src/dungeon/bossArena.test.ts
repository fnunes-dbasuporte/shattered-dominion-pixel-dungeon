import { describe, expect, it } from "vitest";
import { TileType, isPassable } from "../types.js";
import { floodFill } from "./grid.js";
import { rectContains } from "./rect.js";
import { RoomType } from "./level.js";
import { BOSS_DEPTH, generateBossArena } from "./bossArena.js";
import { generateLevel, levelFingerprint } from "./generateLevel.js";

describe("generateBossArena", () => {
  it("generateLevel delega para a arena no andar do boss", () => {
    const viaGenerate = generateLevel(123, BOSS_DEPTH);
    const direto = generateBossArena(123);
    expect(levelFingerprint(viaGenerate)).toBe(levelFingerprint(direto));
    expect(viaGenerate.bossSpawn).toBeDefined();
  });

  it("é determinístico por seed e varia entre seeds (decoração)", () => {
    expect(levelFingerprint(generateBossArena(1))).toBe(levelFingerprint(generateBossArena(1)));
    expect(levelFingerprint(generateBossArena(1))).not.toBe(levelFingerprint(generateBossArena(2)));
  });

  it("NÃO tem escada de descida — a run termina aqui", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const level = generateBossArena(seed);
      expect(level.grid.count(TileType.StairsDown)).toBe(0);
      expect(level.grid.count(TileType.StairsUp)).toBe(1);
    }
  });

  it("tudo conectado: da escada ▲ alcança-se o bossSpawn e todo tile passável", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const level = generateBossArena(seed);
      const { reached, count } = floodFill(level.grid, level.stairsUp);
      expect(count).toBe(level.grid.countIf(isPassable));
      expect(reached[level.grid.index(level.bossSpawn!.x, level.bossSpawn!.y)]).toBe(true);
    }
  });

  it("8 spawns na sala de entrada; bossSpawn na arena, longe da entrada", () => {
    const level = generateBossArena(9);
    const entrance = level.rooms.find((r) => r.type === RoomType.Entrance)!;
    const arena = level.rooms.find((r) => r.type === RoomType.Boss)!;

    expect(level.spawnPoints).toHaveLength(8);
    for (const p of level.spawnPoints) {
      expect(rectContains(entrance, p.x, p.y)).toBe(true);
      expect(isPassable(level.grid.get(p.x, p.y))).toBe(true);
    }
    expect(rectContains(arena, level.bossSpawn!.x, level.bossSpawn!.y)).toBe(true);
    expect(isPassable(level.grid.get(level.bossSpawn!.x, level.bossSpawn!.y))).toBe(true);
    // boss longe da porta de entrada da arena
    expect(level.bossSpawn!.y).toBeLessThan(entrance.y - 8);
  });

  it("pilares de cobertura existem dentro da arena", () => {
    const level = generateBossArena(4);
    const arena = level.rooms.find((r) => r.type === RoomType.Boss)!;
    let paredesInternas = 0;
    for (let y = arena.y; y < arena.y + arena.height; y++) {
      for (let x = arena.x; x < arena.x + arena.width; x++) {
        if (level.grid.get(x, y) === TileType.Wall) paredesInternas++;
      }
    }
    expect(paredesInternas).toBe(16); // 4 pilares 2×2
  });
});
