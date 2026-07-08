import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import {
  ALL_ARMORS,
  ALL_POTIONS,
  ALL_SCROLLS,
  ALL_WEAPONS,
  ARMORS,
  WEAPONS,
  itemCategory,
  itemTrueName,
} from "./defs.js";
import { displayLabel, rollAppearances, unidentifiedLabel } from "./appearance.js";

describe("defs", () => {
  it("armas e armaduras têm números válidos", () => {
    for (const id of ALL_WEAPONS) {
      const w = WEAPONS[id];
      expect(w.damageMin).toBeGreaterThan(0);
      expect(w.damageMax).toBeGreaterThanOrEqual(w.damageMin);
    }
    for (const id of ALL_ARMORS) expect(ARMORS[id].defense).toBeGreaterThan(0);
  });

  it("categorias e nomes resolvem para todo item", () => {
    expect(itemCategory("mace")).toBe("weapon");
    expect(itemCategory("leather")).toBe("armor");
    expect(itemCategory("healing")).toBe("potion");
    expect(itemCategory("upgrade")).toBe("scroll");
    expect(itemCategory("ration")).toBe("food");
    expect(itemTrueName("shortsword", 2)).toBe("Espada Curta +2");
    expect(itemTrueName("poison")).toBe("Poção de Veneno");
  });
});

describe("aparências por run", () => {
  it("é determinístico por seed e diferente entre seeds", () => {
    const a = rollAppearances(new Rng(1));
    const b = rollAppearances(new Rng(1));
    const c = rollAppearances(new Rng(2));
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("cores/runas não se repetem dentro da run", () => {
    const ap = rollAppearances(new Rng(7));
    expect(new Set(Object.values(ap.potions)).size).toBe(ALL_POTIONS.length);
    expect(new Set(Object.values(ap.scrolls)).size).toBe(ALL_SCROLLS.length);
  });

  it("rótulo não identificado esconde o tipo; identificado revela por jogador", () => {
    const ap = rollAppearances(new Rng(3));
    const semIdentificar = displayLabel("healing", 0, new Set(), ap);
    expect(semIdentificar).toBe(unidentifiedLabel("healing", ap));
    expect(semIdentificar).toMatch(/^Poção /);
    expect(semIdentificar).not.toContain("Cura");

    const identificado = displayLabel("healing", 0, new Set(["healing"]), ap);
    expect(identificado).toBe("Poção de Cura");
  });

  it("armas nunca precisam de identificação", () => {
    const ap = rollAppearances(new Rng(3));
    expect(displayLabel("dagger", 1, new Set(), ap)).toBe("Adaga +1");
  });
});
