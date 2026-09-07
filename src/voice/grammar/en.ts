/**
 * English.
 *
 * The same twelve rules as `pt-BR.ts`, in the same order, with the same
 * helpers. Rule order is load-bearing and the comments there say why; the
 * comments here cover only what English does differently.
 *
 * Patterns run against folded text with the punctuation already removed by
 * `parse.ts`, so nothing below writes a `?`, a period or a capital.
 */
import type { Grammar, Rule, RuleTools, SlotContext } from './types';
import type { Intent } from '../intents';
import { enNumbers } from './en.numbers';
import { enDates } from './en.dates';
import { parseNumber, type NumberWords } from '../numbers';
import { readSpokenDate, type SpokenDate } from '../dates';

/**
 * Words removed from an item phrase.
 *
 * "more" is here for a reason the Portuguese list does not need. Portuguese
 * puts it before the number - "poe MAIS 2 ovos" - where it can be stripped
 * ahead of the numeral. English puts it after: "add 2 MORE eggs" would leave
 * "more eggs" as the item, and the search then looks for a product by that
 * name and reports that the user has none of it.
 */
const FILLERS = ['the', 'a', 'an', 'of', 'some', 'any', 'more', 'my', 'our'];

/**
 * Prepositions that hang a measure off the item: "take [two kilos] OF rice".
 *
 * They matter only where no number was spoken. A phrase that opens with one is
 * not a short sentence, it is a clipped one - the words the preposition
 * belonged to are missing - so "take of rice" stays UNKNOWN where "take rice"
 * is read as one. Everywhere else "of" is an ordinary filler.
 */
const PARTITIVES = ['of'];

const UNITS = [
  'can', 'cans', 'box', 'boxes', 'bottle', 'bottles', 'bag', 'bags',
  'pack', 'packs', 'packet', 'packets', 'jar', 'jars', 'kg', 'kilo', 'kilos',
  'kilogram', 'kilograms', 'g', 'gram', 'grams', 'l', 'liter', 'liters',
  'litre', 'litres', 'ml', 'lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce',
  'ounces', 'gallon', 'gallons', 'unit', 'units', 'piece', 'pieces',
];

/**
 * Strips a leading quantity, a unit word and filler words from an item phrase,
 * leaving something worth handing to the search. "five cans of black beans"
 * becomes "black beans".
 */
function cleanItemPhrase(phrase: string): string {
  const kept = phrase
    .split(' ')
    .filter((word) => word !== '' && !UNITS.includes(word) && !FILLERS.includes(word));
  return kept.join(' ').trim();
}

/**
 * Words that open or close a question but can never be part of a product name.
 *
 * The item capture in QUERY_QUANTITY is the loosest in the grammar, and English
 * hangs more of the sentence off the end of it than Portuguese does - "how many
 * eggs do i still have" leaves four of these behind. A leftover here is not
 * cosmetic: the search looks for a product called "eggs do i still have", finds
 * none, and tells the user with confidence that they have none of it.
 *
 * Removing them from the ITEM is safe in a way that loosening the PATTERN would
 * not be. It cannot make a new sentence match, because the rule has already
 * matched by the time this runs; it can only shorten what was captured, and a
 * phrase it empties is declined rather than answered.
 */
const QUERY_WORDS = [
  'how', 'much', 'many', 'do', 'did', 'i', 'we', 'have', 'has', 'had', 'got',
  'is', 'are', 'there', 'still', 'left', 'remain', 'remains', 'remaining',
];

function stripQueryWords(phrase: string): string {
  return phrase
    .split(' ')
    .filter((word) => word !== '' && !QUERY_WORDS.includes(word))
    .join(' ')
    .trim();
}

/** Pulls the unit word out of a phrase, if one is there. */
function findUnit(phrase: string): string | null {
  const found = phrase.split(' ').find((word) => UNITS.includes(word));
  return found ?? null;
}

