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

describe("Match — IA dos mobs em jogo", () => {
  it("mob fora do alcance dorme parado (e chega como asleep na visão)", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    const id = match.spawnMobAt("rat", 10, 2); // dist 8: jogador vê (raio 8), rato não (raio 6)

    let asleep: boolean | undefined;
    for (let t = 0; t < 30; t++) {
      const v = match.update().get("a");
      const rato = v?.actors.find((x) => x.id === id);
      if (rato) asleep = rato.asleep;
    }
    expect(match.mobPositionsForTest().get(id)).toEqual({ x: 10, y: 2 });
    expect(asleep).toBe(true);
  });

  it("mob próximo acorda e persegue até ficar adjacente ao jogador", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    const id = match.spawnMobAt("rat", 7, 2); // dist 5: dentro do raio 6 do rato

    for (let t = 0; t < 120; t++) match.update();
    const pos = match.mobPositionsForTest().get(id)!;
    const dist = Math.max(Math.abs(pos.x - 2), Math.abs(pos.y - 2));
    expect(dist).toBe(1); // encostado, aguardando a resolução de ataque (T5)
  });

  it("caranguejo (speed 2) alcança o jogador mais rápido que o rato", () => {
    const chase = (kind: "rat" | "crab") => {
      const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
      match.addPlayer("a", "A");
      const id = match.spawnMobAt(kind, 8, 2);
      let ticks = 0;
      for (; ticks < 200; ticks++) {
        match.update();
        const pos = match.mobPositionsForTest().get(id)!;
        if (Math.max(Math.abs(pos.x - 2), Math.abs(pos.y - 2)) === 1) break;
      }
      return ticks;
    };
    expect(chase("crab")).toBeLessThan(chase("rat"));
  });
});

describe("Match — combate", () => {
  /** Ataca o mob adjacente até ele morrer; devolve eventos coletados. */
  function matarMobAdjacente(match: Match, mobId: string, dir: Vec2, maxTicks = 600) {
    const eventos: unknown[] = [];
    for (let t = 0; t < maxTicks; t++) {
      match.queueIntent("a", dir.x, dir.y);
      const v = match.update().get("a");
      if (v) eventos.push(...v.events);
      if (!match.mobPositionsForTest().has(mobId)) break;
    }
    return eventos as { type: string; damage?: number; actorId?: string }[];
  }

  it("andar contra um mob ataca em vez de mover (e gera evento hit/miss)", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.spawnMobAt("rat", 3, 2);

    match.queueIntent("a", 1, 0);
    const v = match.update().get("a")!;
    expect(match.positionOf("a")).toEqual({ x: 2, y: 2 }); // não moveu
    const tipos = v.events.map((e) => e.type);
    expect(tipos.some((t) => t === "hit" || t === "miss")).toBe(true);
  });

  it("matar o rato remove o mob, emite death e concede XP", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    const id = match.spawnMobAt("rat", 3, 2);

    const eventos = matarMobAdjacente(match, id, { x: 1, y: 0 });
    expect(match.mobPositionsForTest().has(id)).toBe(false);
    expect(eventos.some((e) => e.type === "death")).toBe(true);

    const v = match.update().get("a") ?? null;
    // xp do rato = 2; ainda sem level up
    const you = v?.you ?? null;
    if (you) expect(you.xp).toBe(2);
  });

  it("dano de hit sempre dentro do intervalo dos punhos (1–6)", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    const id = match.spawnMobAt("crab", 3, 2);
    const eventos = matarMobAdjacente(match, id, { x: 1, y: 0 });
    const hits = eventos.filter((e) => e.type === "hit");
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.damage).toBeGreaterThanOrEqual(1);
      expect(h.damage).toBeLessThanOrEqual(6);
    }
  });

  it("matar 5 ratos sobe de nível (+5 HP máximo) e emite levelup", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");

    const eventos: { type: string }[] = [];
    for (let n = 0; n < 5; n++) {
      const id = match.spawnMobAt("rat", 3, 2);
      eventos.push(...matarMobAdjacente(match, id, { x: 1, y: 0 }));
      // cura entre as lutas — o teste valida XP, não sobrevivência
      const heroi = match.actorForTest("a")!;
      heroi.hp = heroi.maxHp;
    }
    expect(eventos.some((e) => e.type === "levelup")).toBe(true);

    match.queueIntent("a", 0, 1); // força uma visão nova
    let you = null as { level: number; maxHp: number } | null;
    for (let t = 0; t < 15 && !you; t++) {
      const v = match.update().get("a");
      if (v) you = v.you;
    }
    expect(you!.level).toBe(2);
    expect(you!.maxHp).toBe(25);
  });

  it("sem friendly fire: andar contra aliado não ataca nem move", () => {
    const match = new Match(
      makeTestLevel([
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ]),
    );
    match.addPlayer("a", "A");
    match.addPlayer("b", "B");

    match.queueIntent("a", 1, 0);
    const v = match.update().get("a");
    expect(match.positionOf("a")).toEqual({ x: 2, y: 2 });
    const eventos = v?.events ?? [];
    expect(eventos.filter((e) => e.type === "hit" || e.type === "miss")).toHaveLength(0);
  });

  it("mob adjacente ataca o jogador e o HP cai", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.spawnMobAt("gnoll", 3, 2);

    let hp = 20;
    for (let t = 0; t < 400; t++) {
      const v = match.update().get("a");
      if (v) hp = v.you.hp;
      if (hp < 20) break;
    }
    expect(hp).toBeLessThan(20);
  });
});

