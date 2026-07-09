/**
 * Compõe spritesheets de personagens a partir dos frames individuais do
 * Pixellab (manifest.characters) e gera o meta JSON consumido pelo Phaser.
 *
 * Layout da sheet: uma linha por (animação, direção) na ordem do manifest,
 * `columns` = maior contagem de frames; frame index = linha*columns + coluna.
 * A primeira linha de cada direção sem animação é a rotação parada.
 *
 * Uso: pnpm assets:gen (chama download + compose) [--only <id>] [--force]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";

export interface CharacterEntry {
  id: string;
  pixellabId: string;
  prompt: string;
  canvas: number;
  out: string;
  rotations: Record<string, string>;
  animations: Record<string, Record<string, string[]>>;
  /** gera variações de cor re-matizadas (índices da paleta do jogo). */
  recolor?: boolean;
}

interface SheetMeta {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  /** nome "anim-dir" → { row, count } */
  rows: Record<string, { row: number; count: number }>;
}

const ROOT = join(import.meta.dirname, "..", "..");
const OUT_DIR = join(ROOT, "packages", "client", "public", "assets");

/** Paleta dos jogadores (mesma de PLAYER_COLORS no shared) — alvo do recolor. */
const PLAYER_HUES = [4, 207, 127, 45, 277, 171, 24, 324];

async function fetchPng(url: string): Promise<PNG> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return PNG.sync.read(Buffer.from(await res.arrayBuffer()));
}

export async function composeCharacter(entry: CharacterEntry, force: boolean): Promise<void> {
  const sheetPath = join(OUT_DIR, entry.out);
  const metaPath = sheetPath.replace(/\.png$/, ".json");
  if (existsSync(sheetPath) && existsSync(metaPath) && !force) {
    console.log(`cache    ${entry.id}`);
    return;
  }

  // monta a lista de linhas: rotações paradas primeiro, depois animações
  const rows: { name: string; urls: string[] }[] = [];
  for (const [dir, url] of Object.entries(entry.rotations)) {
    rows.push({ name: `still-${dir}`, urls: [url] });
  }
  for (const [anim, dirs] of Object.entries(entry.animations)) {
    for (const [dir, urls] of Object.entries(dirs)) {
      rows.push({ name: `${anim}-${dir}`, urls });
    }
  }

  const columns = Math.max(...rows.map((r) => r.urls.length));
  const size = entry.canvas;
  const sheet = new PNG({ width: columns * size, height: rows.length * size });

  const meta: SheetMeta = { frameWidth: size, frameHeight: size, columns, rows: {} };
  for (let r = 0; r < rows.length; r++) {
    meta.rows[rows[r].name] = { row: r, count: rows[r].urls.length };
    for (let c = 0; c < rows[r].urls.length; c++) {
      const frame = await fetchPng(rows[r].urls[c]);
      if (frame.width !== size || frame.height !== size) {
        throw new Error(
          `${entry.id}/${rows[r].name}[${c}]: frame ${frame.width}x${frame.height}, esperado ${size}`,
        );
      }
      PNG.bitblt(frame, sheet, 0, 0, size, size, c * size, r * size);
    }
  }

  mkdirSync(dirname(sheetPath), { recursive: true });
  writeFileSync(sheetPath, PNG.sync.write(sheet));
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`composto ${entry.id} → assets/${entry.out} (${rows.length} linhas × ${columns})`);

  if (entry.recolor) recolorSheet(entry, sheet, sheetPath);
}

/**
 * Recolor programático: re-matiza os pixels saturados (o pano/detalhes da
 * roupa) para o matiz de cada cor da paleta, preservando tons neutros
 * (pele, couro, metal — baixa saturação).
 */
function recolorSheet(entry: CharacterEntry, base: PNG, sheetPath: string): void {
  for (let variant = 0; variant < PLAYER_HUES.length; variant++) {
    const out = new PNG({ width: base.width, height: base.height });
    base.data.copy(out.data);
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] === 0) continue;
      const [, s, l] = rgbToHsl(out.data[i], out.data[i + 1], out.data[i + 2]);
      if (s < 0.25 || l < 0.12 || l > 0.92) continue; // neutros ficam
      const [r, g, b] = hslToRgb(PLAYER_HUES[variant], Math.max(s, 0.45), l);
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
    }
    const variantPath = sheetPath.replace(/\.png$/, `-${variant}.png`);
    writeFileSync(variantPath, PNG.sync.write(out));
  }
  console.log(`recolor  ${entry.id} → 8 variações de cor`);
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
