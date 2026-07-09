import Phaser from "phaser";
import { runLobby } from "./ui/lobby.js";
import { GameConnection } from "./net/connection.js";
import type { GameSceneData } from "./game/GameScene.js";
import { WalkableGameScene } from "./game/WalkableGameScene.js";

async function main(): Promise<void> {
  // F5/queda: tenta retomar a sessão desta aba antes de mostrar o lobby
  let data: GameSceneData;
  const retomada = await GameConnection.tryReconnect();
  if (retomada) {
    const ui = document.querySelector<HTMLDivElement>("#ui");
    if (ui) {
      ui.classList.remove("hidden");
      ui.innerHTML = `<div class="card"><h1>RECONECTANDO<small>retomando sua sessão...</small></h1></div>`;
    }
    const started = await retomada.waitForStart();
    if (ui) {
      ui.classList.add("hidden");
      ui.innerHTML = "";
    }
    data = { conn: retomada, started };
  } else {
    const { conn, started } = await runLobby();
    data = { conn, started };
  }
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    width: 960,
    height: 540,
    backgroundColor: "#0b0a10",
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
  game.scene.add("Game", WalkableGameScene, true, data);
}

void main();
