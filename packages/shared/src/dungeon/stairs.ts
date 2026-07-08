import { TileType, type Vec2 } from "../types.js";
import { MAX_PLAYERS } from "../constants.js";
import type { Rng } from "../rng.js";
import type { Grid } from "./grid.js";
import { rectCenter, rectContains } from "./rect.js";
import { RoomType, type Room } from "./level.js";

export const TREASURE_ROOM_CHANCE = 0.05;

export interface StairsResult {
  stairsUp: Vec2;
  stairsDown: Vec2;
  spawnPoints: Vec2[];
}

/**
 * Escolhe sala de entrada (aleatória) e de saída (a mais distante da
 * entrada), marca os tipos de sala, coloca as escadas nos centros e
 * distribui até 8 spawns ao redor da escada de subida.
 */
export function placeStairsAndSpawns(grid: Grid, rooms: Room[], rng: Rng): StairsResult {
  const entranceIndex = rng.nextInt(0, rooms.length - 1);
  const exitIndex = farthestRoomFrom(rooms, entranceIndex);
  rooms[entranceIndex].type = RoomType.Entrance;
  rooms[exitIndex].type = RoomType.Exit;

  for (const room of rooms) {
    if (room.type === RoomType.Standard && rng.chance(TREASURE_ROOM_CHANCE)) {
      room.type = RoomType.Treasure;
    }
  }

  const stairsUp = rectCenter(rooms[entranceIndex]);
  const stairsDown = rectCenter(rooms[exitIndex]);
  grid.set(stairsUp.x, stairsUp.y, TileType.StairsUp);
  grid.set(stairsDown.x, stairsDown.y, TileType.StairsDown);

  const spawnPoints = pickSpawns(grid, rooms[entranceIndex], stairsUp);
  return { stairsUp, stairsDown, spawnPoints };
}

/** Sala cujo centro está mais longe (manhattan) — empate resolvido pelo menor índice. */
function farthestRoomFrom(rooms: Room[], fromIndex: number): number {
  const from = rectCenter(rooms[fromIndex]);
  let best = -1;
  let bestDist = -1;
  for (let i = 0; i < rooms.length; i++) {
    if (i === fromIndex) continue;
    const c = rectCenter(rooms[i]);
    const dist = Math.abs(c.x - from.x) + Math.abs(c.y - from.y);
    if (dist > bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * BFS a partir da escada, restrito ao interior da sala de entrada, coletando
 * os tiles de piso mais próximos — ordem de visita fixa ⇒ determinístico.
 * Interior mínimo 3×3 garante 8 tiles livres além da escada.
 */
function pickSpawns(grid: Grid, entrance: Room, stairsUp: Vec2): Vec2[] {
  const spawns: Vec2[] = [];
  const visited = new Set<number>([grid.index(stairsUp.x, stairsUp.y)]);
  const queue: Vec2[] = [stairsUp];

  while (queue.length > 0 && spawns.length < MAX_PLAYERS) {
    const current = queue.shift() as Vec2;
    for (const n of grid.neighbors4(current.x, current.y)) {
      const i = grid.index(n.x, n.y);
      if (visited.has(i) || !rectContains(entrance, n.x, n.y)) continue;
      visited.add(i);
      if (grid.get(n.x, n.y) === TileType.Floor) {
        spawns.push(n);
        if (spawns.length === MAX_PLAYERS) break;
      }
      queue.push(n);
    }
  }

  return spawns;
}