/**
 * Takes the article back out of a spoken quantity.
 *
 * English is the only one of the three languages that puts a word between the
 * number and what it counts. "a dozen eggs" and "half a dozen eggs" are the
 * ordinary forms, and `parseNumber` reads the article as the number one: the
 * first comes out as 1 x 12 by luck, and the second as 0.5 + 1, multiplied by
 * the dozen into eighteen eggs eaten instead of six.
 *
 * So the article is dropped where it stands next to a fraction, and turned into
 * "one" where it opens the phrase - the only thing it can mean there. "add a
 * can of beans" is one can, exactly as "adiciona uma lata de feijao" is.
 */
function normalizeArticles(phrase: string): string {
  return phrase
    .replace(/\bhalf an? /g, 'half ')
    .replace(/^an? half /, 'half ')
    .replace(/^an? /, 'one ');
}

/**
 * Splits "twenty five cans of beans" into the number it opens with (25) and
 * everything after it ("cans of beans").
 *
 * A loop rather than a regex group, for the reason spelled out in `pt-BR.ts`:
 * an English numeral is not one word either - "twenty five" is two and "half a
 * dozen" is three before the article comes out.
 */
function splitLeadingAmount(
  numbers: NumberWords,
  phrase: string,
): { amount: number | null; rest: string } {
  const tokens = normalizeArticles(phrase).split(' ').filter((token) => token !== '');
  let amount: number | null = null;
  let taken = 0;

  for (let end = 1; end <= tokens.length; end += 1) {
    const value = parseNumber(numbers, tokens.slice(0, end).join(' '));
    if (value === null) break;
    amount = value;
    taken = end;
  }

  return { amount, rest: tokens.slice(taken).join(' ') };
}

/**
 * Whether "i bought rice" may be read as one bag of rice.
 *
 * A write with no number used to stay UNKNOWN. On a real phone that turned the
 * most ordinary sentence anyone says into a transcript on the screen and
 * nothing else, so the number is now assumed - and, being assumed, it is
 * confirmed before it is stored rather than written straight.
 *
 * Two shapes are still refused, because in both of them a number was said and
 * this file failed to read it. Assuming one there would not fill a gap, it
 * would overrule the speaker.
 *
 *   A leading partitive: "take OF rice" is "take [two kilos] of rice" with the
 *   measure clipped off by the recognizer.
 *   A numeral anywhere else in the phrase: "add fewer 2 eggs" says two, and no
 *   reading of "fewer" here is better than a guess.
 */
function canAssumeOne(numbers: NumberWords, phrase: string): boolean {
  const tokens = phrase.split(' ').filter((token) => token !== '');
  const first = tokens[0];
  if (first === undefined || PARTITIVES.includes(first)) return false;
  return tokens.every((token) => parseNumber(numbers, token) === null);
}

/**
 * Puts an English date into the order `enDates` reads.
 *
 * English names the month first - "september 12", "december twenty five" -
 * where Portuguese and Spanish name the day. A regex numbers its groups left to
 * right, so a month-first pattern would hand the month to the day slot and the
 * day to the month slot. Turning the phrase around here keeps `dates.ts` free
 * of any language's word order, and both English orders ("september 12" and
 * "the 12th of september") reach the shared parser in one shape.
 *
 * The month is moved only when what follows it parses as a number, so "in
 * march" and "12 of september" are left exactly as they were.
 */
function turnAroundMonthDay(numbers: NumberWords, text: string): string {
  const tokens = text.split(' ');

  for (let index = 0; index < tokens.length; index += 1) {
    const word = tokens[index];
    if (word === undefined || !Object.hasOwn(enDates.months, word)) continue;

    const after = tokens.slice(index + 1).join(' ');
    if (after === '' || parseNumber(numbers, after) === null) continue;

    return [...tokens.slice(0, index), after, 'of', word].join(' ');
  }

  return text;
}

