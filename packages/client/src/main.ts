import Phaser from "phaser";
import { runLobby } from "./ui/lobby.js";
import type { GameSceneData } from "./game/GameScene.js";
import { WalkableGameScene } from "./game/WalkableGameScene.js";

async function main(): Promise<void> {
  const { conn, started } = await runLobby();

  const data: GameSceneData = { conn, started };
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
