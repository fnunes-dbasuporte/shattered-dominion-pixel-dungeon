import { TileType, isPassable, type Vec2 } from "../types.js";
import type { Rng } from "../rng.js";
import { Grid, floodFill } from "./grid.js";
import { rectCenter } from "./rect.js";
import type { Room } from "./level.js";

/** Chance de cada aresta fora da MST virar um corredor extra (loops no mapa). */
export const EXTRA_EDGE_CHANCE = 0.15;

interface Edge {
  a: number;
  b: number;
  weight: number;
}

/**
 * Conecta todas as salas: MST de Prim sobre os centros (conectividade
 * garantida) + arestas extras aleatórias (loops), corredores em L e portas
 * nas transições sala↔corredor. Retorna as posições das portas.
 */
export function connectRooms(grid: Grid, rooms: Room[], rng: Rng): Vec2[] {
  const interior = buildInteriorMask(grid, rooms);
  const centers = rooms.map(rectCenter);
  const edges = buildEdges(centers);
  const mst = minimumSpanningTree(edges, rooms.length);
  const chosen = [...mst, ...extraEdges(edges, mst, rng)];

  const carved = new Set<number>();
  for (const edge of chosen) {
    carveCorridor(grid, interior, centers[edge.a], centers[edge.b], rng, carved);
  }

  const doors = placeDoors(grid, interior, carved);
  repairDoorRuns(grid, doors);
  removeDeadEndDoors(grid, interior, doors);
  return doors.filter((d) => grid.get(d.x, d.y) === TileType.Door);
}

/** interior[index] === true se o tile pertence ao interior de alguma sala. */
function buildInteriorMask(grid: Grid, rooms: Room[]): boolean[] {
  const mask = new Array<boolean>(grid.tiles.length).fill(false);
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        mask[grid.index(x, y)] = true;
      }
    }
  }
  return mask;
}

function buildEdges(centers: Vec2[]): Edge[] {
  const edges: Edge[] = [];
  for (let a = 0; a < centers.length; a++) {
    for (let b = a + 1; b < centers.length; b++) {
      const weight = Math.abs(centers[a].x - centers[b].x) + Math.abs(centers[a].y - centers[b].y);
      edges.push({ a, b, weight });
    }
  }
  return edges;
}

/** Prim a partir do nó 0; empates resolvidos pela ordem estável das arestas. */
function minimumSpanningTree(edges: Edge[], nodeCount: number): Edge[] {
  const inTree = new Array<boolean>(nodeCount).fill(false);
  inTree[0] = true;
  const result: Edge[] = [];

  while (result.length < nodeCount - 1) {
    let best: Edge | undefined;
    for (const e of edges) {
      if (inTree[e.a] === inTree[e.b]) continue; // ambos dentro ou ambos fora
      if (!best || e.weight < best.weight) best = e;
    }
    if (!best) throw new Error("minimumSpanningTree: grafo desconexo");
    inTree[best.a] = true;
    inTree[best.b] = true;
    result.push(best);
  }

  return result;
}

function extraEdges(edges: Edge[], mst: Edge[], rng: Rng): Edge[] {
  const mstSet = new Set(mst);
  return edges.filter((e) => !mstSet.has(e) && rng.chance(EXTRA_EDGE_CHANCE));
}

/** Cava um corredor em L entre dois centros, pulando interiores de sala. */
function carveCorridor(
  grid: Grid,
  interior: boolean[],
  from: Vec2,
  to: Vec2,
  rng: Rng,
  carved: Set<number>,
): void {
  for (const p of lPath(from, to, rng.chance(0.5))) {
    const i = grid.index(p.x, p.y);
    if (interior[i]) continue;
    grid.set(p.x, p.y, TileType.Floor);
    carved.add(i);
  }
}

/** Caminho em L (inclusivo) entre dois pontos: um eixo por vez. */
function lPath(from: Vec2, to: Vec2, horizontalFirst: boolean): Vec2[] {
  const path: Vec2[] = [];
  const stepX = (y: number) => {
    const dir = Math.sign(to.x - from.x) || 1;
    for (let x = from.x; x !== to.x + dir; x += dir) path.push({ x, y });
  };
  const stepY = (x: number) => {
    const dir = Math.sign(to.y - from.y) || 1;
    for (let y = from.y; y !== to.y + dir; y += dir) path.push({ x, y });
  };
  if (horizontalFirst) {
    stepX(from.y);
    stepY(to.x);
  } else {
    stepY(from.x);
    stepX(to.y);
  }
  return path;
}

/** Todo tile cavado fora de sala mas encostado num interior vira porta. */
function placeDoors(grid: Grid, interior: boolean[], carved: Set<number>): Vec2[] {
  const doors: Vec2[] = [];
  for (const i of carved) {
    const x = i % grid.width;
    const y = Math.floor(i / grid.width);
    const touchesRoom = grid.neighbors4(x, y).some((n) => interior[grid.index(n.x, n.y)]);
    if (touchesRoom) {
      grid.set(x, y, TileType.Door);
      doors.push({ x, y });
    }
  }
  return doors;
}

/**
 * Corredores que tangenciam uma sala geram fileiras de portas coladas.
 * Converte para parede toda porta redundante — apenas quando a remoção
 * preserva 100% da conectividade dos tiles passáveis.
 */
function repairDoorRuns(grid: Grid, doors: Vec2[]): void {
  for (const door of doors) {
    const adjacentDoor = grid
      .neighbors4(door.x, door.y)
      .some((n) => grid.get(n.x, n.y) === TileType.Door);
    if (!adjacentDoor) continue;

    grid.set(door.x, door.y, TileType.Wall);
    if (!fullyConnected(grid)) {
      grid.set(door.x, door.y, TileType.Door); // era essencial — desfaz
    }
  }
}

/**
 * O reparo acima pode deixar uma porta cujo lado de corredor virou parede
 * ("porta para lugar nenhum"). Remover uma porta sem saída nunca desconecta
 * o mapa (é uma folha do grafo de passáveis), mas pode expor outra porta
 * sem saída — por isso itera até estabilizar.
 */
function removeDeadEndDoors(grid: Grid, interior: boolean[], doors: Vec2[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const door of doors) {
      if (grid.get(door.x, door.y) !== TileType.Door) continue;
      const temSaida = grid
        .neighbors4(door.x, door.y)
        .some((n) => !interior[grid.index(n.x, n.y)] && isPassable(grid.get(n.x, n.y)));
      if (!temSaida) {
        grid.set(door.x, door.y, TileType.Wall);
        changed = true;
      }
    }
  }
}

function fullyConnected(grid: Grid): boolean {
  const total = grid.countIf(isPassable);
  if (total === 0) return true;
  const start = findFirstPassable(grid);
  return floodFill(grid, start).count === total;
}

function findFirstPassable(grid: Grid): Vec2 {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (isPassable(grid.get(x, y))) return { x, y };
    }
  }
  throw new Error("findFirstPassable: grid sem tiles passáveis");
}
