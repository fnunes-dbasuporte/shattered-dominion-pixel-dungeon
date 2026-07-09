/**
 * Build de produção do servidor: bundle ÚNICO via esbuild.
 *
 * Por que bundle: a VM de produção tem ~666 MiB de RAM livre e o deploy
 * é "build fora da VM" — um arquivo só (dist-prod/server.mjs) dispensa
 * node_modules e pnpm no host. bufferutil/utf-8-validate ficam externos:
 * são aceleradores OPCIONAIS do ws (require em try/catch — sem eles o
 * fallback JS assume).
 *
 * Pré-requisito: `pnpm --filter @shattered-dominion/shared build`
 * (o pacote shared exporta de dist/).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist-prod/server.mjs",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // deps CJS (express/colyseus) precisam de require() no bundle ESM
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  external: ["bufferutil", "utf-8-validate"],
  sourcemap: false,
  minify: false, // legível para depurar na VM; tamanho não é o gargalo
  logLevel: "info",
});
