import type { NumberWords } from '../numbers';

/**
 * Portuguese number words, already folded: no accents, lowercase. `três` is
 * `tres` here because `foldText` runs before the parser ever sees the text.
 *
 * Gendered forms are both present (`um`/`uma`, `dois`/`duas`) because a speaker
 * says "duas latas" and "dois quilos" and neither is a mistake.
 */
export const ptBRNumbers: NumberWords = {
  units: {
    zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
    treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16,
    dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30,
    quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80,
    noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200,
    trezentos: 300, trezentas: 300, quatrocentos: 400, quinhentos: 500,
    seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900,
  },
  /**
   * Words that multiply the number before them: "duas dúzias" is 2 × 12, and a
   * bare "dúzia" is 1 × 12.
   *
   * `mil` belongs here and NOT in `units`, however much it looks like a number
   * word. As a unit it was added, so "dois mil" parsed as 2 + 1000 = 1002 and
   * "dez mil" as 1010 - a wrong quantity with no error to notice, written
   * straight into someone's stock. As a group it multiplies, which is what the
   * word actually does: 2 × 1000. "mil" on its own still reads 1000 because a
   * group with nothing before it multiplies 1.
   */
  groups: { duzia: 12, duzias: 12, par: 2, pares: 2, mil: 1000 },
  /** Standalone quantities that need no numeral. */
  literals: { meio: 0.5, meia: 0.5, metade: 0.5 },
  /** Joins tens to units: "vinte e cinco". */
  joiner: 'e',
};
