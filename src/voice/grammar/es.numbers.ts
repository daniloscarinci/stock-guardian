import type { NumberWords } from '../numbers';

/**
 * Spanish number words, already folded: no accents, lowercase. `veintidós` is
 * `veintidos` here and `dieciséis` is `dieciseis`, because `foldText` runs
 * before the parser ever sees the text.
 *
 * Twenty-one through twenty-nine are single words in Spanish and are listed as
 * such; from thirty up the language joins with `y` ("treinta y cinco"), which
 * the joiner handles. Gendered forms are both present (`un`/`una`,
 * `doscientos`/`doscientas`) because a speaker says "una lata" and "un kilo"
 * and neither is a mistake.
 */
export const esNumbers: NumberWords = {
  units: {
    cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
    trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
    dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21,
    veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
    veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
    treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
    ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200,
    doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400,
    cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600,
    setecientos: 700, ochocientos: 800, novecientos: 900,
  },
  /**
   * Words that multiply the number before them: "dos docenas" is 2 x 12 and a
   * bare "docena" is 1 x 12.
   *
   * `mil` belongs here and NOT in `units` for the reason set out in
   * `pt-BR.numbers.ts`: as a unit it was added, so "dos mil" came out as 1002.
   */
  groups: { docena: 12, docenas: 12, par: 2, pares: 2, mil: 1000 },
  /** Standalone quantities that need no numeral. */
  literals: { medio: 0.5, media: 0.5, mitad: 0.5 },
  /** Joins tens to units: "treinta y cinco". */
  joiner: 'y',
  /**
   * Empty, and that is an answer rather than a gap. Portuguese has "meia" for
   * six and English "oh" for zero; a Spanish speaker reading a number out says
   * "cero" and "seis", the words already in `units` above.
   */
  digitAliases: {},
};
