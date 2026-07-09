import type { Rng } from "../rng.js";
import type { MobKind } from "../mobs.js";
import { ALL_ARMORS, ALL_POTIONS, ALL_SCROLLS, ALL_WEAPONS, WEAPONS, type ItemId } from "./defs.js";

/** Tabelas de loot — números próprios do projeto. */

export type LootRoll =
  { kind: "item"; itemId: ItemId; upgrade: number } | { kind: "gold"; amount: number };

export const FLOOR_LOOT_MIN = 3;
export const FLOOR_LOOT_MAX = 6;
export const TREASURE_BONUS_ITEMS = 2;

export function rollFloorLootCount(rng: Rng): number {
  return rng.nextInt(FLOOR_LOOT_MIN, FLOOR_LOOT_MAX);
}

/** Um item/pilha de ouro aleatório do andar. */
export function rollFloorLoot(rng: Rng, depth: number): LootRoll {
  const roll = rng.nextInt(1, 100);
  if (roll <= 25) return { kind: "item", itemId: rng.pick(ALL_POTIONS), upgrade: 0 };
  if (roll <= 45) return { kind: "item", itemId: rng.pick(ALL_SCROLLS), upgrade: 0 };
  if (roll <= 65) return { kind: "gold", amount: rng.nextInt(8 + depth * 2, 25 + depth * 5) };
  if (roll <= 77)
    return { kind: "item", itemId: rollWeapon(rng, depth), upgrade: rollUpgrade(rng) };
  if (roll <= 87) return { kind: "item", itemId: rng.pick(ALL_ARMORS), upgrade: rollUpgrade(rng) };
  return { kind: "item", itemId: "ration", upgrade: 0 };
}

/** Ouro extra da sala do tesouro. */
export function rollTreasureGold(rng: Rng, depth: number): number {
  return rng.nextInt(25 + depth * 5, 60 + depth * 10);
}

/** Armas tier 2 só aparecem do andar 2 em diante. */
function rollWeapon(rng: Rng, depth: number) {
  const pool = ALL_WEAPONS.filter((w) => WEAPONS[w].tier === 1 || depth >= 2);
  return rng.pick(pool);
}

/** 15% de chance de vir com +1. */
function rollUpgrade(rng: Rng): number {
  return rng.chance(0.15) ? 1 : 0;
}

/** Drop ao morrer, por espécie. */
export function rollMobDrop(rng: Rng, kind: MobKind): LootRoll | null {
  switch (kind) {
    case "rat":
      return rng.chance(0.15) ? { kind: "item", itemId: "ration", upgrade: 0 } : null;
    case "gnoll":
      return rng.chance(0.3) ? { kind: "gold", amount: rng.nextInt(4, 12) } : null;
    case "crab":
      return rng.chance(0.25) ? { kind: "item", itemId: rng.pick(ALL_POTIONS), upgrade: 0 } : null;
    default:
      return null; // lodo não carrega nada; o boss dropa o Amuleto (regra do Match)
  }
}
