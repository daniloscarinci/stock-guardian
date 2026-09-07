/**
 * Every English phrase form the application claims to understand.
 *
 * A transcript arrives without punctuation or capitals, which is why the rows
 * below are written the way a recognizer actually returns them rather than the
 * way a person would type them.
 *
 * When a real phrase fails in real use, add it here first.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../parse';
import { enGrammar } from './en';
import type { Intent } from '../intents';

const CTX = { today: '2026-09-07' };
const say = (text: string): Intent => parse(enGrammar, text, CTX);

describe('en phrases: asking', () => {
  const quantity = ['how much rice do i have', 'how much rice', 'how many cans of beans',
    'do i have sugar', 'how many eggs are left', 'is there any water',
    'how much rice is left'];
  for (const phrase of quantity) {
    it(`"${phrase}" asks a quantity`, () => {
      expect(say(phrase).kind).toBe('QUERY_QUANTITY');
    });
  }

  it('recovers the item from a quantity question', () => {
    expect(say('how many cans of black beans do i have')).toEqual({
      kind: 'QUERY_QUANTITY', item: 'black beans',
    });
  });

  /**
   * English wraps the item in the question where Portuguese puts the verb in
   * front of it, so more of the sentence ends up inside the item capture.
   * "eggs do i still have" as an item means the search reports, confidently,
   * that the user has no such product.
   */
  const trailingVerb: ReadonlyArray<readonly [string, string]> = [
    ['how many eggs do i have', 'eggs'],
    ['how much rice do i still have', 'rice'],
    ['how many eggs are left', 'eggs'],
    ['how much coffee is left', 'coffee'],
    ['do i have any rice', 'rice'],
  ];
  for (const [phrase, item] of trailingVerb) {
    it(`"${phrase}" asks about ${item}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_QUANTITY', item });
    });
  }

  const expiring = ['what is expiring', 'whats expiring', 'what is about to expire',
    'which items are expiring'];
  for (const phrase of expiring) {
    it(`"${phrase}" asks what is expiring`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: false });
    });
  }

  const expired = ['what has expired', 'what already expired'];
  for (const phrase of expired) {
    it(`"${phrase}" asks only for what is already past`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: true });
    });
  }

  it('reads a window out of the question', () => {
    expect(say('what will expire in the next 30 days')).toMatchObject({
      kind: 'QUERY_EXPIRING', withinDays: 30,
    });
  });

  const missing = ['what do i need', 'what do i need to buy', 'what am i missing',
    'shopping list', 'what is running low'];
  for (const phrase of missing) {
    it(`"${phrase}" asks what is missing`, () => {
      expect(say(phrase).kind).toBe('QUERY_MISSING');
    });
  }

  const whereItem: ReadonlyArray<readonly [string, string]> = [
    ['where is the rice', 'rice'],
    ['where are the batteries', 'batteries'],
  ];
  for (const [phrase, item] of whereItem) {
    it(`"${phrase}" asks where ${item} is`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_WHERE', item, location: null });
    });
  }

  const whereLocation: ReadonlyArray<readonly [string, string]> = [
    ['what is in the pantry', 'pantry'],
    ['what do i have in the freezer', 'freezer'],
  ];
  for (const [phrase, location] of whereLocation) {
    it(`"${phrase}" asks what is in the ${location}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_WHERE', item: null, location });
    });
  }

  const expiryOf = ['when does the milk expire', 'when is the milk expiring',
    'what is the expiry date of the milk'];
  for (const phrase of expiryOf) {
    it(`"${phrase}" asks when milk expires`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_EXPIRY_OF', item: 'milk' });
    });
  }

  const score = ['how prepared am i', 'what is my preparedness score'];
  for (const phrase of score) {
    it(`"${phrase}" asks for the preparedness score`, () => {
      expect(say(phrase).kind).toBe('QUERY_SCORE');
    });
  }

  const help = ['help', 'what can you do'];
  for (const phrase of help) {
    it(`"${phrase}" asks for help`, () => {
      expect(say(phrase).kind).toBe('HELP');
    });
  }
});

