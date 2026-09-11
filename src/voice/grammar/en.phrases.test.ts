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
    'how much rice is left',
    // The clipped register, which is most of what a phone actually receives:
    // no auxiliary, no question mark, the apostrophe the recognizer inserts.
    'any rice left', 'any rice', 'got any coffee', 'got coffee',
    'do i still have rice', "what's left of the rice", 'whats left of the rice',
    'tell me how much rice is left', 'show me how much rice i have',
    'how much rice remains', "how's my rice"];
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
    'which items are expiring',
    "what's expiring", 'anything expiring', 'is anything expiring',
    'is there anything expiring', 'anything about to go bad',
    'whats going off', 'what is going bad', 'which things are expiring',
    'what will expire'];
  for (const phrase of expiring) {
    it(`"${phrase}" asks what is expiring`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: false });
    });
  }

  const expired = ['what has expired', 'what already expired', 'what expired',
    'whats gone bad', 'what has gone off', 'anything expired'];
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

  /**
   * A period is a window too.
   *
   * "this week" and "this month" are the ordinary way to ask, and the number
   * behind each is this application's own - seven and thirty, the figures the
   * expiry screen already uses. Saying it out loud in a row here is what keeps
   * that choice honest: nobody said seven.
   */
  const windows: ReadonlyArray<readonly [string, number]> = [
    ['what expires today', 0],
    ['what expires tomorrow', 1],
    ['what expires this week', 7],
    ['what is expiring this month', 30],
    ['what expires within 10 days', 10],
  ];
  for (const [phrase, withinDays] of windows) {
    it(`"${phrase}" asks about ${withinDays} days`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', withinDays });
    });
  }

  const missing = ['what do i need', 'what do i need to buy', 'what am i missing',
    'shopping list', 'what is running low',
    'what do i need to restock', 'what should i pick up', 'what do i need to replace',
    'what am i low on', 'what am i out of', 'what am i nearly out of',
    'what have i run out of', 'what ran out', "what's out of stock",
    'whats gone', 'what needs restocking', 'what needs replacing',
    'the shopping list', 'whats on the shopping list', 'what to buy'];
  for (const phrase of missing) {
    it(`"${phrase}" asks what is missing`, () => {
      expect(say(phrase).kind).toBe('QUERY_MISSING');
    });
  }

  const whereItem: ReadonlyArray<readonly [string, string]> = [
    ['where is the rice', 'rice'],
    ['where are the batteries', 'batteries'],
    ["where's the rice", 'rice'],
    ['wheres the rice', 'rice'],
    ['where do i keep the rice', 'rice'],
    ['where did i put the rice', 'rice'],
    ['where did i leave the rice', 'rice'],
    ['where can i find the rice', 'rice'],
  ];
  for (const [phrase, item] of whereItem) {
    it(`"${phrase}" asks where ${item} is`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_WHERE', item, location: null });
    });
  }

  const whereLocation: ReadonlyArray<readonly [string, string]> = [
    ['what is in the pantry', 'pantry'],
    ['what do i have in the freezer', 'freezer'],
    ["what's in the pantry", 'pantry'],
    ['whats in the pantry', 'pantry'],
    ['what do i keep in the garage', 'garage'],
    ['what is stored in the cellar', 'cellar'],
    ['show me whats in the pantry', 'pantry'],
    ['what have i got in the shed', 'shed'],
  ];
  for (const [phrase, location] of whereLocation) {
    it(`"${phrase}" asks what is in the ${location}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_WHERE', item: null, location });
    });
  }

  const expiryOf = ['when does the milk expire', 'when is the milk expiring',
    'what is the expiry date of the milk', "what's the expiry date of the milk",
    'when will the milk expire', 'when does the milk go bad',
    'when will the milk go off', 'whats the expiration date for the milk'];
  for (const phrase of expiryOf) {
    it(`"${phrase}" asks when milk expires`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_EXPIRY_OF', item: 'milk' });
    });
  }

  const score = ['how prepared am i', 'what is my preparedness score',
    "what's my preparedness score", 'how ready am i', 'am i prepared',
    'am i ready', 'whats my score', 'preparedness score', 'how prepared are we'];
  for (const phrase of score) {
    it(`"${phrase}" asks for the preparedness score`, () => {
      expect(say(phrase).kind).toBe('QUERY_SCORE');
    });
  }

  const help = ['help', 'what can you do', 'what can i say', 'what can i ask',
    'what do you understand', 'what do you know', 'what commands',
    'how does this work', 'how do i use this'];
  for (const phrase of help) {
    it(`"${phrase}" asks for help`, () => {
      expect(say(phrase).kind).toBe('HELP');
    });
  }
});

describe('en phrases: the whole stock, the address book and the past', () => {
  const total = ['how many items do i have', 'how many items', 'how many things do i have',
    'how many items are there', 'how many items in total', 'how many products do we have',
    'total items', 'whats my total', "what's my total", 'how big is my inventory'];
  for (const phrase of total) {
    it(`"${phrase}" counts the whole inventory`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_TOTAL' });
    });
  }

  /**
   * The counting question and the whole-stock question are one word apart.
   *
   * "how many items of rice do i have" is about rice, and it has to survive
   * QUERY_TOTAL to reach the rule that can answer it - the `$` on that rule is
   * what lets it through.
   */
  it('still asks about one item when the sentence names one', () => {
    expect(say('how many items of rice do i have')).toEqual({
      kind: 'QUERY_QUANTITY', item: 'rice',
    });
  });

  const contact: ReadonlyArray<readonly [string, string]> = [
    ["what's the doctor's number", 'doctor'],
    ['whats the doctors number', 'doctor'],
    ['what is the number for the doctor', 'doctor'],
    ['whats the phone number of the doctor', 'doctor'],
    ['the number for the doctor', 'doctor'],
    ['the contact for the plumber', 'plumber'],
    ['how do i call the doctor', 'doctor'],
    ['how do i reach the neighbour', 'neighbour'],
  ];
  for (const [phrase, query] of contact) {
    it(`"${phrase}" looks up ${query} in the contacts`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_CONTACT', query });
    });
  }

  /**
   * The article comes off the front, the possessive off the end, and nothing
   * else moves.
   *
   * `contacts.search` asks whether a stored field CONTAINS the phrase, so "the
   * doctor" matches nothing and "doctor" matches the doctor - while a name
   * with a preposition inside it has to survive whole.
   */
  it('keeps the inside of a name and drops only what surrounds it', () => {
    expect(say('the number for mary of the clinic')).toEqual({
      kind: 'QUERY_CONTACT', query: 'mary of the clinic',
    });
  });

  const history: ReadonlyArray<readonly [string, string]> = [
    ['when did i last buy rice', 'rice'],
    ['when did i buy rice', 'rice'],
    ['when did we buy rice', 'rice'],
    ['when did i last use the beans', 'beans'],
    ['when did i open the milk', 'milk'],
    ['when was the last time i bought rice', 'rice'],
    ['history of the rice', 'rice'],
    ['the history for rice', 'rice'],
    ['the last purchase of rice', 'rice'],
  ];
  for (const [phrase, item] of history) {
    it(`"${phrase}" asks for the history of ${item}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_HISTORY', item });
    });
  }

  /**
   * "when did i buy" and "when does it expire" open identically, and only one
   * of them is about a date in the future. The expiry question is tried first
   * and declines everything that is not about a date, which keeps these apart.
   */
  it('does not read a history question as an expiry question', () => {
    expect(say('when did i buy the milk')).toEqual({ kind: 'QUERY_HISTORY', item: 'milk' });
    expect(say('when does the milk expire')).toEqual({ kind: 'QUERY_EXPIRY_OF', item: 'milk' });
  });

  const category: ReadonlyArray<readonly [string, string]> = [
    ['whats in the food category', 'food'],
    ["what's in the food category", 'food'],
    ['what is in the water category', 'water'],
    ['which items are in the food category', 'food'],
    ['show me the food category', 'food'],
    ['list the food category', 'food'],
    ['category food', 'food'],
  ];
  for (const [phrase, name] of category) {
    it(`"${phrase}" asks for the ${name} category`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_CATEGORY', category: name });
    });
  }

  /**
   * THE DECISION, written down.
   *
   * "what's in food" names something that could be a shelf or could be a
   * category, and the words cannot say which - so the grammar does not try. It
   * produces the LOCATION question, and `execute` looks for a place first and
   * falls back to the category when there is none. A place wins because it is
   * the more concrete of the two: locations are things the user made and
   * named, categories are twenty fixed labels that ship with the application.
   *
   * The unambiguous form above says "category" out loud and skips the race.
   */
  it('leaves the ambiguous form as a place, for execute to resolve', () => {
    expect(say('whats in food')).toEqual({
      kind: 'QUERY_WHERE', item: null, location: 'food',
    });
  });
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

  /**
   * Stock arrives in more ways than it is "added".
   *
   * Each of these is a sentence somebody says out loud in a kitchen, and each
   * one used to be a transcript on the screen and nothing else.
   */
  const arriving: ReadonlyArray<readonly [string, string, number]> = [
    ['i received 4 boxes of milk', 'milk', 4],
    ['restocked 6 cans of beans', 'beans', 6],
    ['i brought 2 bags of rice', 'rice', 2],
    ['stocked 3 bottles of water', 'water', 3],
    ['i stashed 2 kg of rice', 'rice', 2],
    ['topped up 3 cans of beans', 'beans', 3],
    ['i purchased 5 cans of beans', 'beans', 5],
  ];
  for (const [phrase, item, amount] of arriving) {
    it(`"${phrase}" adds ${amount} of ${item}`, () => {
      expect(say(phrase)).toMatchObject({
        kind: 'ADJUST_QUANTITY', item, amount, direction: 'up',
      });
    });
  }

  const leaving: ReadonlyArray<readonly [string, string, number]> = [
    ['i threw out 2 eggs', 'eggs', 2],
    ['tossed 3 eggs', 'eggs', 3],
    ['i drank 2 litres of water', 'water', 2],
    ['we ate 6 eggs', 'eggs', 6],
    ['i opened a can of beans', 'beans', 1],
    ['discarded 2 cans of beans', 'beans', 2],
    ['i lost 3 eggs', 'eggs', 3],
    ['cooked 4 eggs', 'eggs', 4],
    ['i wasted 2 kg of rice', 'rice', 2],
  ];
  for (const [phrase, item, amount] of leaving) {
    it(`"${phrase}" removes ${amount} of ${item}`, () => {
      expect(say(phrase)).toMatchObject({
        kind: 'ADJUST_QUANTITY', item, amount, direction: 'down',
      });
    });
  }

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
   * "i ran out of rice" is a number, not a removal.
   *
   * Read as an adjustment it would take one bag off a shelf that is already
   * empty - wrong, and useless. The speaker is stating what is there now,
   * which is nothing, so it sets the quantity to zero the way "now i have 12"
   * sets it to twelve.
   */
  const emptied = ['i ran out of rice', 'ran out of rice', 'i used up the rice',
    'used all the rice', 'i finished the milk', 'out of milk', 'ate all the eggs'];
  for (const phrase of emptied) {
    it(`"${phrase}" sets the quantity to zero`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_QUANTITY', amount: 0 });
    });
  }

  it('names the item that ran out', () => {
    expect(say('i ran out of rice')).toEqual({
      kind: 'SET_QUANTITY', item: 'rice', amount: 0, unit: null,
    });
  });

  /**
   * A number changes the reading back to an adjustment: "i finished 2 eggs" is
   * two eggs eaten, not an empty carton, and the rule declines rather than
   * storing a zero nobody said.
   */
  it('reads the same verb with a number as an adjustment', () => {
    expect(say('i finished 2 eggs')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'eggs', amount: 2, direction: 'down',
    });
  });

  /**
   * "there are only 2 eggs left" says what is left, which is a correction
   * rather than a removal: two is the count now, not the count that went.
   */
  const leftovers: ReadonlyArray<readonly [string, string, number]> = [
    ['there are only 2 eggs left', 'eggs', 2],
    ['only 2 eggs left', 'eggs', 2],
    ["there's only 1 can of beans left", 'beans', 1],
    ['there are 3 cans of beans left', 'beans', 3],
    ['only 5 kg of rice left', 'rice', 5],
  ];
  for (const [phrase, item, amount] of leftovers) {
    it(`"${phrase}" corrects ${item} to ${amount}`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_QUANTITY', item, amount });
    });
  }

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

  /**
   * "new place, cellar" - a place with no item and nowhere else in the
   * sentence for one to be.
   *
   * The comma is not a word the rule sees: `parse.ts` strips a comma that is
   * not holding a decimal together before any rule runs, so this reaches
   * CREATE_LOCATION as "new place cellar" - the noun and the name separated
   * by nothing but the single space the comma leaves behind.
   */
  it('reads "new place, cellar" as a place to create', () => {
    expect(say('new place, cellar')).toEqual({ kind: 'CREATE_LOCATION', name: 'cellar' });
  });

  it('drops the article from "add a place called the cellar"', () => {
    expect(say('add a place called the cellar')).toEqual({
      kind: 'CREATE_LOCATION', name: 'cellar',
    });
  });

  /**
   * The test that actually guards something: "place" is also a verb in
   * `MOVE_VERBS`, so a sentence that opens with it - "place the rice in the
   * cellar" - has to keep reaching MOVE_ITEM once CREATE_LOCATION exists.
   * CREATE_LOCATION never competes for it: its pattern only ever opens with
   * create, add, new or make, never with "place" itself, so a sentence
   * spoken as a bare verb cannot be read as a creation regardless of where
   * the two rules sit relative to each other.
   *
   * `toEqual` rather than `toMatchObject`, so a future change to this
   * pattern that keeps the kind but mangles the item or the location - "the
   * rice" surviving with its article, say - fails here instead of passing a
   * check that only ever looked at `kind`.
   */
  it('still reads "place the rice in the cellar" as a move', () => {
    expect(say('place the rice in the cellar')).toEqual({
      kind: 'MOVE_ITEM', item: 'rice', location: 'cellar',
    });
  });

  /**
   * "place", "room", "area" and "spot" are ordinary English nouns inside
   * ordinary product names, in a way "item", "product", "entry" and "thing"
   * never are - a household actually has room spray, spot remover and area
   * rugs on a shelf. An earlier draft of the pattern above read the first of
   * these as the noun CREATE_LOCATION looks for and everything after it as
   * the name of a new place, so "add a room spray" made a place called
   * "spray" instead of putting one more can of spray on the stock. It stays
   * ADJUST_QUANTITY here because "add" names no place at all without
   * "called", "named" or a colon after the noun - see the rule's own comment
   * for why only "new" is trusted without one.
   */
  it('does not read "add a room spray" as a place worth making', () => {
    expect(say('add a room spray')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'room spray', direction: 'up',
    });
  });

  /**
   * The same bug, on the verb that has no fallback reading at all. "make" is
   * in nobody's verb map - not ADD_VERBS, not REMOVE_VERBS, not MOVE_VERBS -
   * so where "add a room spray" at least falls back to a stock addition,
   * "make room in the pantry" fell all the way to UNKNOWN before
   * CREATE_LOCATION existed. The loose pattern turned that UNKNOWN into a
   * place called "in the pantry"; the fix is that "make", like "add", is not
   * "new", so a sentence with neither "called" nor "named" nor a colon in it
   * cannot be read as a creation and this phrase falls exactly where it did
   * before CREATE_LOCATION was added.
   */
  it('does not read "make room in the pantry" as a place, and stays UNKNOWN', () => {
    expect(say('make room in the pantry').kind).toBe('UNKNOWN');
  });
});

