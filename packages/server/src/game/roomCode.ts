import { randomBytes, randomInt } from "node:crypto";

/** Sem I, O, 0 e 1 — evita confusão ao ditar o código em voz alta. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Código de sala de 6 caracteres (32^6 ≈ 1 bi de combinações — colisão com
 * sala ativa é desprezível no v1). RNG de infra (crypto), não de regra de
 * jogo — o Rng seedado do shared é só para lógica determinística.
 */
export function generateRoomCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/** Seed imprevisível para o andar — nunca enviada ao cliente. */
export function randomSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}
