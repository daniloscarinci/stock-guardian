/**
 * Every Spanish phrase form the application claims to understand.
 *
 * A transcript arrives without capitals and usually without accents, which is
 * why most rows below are written the way a recognizer actually returns them.
 * The rows that keep their accents and their `¿` are there on purpose: they
 * prove the fold and the punctuation strip in `parse.ts` reach the patterns.
 *
 * When a real phrase fails in real use, add it here first.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../parse';
import { esGrammar } from './es';
import type { Intent } from '../intents';

const CTX = { today: '2026-09-07' };
const say = (text: string): Intent => parse(esGrammar, text, CTX);

describe('es phrases: asking', () => {
  const quantity = ['cuanto arroz tengo', 'cuanto arroz', 'cuantas latas de frijoles tengo',
    'hay azucar', 'tengo agua', 'cuanta agua tengo', 'cuanto queda de cafe'];
  for (const phrase of quantity) {
    it(`"${phrase}" asks a quantity`, () => {
      expect(say(phrase).kind).toBe('QUERY_QUANTITY');
    });
  }

  it('recovers the item from a quantity question', () => {
    expect(say('cuantas latas de frijoles negros tengo')).toEqual({
      kind: 'QUERY_QUANTITY', item: 'frijoles negros',
    });
  });

  /**
   * The verb can trail the item. A leftover in the item phrase means the
   * search looks for a product by that name and reports, confidently, that the
   * user has none of it.
   */
  const trailingVerb: ReadonlyArray<readonly [string, string]> = [
    ['cuantos huevos quedan', 'huevos'],
    ['cuanto arroz sobra', 'arroz'],
    ['cuanta leche hay', 'leche'],
  ];
  for (const [phrase, item] of trailingVerb) {
    it(`"${phrase}" asks about ${item}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_QUANTITY', item });
    });
  }

  /** Inverted order, answerable because these are read-only questions. */
  const inverted: ReadonlyArray<readonly [string, string]> = [
    ['cuanto tengo de azucar', 'azucar'],
    ['cuanto queda de arroz', 'arroz'],
    ['cuantos huevos me quedan', 'huevos'],
  ];
  for (const [phrase, item] of inverted) {
    it(`"${phrase}" asks about ${item} despite the word order`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_QUANTITY', item });
    });
  }

  const expiring = ['que esta venciendo', 'que vence', 'cuales items estan venciendo',
    'que va a vencer'];
  for (const phrase of expiring) {
    it(`"${phrase}" asks what is expiring`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: false });
    });
  }

  const expired = ['que ha vencido', 'que ya vencio'];
  for (const phrase of expired) {
    it(`"${phrase}" asks only for what is already past`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: true });
    });
  }

  it('reads a window out of the question', () => {
    expect(say('que vence en los proximos 30 dias')).toMatchObject({
      kind: 'QUERY_EXPIRING', withinDays: 30,
    });
  });

  const missing = ['que falta', 'que me falta', 'que necesito comprar',
    'lista de compras', 'que esta acabando'];
  for (const phrase of missing) {
    it(`"${phrase}" asks what is missing`, () => {
      expect(say(phrase).kind).toBe('QUERY_MISSING');
    });
  }

  const whereItem: ReadonlyArray<readonly [string, string]> = [
    ['donde esta el arroz', 'arroz'],
    ['donde estan las pilas', 'pilas'],
  ];
  for (const [phrase, item] of whereItem) {
    it(`"${phrase}" asks where ${item} is`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_WHERE', item, location: null });
    });
  }

  const whereLocation: ReadonlyArray<readonly [string, string]> = [
    ['que hay en la despensa', 'despensa'],
    ['que tengo en el congelador', 'congelador'],
  ];
  for (const [phrase, location] of whereLocation) {
    it(`"${phrase}" asks what is in the ${location}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_WHERE', item: null, location });
    });
  }

  const expiryOf = ['cuando vence la leche', 'cuando caduca la leche'];
  for (const phrase of expiryOf) {
    it(`"${phrase}" asks when milk expires`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_EXPIRY_OF', item: 'leche' });
    });
  }

  const score = ['como estoy de preparacion', 'que tan preparado estoy'];
  for (const phrase of score) {
    it(`"${phrase}" asks for the preparedness score`, () => {
      expect(say(phrase).kind).toBe('QUERY_SCORE');
    });
  }

  const help = ['ayuda', 'que puedes hacer'];
  for (const phrase of help) {
    it(`"${phrase}" asks for help`, () => {
      expect(say(phrase).kind).toBe('HELP');
    });
  }
});

