/**
 * Baixa os assets do manifest para packages/client/public/assets/.
 * Uso: pnpm assets:gen [--only <id>] [--force]
 * Cache: arquivos existentes não são baixados de novo (salvo --force).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { composeCharacter, type CharacterEntry } from "./compose.js";

interface AssetFile {
  url: string;
  out: string;
}

interface AssetEntry {
  id: string;
  kind: string;
  pixellabId: string;
  prompt: string;
  files: AssetFile[];
}

interface Manifest {
  version: number;
  assets: AssetEntry[];
  characters: CharacterEntry[];
}

const ROOT = join(import.meta.dirname, "..", "..");
const OUT_DIR = join(ROOT, "packages", "client", "public", "assets");
const MANIFEST = join(import.meta.dirname, "manifest.json");

async function main(): Promise<void> {
  const only = flagValue("--only");
  const force = process.argv.includes("--force");
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;

  let baixados = 0;
  let pulados = 0;
  for (const asset of manifest.assets) {
    if (only && asset.id !== only) continue;
    for (const file of asset.files) {
      const dest = join(OUT_DIR, file.out);
      if (existsSync(dest) && !force) {
        pulados++;
        continue;
      }
      mkdirSync(dirname(dest), { recursive: true });
      const res = await fetch(file.url);
      if (!res.ok) {
        throw new Error(`falha ao baixar ${asset.id}/${file.out}: HTTP ${res.status}`);
      }
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      console.log(`baixado  ${asset.id} → assets/${file.out}`);
      baixados++;
    }
  }
  for (const character of manifest.characters ?? []) {
    if (only && character.id !== only) continue;
    await composeCharacter(character, force);
  }

  console.log(`\n${baixados} baixado(s), ${pulados} em cache. Destino: ${OUT_DIR}`);
}

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
