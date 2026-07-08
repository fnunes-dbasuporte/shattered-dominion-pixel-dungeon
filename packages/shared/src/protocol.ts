import { TICKS_PER_TIME_UNIT } from "./constants.js";
import type { MobKind } from "./mobs.js";

/** Nomes das mensagens cliente ⇄ servidor. */
export const MessageType = {
  /** cliente → servidor: intenção de movimento (8 direções). */
  Move: "move",
  /** cliente → servidor: host inicia a partida. */
  Start: "start",
  /** servidor → cliente: só o que ESTE jogador vê (anti-cheat de visão). */
  Vision: "vision",
  /** servidor → todos: partida começou (dimensões do andar; a seed é secreta). */
  MatchStarted: "matchStarted",
} as const;

export type GamePhase = "lobby" | "playing";

export interface MoveMessage {
  dx: number;
  dy: number;
}

export interface MatchStartedMessage {
  width: number;
  height: number;
  depth: number;
}

export type ActorKind = "player" | MobKind;

export interface VisibleActor {
  id: string;
  name: string;
  kind: ActorKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** duração do movimento em ticks — o cliente usa para interpolar. */
  moveTicks: number;
  /** mobs dormindo ganham indicador visual; sempre false para jogadores. */
  asleep: boolean;
}

/** Estado privado do próprio jogador — só ele recebe. */
export interface YouState {
  x: number;
  y: number;
  nextActionAt: number;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpToNext: number;
  alive: boolean;
}

/** Eventos de combate/progressão — cada jogador só recebe os que enxerga. */
export type GameEvent =
  | {
      type: "hit";
      attackerId: string;
      attackerName: string;
      targetId: string;
      targetName: string;
      x: number;
      y: number;
      damage: number;
    }
  | {
      type: "miss";
      attackerId: string;
      attackerName: string;
      targetId: string;
      targetName: string;
      x: number;
      y: number;
    }
  | { type: "death"; actorId: string; name: string; x: number; y: number }
  | { type: "levelup"; actorId: string; name: string; level: number; x: number; y: number }
  | { type: "revive"; actorId: string; name: string; x: number; y: number };

export interface VisionMessage {
  tick: number;
  you: YouState;
  /** índices dos tiles visíveis agora. */
  visible: number[];
  /** tiles recém-descobertos: pares [índice, TileType] — memória do mapa. */
  discovered: [number, number][];
  /** atores dentro do FOV deste jogador (inclui o próprio). */
  actors: VisibleActor[];
  /** eventos deste tick visíveis a este jogador (ou que o envolvem). */
  events: GameEvent[];
}

export const HERO_SPEED = 1;

/** Custo de mover 1 tile, em ticks: 1 unidade de tempo ÷ velocidade. */
export function moveCostTicks(speed: number): number {
  return Math.max(1, Math.round(TICKS_PER_TIME_UNIT / speed));
}
