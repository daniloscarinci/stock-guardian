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
      direction: 'up', transaction: 'add', unit: 'latas', amountAssumed: false,
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

  /**
   * A write with no number is read as one, and says so.
   *
   * These rows used to sit under "what must NOT parse": nothing in "comprei
   * arroz" says one, and guessing writes a number the user never said. None of
   * that reasoning was wrong, but on a real phone it turned the most ordinary
   * sentence anyone says into a transcript on the screen and no change at all.
   *
   * The number is now assumed AND FLAGGED. `amountAssumed` is what carries the
   * old caution: a flagged amount reaches the confirmation card, never the
   * database, so the guess is offered rather than stored behind the user's back.
   */
  const assumedOne: ReadonlyArray<readonly [string, string, 'up' | 'down']> = [
    ['comprei arroz', 'arroz', 'up'],
    ['usei ovos', 'ovos', 'down'],
    ['adiciona feijao', 'feijao', 'up'],
    ['tira arroz', 'arroz', 'down'],
    ['comprei latas de feijao', 'feijao', 'up'],
  ];
  for (const [phrase, item, direction] of assumedOne) {
    it(`"${phrase}" means one ${item}, marked as assumed`, () => {
      expect(say(phrase)).toMatchObject({
        kind: 'ADJUST_QUANTITY', item, amount: 1, direction, amountAssumed: true,
      });
    });
  }

  it('does not mark an amount that was spoken', () => {
    expect(say('usei 3 ovos')).toMatchObject({ amount: 3, amountAssumed: false });
  });

  it('sets an expiry date with a bare day', () => {
    expect(say('o leite vence dia 12')).toEqual({
      kind: 'SET_EXPIRY', item: 'leite', expiresOn: '2026-09-12', dateAssumed: false,
    });
  });

  /**
   * A month with no day, and a period rather than a day, are dates this
   * application chose. "em marco" is stored as the 31st because a deadline has
   * to be some day; the speaker never said the 31st, so it is flagged.
   */
  it('sets an expiry date with a month, and marks the day as its own', () => {
    expect(say('o leite vence em marco')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'leite', expiresOn: '2027-03-31', dateAssumed: true,
    });
  });

  it('marks a relative period as a date it chose', () => {
    expect(say('o leite vence semana que vem')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'leite', expiresOn: '2026-09-14', dateAssumed: true,
    });
    expect(say('o pao vence daqui a 30 dias')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'pao', expiresOn: '2026-10-07', dateAssumed: true,
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
      kind: 'SET_EXPIRY', item: 'leite', expiresOn: '2026-09-12', dateAssumed: false,
    });
  });

  /**
   * A day that exists but has not come round yet rolls forward to a month that
   * really has it. September has no 31st, so the next 31st is October's.
   */
  it('rolls a day forward to a month that has it', () => {
    // The day was stated, and October is the only month that can hold it, so
    // nothing here was chosen for the speaker.
    expect(say('o leite vence dia 31')).toEqual({
      kind: 'SET_EXPIRY', item: 'leite', expiresOn: '2026-10-31', dateAssumed: false,
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
    'obrigado'];
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
   * The other half of "a missing number means one".
   *
   * "comprei arroz" is now read as +1 and flagged, but these two are not short
   * sentences - they are clipped ones, and what is missing from each is more
   * than the number.
   *
   *   "tira de arroz" opens with a partitive. "de" belonged to a measure the
   *   recognizer dropped - "tira [dois quilos] de arroz" - so the phrase is
   *   evidence that something was said and lost, not that nothing was said.
   *   "adiciona latas de" has no item left once the unit and the filler come
   *   off, and an adjustment with no item is not an adjustment.
   */
  const clipped = ['tira de arroz', 'adiciona latas de'];
  for (const phrase of clipped) {
    it(`"${phrase}" is a fragment, so it stays UNKNOWN`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * "menos" is deliberately not tolerated where "mais" is. "poe menos 2 ovos"
   * has no settled meaning - two fewer than what? - and the verb says "add", so
   * any reading is a guess at a write. It stays UNKNOWN on purpose.
   *
   * The assumed one cannot rescue it either, and must not: a numeral WAS
   * spoken here. Reading this as one egg would not fill a gap, it would
   * overrule the two the user said.
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