describe('en phrases: moving and thresholds', () => {
  const moves: ReadonlyArray<readonly [string, string, string]> = [
    ['move the rice to the cellar', 'rice', 'cellar'],
    ['i moved the rice to the cellar', 'rice', 'cellar'],
    ['move the beans into the garage', 'beans', 'garage'],
    ['i put the rice in the cellar', 'rice', 'cellar'],
    ['store the beans in the garage', 'beans', 'garage'],
    ['keep the rice in the pantry', 'rice', 'pantry'],
    ['i took the rice to the kitchen', 'rice', 'kitchen'],
    ['transfer the water to the shed', 'water', 'shed'],
    ['shift the rice over to the cellar', 'rice', 'cellar'],
    ['stash the batteries inside the cupboard', 'batteries', 'cupboard'],
  ];
  for (const [phrase, item, location] of moves) {
    it(`"${phrase}" moves ${item} to the ${location}`, () => {
      expect(say(phrase)).toEqual({ kind: 'MOVE_ITEM', item, location });
    });
  }

  /**
   * The overlap between moving and adding, decided by the destination and by
   * the number.
   *
   * "put" is both. With a shelf it moves the row that exists; without one it
   * is stock arriving. And a NUMBER in front of the item means the sentence is
   * about a quantity, not about a row changing shelf - an item holds one
   * location, so a partial move is not something this application can perform.
   */
  it('reads the same verb as an addition when no destination was named', () => {
    expect(say('i put 5 cans of beans')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'beans', amount: 5, direction: 'up',
    });
  });

  it('reads a numbered phrase as an addition even with a shelf in it', () => {
    expect(say('put 2 kg of rice in the pantry')).toMatchObject({
      kind: 'ADJUST_QUANTITY', amount: 2, direction: 'up',
    });
  });

  const minimums: ReadonlyArray<readonly [string, string, number]> = [
    ['the minimum for rice is 5 kg', 'rice', 5],
    ['minimum of rice is 5 kg', 'rice', 5],
    ['the min for beans is 10 cans', 'beans', 10],
    ['the reorder level for rice is 5 kg', 'rice', 5],
    ['i want to keep at least 5 kg of rice', 'rice', 5],
    ['keep at least 10 cans of beans', 'beans', 10],
    ['i need to have at least 12 bottles of water', 'water', 12],
    ['hold at least 3 packs of batteries', 'batteries', 3],
  ];
  for (const [phrase, item, amount] of minimums) {
    it(`"${phrase}" sets the minimum for ${item} to ${amount}`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_MINIMUM', item, amount });
    });
  }

  it('keeps the unit the minimum was spoken in', () => {
    expect(say('the minimum for rice is 5 kg')).toEqual({
      kind: 'SET_MINIMUM', item: 'rice', amount: 5, unit: 'kg',
    });
  });

  /** Zero is a minimum: it says "never warn me about this one again". */
  it('accepts a minimum of zero', () => {
    expect(say('the minimum for rice is 0')).toMatchObject({
      kind: 'SET_MINIMUM', amount: 0,
    });
  });

  const targets: ReadonlyArray<readonly [string, string, number]> = [
    ['i want 20 cans of beans', 'beans', 20],
    ['i want to have 20 eggs', 'eggs', 20],
    ['i want to keep 20 cans of beans', 'beans', 20],
    ['i would like to have 12 bottles of water', 'water', 12],
    ['the target for beans is 20 cans', 'beans', 20],
    ['the goal for water is 50 litres', 'water', 50],
    ['the ideal for rice is 30 kg', 'rice', 30],
  ];
  for (const [phrase, item, amount] of targets) {
    it(`"${phrase}" sets the target for ${item} to ${amount}`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_TARGET', item, amount });
    });
  }

  /**
   * The two thresholds share an opener, and the order decides it.
   *
   * "i want to keep at least 5 kg of rice" is a MINIMUM, and SET_MINIMUM runs
   * first precisely so that the target rule never sees it.
   */
  it('reads "at least" as a minimum rather than a target', () => {
    expect(say('i want to keep at least 5 kg of rice')).toMatchObject({
      kind: 'SET_MINIMUM', item: 'rice', amount: 5,
    });
  });

  it('reads the same opener without "at least" as a target', () => {
    expect(say('i want to keep 5 kg of rice')).toMatchObject({
      kind: 'SET_TARGET', item: 'rice', amount: 5,
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
  const clipped = ['take of rice', 'add cans of',
    // The same argument with a shelf instead of a measure: "i put [the rice]
    // in the pantry" lost its item, and adding one of a product called
    // "pantry" would invent a row named after the shelf it was going on.
    'put in the pantry', 'add in the pantry', 'store in the cellar',
    // A number with nothing to count. Answering either would send a bare
    // number to the item search.
    'only 2 left', 'there are only 3 left'];
  for (const phrase of clipped) {
    it(`"${phrase}" is a fragment, so it stays UNKNOWN`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * The new rules refuse as much as they accept.
   *
   * Every one of these is the opening of a sentence the grammar understands,
   * with the part that carries the meaning missing. A move with no destination
   * is not a move; a threshold with no number is not a threshold; a category
   * or a contact with nothing named is not a question anyone can answer.
   */
  const halfSaid = [
    'move the rice', 'move to the cellar', 'moved', 'take to the kitchen',
    'the minimum for rice', 'the minimum for rice is lots', 'minimum of',
    'i want', 'i want lots of rice', 'the target for beans',
    'category', 'show me the category',
    'the number for', 'how do i call',
    'when did i buy', 'history of', 'the last purchase of',
    'how many', 'whats in the',
  ];
  for (const phrase of halfSaid) {
    it(`"${phrase}" says half a command, so it stays UNKNOWN`, () => {
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
