import { TileType } from "../types.js";
import type { Rng } from "../rng.js";
import type { Grid } from "./grid.js";
import { rectsIntersect } from "./rect.js";
import { RoomType, type Room } from "./level.js";

/** Interior mínimo 3×3: comporta escada + 8 spawns na sala de entrada. */
export const ROOM_MIN_SIZE = 3;
export const ROOM_MAX_SIZE = 7;
export const MIN_ROOMS = 6;

const PLACEMENT_ATTEMPTS = 90;
const PLACEMENT_ROUNDS = 20;

/**
 * Coloca salas retangulares por tentativa e erro: sorteia tamanho/posição e
 * descarta as que sobrepõem (com ≥1 tile de parede entre interiores). Se uma
 * rodada terminar com menos de MIN_ROOMS salas (estatisticamente raríssimo),
 * refaz com o mesmo Rng — o resultado continua determinístico por seed.
 */
export function placeRooms(grid: Grid, rng: Rng): Room[] {
  for (let round = 0; round < PLACEMENT_ROUNDS; round++) {
    const rooms = tryPlaceRooms(grid, rng);
    if (rooms.length >= MIN_ROOMS) {
      carveRooms(grid, rooms);
      return rooms;
    }
  }
  throw new Error(`placeRooms: menos de ${MIN_ROOMS} salas após ${PLACEMENT_ROUNDS} rodadas`);
}

function tryPlaceRooms(grid: Grid, rng: Rng): Room[] {
  const rooms: Room[] = [];

  for (let i = 0; i < PLACEMENT_ATTEMPTS; i++) {
    const width = rng.nextInt(ROOM_MIN_SIZE, ROOM_MAX_SIZE);
    const height = rng.nextInt(ROOM_MIN_SIZE, ROOM_MAX_SIZE);
    // Interior a partir de (2,2): garante o anel de paredes da sala dentro
    // do grid e ainda uma borda externa de 1 tile no mapa.
    const x = rng.nextInt(2, grid.width - width - 2);
    const y = rng.nextInt(2, grid.height - height - 2);
    const candidate: Room = { x, y, width, height, type: RoomType.Standard };

    // Margem 2 entre interiores ⇒ nunca menos de 2 paredes entre salas,
    // evitando portas coladas entre duas salas.
    if (!rooms.some((r) => rectsIntersect(candidate, r, 2))) {
      rooms.push(candidate);
    }
  }

  return rooms;
}

function carveRooms(grid: Grid, rooms: Room[]): void {
  for (const room of rooms) {
    grid.fillRect(room, TileType.Floor);
  }
}
