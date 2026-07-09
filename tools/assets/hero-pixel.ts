/**
 * Guerreiro artesanal, pixel a pixel — reprodução fiel do design aprovado
 * pelo Felipe ("v3 B"): cabelo grisalho volumoso com franja, rosto tan,
 * túnica caramelo, manto escuro nos ombros, detalhes teal na cintura
 * (alvo do recolor), pernas curtas. Paleta chapada, contorno 1px,
 * idle ESTÁTICO (sem cintilação), walk de 2 poses + bob de 1px.
 *
 * Gera assets/sprites/hero.png (+ hero-0..7.png recoloridos) e hero.json
 * no mesmo formato do compose.ts. Uso: pnpm assets:hero
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const ROOT = join(import.meta.dirname, "..", "..");
const OUT_DIR = join(ROOT, "packages", "client", "public", "assets", "sprites");

/** Canvas por frame — igual ao dos demais personagens (CHAR_CANVAS). */
const CANVAS = 28;
const GRID = 16;

// ── paleta (chapada, cores lidas do v3 B) ────────────────────────────
const PAL: Record<string, [number, number, number, number]> = {
  ".": [0, 0, 0, 0], // transparente
  o: [12, 11, 16, 255], // contorno
  h: [104, 102, 124, 255], // cabelo grisalho
  H: [60, 58, 78, 255], // cabelo grisalho sombra
  s: [235, 195, 152, 255], // pele
  S: [204, 152, 106, 255], // pele sombra
  e: [24, 20, 30, 255], // olho
  t: [196, 132, 66, 255], // túnica caramelo
  T: [152, 98, 48, 255], // túnica sombra
  d: [82, 58, 46, 255], // manto/ombreiras escuras
  c: [63, 167, 160, 255], // pano teal (alvo do recolor)
  b: [52, 40, 32, 255], // botas
  m: [186, 196, 206, 255], // lâmina
  M: [124, 134, 146, 255], // lâmina sombra
  g: [110, 86, 56, 255], // punho/cabo
};

type Frame = string[];

/** Valida que todo frame é um grid 16×16 exato. */
function checked(name: string, rows: string[]): Frame {
  if (rows.length !== GRID) throw new Error(`${name}: ${rows.length} linhas (esperado ${GRID})`);
  rows.forEach((row, i) => {
    if (row.length !== GRID)
      throw new Error(`${name} linha ${i}: ${row.length} colunas — "${row}"`);
    for (const ch of row) if (!(ch in PAL)) throw new Error(`${name} linha ${i}: char "${ch}"`);
  });
  return rows;
}

// ── SUL (de frente) ─────────────────────────────────────────────────
const SOUTH_BASE = checked("south", [
  "................",
  ".....oooooo.....",
  "....ohhHhhho....",
  "..oohhhhhhhhoo..",
  "..ohHhhHhhHhho..",
  "..ohhsssssshho..",
  "..ohsessssesho..",
  "..ohssssssssho..",
  "...oSssssssSo...",
  ".oddttttttttddo.",
  "..odttttttttdo..",
  "..octtttttttco..",
  "...odttttttdo...",
  "....obb..bbo....",
  "....obb..bbo....",
  "....ooo..ooo....",
]);

const SOUTH_STRIDE = checked("south-stride", [
  "................",
  ".....oooooo.....",
  "....ohhHhhho....",
  "..oohhhhhhhhoo..",
  "..ohHhhHhhHhho..",
  "..ohhsssssshho..",
  "..ohsessssesho..",
  "..ohssssssssho..",
  "...oSssssssSo...",
  ".oddttttttttddo.",
  "..odttttttttdo..",
  "..octtttttttco..",
  "...odttttttdo...",
  "...obb....bbo...",
  "...obb....bbo...",
  "...ooo....ooo...",
]);

