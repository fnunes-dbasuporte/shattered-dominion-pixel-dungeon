import { TICKS_PER_TIME_UNIT } from "./constants.js";
import type { MobKind } from "./mobs.js";
import type { ItemCategory } from "./items/defs.js";

/** Nomes das mensagens cliente ⇄ servidor. */
export const MessageType = {
  /** cliente → servidor: intenção de movimento (8 direções). */
  Move: "move",
  /** cliente → servidor: host inicia a partida. */
  Start: "start",
  /** cliente → servidor: pegar itens do tile atual. */
  Pickup: "pickup",
  /** cliente → servidor: equipar/desequipar arma ou armadura { uid }. */
  Equip: "equip",
  /** cliente → servidor: usar/beber/ler { uid, targetUid? }. */
  Use: "use",
  /** cliente → servidor: dropar { uid }. */
  Drop: "drop",
  /** cliente → servidor { text } · servidor → todos { senderId, name, text }. */
  Chat: "chat",
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

export const CHAT_MAX_LENGTH = 140;

export interface ChatBroadcast {
  senderId: string;
  name: string;
  text: string;
}

export interface MatchStartedMessage {
  width: number;
  height: number;
  depth: number;
}

export type ActorKind = "player" | MobKind;

/** Paleta de cores dos heróis — índice validado no servidor (0..7). */
export const PLAYER_COLORS = [
  0xe8554d, 0x4da3e8, 0x5fce6b, 0xe8c04d, 0xb35de8, 0x4de8d3, 0xe88a4d, 0xdd6fb1,
] as const;

export interface VisibleActor {
  id: string;
  name: string;
  kind: ActorKind;
  /** índice em PLAYER_COLORS (jogadores); 0 para mobs. */
  colorIndex: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** duração do movimento em ticks — o cliente usa para interpolar. */
  moveTicks: number;
  /** mobs dormindo ganham indicador visual; sempre false para jogadores. */
  asleep: boolean;
}

/** Item no inventário, com rótulo já resolvido pela identificação do dono. */
export interface InventoryEntry {
  uid: string;
  label: string;
  category: ItemCategory;
  identified: boolean;
  equipped: boolean;
  upgrade: number;
}

/** Item/ouro no chão, com rótulo resolvido pela identificação do viewer. */
export interface VisibleItem {
  id: string;
  x: number;
  y: number;
  category: ItemCategory | "gold";
  label: string;
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
  gold: number;
  strength: number;
  defense: number;
  statuses: string[];
  inventory: InventoryEntry[];
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
  | { type: "revive"; actorId: string; name: string; x: number; y: number }
  /** ações de item e avisos — texto já seguro (usa aparências, não identidades). */
  | { type: "info"; actorId: string; text: string; x: number; y: number };

export interface VisionMessage {
  tick: number;
  you: YouState;
  /** índices dos tiles visíveis agora. */
  visible: number[];
  /** tiles recém-descobertos: pares [índice, TileType] — memória do mapa. */
  discovered: [number, number][];
  /** atores dentro do FOV deste jogador (inclui o próprio). */
  actors: VisibleActor[];
  /** itens no chão dentro do FOV. */
  items: VisibleItem[];
  /** eventos deste tick visíveis a este jogador (ou que o envolvem). */
  events: GameEvent[];
}

export const HERO_SPEED = 1;

/** Custo de mover 1 tile, em ticks: 1 unidade de tempo ÷ velocidade. */
export function moveCostTicks(speed: number): number {
  return Math.max(1, Math.round(TICKS_PER_TIME_UNIT / speed));
}
