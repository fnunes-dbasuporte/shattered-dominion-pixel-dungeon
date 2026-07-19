/**
 * Renderiza a capa e as capturas da vitrine (pixelforgegames.com.br) a partir
 * do jogo de verdade — sem navegador: `generateLevel` real, os mesmos PNGs de
 * tile e sprite que o cliente carrega, o mesmo fog of war (tint 0x555566) e o
 * mesmo zoom 2x da câmera, com upscale nearest-neighbor.
 *
 * Uso: pnpm site:art [--out tools/site/out]
 *
 * Saídas: capa 1280x720 + 3 capturas 960x540, prontas para
 * /usr/share/nginx/html/assets/img/{covers,shots}/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PNG } from "pngjs";
import {
  TileType,
  computeFov,
  generateLevel,
  hashSeed,
  isPassable,
  rectCenter,
  type Level,
  type Vec2,
} from "../../packages/shared/src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ASSETS = join(ROOT, "packages/client/public/assets");

// Espelham GameScene.ts: TILE_PX, zoom da câmera, tint do fog e cor de fundo.
const TILE_PX = 32;
const ZOOM = 2;
const FOG = [0x55 / 255, 0x55 / 255, 0x66 / 255] as const;
const BG = [0x0b, 0x0a, 0x10, 0xff] as const;

// GameScene.TILE_TEXTURES — a variação de chão sai do hash do índice do tile.
const TILE_TEXTURES: Record<number, string[]> = {
  [TileType.Wall]: ["wall"],
  [TileType.Floor]: ["floor-1", "floor-2", "floor-3"],
  [TileType.Door]: ["door"],
  [TileType.StairsUp]: ["stairs-up"],
  [TileType.StairsDown]: ["stairs-down"],
  [TileType.Water]: ["water"],
  [TileType.Grass]: ["grass"],
  [TileType.Embers]: ["embers"],
};

// ── canvas RGBA cru ─────────────────────────────────────────────────
interface Canvas {
  w: number;
  h: number;
  data: Buffer;
}

function canvas(w: number, h: number): Canvas {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(BG, i * 4);
  return { w, h, data };
}

const pngCache = new Map<string, Canvas>();
function loadPng(path: string): Canvas {
  const hit = pngCache.get(path);
  if (hit) return hit;
  const png = PNG.sync.read(readFileSync(path));
  const img: Canvas = { w: png.width, h: png.height, data: png.data };
  pngCache.set(path, img);
  return img;
}

/** Blit com alpha "source over", recorte no destino e tint multiplicativo. */
function blit(
  dst: Canvas,
  src: Canvas,
  dx: number,
  dy: number,
  rect?: { sx: number; sy: number; w: number; h: number },
  tint?: readonly [number, number, number],
): void {
  const { sx = 0, sy = 0, w = src.w, h = src.h } = rect ?? {};
  for (let y = 0; y < h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.h) continue;
    for (let x = 0; x < w; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.w) continue;
      const si = ((sy + y) * src.w + (sx + x)) * 4;
      const a = src.data[si + 3] / 255;
      if (a === 0) continue;
      const di = (ty * dst.w + tx) * 4;
      for (let c = 0; c < 3; c++) {
        const s = src.data[si + c] * (tint ? tint[c] : 1);
        dst.data[di + c] = Math.round(s * a + dst.data[di + c] * (1 - a));
      }
      dst.data[di + 3] = 255;
    }
  }
}

/** Zoom da câmera: nearest-neighbor, como o `pixelArt: true` do Phaser. */
function upscale(src: Canvas, factor: number): Canvas {
  const out = canvas(src.w * factor, src.h * factor);
  for (let y = 0; y < out.h; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < out.w; x++) {
      const si = (sy * src.w + Math.floor(x / factor)) * 4;
      src.data.copy(out.data, (y * out.w + x) * 4, si, si + 4);
    }
  }
  return out;
}

function save(img: Canvas, path: string): void {
  const png = new PNG({ width: img.w, height: img.h });
  img.data.copy(png.data);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
  console.log(`  ${path}  ${img.w}x${img.h}`);
}

// ── sprites ─────────────────────────────────────────────────────────
interface SheetMeta {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: Record<string, { row: number; count: number }>;
}

/** Frame parado virado para o sul, como `playAnim(..., "idle"|"still", "south")`. */
function restFrame(texture: string): {
  img: Canvas;
  rect: { sx: number; sy: number; w: number; h: number };
} {
  const metaName = texture.startsWith("hero") ? "hero" : texture;
  const meta = JSON.parse(
    readFileSync(join(ASSETS, `sprites/${metaName}.json`), "utf8"),
  ) as SheetMeta;
  const row = meta.rows["idle-south"] ?? meta.rows["still-south"];
  const index = row.row * meta.columns;
  const size = meta.frameWidth;
  return {
    img: loadPng(join(ASSETS, `sprites/${texture}.png`)),
    rect: {
      sx: (index % meta.columns) * size,
      sy: Math.floor(index / meta.columns) * size,
      w: size,
      h: meta.frameHeight,
    },
  };
}

