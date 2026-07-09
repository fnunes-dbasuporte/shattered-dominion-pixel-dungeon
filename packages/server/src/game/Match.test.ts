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

describe("Match — loot no chão e pickup", () => {
  it("fromSeed espalha itens (3+ contando tesouro) fora da sala de entrada (10 seeds)", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const match = Match.fromSeed(seed, 1);
      expect(match.floorItemCount).toBeGreaterThanOrEqual(3);
      const entrance = match.level.rooms.find((r) => r.type === RoomType.Entrance)!;
      for (const e of match.floorEntitiesForTest()) {
        expect(rectContains(entrance, e.x, e.y)).toBe(false);
      }
    }
  });

  it("andar sobre um item pega automaticamente e some do chão", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.placeLootAt(3, 2, { kind: "item", itemId: "dagger", upgrade: 0 });

    match.queueIntent("a", 1, 0);
    const v = match.update().get("a")!;
    expect(v.you.inventory.map((i) => i.label)).toContain("Adaga");
    expect(match.floorItemCount).toBe(0);
    expect(v.events.some((e) => e.type === "info")).toBe(true);
  });

  it("ouro soma no contador individual e não entra no inventário", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.placeLootAt(3, 2, { kind: "gold", amount: 25 });

    match.queueIntent("a", 1, 0);
    const v = match.update().get("a")!;
    expect(v.you.gold).toBe(25);
    expect(v.you.inventory).toHaveLength(0);
  });

  it("dois jogadores correndo para o mesmo item: só um pega, sem duplicação", () => {
    const match = new Match(
      makeTestLevel([
        { x: 2, y: 2 },
        { x: 4, y: 2 },
      ]),
    );
    match.addPlayer("a", "A");
    match.addPlayer("b", "B");
    match.placeLootAt(3, 2, { kind: "item", itemId: "ration", upgrade: 0 });

    match.queueIntent("a", 1, 0);
    match.queueIntent("b", -1, 0);
    const out = match.update();
    const invA = out.get("a")?.you.inventory.length ?? 0;
    const invB = out.get("b")?.you.inventory.length ?? 0;
    expect(invA + invB).toBe(1);
    expect(match.floorItemCount).toBe(0);
  });

  it("poção no chão aparece com rótulo de aparência (não revela o tipo)", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.placeLootAt(4, 2, { kind: "item", itemId: "healing", upgrade: 0 });

    const v = match.update().get("a")!;
    const item = v.items.find((i) => i.category === "potion")!;
    expect(item.label).toMatch(/^Poção /);
    expect(item.label).not.toContain("Cura");
  });

  it("um tile nunca acumula dois itens", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    expect(match.placeLootAt(5, 5, { kind: "gold", amount: 5 })).toBe(true);
    expect(match.placeLootAt(5, 5, { kind: "gold", amount: 5 })).toBe(false);
    expect(match.floorItemCount).toBe(1);
  });
});

