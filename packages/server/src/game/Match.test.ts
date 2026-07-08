import { describe, expect, it } from "vitest";
import {
  Grid,
  RoomType,
  TileType,
  rectContains,
  type Level,
  type Vec2,
} from "@shattered-dominion/shared";
import { Match } from "./Match.js";

/** Andar sintético: retângulo aberto com borda de parede e spawns dados. */
function makeTestLevel(spawns: Vec2[], width = 30, height = 12): Level {
  const grid = new Grid(width, height);
  grid.fillRect({ x: 1, y: 1, width: width - 2, height: height - 2 }, TileType.Floor);
  return {
    seed: 0,
    depth: 1,
    width,
    height,
    grid,
    rooms: [],
    stairsUp: { x: 1, y: 1 },
    stairsDown: { x: width - 2, y: height - 2 },
    spawnPoints: spawns,
  };
}

describe("Match — spawns e atores", () => {
  it("posiciona jogadores nos spawns em ordem, sem repetir", () => {
    const match = new Match(
      makeTestLevel([
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ]),
    );
    expect(match.addPlayer("a", "A")).toEqual({ x: 2, y: 2 });
    expect(match.addPlayer("b", "B")).toEqual({ x: 3, y: 2 });
    expect(match.playerCount).toBe(2);
  });

  it("removePlayer libera o tile para outro jogador", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.removePlayer("a");
    expect(match.addPlayer("b", "B")).toEqual({ x: 2, y: 2 });
  });
});

describe("Match — fila de tempo (nextActionAt)", () => {
  it("primeira intenção executa no primeiro tick; depois respeita o custo de 10 ticks", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");

    match.queueIntent("a", 1, 0);
    match.update(); // tick 1 — executa
    expect(match.positionOf("a")).toEqual({ x: 3, y: 2 });

    match.queueIntent("a", 1, 0);
    for (let t = 2; t <= 10; t++) match.update(); // ticks 2..10 — em cooldown
    expect(match.positionOf("a")).toEqual({ x: 3, y: 2 });

    match.update(); // tick 11 — cooldown vencido
    expect(match.positionOf("a")).toEqual({ x: 4, y: 2 });
  });

  it("buffer de 1 slot: a última intenção vence", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.queueIntent("a", 1, 0);
    match.queueIntent("a", 0, 1); // sobrescreve
    match.update();
    expect(match.positionOf("a")).toEqual({ x: 2, y: 3 });
  });
});

describe("Match — validação de movimento", () => {
  it("parede bloqueia e a intenção é consumida sem efeito", () => {
    const match = new Match(makeTestLevel([{ x: 1, y: 1 }]));
    match.addPlayer("a", "A");
    match.queueIntent("a", 0, -1); // (1,0) é parede
    match.update();
    expect(match.positionOf("a")).toEqual({ x: 1, y: 1 });
  });

  it("dois jogadores nunca ocupam o mesmo tile", () => {
    const match = new Match(
      makeTestLevel([
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ]),
    );
    match.addPlayer("a", "A");
    match.addPlayer("b", "B");
    match.queueIntent("a", 1, 0); // alvo: tile do B
    match.update();
    expect(match.positionOf("a")).toEqual({ x: 2, y: 2 });
  });

  it("payload malicioso é descartado sem crash", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.queueIntent("a", "x" as unknown, 0);
    match.queueIntent("a", 5, 0);
    match.queueIntent("a", 0.5, 0.5);
    match.queueIntent("a", 0, 0);
    match.queueIntent("desconhecido", 1, 0);
    match.update();
    expect(match.positionOf("a")).toEqual({ x: 2, y: 2 });
  });
});

