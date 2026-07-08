import { TileType, type Vec2 } from "../types.js";
import type { Grid } from "./grid.js";

export const FOV_RADIUS = 8;

/**
 * Portas fechadas bloqueiam visão (não há estado aberta/fechada ainda);
 * quem está EM CIMA da porta enxerga os dois lados, então atravessar
 * uma porta revela a sala — comportamento clássico de roguelike.
 */
export function blocksSight(tile: TileType): boolean {
  return tile === TileType.Wall || tile === TileType.Door;
}

/** Matrizes de transformação dos 8 octantes do shadowcasting. */
const OCTANTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, -1, 1, 0],
  [-1, 0, 0, 1],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [0, 1, -1, 0],
  [1, 0, 0, -1],
];

/**
 * FOV por shadowcasting recursivo (algoritmo clássico de RogueBasin),
 * raio euclidiano. Retorna o conjunto de índices de tiles visíveis.
 * Roda no SERVIDOR — o cliente nunca decide o que enxerga.
 */
export function computeFov(grid: Grid, origin: Vec2, radius = FOV_RADIUS): Set<number> {
  const visible = new Set<number>();
  if (!grid.inBounds(origin.x, origin.y)) return visible;
  visible.add(grid.index(origin.x, origin.y));
  for (const [xx, xy, yx, yy] of OCTANTS) {
    castLight(grid, origin, radius, 1, 1.0, 0.0, xx, xy, yx, yy, visible);
  }
  return visible;
}

function castLight(
  grid: Grid,
  origin: Vec2,
  radius: number,
  row: number,
  start: number,
  end: number,
  xx: number,
  xy: number,
  yx: number,
  yy: number,
  visible: Set<number>,
): void {
  if (start < end) return;
  const radius2 = radius * radius;
  let newStart = 0;
  let blocked = false;

  for (let distance = row; distance <= radius && !blocked; distance++) {
    const dy = -distance;
    for (let dx = -distance; dx <= 0; dx++) {
      const currentX = origin.x + dx * xx + dy * xy;
      const currentY = origin.y + dx * yx + dy * yy;
      const leftSlope = (dx - 0.5) / (dy + 0.5);
      const rightSlope = (dx + 0.5) / (dy - 0.5);

      if (!grid.inBounds(currentX, currentY) || start < rightSlope) continue;
      if (end > leftSlope) break;

      if (dx * dx + dy * dy <= radius2) {
        visible.add(grid.index(currentX, currentY));
      }

      const isBlocking = blocksSight(grid.get(currentX, currentY));
      if (blocked) {
        if (isBlocking) {
          newStart = rightSlope;
        } else {
          blocked = false;
          start = newStart;
        }
      } else if (isBlocking && distance < radius) {
        blocked = true;
        castLight(grid, origin, radius, distance + 1, start, leftSlope, xx, xy, yx, yy, visible);
        newStart = rightSlope;
      }
    }
  }
}
