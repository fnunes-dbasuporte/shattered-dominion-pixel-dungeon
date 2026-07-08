import type { Rng } from "../rng.js";
import {
  ALL_POTIONS,
  ALL_SCROLLS,
  itemCategory,
  itemTrueName,
  type ItemId,
  type PotionId,
  type ScrollId,
} from "./defs.js";

/**
 * Aparências sorteadas por run: cada tipo de poção/pergaminho ganha uma
 * cor/runa aleatória no seed da partida. A identidade real só é revelada
 * a quem identificou (estado POR JOGADOR, guardado no servidor).
 */

export const POTION_COLORS = [
  "vermelha",
  "azul",
  "esverdeada",
  "turva",
  "âmbar",
  "violeta",
] as const;

export const SCROLL_RUNES = ["KAZ", "MOR", "VEL", "ORN", "ZUL", "THA"] as const;

export interface RunAppearances {
  potions: Record<PotionId, string>;
  scrolls: Record<ScrollId, string>;
}

export function rollAppearances(rng: Rng): RunAppearances {
  const cores = rng.shuffle([...POTION_COLORS]);
  const runas = rng.shuffle([...SCROLL_RUNES]);
  const potions = {} as Record<PotionId, string>;
  const scrolls = {} as Record<ScrollId, string>;
  ALL_POTIONS.forEach((id, i) => (potions[id] = cores[i]));
  ALL_SCROLLS.forEach((id, i) => (scrolls[id] = runas[i]));
  return { potions, scrolls };
}

/** Rótulo visto por quem NÃO identificou o tipo. */
export function unidentifiedLabel(itemId: ItemId, appearances: RunAppearances): string {
  const cat = itemCategory(itemId);
  if (cat === "potion") return `Poção ${appearances.potions[itemId as PotionId]}`;
  if (cat === "scroll") return `Pergaminho "${appearances.scrolls[itemId as ScrollId]}"`;
  return itemTrueName(itemId); // armas/armaduras/comida são sempre reconhecíveis
}

/** Rótulo exibido a um jogador conforme seu conjunto de tipos identificados. */
export function displayLabel(
  itemId: ItemId,
  upgrade: number,
  identified: ReadonlySet<ItemId>,
  appearances: RunAppearances,
): string {
  const cat = itemCategory(itemId);
  const precisaIdentificar = cat === "potion" || cat === "scroll";
  if (!precisaIdentificar || identified.has(itemId)) return itemTrueName(itemId, upgrade);
  return unidentifiedLabel(itemId, appearances);
}