describe("Match — visão por jogador", () => {
  it("primeiro tick envia visão inicial com descobertas e o próprio ator", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    const visions = match.update();

    const v = visions.get("a");
    expect(v).toBeDefined();
    expect(v!.discovered.length).toBeGreaterThan(0);
    expect(v!.visible).toContain(match.level.grid.index(2, 2));
    expect(v!.actors.map((a) => a.id)).toEqual(["a"]);
    expect(v!.you).toMatchObject({ x: 2, y: 2 });
  });

  it("ator longe não aparece; aparece ao entrar no raio de visão dos dois lados", () => {
    // A em (2,2), B em (12,2): distância 10 > raio 8
    const match = new Match(
      makeTestLevel([
        { x: 2, y: 2 },
        { x: 12, y: 2 },
      ]),
    );
    match.addPlayer("a", "A");
    match.addPlayer("b", "B");

    const visions = match.update();
    expect(visions.get("a")!.actors.map((x) => x.id)).toEqual(["a"]);
    expect(visions.get("b")!.actors.map((x) => x.id)).toEqual(["b"]);

    // A anda 2 tiles para a direita (2 movimentos × 10 ticks de cooldown)
    match.queueIntent("a", 1, 0);
    match.update(); // move para (3,2)
    match.queueIntent("a", 1, 0);
    const last = new Map<string, unknown>();
    for (let t = 0; t < 10; t++) {
      const out = match.update();
      for (const [k, m] of out) last.set(k, m);
    }
    // A em (4,2): distância 8 == raio ⇒ ambos se veem
    expect(match.positionOf("a")).toEqual({ x: 4, y: 2 });
    const va = last.get("a") as { actors: { id: string }[] };
    const vb = last.get("b") as { actors: { id: string }[] };
    expect(va.actors.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(vb.actors.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("sem mudanças não reenvia visão (economia de rede)", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.update(); // visão inicial
    expect(match.update().size).toBe(0);
    expect(match.update().size).toBe(0);
  });

  it("you carrega hp/level/xp/alive do Guerreiro nível 1", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    const v = match.update().get("a")!;
    expect(v.you).toMatchObject({ hp: 20, maxHp: 20, level: 1, xp: 0, alive: true });
    expect(v.you.xpToNext).toBeGreaterThan(0);
  });
});

describe("Match — spawn de mobs", () => {
  it("fromSeed povoa 4–8 mobs fora da sala de entrada, sem sobreposição (20 seeds)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const match = Match.fromSeed(seed, 1);
      expect(match.mobCount).toBeGreaterThanOrEqual(4);
      expect(match.mobCount).toBeLessThanOrEqual(8);

      const entrance = match.level.rooms.find((r) => r.type === RoomType.Entrance)!;
      const seen = new Set<string>();
      for (const [id, pos] of match.mobPositionsForTest()) {
        expect(rectContains(entrance, pos.x, pos.y)).toBe(false);
        const key = `${pos.x},${pos.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(id.startsWith("mob-")).toBe(true);
      }
    }
  });

  it("mob próximo aparece na visão com kind/hp; distante não aparece", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.spawnMobAt("rat", 5, 2); // dist 3 — visível
    match.spawnMobAt("crab", 20, 2); // dist 18 — fora do raio 8

    const v = match.update().get("a")!;
    const ids = v.actors.map((x) => x.id);
    expect(ids).toContain("mob-1");
    expect(ids).not.toContain("mob-2");

    const rato = v.actors.find((x) => x.id === "mob-1")!;
    expect(rato.kind).toBe("rat");
    expect(rato.hp).toBe(rato.maxHp);
    expect(rato.name).toBe("Rato do Esgoto");
  });

  it("mobs são determinísticos por seed", () => {
    const a = Match.fromSeed(77, 1);
    const b = Match.fromSeed(77, 1);
    expect([...a.mobPositionsForTest()]).toEqual([...b.mobPositionsForTest()]);
  });

  it("respawn não ultrapassa o teto do andar", () => {
    const match = Match.fromSeed(3, 1);
    const cap = match.mobCount;
    for (let t = 0; t < 1300; t++) match.update();
    expect(match.mobCount).toBe(cap);
  });
});
