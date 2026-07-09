/**
 * Compõe spritesheets de personagens a partir do ZIP de download do
 * Pixellab (rotations/ + animations/<pasta>/<direção>/frame_NNN.png) e gera
 * o meta JSON consumido pelo Phaser.
 *
 * Layout da sheet: uma linha por (animação, direção); `columns` = maior
 * contagem de frames; frame index = linha*columns + coluna. As 4 primeiras
 * linhas são as rotações paradas (still-south/east/north/west).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import { unzipSync } from "fflate";

export interface CharacterEntry {
  id: string;
  pixellabId: string;
  prompt: string;
  /** canvas padrão dos frames (personagens 16px → 24). */
  canvas: number;
  out: string;
  zip: string;
  /** pasta de animação no zip → nome canônico (walk/idle/attack/death). */
  animMap: Record<string, string>;
  /** gera 8 variações de cor re-matizadas (paleta dos jogadores). */
  recolor?: boolean;
  /** upscale inteiro (nearest) aplicado a cada frame antes de compor. */
  scale?: number;
}

interface ZipMetadata {
  states: {
    folder: string;
    frames: {
      rotations: Record<string, string>;
      animations: Record<string, Record<string, string[]>>;
    };
  }[];
}

interface SheetMeta {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: Record<string, { row: number; count: number }>;
}

const ROOT = join(import.meta.dirname, "..", "..");
const OUT_DIR = join(ROOT, "packages", "client", "public", "assets");

const DIRECTION_ORDER = ["south", "east", "north", "west"];

/** Paleta dos jogadores (mesma de PLAYER_COLORS no shared) — alvo do recolor. */
const PLAYER_HUES = [4, 207, 127, 45, 277, 171, 24, 324];

export async function composeCharacter(entry: CharacterEntry, force: boolean): Promise<void> {
  const sheetPath = join(OUT_DIR, entry.out);
  const metaPath = sheetPath.replace(/\.png$/, ".json");
  if (existsSync(sheetPath) && existsSync(metaPath) && !force) {
    console.log(`cache    ${entry.id}`);
    return;
  }

  const res = await fetch(entry.zip);
  if (!res.ok) throw new Error(`${entry.id}: HTTP ${res.status} ao baixar zip`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 2).toString() !== "PK") {
    throw new Error(`${entry.id}: resposta não é zip — ${buf.subarray(0, 120).toString()}`);
  }
  const files = unzipSync(new Uint8Array(buf));
  const metadata = JSON.parse(Buffer.from(files["metadata.json"]).toString("utf8")) as ZipMetadata;
  const frames = metadata.states[0].frames;

  // linhas: rotações paradas primeiro, depois animações na ordem do animMap
  const rows: { name: string; paths: string[] }[] = [];
  for (const dir of DIRECTION_ORDER) {
    if (frames.rotations[dir]) rows.push({ name: `still-${dir}`, paths: [frames.rotations[dir]] });
  }
  for (const [folder, animName] of Object.entries(entry.animMap)) {
    const dirs = frames.animations[folder];
    if (!dirs) throw new Error(`${entry.id}: animação "${folder}" não está no zip`);
    for (const dir of DIRECTION_ORDER) {
      if (dirs[dir]) rows.push({ name: `${animName}-${dir}`, paths: [...dirs[dir]].sort() });
    }
  }

  const columns = Math.max(...rows.map((r) => r.paths.length));
  const size = entry.canvas;
  const sheet = new PNG({ width: columns * size, height: rows.length * size });

  const meta: SheetMeta = { frameWidth: size, frameHeight: size, columns, rows: {} };
  for (let r = 0; r < rows.length; r++) {
    meta.rows[rows[r].name] = { row: r, count: rows[r].paths.length };
    for (let c = 0; c < rows[r].paths.length; c++) {
      const data = files[rows[r].paths[c]];
      if (!data) throw new Error(`${entry.id}: ${rows[r].paths[c]} ausente no zip`);
      let frame = PNG.sync.read(Buffer.from(data));
      if (entry.scale && entry.scale > 1) frame = nearestScale(frame, entry.scale);
      if (frame.width > size || frame.height > size) {
        throw new Error(
          `${entry.id}/${rows[r].name}[${c}]: frame ${frame.width}x${frame.height} maior que o canvas ${size}`,
        );
      }
      const dx = Math.floor((size - frame.width) / 2);
      const dy = Math.floor((size - frame.height) / 2);
      PNG.bitblt(frame, sheet, 0, 0, frame.width, frame.height, c * size + dx, r * size + dy);
    }
  }

  mkdirSync(dirname(sheetPath), { recursive: true });
  writeFileSync(sheetPath, PNG.sync.write(sheet));
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`composto ${entry.id} → assets/${entry.out} (${rows.length} linhas × ${columns})`);

  if (entry.recolor) recolorSheet(entry, sheet, sheetPath);
}

/**
 * Recolor programático: re-matiza APENAS o pano teal do uniforme (matiz
 * 140–230°) para a cor de cada jogador — pele, couro e metal ficam como
 * estão. O sprite base foi gerado com faixa teal exatamente para servir
 * de máscara de cor.
 */
function recolorSheet(entry: CharacterEntry, base: PNG, sheetPath: string): void {
  for (let variant = 0; variant < PLAYER_HUES.length; variant++) {
    const out = new PNG({ width: base.width, height: base.height });
    base.data.copy(out.data);
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] === 0) continue;
      const [h, s, l] = rgbToHsl(out.data[i], out.data[i + 1], out.data[i + 2]);
      if (s < 0.2 || l < 0.1 || l > 0.95) continue; // neutros ficam
      if (h < 140 || h > 230) continue; // só o pano teal muda
      const [r, g, b] = hslToRgb(PLAYER_HUES[variant], Math.max(s, 0.55), l);
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
    }
    const variantPath = sheetPath.replace(/\.png$/, `-${variant}.png`);
    writeFileSync(variantPath, PNG.sync.write(out));
  }
  console.log(`recolor  ${entry.id} → 8 variações de cor`);
}

/** Upscale inteiro sem interpolação — preserva os pixels. */
function nearestScale(src: PNG, k: number): PNG {
  const out = new PNG({ width: src.width * k, height: src.height * k });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = ((Math.floor(y / k) * src.width + Math.floor(x / k)) * 4) | 0;
      const di = (y * out.width + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
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