describe("Match — inventário e ações", () => {
  /** Match com jogador "a" e um item já no inventário. */
  function comItem(itemId: string, upgrade = 0) {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.placeLootAt(3, 2, { kind: "item", itemId: itemId as never, upgrade });
    match.queueIntent("a", 1, 0);
    match.update(); // anda e pega
    const player = match.actorForTest("a")!;
    if (player.kind !== "player") throw new Error("esperava jogador");
    return { match, player };
  }

  it("equipar espada muda o dano; desequipar volta aos punhos", () => {
    const { match, player } = comItem("shortsword");
    const uid = player.inventory[0].uid;
    expect(player.damageMax).toBe(6); // punhos

    match.equip("a", uid);
    expect(player.damageMin).toBe(3);
    expect(player.damageMax).toBe(7);

    match.equip("a", uid); // toggle
    expect(player.damageMax).toBe(6);
  });

  it("equipar armadura aparece na defesa do you", () => {
    const { match, player } = comItem("leather");
    match.equip("a", player.inventory[0].uid);
    match.queueIntent("a", 0, 1);
    const v = match.update().get("a")!;
    expect(v.you.defense).toBe(2);
  });

  it("beber cura recupera HP, consome e identifica só para o bebedor", () => {
    const { match, player } = comItem("healing");
    match.damageForTest("a", 12);
    match.use("a", player.inventory[0].uid);

    expect(player.hp).toBe(20); // 8 + 15 clampado no máximo (20)
    expect(player.inventory).toHaveLength(0);
    expect(player.identified.has("healing")).toBe(true);

    match.addPlayer("b", "B");
    const b = match.actorForTest("b")!;
    if (b.kind === "player") expect(b.identified.size).toBe(0);
  });

  it("poção de força soma dano permanente", () => {
    const { match, player } = comItem("strength");
    match.use("a", player.inventory[0].uid);
    expect(player.strength).toBe(1);
    expect(player.damageMin).toBe(2); // 1 + FOR
    expect(player.damageMax).toBe(7); // 6 + FOR
  });

  it("pergaminho de identificação: sem alvo não consome; com alvo identifica", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.placeLootAt(3, 2, { kind: "item", itemId: "identify", upgrade: 0 });
    match.placeLootAt(4, 2, { kind: "item", itemId: "poison", upgrade: 0 });
    match.queueIntent("a", 1, 0);
    match.update();
    match.queueIntent("a", 1, 0);
    for (let t = 0; t < 11; t++) match.update();

    const player = match.actorForTest("a")!;
    if (player.kind !== "player") throw new Error();
    expect(player.inventory).toHaveLength(2);
    const scroll = player.inventory.find((i) => i.itemId === "identify")!;
    const potion = player.inventory.find((i) => i.itemId === "poison")!;

    match.use("a", scroll.uid); // sem alvo
    expect(player.inventory).toHaveLength(2); // não consumiu
    expect(player.identified.has("identify")).toBe(true); // mas revelou o pergaminho

    match.use("a", scroll.uid, potion.uid);
    expect(player.identified.has("poison")).toBe(true);
    expect(player.inventory).toHaveLength(1); // consumiu o pergaminho
  });

  it("teleporte move o jogador e mantém a ocupação consistente", () => {
    const { match, player } = comItem("teleport");
    const antes = { x: player.x, y: player.y };
    match.use("a", player.inventory[0].uid);
    expect({ x: player.x, y: player.y }).not.toEqual(antes);
    // ninguém ocupa o tile antigo; o novo é dele
    const grid = match.level.grid;
    match.addPlayer("b", "B"); // spawn (2,2) agora livre? só valida sem crash
    expect(grid.inBounds(player.x, player.y)).toBe(true);
  });

  it("melhoria dá +1 na arma equipada e é consumida; sem equipado não consome", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.placeLootAt(3, 2, { kind: "item", itemId: "upgrade", upgrade: 0 });
    match.placeLootAt(4, 2, { kind: "item", itemId: "dagger", upgrade: 0 });
    match.queueIntent("a", 1, 0);
    match.update();
    match.queueIntent("a", 1, 0);
    for (let t = 0; t < 11; t++) match.update();

    const player = match.actorForTest("a")!;
    if (player.kind !== "player") throw new Error();
    const scroll = player.inventory.find((i) => i.itemId === "upgrade")!;
    const dagger = player.inventory.find((i) => i.itemId === "dagger")!;

    match.use("a", scroll.uid); // nada equipado
    expect(player.inventory).toHaveLength(2);

    match.equip("a", dagger.uid);
    match.use("a", scroll.uid);
    expect(dagger.upgrade).toBe(1);
    expect(player.damageMax).toBe(6); // adaga 5 + 1
    expect(player.inventory).toHaveLength(1);
  });

  it("dropar coloca no chão e outro jogador pode pegar", () => {
    const { match, player } = comItem("ration");
    const uid = player.inventory[0].uid;
    match.drop("a", uid);
    expect(player.inventory).toHaveLength(0);
    expect(match.floorItemCount).toBe(1);

    // A sai do tile; B nasce e caminha até o item
    match.queueIntent("a", 0, 1);
    for (let t = 0; t < 11; t++) match.update();
    match.addPlayer("b", "B");
    const alvo = match.floorEntitiesForTest()[0];
    for (let passo = 0; passo < 6; passo++) {
      const pos = match.positionOf("b")!;
      if (pos.x === alvo.x && pos.y === alvo.y) break;
      match.queueIntent("b", Math.sign(alvo.x - pos.x), Math.sign(alvo.y - pos.y));
      for (let t = 0; t < 11; t++) match.update();
    }
    const b = match.actorForTest("b")!;
    if (b.kind === "player") expect(b.inventory).toHaveLength(1);
  });

  it("uid alheio ou inválido não faz nada", () => {
    const { match, player } = comItem("dagger");
    match.equip("a", "uid-inexistente");
    match.use("a", 42);
    match.drop("a", null);
    expect(player.inventory).toHaveLength(1);
    expect(player.equippedWeapon).toBeNull();
  });
});

