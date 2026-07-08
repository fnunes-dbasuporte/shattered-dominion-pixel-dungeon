import { runLobby } from "./ui/lobby.js";

async function main(): Promise<void> {
  const { conn, started } = await runLobby();
  // A cena de jogo (Phaser) entra na próxima tarefa da sprint.
  console.log("[client] partida iniciada", started, "sessão:", conn.sessionId);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (app) app.textContent = "Partida iniciada — renderização chega na próxima tarefa.";
}

void main();
