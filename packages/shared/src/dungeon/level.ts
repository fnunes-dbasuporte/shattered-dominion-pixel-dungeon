import type { Vec2 } from "../types.js";
import type { Grid } from "./grid.js";
import type { Rect } from "./rect.js";

export const LEVEL_WIDTH = 32;
export const LEVEL_HEIGHT = 32;

export enum RoomType {
  Standard = 0,
  Entrance = 1,
  Exit = 2,
  Treasure = 3,
  Boss = 4,
}

/** Sala retangular; o Rect é o interior (piso) — o anel de paredes fica em volta. */
export interface Room extends Rect {
  type: RoomType;
}

export interface Level {
  seed: number;
  depth: number;
  width: number;
  height: number;
  grid: Grid;
  rooms: Room[];
  stairsUp: Vec2;
  stairsDown: Vec2;
  /** Até 8 pontos de spawn, na sala de entrada (a da escada de subida). */
  spawnPoints: Vec2[];
  /** Presente apenas no covil do boss (andar 5): onde o chefe desperta. */
  bossSpawn?: Vec2;
}
