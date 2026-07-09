import { describe, expect, it } from "vitest";
import {
  BOSS_HP_PER_EXTRA_PLAYER,
  CHARGE_COOLDOWN_TICKS,
  CHARGE_RANGE,
  CHARGE_TELEGRAPH_TICKS,
  MINION_INTERVAL_TICKS,
  bossMaxHp,
  bossThink,
  freshBossMind,
  type BossSenses,
} from "./bossAi.js";
import { MOB_DEFS } from "./mobs.js";
import { Grid } from "./dungeon/grid.js";
import { Rng } from "./rng.js";
import { TileType, type Vec2 } from "./types.js";

function arena(): Grid {
  const grid = new Grid(24, 24);
  grid.fillRect({ x: 1, y: 1, width: 22, height: 22 }, TileType.Floor);
  return grid;
}

function senses(
  self: Vec2,
  players: { id: string; pos: Vec2; alive?: boolean }[],
  tick: number,
  extra?: Partial<BossSenses>,
): BossSenses {
  return {
    grid: arena(),
    self,
    tick,
    players: players.map((p) => ({ id: p.id, pos: p.pos, alive: p.alive ?? true })),
    rng: new Rng(1),
    isFree: () => true,
    hpFrac: 1,
    minionCount: 0,
    ...extra,
  };
}

describe("bossMaxHp", () => {
  it("escala com o número de jogadores", () => {
    expect(bossMaxHp(1)).toBe(MOB_DEFS.boss.maxHp);
    expect(bossMaxHp(2)).toBe(MOB_DEFS.boss.maxHp + BOSS_HP_PER_EXTRA_PLAYER);
    expect(bossMaxHp(4)).toBe(MOB_DEFS.boss.maxHp + 3 * BOSS_HP_PER_EXTRA_PLAYER);
  });
});

describe("bossThink — fases", () => {
  it("sem jogadores visíveis, espera", () => {
    const mind = freshBossMind();
    expect(bossThink(mind, senses({ x: 12, y: 12 }, [], 1))).toEqual({ type: "wait" });
  });

  it("persegue e ataca corpo a corpo quando adjacente", () => {
    const mind = freshBossMind();
    const longe = bossThink(
      mind,
      senses({ x: 12, y: 12 }, [{ id: "p", pos: { x: 18, y: 12 } }], 1),
    );
    expect(longe.type).toBe("move");

    const perto = bossThink(
      mind,
      senses({ x: 12, y: 12 }, [{ id: "p", pos: { x: 13, y: 12 } }], 2),
    );
    expect(perto).toEqual({ type: "attack", targetId: "p" });
  });

  it("carrega quando o cooldown vence e o alvo está no alcance; explode após o telegraph", () => {
    const mind = freshBossMind();
    const tick = CHARGE_COOLDOWN_TICKS + 1;
    const alvo = { id: "p", pos: { x: 12 + CHARGE_RANGE, y: 12 } };

    const inicio = bossThink(mind, senses({ x: 12, y: 12 }, [alvo], tick));
    expect(inicio).toEqual({ type: "startCharge", center: { x: alvo.pos.x, y: alvo.pos.y } });

    // durante o telegraph, espera (mesmo com alvo colado)
    const durante = bossThink(mind, senses({ x: 12, y: 12 }, [alvo], tick + 5));
    expect(durante).toEqual({ type: "wait" });

    const explosao = bossThink(
      mind,
      senses({ x: 12, y: 12 }, [alvo], tick + CHARGE_TELEGRAPH_TICKS),
    );
    expect(explosao).toEqual({ type: "explode", center: { x: alvo.pos.x, y: alvo.pos.y } });

    // cooldown re-armado: não carrega de novo imediatamente
    const depois = bossThink(
      mind,
      senses({ x: 12, y: 12 }, [alvo], tick + CHARGE_TELEGRAPH_TICKS + 1),
    );
    expect(depois.type).not.toBe("startCharge");
  });

  it("enfurece uma única vez ao cruzar 50% de HP", () => {
    const mind = freshBossMind();
    const s = senses({ x: 12, y: 12 }, [{ id: "p", pos: { x: 14, y: 12 } }], 1, { hpFrac: 0.4 });
    expect(bossThink(mind, s)).toEqual({ type: "enrage" });
    expect(mind.enraged).toBe(true);
    // segunda chamada não repete o enrage
    expect(bossThink(mind, s).type).not.toBe("enrage");
  });

  it("invoca minions periodicamente, respeitando o teto", () => {
    const mind = freshBossMind();
    const tick = MINION_INTERVAL_TICKS + 1;
    const alvo = { id: "p", pos: { x: 20, y: 12 } };

    const chamada = bossThink(mind, senses({ x: 12, y: 12 }, [alvo], tick));
    expect(chamada).toEqual({ type: "summon" });

    // logo em seguida não invoca de novo (intervalo re-armado)
    expect(bossThink(mind, senses({ x: 12, y: 12 }, [alvo], tick + 1)).type).not.toBe("summon");

    // no teto de minions, não invoca
    const mind2 = freshBossMind();
    const cheio = bossThink(mind2, senses({ x: 12, y: 12 }, [alvo], tick, { minionCount: 4 }));
    expect(cheio.type).not.toBe("summon");
  });

  it("fúria encurta o cooldown da carga", () => {
    const mind = freshBossMind();
    mind.enraged = true;
    const tick = CHARGE_COOLDOWN_TICKS + 1;
    const alvo = { id: "p", pos: { x: 13, y: 12 } };
    bossThink(mind, senses({ x: 12, y: 12 }, [alvo], tick)); // startCharge
    bossThink(mind, senses({ x: 12, y: 12 }, [alvo], tick + CHARGE_TELEGRAPH_TICKS)); // explode
    // com fúria, o próximo carregamento arma antes do cooldown normal
    expect(mind.nextChargeAt - (tick + CHARGE_TELEGRAPH_TICKS)).toBeLessThan(CHARGE_COOLDOWN_TICKS);
  });
});