describe('es phrases: changing', () => {
  it('adds with a spoken number', () => {
    expect(say('agrega cinco latas de frijoles')).toEqual({
      kind: 'ADJUST_QUANTITY', item: 'frijoles', amount: 5,
      direction: 'up', transaction: 'add', unit: 'latas',
    });
  });

  it('adds with a single-word numeral above twenty', () => {
    expect(say('anade veinticinco latas de frijoles')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'frijoles', amount: 25, direction: 'up',
    });
  });

  it('adds with a multi-word numeral', () => {
    expect(say('agrega treinta y cinco latas de frijoles')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'frijoles', amount: 35, direction: 'up',
    });
  });

  it('records a purchase as a purchase', () => {
    expect(say('compre 2 kg de arroz')).toMatchObject({
      direction: 'up', transaction: 'purchase', amount: 2, item: 'arroz',
    });
  });

  it('records consumption as consumption', () => {
    expect(say('use 3 huevos')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'huevos', amount: 3,
      direction: 'down', transaction: 'consume',
    });
  });

  it('removes with a fraction', () => {
    expect(say('quita medio kilo de arroz')).toMatchObject({
      direction: 'down', amount: 0.5, item: 'arroz',
    });
  });

  it('consumes half a dozen', () => {
    expect(say('comi media docena de huevos')).toMatchObject({
      direction: 'down', amount: 6, item: 'huevos',
    });
  });

  it('adds a pair', () => {
    expect(say('agrega un par de pilas')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'pilas', amount: 2, direction: 'up',
    });
  });

  /**
   * Spanish says it both ways round - "pon mas 2 huevos" and "agrega 2 huevos
   * mas" - so "mas" is stripped ahead of the numeral AND listed as a filler.
   * Either way it carries no arithmetic of its own: the verb already said which
   * direction the stock moves.
   */
  it('tolerates "mas" between the verb and the number', () => {
    expect(say('pon mas 2 huevos')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'huevos', amount: 2, direction: 'up',
    });
  });

  it('tolerates "mas" after the item', () => {
    expect(say('agrega 2 huevos mas')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'huevos', amount: 2, direction: 'up',
    });
  });

  it('keeps the verb in charge of the direction', () => {
    expect(say('quita mas 2 huevos')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'huevos', amount: 2, direction: 'down',
    });
  });

  it('sets an absolute quantity', () => {
    expect(say('ahora tengo 12 latas de frijoles')).toMatchObject({
      kind: 'SET_QUANTITY', amount: 12, item: 'frijoles', unit: 'latas',
    });
  });

  it('sets an absolute quantity of zero', () => {
    expect(say('ahora tengo cero huevos')).toMatchObject({
      kind: 'SET_QUANTITY', amount: 0, item: 'huevos',
    });
  });

  it('sets an expiry date with a bare day', () => {
    expect(say('la leche vence el 12')).toEqual({
      kind: 'SET_EXPIRY', item: 'leche', expiresOn: '2026-09-12',
    });
  });

  it('sets an expiry date with a month', () => {
    expect(say('la leche vence en marzo')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'leche', expiresOn: '2027-03-31',
    });
  });

  it('sets an expiry date with a day and month', () => {
    expect(say('el arroz vence el 10 de octubre')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'arroz', expiresOn: '2026-10-10',
    });
  });

  it('sets an expiry date a number of days out', () => {
    expect(say('el pan vence en 10 dias')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'pan', expiresOn: '2026-09-17',
    });
  });

  it('creates an item with everything it was told', () => {
    expect(say('crear item 10 kg de arroz en la despensa')).toMatchObject({
      kind: 'CREATE_ITEM', name: 'arroz', amount: 10, unit: 'kg', location: 'despensa',
    });
  });
});

describe('es phrases: what must NOT parse', () => {
  const rejected = ['', '   ', 'arroz', 'frijoles negros', 'y', 'aaa bbb ccc',
    'gracias', 'quita de arroz', 'agrega latas de'];
  for (const phrase of rejected) {
    it(`"${phrase}" is UNKNOWN rather than a guess`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * A question with no item is a question the application cannot answer, and
   * the item is what is missing rather than something it failed to hear.
   */
  const itemless = ['cuanto hay', 'cuanto tengo', 'tengo cuanto'];
  for (const phrase of itemless) {
    it(`"${phrase}" names no item, so it is UNKNOWN`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * A write with no number stays UNKNOWN.
   *
   * "compre arroz" is a real sentence and the temptation is to read it as +1.
   * Nothing in it says one. Guessing writes a number the user never said into
   * an emergency food inventory and, worse, tells them it worked. UNKNOWN puts
   * the transcript back on the screen, where a person can see it and say the
   * amount.
   */
  const amountless = ['compre arroz', 'use huevos', 'agrega frijoles',
    'quita arroz', 'compre latas de frijoles'];
  for (const phrase of amountless) {
    it(`"${phrase}" names no amount, so it is UNKNOWN`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * "menos" is deliberately not tolerated where "mas" is. "pon menos 2 huevos"
   * has no settled meaning - two fewer than what? - and the verb says add, so
   * any reading is a guess at a write.
   */
  it('"pon menos 2 huevos" is UNKNOWN, because only "mas" is a filler', () => {
    expect(say('pon menos 2 huevos').kind).toBe('UNKNOWN');
  });

  /** An impossible date is refused rather than repaired. */
  it('"el arroz vence el 31 de abril" is UNKNOWN, because that date never happens', () => {
    expect(say('el arroz vence el 31 de abril').kind).toBe('UNKNOWN');
  });
});

describe('es phrases: as a recognizer returns them', () => {
  it('survives missing accents', () => {
    expect(say('cuanto azucar tengo')).toEqual({ kind: 'QUERY_QUANTITY', item: 'azucar' });
  });

  it('survives full accents', () => {
    expect(say('Cuánto azúcar tengo')).toEqual({ kind: 'QUERY_QUANTITY', item: 'azucar' });
  });

  /**
   * The opener is the row that matters most in this file. `foldText` strips
   * combining marks and U+00BF is not one, so without the punctuation strip in
   * `parse.ts` every rule anchored at `^` would silently never match and the
   * whole language would answer UNKNOWN to correctly spoken Spanish.
   */
  it('survives the inverted question mark', () => {
    expect(say('¿Cuánto azúcar tengo?')).toEqual({ kind: 'QUERY_QUANTITY', item: 'azucar' });
  });

  it('survives an inverted opener on a write', () => {
    expect(say('¿Cuántas latas de frijoles tengo?')).toEqual({
      kind: 'QUERY_QUANTITY', item: 'frijoles',
    });
  });

  it('survives collapsed whitespace', () => {
    expect(say('  cuanto   arroz  ')).toEqual({ kind: 'QUERY_QUANTITY', item: 'arroz' });
  });
});
