/**
 * Visualizador estático do gerador de dungeon.
 * Uso: pnpm viz --seed 123 --depth 1 [--out caminho.html]
 * Gera tools/viz/out.html (HTML puro, sem servidor) para inspeção manual.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  TileType,
  RoomType,
  generateLevel,
  levelFingerprint,
  rectCenter,
  type Level,
} from "../../packages/shared/src/index.js";

function main(): void {
  const { values } = parseArgs({
    options: {
      seed: { type: "string", default: "1" },
      depth: { type: "string", default: "1" },
      out: { type: "string" },
    },
  });

  const seed = Number(values.seed);
  const depth = Number(values.depth);
  if (!Number.isInteger(seed) || !Number.isInteger(depth) || depth < 1) {
    console.error("Uso: pnpm viz --seed <inteiro> --depth <inteiro ≥1>");
    process.exit(1);
  }

  const level = generateLevel(seed, depth);
  const outPath = values.out ?? join(import.meta.dirname, "out.html");
  writeFileSync(outPath, renderHtml(level), "utf8");

  console.log(
    `mapa seed=${seed} depth=${depth} → ${outPath}\n` +
      `salas=${level.rooms.length} fingerprint=0x${levelFingerprint(level).toString(16)}`,
  );
}

// ── renderização ─────────────────────────────────────────────────────

const TILE_COLORS: Record<TileType, string> = {
  [TileType.Wall]: "#241f33",
  [TileType.Floor]: "#5c5570",
  [TileType.Door]: "#c9a227",
  [TileType.StairsUp]: "#4da3e8",
  [TileType.StairsDown]: "#e8554d",
  [TileType.Water]: "#3a6ea5",
  [TileType.Grass]: "#4e9a51",
  [TileType.Embers]: "#b3542e",
};

const TILE_NAMES: Record<TileType, string> = {
  [TileType.Wall]: "parede",
  [TileType.Floor]: "piso",
  [TileType.Door]: "porta",
  [TileType.StairsUp]: "escada ↑",
  [TileType.StairsDown]: "escada ↓",
  [TileType.Water]: "água",
  [TileType.Grass]: "grama",
  [TileType.Embers]: "brasas",
};

function renderHtml(lvl: Level): string {
  const spawnSet = new Set(lvl.spawnPoints.map((p) => lvl.grid.index(p.x, p.y)));
  const treasureCenters = new Map(
    lvl.rooms
      .filter((r) => r.type === RoomType.Treasure)
      .map((r) => {
        const c = rectCenter(r);
        return [lvl.grid.index(c.x, c.y), "T"] as const;
      }),
  );

  const cells: string[] = [];
  for (let y = 0; y < lvl.height; y++) {
    for (let x = 0; x < lvl.width; x++) {
      const i = lvl.grid.index(x, y);
      const tile = lvl.grid.get(x, y);
      let marker = "";
      if (tile === TileType.StairsUp) marker = "▲";
      else if (tile === TileType.StairsDown) marker = "▼";
      else if (spawnSet.has(i)) marker = "•";
      else if (treasureCenters.has(i)) marker = "T";
      cells.push(
        `<div class="c" style="background:${TILE_COLORS[tile]}" ` +
          `title="(${x},${y}) ${TILE_NAMES[tile]}">${marker}</div>`,
      );
    }
  }

  const legend = (Object.keys(TILE_COLORS) as unknown as TileType[])
    .filter((t) => TILE_NAMES[t] !== undefined)
    .map(
      (t) =>
        `<span class="l"><span class="sw" style="background:${TILE_COLORS[t]}"></span>` +
        `${TILE_NAMES[t]}</span>`,
    )
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Dungeon seed=${lvl.seed} depth=${lvl.depth}</title>
<style>
  body { background:#0b0a10; color:#e8e6f0; font-family:monospace; padding:24px; }
  h1 { font-size:16px; }
  .grid { display:grid; grid-template-columns:repeat(${lvl.width}, 22px); gap:1px; width:fit-content; }
  .c { width:22px; height:22px; display:flex; align-items:center; justify-content:center;
       font-size:13px; color:#0b0a10; font-weight:bold; }
  .legend { margin:16px 0; display:flex; gap:16px; flex-wrap:wrap; font-size:13px; }
  .l { display:flex; align-items:center; gap:6px; }
  .sw { width:14px; height:14px; display:inline-block; border:1px solid #444; }
  .info { color:#9a96ad; font-size:13px; }
</style>
</head>
<body>
<h1>Shattered Dominion — seed ${lvl.seed} · andar ${lvl.depth}</h1>
<p class="info">${lvl.rooms.length} salas · fingerprint 0x${levelFingerprint(lvl).toString(16)} ·
▲ subida · ▼ descida · • spawn · T sala de tesouro</p>
<div class="legend">${legend}</div>
<div class="grid">${cells.join("")}</div>
</body>
</html>
`;
}

main();
