/**
 * RNG determinístico seedado (mulberry32). Toda aleatoriedade de regra de
 * jogo DEVE passar por uma instância de Rng — nunca usar Math.random(),
 * para que cliente e servidor possam reproduzir a mesma sequência a partir
 * da mesma seed.
 */

/** Deriva uma seed numérica estável de uma string (xmur3, 1 rodada). */
export function hashSeed(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = (typeof seed === "string" ? hashSeed(seed) : seed) >>> 0;
  }

  /** Estado interno serializável — permite salvar/restaurar a sequência. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }

  /** Próximo float em [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  /** Inteiro uniforme em [min, max], ambos inclusivos (estilo rolagem de dado). */
  nextInt(min: number, max: number): number {
    if (max < min) throw new RangeError(`nextInt: max (${max}) < min (${min})`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Retorna true com probabilidade p (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Elemento aleatório de um array não-vazio. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("pick: array vazio");
    return items[this.nextInt(0, items.length - 1)];
  }

  /** Embaralha o array in-place (Fisher–Yates) e o retorna. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  /**
   * Deriva um RNG independente para um subsistema (ex.: "loot", "mobs"),
   * de forma que consumos em um fluxo não desloquem a sequência do outro.
   */
  fork(streamName: string): Rng {
    return new Rng((this.nextU32() ^ hashSeed(streamName)) >>> 0);
  }

  private nextU32(): number {
    return Math.floor(this.next() * 0x100000000) >>> 0;
  }
}
