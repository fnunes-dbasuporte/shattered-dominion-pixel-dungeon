import type { Vec2 } from "../types.js";

/** Retângulo em tiles; para salas, representa apenas o interior (piso), sem o anel de paredes. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + Math.floor(r.width / 2), y: r.y + Math.floor(r.height / 2) };
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

/** true se os retângulos se intersectam quando `a` é expandido por `margin` tiles em toda direção. */
export function rectsIntersect(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x - margin < b.x + b.width &&
    a.x + a.width + margin > b.x &&
    a.y - margin < b.y + b.height &&
    a.y + a.height + margin > b.y
  );
}

export function forEachRectTile(r: Rect, fn: (x: number, y: number) => void): void {
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      fn(x, y);
    }
  }
}