interface Actor {
  /** `hero-0`..`hero-7`, `rat`, `gnoll`, `crab`, `boss`. */
  texture: string;
  x: number;
  y: number;
  /** desenha o anel branco sob os pés (o cliente só o põe no seu herói). */
  ring?: boolean;
}

/** Anel elíptico sob o herói — GameScene: ellipse(0, 14, 26, 10), branco 0.85. */
function drawRing(dst: Canvas, cx: number, cy: number): void {
  const rx = 13;
  const ry = 5;
  for (let a = 0; a < 360; a += 3) {
    const t = (a * Math.PI) / 180;
    const px = Math.round(cx + Math.cos(t) * rx);
    const py = Math.round(cy + 14 + Math.sin(t) * ry);
    if (px < 0 || py < 0 || px >= dst.w || py >= dst.h) continue;
    const di = (py * dst.w + px) * 4;
    for (let c = 0; c < 3; c++) {
      dst.data[di + c] = Math.round(255 * 0.85 + dst.data[di + c] * 0.15);
    }
  }
}

// ── cena ────────────────────────────────────────────────────────────
interface Scene {
  level: Level;
  /** centro da câmera, em tiles. */
  center: Vec2;
  actors: Actor[];
  /** origens de FOV que compõem o mapa já descoberto. */
  explored: Vec2[];
  /** raio (em tiles, a partir do centro) já revelado — enche o quadro de masmorra. */
  exploredRadius?: number;
  /** de onde sai o campo de visão iluminado agora. */
  eye: Vec2;
  outW: number;
  outH: number;
}

function render(scene: Scene): Canvas {
  const { level, center, outW, outH } = scene;
  const grid = level.grid;
  const worldW = Math.ceil(outW / ZOOM);
  const worldH = Math.ceil(outH / ZOOM);
  const originX = Math.round(center.x * TILE_PX + TILE_PX / 2 - worldW / 2);
  const originY = Math.round(center.y * TILE_PX + TILE_PX / 2 - worldH / 2);

  const visible = computeFov(grid, scene.eye);
  const discovered = new Set<number>(visible);
  for (const p of scene.explored) for (const i of computeFov(grid, p)) discovered.add(i);
  const r = scene.exploredRadius ?? 0;
  for (let y = center.y - r; y <= center.y + r; y++) {
    for (let x = center.x - r; x <= center.x + r; x++) {
      if (grid.inBounds(x, y)) discovered.add(y * grid.width + x);
    }
  }

  const img = canvas(worldW, worldH);

  // 1. tiles — nunca descoberto não desenha nada (fica o fundo #0b0a10)
  const t0 = Math.max(0, Math.floor(originY / TILE_PX));
  const t1 = Math.min(grid.height - 1, Math.ceil((originY + worldH) / TILE_PX));
  const l0 = Math.max(0, Math.floor(originX / TILE_PX));
  const l1 = Math.min(grid.width - 1, Math.ceil((originX + worldW) / TILE_PX));
  for (let ty = t0; ty <= t1; ty++) {
    for (let tx = l0; tx <= l1; tx++) {
      const i = ty * grid.width + tx;
      if (!discovered.has(i)) continue;
      const names = TILE_TEXTURES[grid.tiles[i]] ?? TILE_TEXTURES[TileType.Floor];
      const name = names[hashSeed(`tile:${i}`) % names.length];
      blit(
        img,
        loadPng(join(ASSETS, `tiles/${name}.png`)),
        tx * TILE_PX - originX,
        ty * TILE_PX - originY,
        undefined,
        visible.has(i) ? undefined : FOG,
      );
    }
  }

  // 2. atores dentro do campo de visão, do fundo para a frente
  for (const actor of [...scene.actors].sort((a, b) => a.y - b.y)) {
    if (!visible.has(actor.y * grid.width + actor.x)) continue;
    const { img: sheet, rect } = restFrame(actor.texture);
    const cx = actor.x * TILE_PX + TILE_PX / 2 - originX;
    const cy = actor.y * TILE_PX + TILE_PX / 2 - originY;
    if (actor.ring) drawRing(img, cx, cy);
    blit(img, sheet, Math.round(cx - rect.w / 2), Math.round(cy - rect.h / 2), rect);
  }

  return upscale(img, ZOOM);
}

// ── ajudantes de composição ─────────────────────────────────────────
function floorsAround(level: Level, from: Vec2, radius: number): Vec2[] {
  const out: Vec2[] = [];
  const g = level.grid;
  for (let y = from.y - radius; y <= from.y + radius; y++) {
    for (let x = from.x - radius; x <= from.x + radius; x++) {
      if (!g.inBounds(x, y)) continue;
      const t = g.get(x, y);
      if (t === TileType.Floor || t === TileType.Grass) out.push({ x, y });
    }
  }
  return out.sort(
    (a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y),
  );
}