const SOUTH_ATK_A = checked("south-atk-a", [
  "................",
  ".....oooooo..m..",
  "....ohhHhhho.m..",
  "..oohhhhhhhhoM..",
  "..ohHhhHhhHhho..",
  "..ohhsssssshho..",
  "..ohsessssesho..",
  "..ohssssssssho..",
  "...oSssssssSo...",
  ".oddttttttttddg.",
  "..odttttttttdo..",
  "..octtttttttco..",
  "...odttttttdo...",
  "....obb..bbo....",
  "....obb..bbo....",
  "....ooo..ooo....",
]);

const SOUTH_ATK_B = checked("south-atk-b", [
  "................",
  ".....oooooo.....",
  "....ohhHhhho....",
  "..oohhhhhhhhoo..",
  "..ohHhhHhhHhho..",
  "..ohhsssssshho..",
  "..ohsessssesho..",
  "..ohssssssssho..",
  "...oSssssssSo...",
  ".oddttttttttddo.",
  "..odttttttttdo..",
  "..octtttttttcgmM",
  "...odttttttdo...",
  "....obb..bbo....",
  "....obb..bbo....",
  "....ooo..ooo....",
]);

const SOUTH_DEATH_A = checked("south-death-a", [
  "................",
  "................",
  "................",
  ".....oooooo.....",
  "....ohhhhhho....",
  "...ohhhhhhhho...",
  "..ohhHhhhhHhho..",
  "..ohsessssesho..",
  "...osssssssso...",
  "....oSssssSo....",
  "...odttttttdo...",
  "..octtttttttco..",
  "...odttttttdo...",
  "....obo..obo....",
  "................",
  "................",
]);

const SOUTH_DEATH_B = checked("south-death-b", [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "..oooooooo......",
  ".ohhhhssssoooo..",
  ".ohHseesstttco..",
  ".ohhhsssstttco..",
  "..oooooooooooo..",
  "................",
]);

// ── NORTE (de costas — bola de cabelo, teal na cintura) ─────────────
const NORTH_BASE = checked("north", [
  "................",
  ".....oooooo.....",
  "....ohhhhhho....",
  "...ohhhhhhhho...",
  "..ohhhhHhhhhho..",
  "..ohHhhhhhHhho..",
  "..ohhhHhhhhhho..",
  "...oHhhhhhhHo...",
  "....ohhhhhho....",
  ".oddttttttttddo.",
  "..odttttttttdo..",
  "..octtttttttco..",
  "...odttttttdo...",
  "....obb..bbo....",
  "....obb..bbo....",
  "....ooo..ooo....",
]);

const NORTH_STRIDE = checked("north-stride", [
  "................",
  ".....oooooo.....",
  "....ohhhhhho....",
  "...ohhhhhhhho...",
  "..ohhhhHhhhhho..",
  "..ohHhhhhhHhho..",
  "..ohhhHhhhhhho..",
  "...oHhhhhhhHo...",
  "....ohhhhhho....",
  ".oddttttttttddo.",
  "..odttttttttdo..",
  "..octtttttttco..",
  "...odttttttdo...",
  "...obb....bbo...",
  "...obb....bbo...",
  "...ooo....ooo...",
]);

const NORTH_ATK_A = checked("north-atk-a", [
  "................",
  ".....oooooo..m..",
  "....ohhhhhho.m..",
  "...ohhhhhhhhoM..",
  "..ohhhhHhhhhho..",
  "..ohHhhhhhHhho..",
  "..ohhhHhhhhhho..",
  "...oHhhhhhhHo...",
  "....ohhhhhho....",
  ".oddttttttttddg.",
  "..odttttttttdo..",
  "..octtttttttco..",
  "...odttttttdo...",
  "....obb..bbo....",
  "....obb..bbo....",
  "....ooo..ooo....",
]);

const NORTH_ATK_B = checked("north-atk-b", [
  "................",
  ".....oooooo.....",
  "....ohhhhhho....",
  "...ohhhhhhhho...",
  "..ohhhhHhhhhho..",
  "..ohHhhhhhHhho..",
  "..ohhhHhhhhhho..",
  "...oHhhhhhhHo...",
  "....ohhhhhho....",
  ".oddttttttttddo.",
  "..odttttttttdo..",
  "..octtttttttcgmM",
  "...odttttttdo...",
  "....obb..bbo....",
  "....obb..bbo....",
  "....ooo..ooo....",
]);