describe("Match — morte de jogador, espectador e revive", () => {
  it("a 0 HP vira espectador: alive=false, tile liberado, intenções ignoradas", () => {
    const match = new Match(
      makeTestLevel([
        { x: 2, y: 2 },
        { x: 4, y: 2 },
      ]),
    );
    match.addPlayer("a", "A");
    match.addPlayer("b", "B");
    match.damageForTest("a", 999);

    const v = match.update().get("a")!;
    expect(v.you.alive).toBe(false);
    expect(v.events.some((e) => e.type === "death")).toBe(true);

    // intenção do morto é ignorada
    match.queueIntent("a", 1, 0);
    match.update();
    expect(match.positionOf("a")).toEqual({ x: 2, y: 2 });

    // o tile do corpo fica livre: B anda até lá
    match.queueIntent("b", -1, 0);
    for (let t = 0; t < 12; t++) match.update();
    match.queueIntent("b", -1, 0);
    for (let t = 0; t < 12; t++) match.update();
    expect(match.positionOf("b")).toEqual({ x: 2, y: 2 });
  });

  it("espectador vê a união do que os vivos veem (e não aparece como ator)", () => {
    const match = new Match(
      makeTestLevel([
        { x: 2, y: 2 },
        { x: 20, y: 2 }, // B longe, fora do raio do próprio A
      ]),
    );
    match.addPlayer("a", "A");
    match.addPlayer("b", "B");
    match.damageForTest("a", 999);

    const v = match.update().get("a")!;
    // vê a área ao redor de B (que A jamais alcançaria com o próprio FOV)
    expect(v.visible).toContain(match.level.grid.index(20, 2));
    const ids = v.actors.map((x) => x.id);
    expect(ids).toContain("b");
    expect(ids).not.toContain("a"); // fantasma
  });

  it("aliado pisando na escada de descida revive o morto com 50% do HP", () => {
    // andar pequeno: escada de descida em (6,6)
    const match = new Match(
      makeTestLevel(
        [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
        ],
        8,
        8,
      ),
    );
    match.addPlayer("a", "A");
    match.addPlayer("b", "B");
    match.damageForTest("a", 999);
    match.update();

    // B caminha até a escada (6,6), um passo guiado por vez
    const eventos: { type: string }[] = [];
    let atoresVistosPorB: string[] = [];
    for (let passo = 0; passo < 8; passo++) {
      const pos = match.positionOf("b")!;
      if (pos.x === 6 && pos.y === 6) break;
      match.queueIntent("b", Math.sign(6 - pos.x), Math.sign(6 - pos.y));
      for (let t = 0; t < 12; t++) {
        const v = match.update().get("b");
        if (v) {
          eventos.push(...v.events);
          atoresVistosPorB = v.actors.map((x) => x.id);
        }
      }
    }
    expect(match.positionOf("b")).toEqual({ x: 6, y: 6 });
    expect(eventos.some((e) => e.type === "revive")).toBe(true);

    const a = match.actorForTest("a")!;
    expect(a.kind).toBe("player");
    if (a.kind === "player") expect(a.alive).toBe(true);
    expect(a.hp).toBe(10); // 50% de 20
    // renasceu perto da escada
    const dist = Math.max(Math.abs(a.x - 6), Math.abs(a.y - 6));
    expect(dist).toBeLessThanOrEqual(2);

    // e voltou a aparecer como ator na visão do aliado
    expect(atoresVistosPorB).toContain("a");
  });
});