/** Caminho curto (BFS 4-direções) para simular por onde o grupo já passou. */
function trail(level: Level, from: Vec2, to: Vec2): Vec2[] {
  const g = level.grid;
  const prev = new Map<number, number>();
  const queue = [from.y * g.width + from.x];
  const seen = new Set(queue);
  const goal = to.y * g.width + to.x;
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === goal) break;
    const cx = cur % g.width;
    const cy = Math.floor(cur / g.width);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!g.inBounds(nx, ny) || !isPassable(g.get(nx, ny))) continue;
      const ni = ny * g.width + nx;
      if (seen.has(ni)) continue;
      seen.add(ni);
      prev.set(ni, cur);
      queue.push(ni);
    }
  }
  const path: Vec2[] = [];
  for (let cur: number | undefined = goal; cur !== undefined; cur = prev.get(cur)) {
    path.push({ x: cur % g.width, y: Math.floor(cur / g.width) });
    if (cur === from.y * g.width + from.x) break;
  }
  return path.reverse();
}

function main(): void {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const outDir = values.out ?? join(ROOT, "tools/site/out");
  console.log("renderizando a vitrine a partir do jogo:");

  // ── capa: a sala grande do andar 2, o grupo reunido e a masmorra em volta
  const capa = generateLevel(20260719, 2);
  const salao = [...capa.rooms].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const centro = rectCenter(salao);
  const vagas = floorsAround(capa, centro, 5);
  save(
    render({
      level: capa,
      center: centro,
      eye: centro,
      explored: trail(capa, capa.stairsUp, centro).filter((_, i) => i % 3 === 0),
      exploredRadius: 12,
      actors: [
        { texture: "hero-0", x: centro.x, y: centro.y, ring: true },
        { texture: "hero-1", x: vagas[3].x, y: vagas[3].y },
        { texture: "hero-2", x: vagas[6].x, y: vagas[6].y },
        { texture: "hero-3", x: vagas[9].x, y: vagas[9].y },
        { texture: "rat", x: vagas[14].x, y: vagas[14].y },
        { texture: "gnoll", x: vagas[19].x, y: vagas[19].y },
      ],
      outW: 1280,
      outH: 720,
    }),
    join(outDir, "covers/shattered-dominion-pixel-dungeon.png"),
  );

  // ── shot 1: exploração solo, com o mapa já andado escurecido pelo fog
  const solo = generateLevel(20260719, 1);
  const trilha = trail(solo, solo.stairsUp, solo.stairsDown);
  const olho = trilha[Math.floor(trilha.length * 0.45)];
  save(
    render({
      level: solo,
      center: olho,
      eye: olho,
      explored: trilha.slice(0, Math.floor(trilha.length * 0.45)).filter((_, i) => i % 2 === 0),
      actors: [{ texture: "hero-0", x: olho.x, y: olho.y, ring: true }],
      outW: 960,
      outH: 540,
    }),
    join(outDir, "shots/shattered-dominion-pixel-dungeon-1.png"),
  );

  // ── shot 2: grupo cercado — as três criaturas dos andares comuns
  const briga = generateLevel(777, 3);
  const arena = [...briga.rooms].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const meio = rectCenter(arena);
  const lugares = floorsAround(briga, meio, 5);
  save(
    render({
      level: briga,
      center: meio,
      eye: meio,
      explored: trail(briga, briga.stairsUp, meio).filter((_, i) => i % 3 === 0),
      exploredRadius: 9,
      actors: [
        { texture: "hero-4", x: meio.x, y: meio.y, ring: true },
        { texture: "hero-5", x: lugares[2].x, y: lugares[2].y },
        { texture: "hero-6", x: lugares[5].x, y: lugares[5].y },
        { texture: "rat", x: lugares[8].x, y: lugares[8].y },
        { texture: "crab", x: lugares[12].x, y: lugares[12].y },
        { texture: "gnoll", x: lugares[16].x, y: lugares[16].y },
      ],
      outW: 960,
      outH: 540,
    }),
    join(outDir, "shots/shattered-dominion-pixel-dungeon-2.png"),
  );

  // ── shot 3: a arena do andar 5, com o Amálgama de Lodo no centro
  const boss = generateLevel(4242, 5);
  const covil = boss.bossSpawn ?? { x: 16, y: 12 };
  const flancos = floorsAround(boss, covil, 3).filter(
    (p) => Math.hypot(p.x - covil.x, p.y - covil.y) >= 1.5,
  );
  save(
    render({
      level: boss,
      center: { x: covil.x, y: covil.y + 1 },
      eye: covil,
      explored: [covil, { x: covil.x, y: covil.y + 6 }, { x: covil.x, y: covil.y + 10 }],
      exploredRadius: 9,
      actors: [
        { texture: "boss", x: covil.x, y: covil.y },
        { texture: "hero-0", x: flancos[0].x, y: flancos[0].y, ring: true },
        { texture: "hero-2", x: flancos[3].x, y: flancos[3].y },
        { texture: "hero-7", x: flancos[6].x, y: flancos[6].y },
      ],
      outW: 960,
      outH: 540,
    }),
    join(outDir, "shots/shattered-dominion-pixel-dungeon-3.png"),
  );
}

main();
