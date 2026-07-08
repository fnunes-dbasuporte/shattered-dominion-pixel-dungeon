import { describe, expect, it } from "vitest";
import { hashSeed, Rng } from "./rng.js";

const sequence = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.next());

describe("Rng (mulberry32)", () => {
  it("mesma seed produz a mesma sequência", () => {
    expect(sequence(new Rng(12345), 100)).toEqual(sequence(new Rng(12345), 100));
  });

  it("seeds diferentes produzem sequências diferentes", () => {
    expect(sequence(new Rng(1), 10)).not.toEqual(sequence(new Rng(2), 10));
  });

  it("seed em string é estável e equivale ao hash numérico", () => {
    expect(sequence(new Rng("esgotos-1"), 10)).toEqual(sequence(new Rng(hashSeed("esgotos-1")), 10));
  });

  it("next() fica em [0, 1)", () => {
    const rng = new Rng(99);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt(min, max) é inclusivo nas duas pontas e respeita os limites", () => {
    const rng = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) {
      const v = rng.nextInt(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("nextInt rejeita intervalo invertido", () => {
    expect(() => new Rng(1).nextInt(5, 1)).toThrow(RangeError);
  });

  it("shuffle é determinístico e é uma permutação", () => {
    const base = () => Array.from({ length: 20 }, (_, i) => i);
    const a = new Rng(42).shuffle(base());
    const b = new Rng(42).shuffle(base());
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(base());
    expect(a).not.toEqual(base());
  });

  it("pick retorna sempre elemento do array e rejeita array vazio", () => {
    const rng = new Rng(3);
    const items = ["a", "b", "c"];
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it("getState/setState retoma a sequência exatamente de onde parou", () => {
    const rng = new Rng(555);
    rng.next();
    const snapshot = rng.getState();
    const continuacao = sequence(rng, 10);
    const restaurado = new Rng(0);
    restaurado.setState(snapshot);
    expect(sequence(restaurado, 10)).toEqual(continuacao);
  });

  it("fork cria fluxos independentes e determinísticos", () => {
    const forkOf = (seed: number, stream: string) => sequence(new Rng(seed).fork(stream), 10);
    expect(forkOf(10, "loot")).toEqual(forkOf(10, "loot"));
    expect(forkOf(10, "loot")).not.toEqual(forkOf(10, "mobs"));
  });
});
