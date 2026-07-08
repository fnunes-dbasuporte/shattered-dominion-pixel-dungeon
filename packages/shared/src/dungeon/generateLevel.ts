import { Rng } from "../rng.js";
import { Grid, fnv1a } from "./grid.js";
import { LEVEL_HEIGHT, LEVEL_WIDTH, type Level } from "./level.js";
import { placeRooms } from "./rooms.js";
import { connectRooms } from "./corridors.js";
import { placeStairsAndSpawns } from "./stairs.js";

/**
 * Gera um andar completo, 100% determinístico por (seed, depth):
 * salas → corredores/portas → escadas/spawns.
 */
export function generateLevel(seed: number, depth: number): Level {
  const rng = new Rng(seed).fork(`depth:${depth}`);
  const grid = new Grid(LEVEL_WIDTH, LEVEL_HEIGHT);

  const rooms = placeRooms(grid, rng);
  connectRooms(grid, rooms, rng);
  const { stairsUp, stairsDown, spawnPoints } = placeStairsAndSpawns(grid, rooms, rng);

  return {
    seed,
    depth,
    width: LEVEL_WIDTH,
    height: LEVEL_HEIGHT,
    grid,
    rooms,
    stairsUp,
    stairsDown,
    spawnPoints,
  };
}

/** Fingerprint estável do andar (grid + escadas + spawns) para testes e sanidade de sync. */
export function levelFingerprint(level: Level): number {
  const extras = [
    level.stairsUp.x,
    level.stairsUp.y,
    level.stairsDown.x,
    level.stairsDown.y,
    ...level.spawnPoints.flatMap((p) => [p.x, p.y]),
  ];
  const bytes = new Uint8Array(level.grid.tiles.length + extras.length);
  bytes.set(level.grid.tiles, 0);
  bytes.set(extras, level.grid.tiles.length);
  return fnv1a(bytes);
}