describe('en phrases: changing', () => {
  it('adds with a spoken number', () => {
    expect(say('add five cans of beans')).toEqual({
      kind: 'ADJUST_QUANTITY', item: 'beans', amount: 5,
      direction: 'up', transaction: 'add', unit: 'cans', amountAssumed: false,
    });
  });

  it('adds with a multi-word numeral', () => {
    expect(say('add twenty five cans of beans')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'beans', amount: 25, direction: 'up',
    });
  });

  it('records a purchase as a purchase', () => {
    expect(say('i bought 2 kg of rice')).toMatchObject({
      direction: 'up', transaction: 'purchase', amount: 2, item: 'rice',
    });
  });

  it('records consumption as consumption', () => {
    expect(say('i used 3 eggs')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'eggs', amount: 3,
      direction: 'down', transaction: 'consume',
    });
  });

  it('removes with a fraction', () => {
    expect(say('take half a kilo of rice')).toMatchObject({
      direction: 'down', amount: 0.5, item: 'rice',
    });
  });

  /**
   * "half a dozen" is the English shape the other two languages do not have -
   * an article standing between the fraction and the group word. Read
   * literally it is 0.5 + 1 dozen, eighteen eggs; the speaker said six.
   */
  it('eats half a dozen', () => {
    expect(say('i ate half a dozen eggs')).toMatchObject({
      direction: 'down', amount: 6, item: 'eggs',
    });
  });

  /**
   * The indefinite article IS a number here, exactly as "uma" is in the
   * Portuguese table. "add a can of beans" names one can as plainly as "add
   * one can of beans" does, and refusing it would leave the most ordinary way
   * of adding a single thing UNKNOWN.
   */
  it('reads the indefinite article as one', () => {
    expect(say('add a can of beans')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'beans', amount: 1, direction: 'up',
    });
  });

  it('buys a dozen', () => {
    expect(say('i bought a dozen eggs')).toMatchObject({
      transaction: 'purchase', amount: 12, item: 'eggs',
    });
  });

  /**
   * English puts "more" after the number where Portuguese puts "mais" before
   * it. Either way the word carries no arithmetic of its own - the verb has
   * already said which way the stock moves.
   */
  it('tolerates "more" after the number', () => {
    expect(say('add 2 more eggs')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'eggs', amount: 2, direction: 'up',
    });
  });

  it('keeps the verb in charge of the direction', () => {
    expect(say('take 2 more eggs')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'eggs', amount: 2, direction: 'down',
    });
  });

  it('sets an absolute quantity', () => {
    expect(say('now i have 12 cans of beans')).toMatchObject({
      kind: 'SET_QUANTITY', amount: 12, item: 'beans', unit: 'cans',
    });
  });

  it('sets an absolute quantity of zero', () => {
    expect(say('actually i have zero eggs')).toMatchObject({
      kind: 'SET_QUANTITY', amount: 0, item: 'eggs',
    });
  });

  /**
   * A write with no number is read as one, and says so.
   *
   * These rows used to sit under "what must NOT parse": nothing in "i bought
   * rice" says one, and guessing writes a number the user never said. None of
   * that reasoning was wrong, but on a real phone it turned the most ordinary
   * sentence anyone says into a transcript on the screen and no change at all.
   *
   * The number is now assumed AND FLAGGED. `amountAssumed` is what carries the
   * old caution: a flagged amount reaches the confirmation card, never the
   * database, so the guess is offered rather than stored behind the user's back.
   */
  const assumedOne: ReadonlyArray<readonly [string, string, 'up' | 'down']> = [
    ['i bought rice', 'rice', 'up'],
    ['i used eggs', 'eggs', 'down'],
    ['add beans', 'beans', 'up'],
    ['remove rice', 'rice', 'down'],
    ['add some rice', 'rice', 'up'],
    ['i bought cans of beans', 'beans', 'up'],
  ];
  for (const [phrase, item, direction] of assumedOne) {
    it(`"${phrase}" means one ${item}, marked as assumed`, () => {
      expect(say(phrase)).toMatchObject({
        kind: 'ADJUST_QUANTITY', item, amount: 1, direction, amountAssumed: true,
      });
    });
  }

  it('does not mark an amount that was spoken', () => {
    expect(say('i used 3 eggs')).toMatchObject({ amount: 3, amountAssumed: false });
  });

  it('sets an expiry date with a bare day', () => {
    expect(say('the milk expires on the 12th')).toEqual({
      kind: 'SET_EXPIRY', item: 'milk', expiresOn: '2026-09-12', dateAssumed: false,
    });
  });

  /**
   * A month with no day, and a period rather than a day, are dates this
   * application chose. "in march" is stored as the 31st because a deadline has
   * to be some day; the speaker never said the 31st, so it is flagged.
   */
  it('sets an expiry date with a month, and marks the day as its own', () => {
    expect(say('the milk expires in march')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'milk', expiresOn: '2027-03-31', dateAssumed: true,
    });
  });

  it('marks a relative period as a date it chose', () => {
    expect(say('the milk expires next week')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'milk', expiresOn: '2026-09-14', dateAssumed: true,
    });
  });

  /**
   * English names the month before the day. The shared date parser reads the
   * other order, so `en.ts` turns the phrase around before handing it over -
   * see `turnAroundMonthDay`.
   */
  it('sets an expiry date with a month before the day', () => {
    expect(say('the rice expires on october 10')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'rice', expiresOn: '2026-10-10',
    });
  });

  it('sets an expiry date with the day before the month', () => {
    expect(say('the rice expires on the 10th of october')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'rice', expiresOn: '2026-10-10',
    });
  });

  it('sets an expiry date a number of days out', () => {
    expect(say('the bread expires in 10 days')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'bread', expiresOn: '2026-09-17', dateAssumed: true,
    });
  });

  it('creates an item with everything it was told', () => {
    expect(say('create item 10 kg of rice in the pantry')).toMatchObject({
      kind: 'CREATE_ITEM', name: 'rice', amount: 10, unit: 'kg', location: 'pantry',
    });
  });
});

