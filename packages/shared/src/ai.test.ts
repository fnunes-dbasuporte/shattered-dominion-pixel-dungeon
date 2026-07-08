import { describe, expect, it } from "vitest";
import { GIVE_UP_TICKS, freshMind, mobThink, type MobMind, type MobSenses } from "./ai.js";
import { Grid } from "./dungeon/grid.js";
import { Rng } from "./rng.js";
import { TileType, type Vec2 } from "./types.js";

function openGrid(): Grid {
  const grid = new Grid(30, 14);
  grid.fillRect({ x: 1, y: 1, width: 28, height: 12 }, TileType.Floor);
  return grid;
}

function makeSenses(
  grid: Grid,
  self: Vec2,
  players: { id: string; pos: Vec2; alive?: boolean }[],
  tick = 1,
): MobSenses {
  return {
    grid,
    self,
    tick,
    players: players.map((p) => ({ id: p.id, pos: p.pos, alive: p.alive ?? true })),
    rng: new Rng(42),
    isFree: () => true,
  };
}

/** Simula N pensamentos aplicando os movimentos ao próprio mob. */
function simulate(
  mind: MobMind,
  grid: Grid,
  start: Vec2,
  players: { id: string; pos: Vec2; alive?: boolean }[],
  steps: number,
  startTick = 1,
) {
  const self = { ...start };
  let lastAction: ReturnType<typeof mobThink> = { type: "wait" };
  for (let t = 0; t < steps; t++) {
    lastAction = mobThink(mind, makeSenses(grid, self, players, startTick + t));
    if (lastAction.type === "move") {
      self.x += lastAction.dir.x;
      self.y += lastAction.dir.y;
    }
  }
  return { self, lastAction };
}

describe("mobThink — dormindo", () => {
  it("continua dormindo com jogador longe (fora do raio 6)", () => {
    const mind = freshMind();
    const action = mobThink(
      mind,
      makeSenses(openGrid(), { x: 5, y: 5 }, [{ id: "p1", pos: { x: 15, y: 5 } }]),
    );
    expect(action.type).toBe("wait");
    expect(mind.state).toBe("sleeping");
  });

  it("acorda ao ver jogador no FOV — acordar consome o turno", () => {
    const mind = freshMind();
    const action = mobThink(
      mind,
      makeSenses(openGrid(), { x: 5, y: 5 }, [{ id: "p1", pos: { x: 9, y: 5 } }]),
    );
    expect(action.type).toBe("wait");
    expect(mind.state).toBe("hunting");
    expect(mind.targetId).toBe("p1");
  });

  it("jogador morto não acorda ninguém", () => {
    const mind = freshMind();
    mobThink(
      mind,
      makeSenses(openGrid(), { x: 5, y: 5 }, [{ id: "p1", pos: { x: 6, y: 5 }, alive: false }]),
    );
    expect(mind.state).toBe("sleeping");
  });
});

describe("mobThink — perseguindo", () => {
  it("persegue até ficar adjacente e então ataca", () => {
    const grid = openGrid();
    const mind = freshMind();
    const player = { id: "p1", pos: { x: 10, y: 5 } };
    const { self, lastAction } = simulate(mind, grid, { x: 4, y: 5 }, [player], 12);

    expect(mind.state).toBe("hunting");
    expect(Math.max(Math.abs(self.x - 10), Math.abs(self.y - 5))).toBe(1);
    expect(lastAction).toEqual({ type: "attack", targetId: "p1" });
  });

  it("contorna paredes para alcançar o alvo", () => {
    const grid = openGrid();
    for (let y = 2; y <= 11; y++) grid.set(12, y, TileType.Wall); // muro com fresta em y=1
    const mind = freshMind();
    mind.state = "hunting";
    mind.targetId = "p1";
    mind.lastKnownPos = { x: 16, y: 5 };

    const { self } = simulate(mind, grid, { x: 8, y: 5 }, [{ id: "p1", pos: { x: 16, y: 5 } }], 40);
    expect(self.x).toBeGreaterThanOrEqual(12); // atravessou pela fresta
  });

  it("persegue a última posição conhecida e desiste após 10 unidades de tempo", () => {
    const grid = openGrid();
    const mind = freshMind();
    mind.state = "hunting";
    mind.targetId = "fantasma"; // alvo que não existe mais
    mind.lastSeenTick = 1;
    mind.lastKnownPos = { x: 6, y: 5 };

    // sem ver ninguém: anda até a última posição e, passado o prazo, vaga
    simulate(mind, grid, { x: 5, y: 5 }, [], 3, 2);
    expect(mind.state).toBe("hunting"); // ainda dentro do prazo
    mobThink(mind, makeSenses(grid, { x: 6, y: 5 }, [], 2 + GIVE_UP_TICKS + 1));
    expect(mind.state).toBe("wandering");
  });

  it("retarget: se o alvo sumiu mas outro jogador está visível, caça o mais próximo", () => {
    const mind = freshMind();
    mind.state = "hunting";
    mind.targetId = "sumiu";
    mind.lastSeenTick = 1;
    mobThink(mind, makeSenses(openGrid(), { x: 5, y: 5 }, [{ id: "p2", pos: { x: 8, y: 5 } }], 10));
    expect(mind.targetId).toBe("p2");
  });
});

describe("mobThink — vagando", () => {
  it("escolhe um destino e se move", () => {
    const grid = openGrid();
    const mind = freshMind();
    mind.state = "wandering";
    const { self } = simulate(mind, grid, { x: 5, y: 5 }, [], 5);
    expect(mind.wanderGoal).not.toBeNull();
    expect(self.x !== 5 || self.y !== 5).toBe(true);
  });

  it("ao avistar jogador volta a caçar", () => {
    const mind = freshMind();
    mind.state = "wandering";
    mobThink(mind, makeSenses(openGrid(), { x: 5, y: 5 }, [{ id: "p1", pos: { x: 7, y: 5 } }]));
    expect(mind.state).toBe("hunting");
    expect(mind.targetId).toBe("p1");
  });
});

describe("mobThink — determinismo e ocupação", () => {
  it("mesmas entradas ⇒ mesmas decisões", () => {
    const run = () => {
      const mind = freshMind();
      mind.state = "wandering";
      const grid = openGrid();
      const actions: string[] = [];
      const self = { x: 5, y: 5 };
      const rng = new Rng(9);
      for (let t = 1; t <= 20; t++) {
        const a = mobThink(mind, { ...makeSenses(grid, self, [], t), rng });
        actions.push(JSON.stringify(a));
        if (a.type === "move") {
          self.x += a.dir.x;
          self.y += a.dir.y;
        }
      }
      return actions;
    };
    expect(run()).toEqual(run());
  });

  it("tile ocupado força desvio ou espera (nunca move para tile ocupado)", () => {
    const grid = openGrid();
    const mind = freshMind();
    mind.state = "hunting";
    mind.targetId = "p1";
    mind.lastKnownPos = { x: 8, y: 5 };
    const senses = makeSenses(grid, { x: 5, y: 5 }, [{ id: "p1", pos: { x: 8, y: 5 } }]);
    senses.isFree = (x, y) => !(x === 6 && y === 5); // caminho direto bloqueado
    const action = mobThink(mind, senses);
    if (action.type === "move") {
      expect(`${5 + action.dir.x},${5 + action.dir.y}`).not.toBe("6,5");
    } else {
      expect(action.type).toBe("wait");
    }
  });
});