// ── LESTE (perfil direito — cabelo atrás, rosto à frente) ───────────
const EAST_BASE = checked("east", [
  "................",
  ".....ooooo......",
  "....ohhhhho.....",
  "...ohhhhhhho....",
  "..ohhHhhhhsso...",
  "..ohhhhhsseso...",
  "..ohHhhhsssso...",
  "...oHhhhSssSo...",
  "....ohhhosso....",
  "....oddtttto....",
  "....odttttco....",
  "....odttttgo....",
  ".....odtto......",
  ".....obb.bbo....",
  ".....obb.bbo....",
  ".....ooo.ooo....",
]);

const EAST_STRIDE = checked("east-stride", [
  "................",
  ".....ooooo......",
  "....ohhhhho.....",
  "...ohhhhhhho....",
  "..ohhHhhhhsso...",
  "..ohhhhhsseso...",
  "..ohHhhhsssso...",
  "...oHhhhSssSo...",
  "....ohhhosso....",
  "....oddtttto....",
  "....odttttco....",
  "....odttttgo....",
  ".....odtto......",
  "....obb...bbo...",
  "....obb...bbo...",
  "....ooo...ooo...",
]);

const EAST_ATK_A = checked("east-atk-a", [
  "................",
  ".....ooooo..m...",
  "....ohhhhho.m...",
  "...ohhhhhhhoM...",
  "..ohhHhhhhsso...",
  "..ohhhhhsseso...",
  "..ohHhhhsssso...",
  "...oHhhhSssSo...",
  "....ohhhosso....",
  "....oddttttog...",
  "....odttttco....",
  "....odttttgo....",
  ".....odtto......",
  ".....obb.bbo....",
  ".....obb.bbo....",
  ".....ooo.ooo....",
]);

const EAST_ATK_B = checked("east-atk-b", [
  "................",
  ".....ooooo......",
  "....ohhhhho.....",
  "...ohhhhhhho....",
  "..ohhHhhhhsso...",
  "..ohhhhhsseso...",
  "..ohHhhhsssso...",
  "...oHhhhSssSo...",
  "....ohhhosso....",
  "....oddtttto....",
  "....odttttgmmmM.",
  "....odttttco....",
  ".....odtto......",
  ".....obb.bbo....",
  ".....obb.bbo....",
  ".....ooo.ooo....",
]);

const DIRECTIONS = ["south", "east", "north", "west"] as const;
type Dir = (typeof DIRECTIONS)[number];

interface AnimSet {
  still: Frame;
  walk: Frame[];
  idle: Frame[];
  attack: Frame[];
  death: Frame[];
}

const mirror = (f: Frame): Frame => f.map((row) => [...row].reverse().join(""));
const mirrorAll = (fs: Frame[]): Frame[] => fs.map(mirror);

const SETS: Record<Dir, AnimSet> = {
  south: {
    still: SOUTH_BASE,
    walk: [SOUTH_STRIDE, SOUTH_BASE, SOUTH_STRIDE, SOUTH_BASE],
    idle: [SOUTH_BASE], // estático — sem cintilação
    attack: [SOUTH_ATK_A, SOUTH_ATK_B],
    death: [SOUTH_DEATH_A, SOUTH_DEATH_B],
  },
  north: {
    still: NORTH_BASE,
    walk: [NORTH_STRIDE, NORTH_BASE, NORTH_STRIDE, NORTH_BASE],
    idle: [NORTH_BASE],
    attack: [NORTH_ATK_A, NORTH_ATK_B],
    death: [SOUTH_DEATH_A, SOUTH_DEATH_B],
  },
  east: {
    still: EAST_BASE,
    walk: [EAST_STRIDE, EAST_BASE, EAST_STRIDE, EAST_BASE],
    idle: [EAST_BASE],
    attack: [EAST_ATK_A, EAST_ATK_B],
    death: [SOUTH_DEATH_A, SOUTH_DEATH_B],
  },
  west: {
    still: mirror(EAST_BASE),
    walk: mirrorAll([EAST_STRIDE, EAST_BASE, EAST_STRIDE, EAST_BASE]),
    idle: [mirror(EAST_BASE)],
    attack: mirrorAll([EAST_ATK_A, EAST_ATK_B]),
    death: [SOUTH_DEATH_A, SOUTH_DEATH_B],
  },
};