/** "the 12th" names a day; `parseNumber` can only read "12". */
function stripOrdinalSuffixes(text: string): string {
  return text.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, '$1');
}

/**
 * A spoken date, tried as said and then again without a leading preposition.
 *
 * Both attempts are needed for the reason given in `pt-BR.ts`: "in march" and
 * "in 10 days" only parse WITH the preposition, while "on 12 of september" only
 * parses once "on" is gone.
 */
function parseDatePhrase(
  tools: RuleTools,
  context: SlotContext,
  spoken: string,
): SpokenDate | null {
  const text = turnAroundMonthDay(tools.numbers, stripOrdinalSuffixes(spoken.trim()));
  const asSpoken = readSpokenDate(tools.dates, tools.numbers, text, context.today);
  if (asSpoken !== null) return asSpoken;

  const stripped = text.replace(/^(?:on|by|at|until|before)\s+/, '');
  if (stripped === text) return null;
  return readSpokenDate(tools.dates, tools.numbers, stripped, context.today);
}

/** Verbs that add stock, mapped to why they added it. */
const ADD_VERBS: Readonly<Record<string, 'add' | 'purchase'>> = {
  add: 'add', adds: 'add', added: 'add', put: 'add', restock: 'add',
  restocked: 'add', stocked: 'add',
  bought: 'purchase', purchased: 'purchase',
};

/** Verbs that remove stock, mapped to why. */
const REMOVE_VERBS: Readonly<Record<string, 'remove' | 'consume'>> = {
  remove: 'remove', removed: 'remove', take: 'remove', took: 'remove',
  discard: 'remove', discarded: 'remove',
  use: 'consume', used: 'consume', ate: 'consume', eat: 'consume',
  consumed: 'consume', drank: 'consume', opened: 'consume', finished: 'consume',
};

