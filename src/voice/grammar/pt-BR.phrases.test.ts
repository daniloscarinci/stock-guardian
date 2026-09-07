/**
 * Every Portuguese phrase form the application claims to understand.
 *
 * A transcript arrives without punctuation or capitals and often without
 * accents, which is why most rows below are written the way a recognizer
 * actually returns them rather than the way a person would type them.
 *
 * When a real phrase fails in real use, add it here first.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../parse';
import { ptBRGrammar } from './pt-BR';
import type { Intent } from '../intents';

const CTX = { today: '2026-09-07' };
const say = (text: string): Intent => parse(ptBRGrammar, text, CTX);

describe('pt-BR phrases: asking', () => {
  const quantity = ['quanto arroz eu tenho', 'quanto arroz', 'quantas latas de feijao tem',
    'tem acucar', 'tenho agua', 'quanta agua eu tenho', 'ainda tem cafe'];
  for (const phrase of quantity) {
    it(`"${phrase}" asks a quantity`, () => {
      expect(say(phrase).kind).toBe('QUERY_QUANTITY');
    });
  }

  it('recovers the item from a quantity question', () => {
    expect(say('quantas latas de feijao preto eu tenho')).toEqual({
      kind: 'QUERY_QUANTITY', item: 'feijao preto',
    });
  });

  /**
   * The verb can trail the item, and it can be plural.
   *
   * "quantos ovos restam" is the most ordinary way to ask this, and the item
   * has to come back as "ovos" rather than "ovos restam" - a leftover verb in
   * the item phrase means the search looks for a product by that name and
   * reports, confidently, that the user has none of it.
   */
  const trailingVerb: ReadonlyArray<readonly [string, string]> = [
    ['quantos ovos restam', 'ovos'],
    ['quanto arroz sobrou', 'arroz'],
    ['quantas latas de feijao sobraram', 'feijao'],
    ['quanto leite tem', 'leite'],
  ];
  for (const [phrase, item] of trailingVerb) {
    it(`"${phrase}" asks about ${item}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_QUANTITY', item });
    });
  }

  /**
   * Inverted order, decided rather than inherited - see the report and the
   * comment on `stripQueryWords` in pt-BR.ts. These are read-only questions, so
   * answering the plausible reading costs nothing that a wrong write would.
   */
  const inverted: ReadonlyArray<readonly [string, string]> = [
    ['tenho quanto de acucar', 'acucar'],
    ['restam quantos ovos', 'ovos'],
    ['tem quanto de arroz', 'arroz'],
  ];
  for (const [phrase, item] of inverted) {
    it(`"${phrase}" asks about ${item} despite the word order`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_QUANTITY', item });
    });
  }

  const expiring = ['o que esta vencendo', 'o que vai vencer', 'o que vence',
    'quais itens estao vencendo'];
  for (const phrase of expiring) {
    it(`"${phrase}" asks what is expiring`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: false });
    });
  }

  it('separates what already expired from what is about to', () => {
    expect(say('o que ja venceu')).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: true });
  });

  it('reads a window out of the question', () => {
    expect(say('o que vence nos proximos 30 dias')).toMatchObject({
      kind: 'QUERY_EXPIRING', withinDays: 30,
    });
  });

  const missing = ['o que falta', 'o que esta faltando', 'o que eu preciso comprar',
    'lista de compras', 'o que esta acabando'];
  for (const phrase of missing) {
    it(`"${phrase}" asks what is missing`, () => {
      expect(say(phrase).kind).toBe('QUERY_MISSING');
    });
  }

  it('asks where an item is', () => {
    expect(say('onde esta o arroz')).toEqual({
      kind: 'QUERY_WHERE', item: 'arroz', location: null,
    });
  });

  it('asks what is in a place', () => {
    expect(say('o que tem na despensa')).toEqual({
      kind: 'QUERY_WHERE', item: null, location: 'despensa',
    });
  });

  it('asks when something expires', () => {
    expect(say('quando vence o leite')).toEqual({ kind: 'QUERY_EXPIRY_OF', item: 'leite' });
  });

  it('asks for the preparedness score', () => {
    expect(say('como esta minha preparacao').kind).toBe('QUERY_SCORE');
  });
});

describe('pt-BR phrases: changing', () => {
  it('adds with a spoken number', () => {
    expect(say('adiciona cinco latas de feijao')).toEqual({
      kind: 'ADJUST_QUANTITY', item: 'feijao', amount: 5,
      direction: 'up', transaction: 'add', unit: 'latas',
    });
  });

  it('adds with a multi-word numeral', () => {
    expect(say('adiciona vinte e cinco latas de feijao')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'feijao', amount: 25, direction: 'up',
    });
  });

  it('records a purchase as a purchase', () => {
    expect(say('comprei 2 kg de arroz')).toMatchObject({
      direction: 'up', transaction: 'purchase', amount: 2,
    });
  });

  it('records consumption as consumption', () => {
    expect(say('usei 3 ovos')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'ovos', amount: 3,
      direction: 'down', transaction: 'consume',
    });
  });

  it('removes with a fraction', () => {
    expect(say('tira meio quilo de arroz')).toMatchObject({
      direction: 'down', amount: 0.5, item: 'arroz',
    });
  });

  it('consumes half a dozen', () => {
    expect(say('usei meia duzia de ovos')).toMatchObject({
      direction: 'down', amount: 6, item: 'ovos',
    });
  });

  /**
   * "põe mais dois ovos" is how the sentence is actually spoken. "mais" sits
   * between the verb and the number and carries no arithmetic of its own - the
   * verb already said which way the stock moves, and "tira mais 2" removes two
   * more rather than adding them.
   */
  it('tolerates "mais" between the verb and the number', () => {
    expect(say('poe mais 2 ovos')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'ovos', amount: 2, direction: 'up',
    });
  });

  it('keeps the verb in charge of the direction', () => {
    expect(say('tira mais 2 ovos')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'ovos', amount: 2, direction: 'down',
    });
  });

  it('sets an absolute quantity', () => {
    expect(say('agora tenho 12 latas de feijao')).toMatchObject({
      kind: 'SET_QUANTITY', amount: 12, item: 'feijao',
    });
  });

  it('sets an expiry date with a bare day', () => {
    expect(say('o leite vence dia 12')).toEqual({
      kind: 'SET_EXPIRY', item: 'leite', expiresOn: '2026-09-12',
    });
  });

  it('sets an expiry date with a month', () => {
    expect(say('o leite vence em marco')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'leite', expiresOn: '2027-03-31',
    });
  });

  it('sets an expiry date with a day and month', () => {
    expect(say('o arroz vence em 10 de outubro')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'arroz', expiresOn: '2026-10-10',
    });
  });

  /**
   * A day spoken WITH its month keeps that month. This row exists because the
   * date layer used to lose it: "dia" was swallowed into the day capture, the
   * day-month branch failed, and the phrase fell through to a branch that
   * cannot see a month at all.
   */
  it('keeps the month when the day is announced as "dia"', () => {
    expect(say('o leite vence dia 12 de setembro')).toEqual({
      kind: 'SET_EXPIRY', item: 'leite', expiresOn: '2026-09-12',
    });
  });

  /**
   * A day that exists but has not come round yet rolls forward to a month that
   * really has it. September has no 31st, so the next 31st is October's.
   */
  it('rolls a day forward to a month that has it', () => {
    expect(say('o leite vence dia 31')).toEqual({
      kind: 'SET_EXPIRY', item: 'leite', expiresOn: '2026-10-31',
    });
  });

  it('creates an item with everything it was told', () => {
    expect(say('criar item 10 kg de arroz na despensa')).toMatchObject({
      kind: 'CREATE_ITEM', name: 'arroz', amount: 10, unit: 'kg', location: 'despensa',
    });
  });
});

describe('pt-BR phrases: what must NOT parse', () => {
  const rejected = ['', '   ', 'feijao', 'feijao preto', 'e', 'aaa bbb ccc',
    'obrigado', 'tira de arroz', 'adiciona latas de'];
  for (const phrase of rejected) {
    it(`"${phrase}" is UNKNOWN rather than a guess`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * A question with no item is a question the application cannot answer, and
   * the item is what is missing rather than something it failed to hear. These
   * used to come back as QUERY_QUANTITY for a product called "tem".
   */
  const itemless = ['quanto tem', 'quantos tem', 'tenho quanto'];
  for (const phrase of itemless) {
    it(`"${phrase}" names no item, so it is UNKNOWN`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * A write with no number stays UNKNOWN.
   *
   * "comprei arroz" is a real sentence and the temptation is to read it as +1.
   * Nothing in it says one. Guessing writes a number the user never said into
   * an emergency food inventory and, worse, tells them it worked - the exact
   * failure this whole design exists to prevent. UNKNOWN puts the transcript
   * back on the screen, where a person can see it and say the amount.
   */
  const amountless = ['comprei arroz', 'usei ovos', 'adiciona feijao',
    'tira arroz', 'comprei latas de feijao'];
  for (const phrase of amountless) {
    it(`"${phrase}" names no amount, so it is UNKNOWN`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * "menos" is deliberately not tolerated where "mais" is. "poe menos 2 ovos"
   * has no settled meaning - two fewer than what? - and the verb says "add", so
   * any reading is a guess at a write. It stays UNKNOWN on purpose.
   */
  it('"poe menos 2 ovos" is UNKNOWN, because only "mais" is a filler', () => {
    expect(say('poe menos 2 ovos').kind).toBe('UNKNOWN');
  });

  /**
   * An impossible date is refused rather than repaired. April has never had a
   * 31st, so there is no year in which this phrase means anything.
   */
  it('"o arroz vence 31 de abril" is UNKNOWN, because that date never happens', () => {
    expect(say('o arroz vence 31 de abril').kind).toBe('UNKNOWN');
  });
});

describe('pt-BR phrases: as a recognizer returns them', () => {
  it('survives missing accents', () => {
    expect(say('quanto acucar eu tenho')).toEqual({ kind: 'QUERY_QUANTITY', item: 'acucar' });
  });

  it('survives full accents', () => {
    expect(say('Quanto açúcar eu tenho?')).toEqual({ kind: 'QUERY_QUANTITY', item: 'acucar' });
  });

  it('survives collapsed whitespace', () => {
    expect(say('  quanto   arroz  ')).toEqual({ kind: 'QUERY_QUANTITY', item: 'arroz' });
  });
});
