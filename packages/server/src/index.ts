import { GAME_NAME } from "@shattered-dominion/shared";
import { createGameServer } from "./app.js";

const port = Number(process.env.PORT ?? 2567);
// Em produção o bind DEVE ser 127.0.0.1 (atrás do nginx) — configurar via .env.
const host = process.env.HOST ?? "localhost";

const server = createGameServer();
await server.listen(port, host);

console.log(`[server] ${GAME_NAME} — ws://${host}:${port} · health: http://${host}:${port}/health`);