describe('en phrases: what must NOT parse', () => {
  const rejected = ['', '   ', 'rice', 'black beans', 'and', 'aaa bbb ccc',
    'thank you'];
  for (const phrase of rejected) {
    it(`"${phrase}" is UNKNOWN rather than a guess`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * A question with no item is a question the application cannot answer, and
   * the item is what is missing rather than something it failed to hear.
   */
  const itemless = ['how much do i have', 'how many are left', 'how much is there'];
  for (const phrase of itemless) {
    it(`"${phrase}" names no item, so it is UNKNOWN`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * The other half of "a missing number means one".
   *
   * "i bought rice" is now read as +1 and flagged, but these two are not short
   * sentences - they are clipped ones, and what is missing from each is more
   * than the number.
   *
   *   "take of rice" opens with a partitive. "of" belonged to a measure the
   *   recognizer dropped - "take [two kilos] of rice" - so the phrase is
   *   evidence that something was said and lost, not that nothing was said.
   *   "add cans of" has no item left once the unit and the filler come off,
   *   and an adjustment with no item is not an adjustment.
   */
  const clipped = ['take of rice', 'add cans of'];
  for (const phrase of clipped) {
    it(`"${phrase}" is a fragment, so it stays UNKNOWN`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * "less" and "fewer" are deliberately not tolerated where "more" is. "add
   * fewer 2 eggs" has no settled meaning, and the verb says add, so any
   * reading is a guess at a write.
   *
   * The assumed one cannot rescue it either, and must not: a numeral WAS
   * spoken here. Reading this as one egg would not fill a gap, it would
   * overrule the two the user said.
   */
  it('"add fewer 2 eggs" is UNKNOWN, because only "more" is a filler', () => {
    expect(say('add fewer 2 eggs').kind).toBe('UNKNOWN');
  });

  /** An impossible date is refused rather than repaired. */
  it('"the rice expires on april 31" is UNKNOWN, because that date never happens', () => {
    expect(say('the rice expires on april 31').kind).toBe('UNKNOWN');
  });
});

describe('en phrases: as a recognizer returns them', () => {
  it('survives a trailing period', () => {
    expect(say('how much rice do i have.')).toEqual({ kind: 'QUERY_QUANTITY', item: 'rice' });
  });

  it('survives capitals and a question mark', () => {
    expect(say('How much Rice do I have?')).toEqual({ kind: 'QUERY_QUANTITY', item: 'rice' });
  });

  it('survives collapsed whitespace', () => {
    expect(say('  how   much  rice  ')).toEqual({ kind: 'QUERY_QUANTITY', item: 'rice' });
  });
});