// ── render ───────────────────────────────────────────────────────────

function drawFrame(sheet: PNG, frame: Frame, col: number, row: number, bobY = 0): void {
  const offX = Math.floor((CANVAS - GRID) / 2);
  const offY = Math.floor((CANVAS - GRID) / 2) + 2 + bobY; // pés ~perto da base
  for (let y = 0; y < frame.length; y++) {
    for (let x = 0; x < frame[y].length; x++) {
      const rgba = PAL[frame[y][x]];
      if (!rgba || rgba[3] === 0) continue;
      const px = col * CANVAS + offX + x;
      const py = row * CANVAS + offY + y;
      const i = (py * sheet.width + px) * 4;
      sheet.data[i] = rgba[0];
      sheet.data[i + 1] = rgba[1];
      sheet.data[i + 2] = rgba[2];
      sheet.data[i + 3] = rgba[3];
    }
  }
}

interface RowSpec {
  name: string;
  frames: Frame[];
  /** bob vertical por frame (walk sobe 1px nas poses de passada). */
  bob?: number[];
}

export function generateHeroSheet(): void {
  const rows: RowSpec[] = [];
  for (const dir of DIRECTIONS) rows.push({ name: `still-${dir}`, frames: [SETS[dir].still] });
  for (const dir of DIRECTIONS)
    rows.push({ name: `walk-${dir}`, frames: SETS[dir].walk, bob: [-1, 0, -1, 0] });
  for (const dir of DIRECTIONS) rows.push({ name: `idle-${dir}`, frames: SETS[dir].idle });
  for (const dir of DIRECTIONS) rows.push({ name: `attack-${dir}`, frames: SETS[dir].attack });
  for (const dir of DIRECTIONS) rows.push({ name: `death-${dir}`, frames: SETS[dir].death });

  const columns = Math.max(...rows.map((r) => r.frames.length));
  const sheet = new PNG({ width: columns * CANVAS, height: rows.length * CANVAS });
  const meta = {
    frameWidth: CANVAS,
    frameHeight: CANVAS,
    columns,
    rows: {} as Record<string, { row: number; count: number }>,
  };

  rows.forEach((spec, r) => {
    meta.rows[spec.name] = { row: r, count: spec.frames.length };
    spec.frames.forEach((frame, c) => drawFrame(sheet, frame, c, r, spec.bob?.[c] ?? 0));
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "hero.png"), PNG.sync.write(sheet));
  writeFileSync(join(OUT_DIR, "hero.json"), JSON.stringify(meta, null, 2));

  // recolor: troca o teal (c) pelo matiz de cada jogador
  const HUES = [4, 207, 127, 45, 277, 171, 24, 324];
  for (let v = 0; v < HUES.length; v++) {
    const out = new PNG({ width: sheet.width, height: sheet.height });
    sheet.data.copy(out.data);
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] === 0) continue;
      const [h, s, l] = rgbToHsl(out.data[i], out.data[i + 1], out.data[i + 2]);
      if (s < 0.2 || h < 140 || h > 230) continue;
      const [r, g, b] = hslToRgb(HUES[v], Math.max(s, 0.55), l);
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
    }
    writeFileSync(join(OUT_DIR, `hero-${v}.png`), PNG.sync.write(out));
  }
  console.log(`herói artesanal (design v3 B): ${rows.length} linhas × ${columns} + 8 recolors`);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ];
}

generateHeroSheet();