const rules: readonly Rule[] = [
  {
    name: 'HELP',
    pattern:
      /^(?:help|what can you do|what do you understand|what can i say|how does this work|how do i use this)$/,
    build: (): Intent => ({ kind: 'HELP' }),
  },

  {
    // Before ADJUST, because "add a new item" also matches an add verb.
    name: 'CREATE_ITEM',
    pattern:
      /^(?:create|add|new|register)\s+(?:an?\s+)?(?:new\s+)?(?:item|product|entry)\s*(?:called\s+)?:?\s*(.+)$/,
    build: (match, tools, context): Intent | null => {
      const body = match[1];
      if (body === undefined || body.trim() === '') return null;

      let rest = body.trim();
      let expiresOn: string | null = null;
      let location: string | null = null;

      const expiry = rest.match(
        /\s+(?:that\s+)?(?:expires|expiring|expiry|expiration|good until|use by)\s+(.+)$/,
      );
      if (expiry?.[1] !== undefined && expiry.index !== undefined) {
        const date = parseDatePhrase(tools, context, expiry[1]);
        // A creation is confirmed whatever the date turned out to be, so how
        // the day was arrived at changes nothing here.
        if (date !== null) {
          expiresOn = date.date;
          rest = rest.slice(0, expiry.index).trim();
        }
      }

      const place = rest.match(/\s+(?:in|inside|on|at)\s+(?:the\s+|an?\s+|my\s+)?(.+)$/);
      if (place?.[1] !== undefined && place.index !== undefined) {
        location = place[1].trim();
        rest = rest.slice(0, place.index).trim();
      }

      const leading = splitLeadingAmount(tools.numbers, rest);
      const name = cleanItemPhrase(leading.rest);
      if (name === '') return null;

      return {
        kind: 'CREATE_ITEM',
        name,
        amount: leading.amount,
        unit: findUnit(rest),
        location,
        expiresOn,
      };
    },
  },

  {
    name: 'QUERY_MISSING',
    pattern:
      /^(?:what (?:do|should) i (?:need|buy)(?: to buy)?|what am i (?:missing|out of)|what(?:s| is) (?:missing|running out|running low|low|almost gone)|what needs (?:buying|restocking)|shopping list|what to buy)$/,
    build: (): Intent => ({ kind: 'QUERY_MISSING' }),
  },

  {
    name: 'QUERY_EXPIRING',
    pattern:
      /^(?:what|whats|which items?|which things)\s+(?:is\s+|are\s+|has\s+|have\s+|will\s+|already\s+|about to\s+|going to\s+)*(?:expiring|expired|expires|expire|going bad|gone bad|going off)\s*(.*)$/,
    build: (match, tools): Intent => {
      const tail = (match[1] ?? '').trim();
      const expiredOnly = /\bexpired\b|\bgone bad\b/.test(match[0]);
      const days = tail.match(/(?:in|within|over)\s+(?:the next\s+)?(.+?)\s+days?/);
      const withinDays = days?.[1] !== undefined ? parseNumber(tools.numbers, days[1]) : null;
      return {
        kind: 'QUERY_EXPIRING',
        withinDays: withinDays === null ? null : Math.round(withinDays),
        expiredOnly,
      };
    },
  },

  {
    name: 'QUERY_SCORE',
    pattern:
      /^(?:how prepared am i|how ready am i|what(?:s| is) my (?:preparedness|readiness)(?: score| level)?|what(?:s| is) my score|am i prepared)$/,
    build: (): Intent => ({ kind: 'QUERY_SCORE' }),
  },

  {
    /*
     * Two alternatives and two captures, where Portuguese needs one of each.
     *
     * Portuguese puts the verb in front of the item - "quando vence o leite" -
     * so one pattern with one trailing capture reads every form of the
     * question. English wraps the item instead: "when does the milk EXPIRE".
     * The second half of the question cannot be optional, or the lazy capture
     * swallows it and the application asks about a product called "the milk
     * expire".
     */
    name: 'QUERY_EXPIRY_OF',
    pattern:
      /^(?:when (?:does|do|will|is|are)\s+(.+?)\s+(?:expires|expiring|expire|go bad|go off)|what(?:s| is) the (?:expiry|expiration|use by) date (?:of|for)\s+(.+))$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? match[2] ?? '');
      return item === '' ? null : { kind: 'QUERY_EXPIRY_OF', item };
    },
  },

  {
    // After QUERY_EXPIRY_OF, so "when does the milk expire" is not read as a
    // write. The spoken date is captured whole, preposition and all, because
    // "in march" and "in 10 days" only parse WITH it - see `parseDatePhrase`.
    name: 'SET_EXPIRY',
    pattern:
      /^(?:the\s+|an?\s+)?(.+?)\s+(?:expires|expire|goes bad|goes off|is good until)\s+(.+)$/,
    build: (match, tools, context): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      const date = parseDatePhrase(tools, context, match[2] ?? '');
      if (item === '' || date === null) return null;
      return { kind: 'SET_EXPIRY', item, expiresOn: date.date, dateAssumed: date.assumed };
    },
  },

  {
    name: 'QUERY_WHERE_LOCATION',
    pattern:
      /^(?:what(?:s| is| are)?|what do i have|what have i got)\s+(?:in|inside|on|at)\s+(?:the\s+|an?\s+|my\s+)?(.+)$/,
    build: (match): Intent | null => {
      const location = (match[1] ?? '').trim();
      return location === '' ? null : { kind: 'QUERY_WHERE', item: null, location };
    },
  },

  {
    name: 'QUERY_WHERE_ITEM',
    pattern: /^(?:where (?:is|are|do i keep|did i put|can i find))\s+(.+)$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      return item === '' ? null : { kind: 'QUERY_WHERE', item, location: null };
    },
  },

  {
    // Before ADJUST and before QUERY_QUANTITY, both of which match "have".
    name: 'SET_QUANTITY',
    pattern:
      /^(?:(?:now|actually|correction)\s+(?:i\s+|we\s+|there\s+)?(?:have|has|is|are|got)|i (?:now|actually) have)\s+(.+)$/,
    build: (match, tools): Intent | null => {
      const { amount, rest } = splitLeadingAmount(tools.numbers, match[1] ?? '');
      const item = cleanItemPhrase(rest);
      // Zero is a legitimate correction here - "now i have zero eggs" is the
      // whole point of a rule that sets rather than adjusts.
      if (amount === null || amount < 0 || item === '') return null;
      return { kind: 'SET_QUANTITY', item, amount, unit: findUnit(rest) };
    },
  },

  {
    // English needs the pronoun where Portuguese carries it in the ending:
    // "comprei" is one word and "i bought" is two.
    name: 'ADJUST_QUANTITY',
    pattern: /^(?:i\s+|we\s+)?([a-z]+)\s+(.+)$/,
    build: (match, tools): Intent | null => {
      const verb = match[1] ?? '';
      const add = ADD_VERBS[verb];
      const remove = REMOVE_VERBS[verb];
      if (add === undefined && remove === undefined) return null;

      // English says "add 2 more eggs" rather than "add more 2 eggs", so most
      // of this is done by "more" being a filler; the strip below covers the
      // other order. Either way the word carries no arithmetic of its own - the
      // verb already said which way the stock moves, so "take more 2" removes
      // two more rather than adding them.
      //
      // "less" and "fewer" are deliberately NOT stripped. "add fewer 2 eggs"
      // has no settled meaning, and the verb says add, so every reading of it
      // is a guess at a write. It stays UNKNOWN.
      const spoken = (match[2] ?? '').replace(/^more\s+/, '');

      const leading = splitLeadingAmount(tools.numbers, spoken);
      // A missing number means one - see `canAssumeOne`, which says when it may
      // not. A spoken zero is not missing: "take zero of the rice" changes
      // nothing and is declined here as it always was.
      const amountAssumed = leading.amount === null;
      if (amountAssumed && !canAssumeOne(tools.numbers, spoken)) return null;

      const amount = leading.amount ?? 1;
      if (amount <= 0) return null;

      const rest = amountAssumed ? spoken : leading.rest;
      const item = cleanItemPhrase(rest);
      if (item === '') return null;

      return {
        kind: 'ADJUST_QUANTITY',
        item,
        amount,
        direction: add !== undefined ? 'up' : 'down',
        transaction: add ?? remove ?? 'add',
        unit: findUnit(rest),
        amountAssumed,
      };
    },
  },

  {
    // Last, because it is the most permissive.
    //
    // English wraps the item in the question - "how much rice DO I HAVE" - so
    // the trailing half is a long alternation where Portuguese needs a single
    // verb. Whatever still leaks through is taken off the item by
    // `stripQueryWords`, which is what keeps the search from looking for a
    // product called "rice do i have".
    name: 'QUERY_QUANTITY',
    pattern:
      /^(?:how much|how many|do i have|do we have|is there|are there)\s+(?:(?:do|did) i (?:have|got)\s+)?(?:of\s+)?(.+?)(?:\s+(?:do i have|do we have|do i still have|is left|are left|is there|are there|is remaining|are remaining|remains|remain|left|have i got))?$/,
    build: (match): Intent | null => {
      const item = stripQueryWords(cleanItemPhrase(match[1] ?? ''));
      return item === '' ? null : { kind: 'QUERY_QUANTITY', item };
    },
  },
];

export const enGrammar: Grammar = {
  language: 'en',
  rules,
  numbers: enNumbers,
  dates: enDates,
  units: UNITS,
  fillers: FILLERS,
  examples: [
    'how much rice do i have?',
    'what is expiring?',
    'what do i need to buy?',
    'add five cans of beans',
    'i used 3 eggs',
    'where is the rice?',
  ],
};
