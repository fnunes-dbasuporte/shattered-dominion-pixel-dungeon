/** Identificador único de qualquer entidade do jogo (jogador, mob, item no chão...). */
export type EntityId = string;

/** Posição/direção em tiles ou pixels, conforme o contexto. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Tipos de tile do mapa. Valores numéricos para armazenamento compacto
 * em arrays de mapa (Uint8Array na geração de dungeon).
 */
export enum TileType {
  Wall = 0,
  Floor = 1,
  Door = 2,
  StairsUp = 3,
  StairsDown = 4,
  Water = 5,
  Grass = 6,
  Embers = 7,
}

/** Tiles que um ator pode ocupar/atravessar (paredes são o único bloqueio no terreno). */
export function isPassable(tile: TileType): boolean {
  return tile !== TileType.Wall;
}
