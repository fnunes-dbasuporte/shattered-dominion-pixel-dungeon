import { TileType } from "../types.js";
import type { Rng } from "../rng.js";
import type { Grid } from "./grid.js";
import type { Room } from "./level.js";

/**
 * Decoração do tema "esgotos" (andares 1–5): manchas orgânicas de água e
 * grama dentro das salas. Regras de segurança:
 *  - só substitui FLOOR no interior de sala (nunca portas, corredores, anel);
 *  - nunca toca tiles protegidos (spawns) nem escadas (que já não são FLOOR);
 *  - água e grama são passáveis ⇒ nunca bloqueiam caminho.
 */
export function decorateSewers(
  grid: Grid,
  rooms: Room[],
  rng: Rng,
  protectedTiles: ReadonlySet<number>,
): void {
  for (const room of rooms) {
    const roll = rng.next();
    if (roll < 0.35) {
      paintPatches(grid, room, rng, TileType.Water, protectedTiles);
    } else if (roll < 0.65) {
      paintPatches(grid, room, rng, TileType.Grass, protectedTiles);
    }
    // senão: sala seca
  }
}

/** 1–2 manchas por sala; blobs em distância manhattan com densidade decaindo do centro. */
function paintPatches(
  grid: Grid,
  room: Room,
  rng: Rng,
  tile: TileType,
  protectedTiles: ReadonlySet<number>,
): void {
  const patches = rng.nextInt(1, 2);
  for (let p = 0; p < patches; p++) {
    const cx = rng.nextInt(room.x, room.x + room.width - 1);
    const cy = rng.nextInt(room.y, room.y + room.height - 1);
    const radius = rng.nextInt(1, 2);

    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        const dist = Math.abs(x - cx) + Math.abs(y - cy);
        if (dist > radius) continue;
        // centro sempre pinta; borda da mancha fica esparsa
        if (!rng.chance(1 - dist * 0.35)) continue;
        if (x < room.x || x >= room.x + room.width || y < room.y || y >= room.y + room.height) {
          continue;
        }
        const i = grid.index(x, y);
        if (protectedTiles.has(i) || grid.get(x, y) !== TileType.Floor) continue;
        grid.set(x, y, tile);
      }
    }
  }
}
