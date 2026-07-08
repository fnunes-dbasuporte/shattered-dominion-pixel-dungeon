import { TileType, isPassable, type Vec2 } from "../types.js";
import type { Grid } from "./grid.js";

/** 8 direções, sentido horário a partir do norte. */
export const DIRECTIONS8: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

/**
 * Regra ÚNICA de passo válido — usada pelo servidor (validação), pelo A* e
 * pelo preview do cliente. Diagonais não cortam quinas e portas só podem
 * ser atravessadas ortogonalmente (clássico de roguelike).
 */
export function canStep(grid: Grid, from: Vec2, dir: Vec2): boolean {
  if (!Number.isInteger(dir.x) || !Number.isInteger(dir.y)) return false;
  if (Math.abs(dir.x) > 1 || Math.abs(dir.y) > 1) return false;
  if (dir.x === 0 && dir.y === 0) return false;

  const tx = from.x + dir.x;
  const ty = from.y + dir.y;
  if (!grid.inBounds(from.x, from.y) || !grid.inBounds(tx, ty)) return false;
  if (!isPassable(grid.get(tx, ty))) return false;

  if (dir.x !== 0 && dir.y !== 0) {
    // sem cortar quinas: os dois ortogonais intermediários precisam ser livres
    if (!isPassable(grid.get(tx, from.y)) || !isPassable(grid.get(from.x, ty))) return false;
    // portas só na ortogonal
    if (grid.get(from.x, from.y) === TileType.Door || grid.get(tx, ty) === TileType.Door) {
      return false;
    }
  }
  return true;
}

/**
 * A* determinístico em 8 direções com custo uniforme por passo (modelo de
 * tempo do jogo: mover 1 tile custa 1 unidade ÷ velocidade, diagonal
 * incluída). Heurística Chebyshev (admissível para custo uniforme).
 * Retorna os passos SEM incluir a origem, ou null se inalcançável.
 */
export function findPath(grid: Grid, from: Vec2, to: Vec2, maxLength = 512): Vec2[] | null {
  if (!grid.inBounds(from.x, from.y) || !grid.inBounds(to.x, to.y)) return null;
  if (!isPassable(grid.get(to.x, to.y))) return null;
  if (from.x === to.x && from.y === to.y) return [];

  const size = grid.tiles.length;
  const startIndex = grid.index(from.x, from.y);
  const targetIndex = grid.index(to.x, to.y);

  const gScore = new Int32Array(size).fill(-1);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Array<boolean>(size).fill(false);
  const open: number[] = [startIndex];
  const fScore = new Int32Array(size).fill(0);

  const heuristic = (i: number) =>
    Math.max(Math.abs((i % grid.width) - to.x), Math.abs(Math.floor(i / grid.width) - to.y));

  gScore[startIndex] = 0;
  fScore[startIndex] = heuristic(startIndex);

  while (open.length > 0) {
    // extração do menor f — empate resolvido pela ordem de inserção (estável)
    let bestPos = 0;
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[bestPos]]) bestPos = i;
    }
    const current = open.splice(bestPos, 1)[0];
    if (current === targetIndex) return reconstruct(grid, cameFrom, targetIndex);
    if (closed[current]) continue;
    closed[current] = true;

    const cx = current % grid.width;
    const cy = Math.floor(current / grid.width);
    const here = { x: cx, y: cy };

    for (const dir of DIRECTIONS8) {
      if (!canStep(grid, here, dir)) continue;
      const ni = grid.index(cx + dir.x, cy + dir.y);
      if (closed[ni]) continue;
      const tentative = gScore[current] + 1;
      if (tentative > maxLength) continue;
      if (gScore[ni] === -1 || tentative < gScore[ni]) {
        gScore[ni] = tentative;
        fScore[ni] = tentative + heuristic(ni);
        cameFrom[ni] = current;
        open.push(ni);
      }
    }
  }

  return null;
}

function reconstruct(grid: Grid, cameFrom: Int32Array, targetIndex: number): Vec2[] {
  const path: Vec2[] = [];
  let i = targetIndex;
  while (cameFrom[i] !== -1) {
    path.push({ x: i % grid.width, y: Math.floor(i / grid.width) });
    i = cameFrom[i];
  }
  return path.reverse();
}
