import { TileType } from "../types.js";
import { Rng } from "../rng.js";
import { Grid } from "./grid.js";
import { LEVEL_HEIGHT, LEVEL_WIDTH, RoomType, type Level, type Room } from "./level.js";

/** Andar do covil do boss (fim do vertical slice v1.0). */
export const BOSS_DEPTH = 5;

/**
 * Layout dedicado do covil: sala de entrada ao sul (escada ▲ + spawns),
 * corredor curto e uma grande arena central com pilares de cobertura e
 * poças de lodo. SEM escada ▼ — a run termina aqui.
 */
export function generateBossArena(seed: number): Level {
  const rng = new Rng(seed).fork(`boss:${BOSS_DEPTH}`);
  const grid = new Grid(LEVEL_WIDTH, LEVEL_HEIGHT);

  // sala de entrada (interior 8×5)
  const entrance: Room = { x: 12, y: 24, width: 8, height: 5, type: RoomType.Entrance };
  grid.fillRect(entrance, TileType.Floor);

  // corredor 2 de largura ligando entrada → arena
  grid.fillRect({ x: 15, y: 20, width: 2, height: 4 }, TileType.Floor);

  // arena central (interior 24×14)
  const arena: Room = { x: 4, y: 6, width: 24, height: 14, type: RoomType.Boss };
  grid.fillRect(arena, TileType.Floor);

  // pilares 2×2 — cobertura contra o ataque em área
  for (const [px, py] of [
    [9, 9],
    [21, 9],
    [9, 15],
    [21, 15],
  ] as const) {
    grid.fillRect({ x: px, y: py, width: 2, height: 2 }, TileType.Wall);
  }

  // poças de lodo nos cantos da arena (passáveis)
  for (const [wx, wy, ww, wh] of [
    [4, 6, 4, 2],
    [24, 6, 4, 2],
    [4, 18, 4, 2],
    [24, 18, 4, 2],
  ] as const) {
    for (let y = wy; y < wy + wh; y++) {
      for (let x = wx; x < wx + ww; x++) {
        if (rng.chance(0.75)) grid.set(x, y, TileType.Water);
      }
    }
  }

  // tufos de ervas espalhados pela arena
  for (let i = 0; i < 14; i++) {
    const x = rng.nextInt(arena.x, arena.x + arena.width - 1);
    const y = rng.nextInt(arena.y, arena.y + arena.height - 1);
    if (grid.get(x, y) === TileType.Floor) grid.set(x, y, TileType.Grass);
  }

  // escada de subida no fundo da sala de entrada; SEM descida
  const stairsUp = { x: 16, y: 28 };
  grid.set(stairsUp.x, stairsUp.y, TileType.StairsUp);

  // spawns ao redor da escada, dentro da sala de entrada
  const spawnPoints = [
    { x: 15, y: 28 },
    { x: 17, y: 28 },
    { x: 14, y: 27 },
    { x: 16, y: 27 },
    { x: 18, y: 27 },
    { x: 14, y: 26 },
    { x: 16, y: 26 },
    { x: 18, y: 26 },
  ];

  // centro da arena — onde o Amálgama desperta
  const bossSpawn = { x: 16, y: 12 };

  return {
    seed,
    depth: BOSS_DEPTH,
    width: LEVEL_WIDTH,
    height: LEVEL_HEIGHT,
    grid,
    rooms: [entrance, arena],
    stairsUp,
    // sem ▼ neste andar: o campo aponta o centro da arena e nenhum tile
    // StairsDown existe no grid (o voto de descida verifica o grid)
    stairsDown: bossSpawn,
    spawnPoints,
    bossSpawn,
  };
}