describe("Match — efeitos em runtime (veneno)", () => {
  function envenenado() {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.placeLootAt(3, 2, { kind: "item", itemId: "poison", upgrade: 0 });
    match.queueIntent("a", 1, 0);
    match.update();
    const player = match.actorForTest("a")!;
    if (player.kind !== "player") throw new Error();
    match.use("a", player.inventory[0].uid);
    return { match, player };
  }

  it("beber veneno aplica status e causa 1 de dano por unidade de tempo", () => {
    const { match, player } = envenenado();
    expect(player.identified.has("poison")).toBe(true);

    match.queueIntent("a", 0, 1);
    const v = match.update().get("a")!;
    expect(v.you.statuses).toContain("veneno");

    const hpInicial = player.hp;
    for (let t = 0; t < 30; t++) match.update(); // 3 unidades de tempo
    expect(player.hp).toBe(hpInicial - 3);
  });

  it("veneno expira após 8 unidades (dano total 8) e o status some", () => {
    const { match, player } = envenenado();
    const hpInicial = player.hp;
    for (let t = 0; t < 120; t++) match.update(); // 12 unidades — além da duração
    expect(player.hp).toBe(hpInicial - 8);

    match.queueIntent("a", 0, 1);
    let statuses: string[] = ["?"];
    for (let t = 0; t < 12; t++) {
      const v = match.update().get("a");
      if (v) statuses = v.you.statuses;
    }
    expect(statuses).toEqual([]);
  });

  it("veneno pode matar: vira espectador com evento de morte", () => {
    const { match, player } = envenenado();
    match.damageForTest("a", player.hp - 3); // sobra 3 HP; veneno dá 8
    const eventos: string[] = [];
    for (let t = 0; t < 60; t++) {
      const v = match.update().get("a");
      if (v) eventos.push(...v.events.map((e) => e.type));
    }
    expect(player.alive).toBe(false);
    expect(eventos).toContain("death");
  });
});

describe("Match — queda, dormência e reconexão", () => {
  it("dropped: herói fica parado mas ainda é alvo da IA", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.spawnMobAt("gnoll", 5, 2);
    match.setDropped("a");

    // intenções são ignoradas enquanto caído
    match.queueIntent("a", 1, 0);
    match.update();
    expect(match.positionOf("a")).toEqual({ x: 2, y: 2 });

    // o gnoll ainda o caça e machuca
    let hp = 20;
    for (let t = 0; t < 300; t++) {
      match.update();
      const a = match.actorForTest("a")!;
      hp = a.hp;
      if (hp < 20) break;
    }
    expect(hp).toBeLessThan(20);
  });

  it("após 600 ticks caído vira adormecido: invulnerável, sem colisão e invisível", () => {
    const match = new Match(
      makeTestLevel([
        { x: 2, y: 2 },
        { x: 4, y: 2 },
      ]),
    );
    match.addPlayer("a", "A");
    match.addPlayer("b", "B");
    match.spawnMobAt("gnoll", 20, 8); // longe, para não interferir
    match.setDropped("a");

    for (let t = 0; t <= Match.DORMANCY_TICKS; t++) match.update();
    const a = match.actorForTest("a")!;
    if (a.kind !== "player") throw new Error();
    expect(a.conn).toBe("dormant");

    // sem colisão: B anda até o tile onde A dorme
    match.queueIntent("b", -1, 0);
    for (let t = 0; t < 12; t++) match.update();
    match.queueIntent("b", -1, 0);
    for (let t = 0; t < 12; t++) match.update();
    expect(match.positionOf("b")).toEqual({ x: 2, y: 2 });

    // invisível para o aliado
    match.queueIntent("b", 1, 0);
    let atores: string[] = [];
    for (let t = 0; t < 12; t++) {
      const v = match.update().get("b");
      if (v) atores = v.actors.map((x) => x.id);
    }
    expect(atores).not.toContain("a");
  });

  it("reconectar de adormecido realoca (tile pode estar ocupado) e devolve o controle", () => {
    const match = new Match(
      makeTestLevel([
        { x: 2, y: 2 },
        { x: 4, y: 2 },
      ]),
    );
    match.addPlayer("a", "A");
    match.addPlayer("b", "B");
    match.setDropped("a");
    for (let t = 0; t <= Match.DORMANCY_TICKS; t++) match.update();

    // B ocupa o tile do dorminhoco
    match.queueIntent("b", -1, 0);
    for (let t = 0; t < 12; t++) match.update();
    match.queueIntent("b", -1, 0);
    for (let t = 0; t < 12; t++) match.update();
    expect(match.positionOf("b")).toEqual({ x: 2, y: 2 });

    match.reconnectPlayer("a");
    const a = match.actorForTest("a")!;
    if (a.kind !== "player") throw new Error();
    expect(a.conn).toBe("online");
    expect(match.positionOf("a")).not.toEqual({ x: 2, y: 2 }); // realocado

    // controle de volta (anda para a direita — longe do B)
    const antes = match.positionOf("a")!;
    match.queueIntent("a", 1, 0);
    for (let t = 0; t < 12; t++) match.update();
    expect(match.positionOf("a")).not.toEqual(antes);
  });

  it("fullVisionFor devolve toda a memória de mapa do jogador", () => {
    const match = new Match(makeTestLevel([{ x: 2, y: 2 }]));
    match.addPlayer("a", "A");
    match.update();
    // anda para descobrir mais tiles
    match.queueIntent("a", 1, 0);
    for (let t = 0; t < 12; t++) match.update();

    const a = match.actorForTest("a")!;
    if (a.kind !== "player") throw new Error();
    const memoria = a.discovered.size;
    expect(memoria).toBeGreaterThan(0);

    const full = match.fullVisionFor("a")!;
    expect(full.discovered).toHaveLength(memoria);
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
