/**
 * Catálogo de itens v1 — nomes e números PRÓPRIOS do projeto.
 * Toda regra de item vive aqui; o servidor só aplica.
 */

export type WeaponId = "dagger" | "shortsword" | "mace";
export type ArmorId = "leather" | "chainmail";
export type PotionId = "healing" | "strength" | "poison";
export type ScrollId = "identify" | "teleport" | "upgrade";
export type FoodId = "ration";
export type ItemId = WeaponId | ArmorId | PotionId | ScrollId | FoodId;

export type ItemCategory = "weapon" | "armor" | "potion" | "scroll" | "food";

export interface WeaponDef {
  id: WeaponId;
  name: string;
  tier: 1 | 2;
  damageMin: number;
  damageMax: number;
  /** modificador de precisão (adaga é certeira, maça é bruta). */
  accuracyMod: number;
}

export interface ArmorDef {
  id: ArmorId;
  name: string;
  tier: 1 | 2;
  defense: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  dagger: { id: "dagger", name: "Adaga", tier: 1, damageMin: 2, damageMax: 5, accuracyMod: 2 },
  shortsword: {
    id: "shortsword",
    name: "Espada Curta",
    tier: 1,
    damageMin: 3,
    damageMax: 7,
    accuracyMod: 0,
  },
  mace: { id: "mace", name: "Maça", tier: 2, damageMin: 4, damageMax: 9, accuracyMod: -1 },
};

export const ARMORS: Record<ArmorId, ArmorDef> = {
  leather: { id: "leather", name: "Armadura de Couro", tier: 1, defense: 2 },
  chainmail: { id: "chainmail", name: "Cota de Malha", tier: 2, defense: 4 },
};

export const POTION_NAMES: Record<PotionId, string> = {
  healing: "Poção de Cura",
  strength: "Poção de Força",
  poison: "Poção de Veneno",
};

export const SCROLL_NAMES: Record<ScrollId, string> = {
  identify: "Pergaminho de Identificação",
  teleport: "Pergaminho de Teleporte",
  upgrade: "Pergaminho de Melhoria",
};

export const FOOD_HEAL = 5;
export const FOOD_NAMES: Record<FoodId, string> = { ration: "Ração de Viagem" };

export const ALL_POTIONS: readonly PotionId[] = ["healing", "strength", "poison"];
export const ALL_SCROLLS: readonly ScrollId[] = ["identify", "teleport", "upgrade"];
export const ALL_WEAPONS: readonly WeaponId[] = ["dagger", "shortsword", "mace"];
export const ALL_ARMORS: readonly ArmorId[] = ["leather", "chainmail"];

export function itemCategory(id: ItemId): ItemCategory {
  if (id in WEAPONS) return "weapon";
  if (id in ARMORS) return "armor";
  if (id in POTION_NAMES) return "potion";
  if (id in SCROLL_NAMES) return "scroll";
  return "food";
}

/** Nome verdadeiro do item (sem considerar identificação). */
export function itemTrueName(id: ItemId, upgrade = 0): string {
  const base =
    (WEAPONS as Record<string, WeaponDef>)[id]?.name ??
    (ARMORS as Record<string, ArmorDef>)[id]?.name ??
    (POTION_NAMES as Record<string, string>)[id] ??
    (SCROLL_NAMES as Record<string, string>)[id] ??
    FOOD_NAMES[id as FoodId];
  return upgrade > 0 ? `${base} +${upgrade}` : base;
}

/** Uma instância concreta de item no mundo ou num inventário. */
export interface ItemInstance {
  uid: string;
  itemId: ItemId;
  upgrade: number;
}

export const INVENTORY_SLOTS = 16;
