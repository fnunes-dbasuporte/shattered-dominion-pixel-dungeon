import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // Em produção o jogo vive em /shattered-dominion/ no site da vitrine;
  // no dev server continua na raiz.
  base: command === "build" ? "/shattered-dominion/" : "/",
  server: {
    port: 5173,
    proxy: {
      // Matchmaking HTTP e upgrade de WebSocket do Colyseus passam pelo
      // mesmo prefixo — em produção o nginx faz o papel deste proxy.
      "/colyseus": {
        target: "http://localhost:2567",
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ""),
      },
    },
  },
}));
