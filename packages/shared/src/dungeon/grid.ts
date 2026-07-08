import { TileType, isPassable, type Vec2 } from "../types.js";
import { type Rect } from "./rect.js";

/** Grid de tiles compacto (Uint8Array) — serializável para rede e hashing. */
export class Grid {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;

  constructor(width: number, height: number, fill: TileType = TileType.Wall) {
    this.width = width;
    this.height = height;
    this.tiles = new Uint8Array(width * height).fill(fill);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  get(x: number, y: number): TileType {
    if (!this.inBounds(x, y)) {
      throw new RangeError(`get fora do grid: (${x}, ${y})`);
    }
    return this.tiles[this.index(x, y)];
  }

  set(x: number, y: number, tile: TileType): void {
    if (!this.inBounds(x, y)) {
      throw new RangeError(`set fora do grid: (${x}, ${y})`);
    }
    this.tiles[this.index(x, y)] = tile;
  }

  fillRect(rect: Rect, tile: TileType): void {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        this.set(x, y, tile);
      }
    }
  }

  /** Vizinhos ortogonais dentro do grid. */
  neighbors4(x: number, y: number): Vec2[] {
    const out: Vec2[] = [];
    if (this.inBounds(x, y - 1)) out.push({ x, y: y - 1 });
    if (this.inBounds(x - 1, y)) out.push({ x: x - 1, y });
    if (this.inBounds(x + 1, y)) out.push({ x: x + 1, y });
    if (this.inBounds(x, y + 1)) out.push({ x, y: y + 1 });
    return out;
  }

  count(tile: TileType): number {
    let n = 0;
    for (const t of this.tiles) if (t === tile) n++;
    return n;
  }

  countIf(predicate: (tile: TileType) => boolean): number {
    let n = 0;
    for (const t of this.tiles) if (predicate(t)) n++;
    return n;
  }
}

export interface FloodFillResult {
  /** reached[grid.index(x, y)] === true se o tile foi alcançado. */
  reached: boolean[];
  count: number;
}

/**
 * Preenchimento por inundação ortogonal a partir de `start`, andando apenas
 * por tiles em que `passable(tile)` é true. Base do teste de conectividade
 * e, futuramente, de visão/pathfinding.
 */
export function floodFill(
  grid: Grid,
  start: Vec2,
  passable: (tile: TileType) => boolean = isPassable,
): FloodFillResult {
  const reached = new Array<boolean>(grid.tiles.length).fill(false);
  if (!grid.inBounds(start.x, start.y) || !passable(grid.get(start.x, start.y))) {
    return { reached, count: 0 };
  }

  const stack: Vec2[] = [start];
  reached[grid.index(start.x, start.y)] = true;
  let count = 1;

  while (stack.length > 0) {
    const { x, y } = stack.pop() as Vec2;
    for (const n of grid.neighbors4(x, y)) {
      const i = grid.index(n.x, n.y);
      if (!reached[i] && passable(grid.get(n.x, n.y))) {
        reached[i] = true;
        count++;
        stack.push(n);
      }
    }
  }

  return { reached, count };
}

/** Hash FNV-1a 32 bits — fingerprint estável de grids para testes de determinismo e sync. */
export function fnv1a(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const b of bytes) {
    hash ^= b;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
