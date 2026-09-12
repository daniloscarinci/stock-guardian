/**
 * English.
 *
 * The same rules as `pt-BR.ts`, in the same order, with the same
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
import { parseNumber, spokenDigits, type NumberWords } from '../numbers';
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

/**
 * Prepositions that introduce a PLACE: "i put [five cans of beans] IN the pantry".
 *
 * The same argument as the partitives above, about a different missing piece.
 * A phrase that opens with one has lost the thing being put somewhere, not
 * just the number - "put in the pantry" would otherwise add one of a product
 * called "pantry", inventing a row named after the shelf it was going on.
 */
const LOCATIVES = ['in', 'into', 'on', 'onto', 'at', 'inside', 'to', 'over'];

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
  'only', 'just', 'any',
  // "how many items of rice do i have" asks about rice, and the word for a
  // stock line is never part of the name of one.
  'items', 'item', 'things', 'stuff',
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
 *   A leading partitive or locative: "take OF rice" is "take [two kilos] of
 *   rice" and "put IN the pantry" is "put [the rice] in the pantry", both with
 *   words clipped off by the recognizer.
 *   A numeral anywhere else in the phrase: "add fewer 2 eggs" says two, and no
 *   reading of "fewer" here is better than a guess.
 */
function canAssumeOne(numbers: NumberWords, phrase: string): boolean {
  const tokens = phrase.split(' ').filter((token) => token !== '');
  const first = tokens[0];
  if (first === undefined || PARTITIVES.includes(first) || LOCATIVES.includes(first)) return false;
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

/**
 * Leading articles taken off a contact phrase, and a possessive off the end.
 *
 * NOT `cleanItemPhrase`, which drops every filler wherever it stands. A contact
 * is matched by `contacts.search`, which asks whether a stored field CONTAINS
 * the phrase, so "mary of the clinic" has to survive with its "of" intact -
 * `cleanItemPhrase` would hand over "mary the clinic", which is in nobody's
 * address book. Only the words around it are noise: "the doctor" finds nothing
 * and "doctor" finds the doctor, and "the doctor's" finds nothing either.
 */
function cleanContactPhrase(phrase: string): string {
  return phrase
    .replace(/^(?:the|a|an|my|our)(?:\s+|$)/, '')
    .replace(/'?s$/, '')
    .trim();
}

/**
 * The window an "is anything expiring" question carried, in days.
 *
 * Two shapes, and both of them are things people say. "in the next 30 days"
 * states the number; "this week" and "this month" state a period, and the
 * number behind it is this application's own - seven and thirty, the same
 * figures the expiry screen uses. A phrase with neither returns null and the
 * caller falls back to the user's own first warning window.
 */
function readWindow(numbers: NumberWords, tail: string): number | null {
  const stated = tail.match(/(?:in|within|over)\s+(?:the next\s+)?(.+?)\s+days?/);
  if (stated?.[1] !== undefined) {
    const value = parseNumber(numbers, stated[1]);
    if (value !== null) return Math.round(value);
  }

  if (/\btoday\b/.test(tail)) return 0;
  if (/\btomorrow\b/.test(tail)) return 1;
  if (/\bthis week\b|\bthe week\b/.test(tail)) return 7;
  if (/\bthis month\b|\bthe month\b/.test(tail)) return 30;
  return null;
}

/** Verbs that add stock, mapped to why they added it. */
const ADD_VERBS: Readonly<Record<string, 'add' | 'purchase'>> = {
  add: 'add', adds: 'add', added: 'add', put: 'add', putting: 'add',
  restock: 'add', restocked: 'add', stock: 'add', stocked: 'add',
  stashed: 'add', stored: 'add', received: 'add', gained: 'add',
  brought: 'add', topped: 'add', found: 'add',
  bought: 'purchase', purchased: 'purchase',
};

/** Verbs that remove stock, mapped to why. */
const REMOVE_VERBS: Readonly<Record<string, 'remove' | 'consume'>> = {
  remove: 'remove', removed: 'remove', take: 'remove', took: 'remove',
  taken: 'remove', discard: 'remove', discarded: 'remove', binned: 'remove',
  threw: 'remove', tossed: 'remove', dumped: 'remove', lost: 'remove',
  wasted: 'remove', grabbed: 'remove', broke: 'remove',
  use: 'consume', used: 'consume', ate: 'consume', eat: 'consume',
  consumed: 'consume', drank: 'consume', drunk: 'consume', opened: 'consume',
  finished: 'consume', cooked: 'consume',
};

/**
 * Verbs that move an item from one place to another.
 *
 * Several of them - put, stored, stashed, took - also say that stock arrived
 * or left, and three are in the maps above. That overlap is settled by rule
 * ORDER and by the destination: MOVE_ITEM runs first and needs an "in the
 * cellar" to match at all, so "i put the rice in the cellar" is a move and "i
 * put 5 cans of beans" is five more cans. See the rule's own comment.
 */
const MOVE_VERBS = [
  'move', 'moved', 'shift', 'shifted', 'transfer', 'transferred',
  'relocate', 'relocated', 'put', 'place', 'placed', 'keep', 'kept',
  'store', 'stored', 'stash', 'stashed', 'take', 'took',
];

/**
 * "the cellar" is a cellar. An article a speaker used is not part of the name.
 *
 * This can take a real word with it: a user who says "new place called The
 * Shed" gets a place named "shed". That is accepted rather than fixed -
 * folding already lower-cased the sentence before this runs, so the
 * capital that would have marked "The" as part of a proper name is gone
 * before this function ever sees it, and the Locations screen can rename the
 * row afterwards - but it is a real cost this function pays, not a case it
 * happens to get right.
 */
function stripLeadingArticle(name: string): string {
  return name.replace(/^(?:the|a|an)\s+/, '').trim();
}

/**
 * Where a phone number starts in the words after the noun.
 *
 * A whole token, at the front of that phrase or after a space, so a word that
 * merely contains one of these is left alone: "phones" and "telephones" are
 * not split. The digits after it are OPTIONAL in the pattern and not in the
 * reading: a marker with nothing after it is a sentence the recognizer cut
 * off, and `readContact` refuses it rather than storing "ana phone" as
 * somebody's name.
 *
 * The longest form comes first, because a regex alternation takes the first
 * branch that matches. With "phone" ahead of "phone number", "ana phone
 * number 5551234" leaves the word "number" sitting at the front of the digits,
 * `spokenDigits` refuses it, and the sentence is declined whole.
 */
const PHONE_MARKER = /(?:^|\s)(?:phone number|phone|number|tel|telephone)(?:\s+(.+))?$/;

/**
 * The words after the noun, read as a name, a relationship and a number.
 *
 * The pattern hands over three things: the possessive phrase exactly as spoken
 * ("my doctor"), the bare word inside it ("doctor"), and everything after it.
 * Deciding which of those is the NAME is this function's whole job, and it is
 * here rather than in the pattern because a regex gets it wrong in ways that
 * end with something stored that nobody said.
 *
 * A MARKER SEPARATES A NAME FROM A NUMBER, so it needs both. Four cases, each
 * of them a sentence somebody really says:
 *
 *   "ana phone 5551234" - a name, a marker, digits. The ordinary one.
 *
 *   "ana phone five hundred" - a name and a marker, and a QUANTITY after it.
 *   A number was said and this file cannot read it, so the rule declines:
 *   somebody who said a number expects the number, and keeping the contact
 *   without it drops the half of the sentence they cared about. "ana phone",
 *   where the recognizer cut the words off before the digits, is the same case
 *   with nothing after the marker at all.
 *
 *   "phone 5551234" - a marker and digits and NO NAME. A contact with no name
 *   is not a contact, `contacts.create` refuses one, and so does this. The
 *   possessive is the exception that makes it worth writing down: "my doctor
 *   phone 5551234" arrives with "my doctor" already taken off as a
 *   relationship and nothing left in front of the marker, and the honest
 *   reading is that "my doctor" was never a relationship - it was the name.
 *   It is put back as one. "new contact my doctor" with no number is already
 *   read that way, so adding a number to a sentence that worked does not stop
 *   it working.
 *
 *   "number for the vet" - a marker at the front, nothing before it, and
 *   nothing after it that reads as digits. It separated nothing, so it was
 *   never a marker and the whole phrase is the name. That is what keeps
 *   "numero de emergencia" and "telefone do hospital" the plain names they
 *   are in the other two files. The cost is a name whose next word happens to
 *   read as a digit - "number nine" - which is taken for a number with nobody
 *   attached to it and declines.
 */
function readContact(
  numbers: NumberWords,
  possessive: string | undefined,
  relationship: string | undefined,
  rest: string,
): Intent | null {
  const named = (phrase: string, related: string | null, phone: string | null): Intent | null => {
    const name = stripLeadingArticle(phrase.trim());
    return name === '' ? null : { kind: 'CREATE_CONTACT', name, relationship: related, phone };
  };

  const slot = rest.match(PHONE_MARKER);
  const at = slot?.index;
  if (slot === null || at === undefined) return named(rest, relationship ?? null, null);

  const before = rest.slice(0, at).trim();
  const spoken = slot[1];
  const phone = spoken === undefined ? null : spokenDigits(numbers, spoken);

  if (phone === null) {
    // Something in front of it, so it really was separating a name from a
    // number - and the number is one this file could not read.
    if (before !== '' || possessive !== undefined) return null;
    // Nothing in front of it and no digits behind it: it separated nothing.
    return named(rest, relationship ?? null, null);
  }

  return before === ''
    ? named(possessive ?? '', null, phone)
    : named(before, relationship ?? null, phone);
}

const rules: readonly Rule[] = [
  {
    name: 'HELP',
    pattern:
      /^(?:help|what can you do|what do you (?:understand|know)|what can i (?:say|ask)|what commands|how does this work|how do i use this)$/,
    build: (): Intent => ({ kind: 'HELP' }),
  },

  {
    /*
     * Early - specifically before ADJUST_QUANTITY, whose ADD_VERBS map also
     * claims "add". Without this rule running first, "add a place called the
     * cellar" is read as one more of an item named "place called cellar"
     * rather than as a place worth creating - proven by running it through
     * the grammar with this rule absent, not assumed.
     *
     * CREATE_ITEM never competes for the same sentence: its noun list is
     * item, product, entry and thing, none of which can ever match this
     * pattern's place, location, spot, area or room. Sitting immediately
     * above it groups the two "new X called Y" rules together; it is not
     * dodging a collision, because there isn't one to dodge.
     *
     * MOVE_ITEM's own pattern is not anchored on a fixed list of verbs the
     * way this one is - its verb slot is a bare `[a-z]+`, filtered against
     * MOVE_VERBS only once a match has already been found. That makes the
     * two patterns genuinely able to match the same sentence, not merely
     * alike in shape: "make a new location called storage in the pantry"
     * satisfies this rule's pattern (verb "make", connector "called") AND
     * MOVE_ITEM's (verb "make", item "new location called storage",
     * destination "pantry") at once. What keeps them from fighting over a
     * sentence like that is not the patterns but the VERB SETS checked at
     * build time: MOVE_VERBS holds none of create, add, new or make, and
     * none of MOVE_VERBS is among those four, so whichever rule's `build`
     * runs first, the loser declines the moment it inspects the verb it
     * captured. That is also why this rule's position relative to MOVE_ITEM
     * is not load-bearing - only its position relative to ADJUST_QUANTITY
     * is, for the reason given above.
     *
     * The pattern below is narrower than "a place-ish word, then whatever
     * comes next" for a reason a first draft of it did not have: "place",
     * "room", "area" and "spot" are ordinary English nouns that show up
     * inside product names - "add a room spray", "add spot remover", "add a
     * placemat" - in a way "item", "product", "entry" and "thing" above never
     * do. A loose separator after the noun let each of those be misread as a
     * place called "spray", "remover" or "mat". Two things close that gap.
     * First, the separator between the noun and the name is a REAL one -
     * `\s+`, or a colon with optional space around it - never the empty
     * match that let "placemat" split into a noun and a name with nothing
     * between them. Second, "called" or "named" (or the colon) is REQUIRED
     * whenever the sentence opens with create, add or make: "add a room
     * spray" has a noun and a name back to back with nothing marking the
     * second as a name.
     *
     * "new" is not narrowed the same way, and staying loose there is a
     * decision, not an oversight it would be tidy to close up next.
     * "new place cellar" and "new room spray" are token-for-token identical -
     * a creating word, a noun this rule already watches for, and one more
     * word - and a regex has no lexicon to tell a cellar from a spray with.
     * It can require the connector after "new" too, which refuses the
     * plainest way anyone names a place ("new place cellar" itself), or it
     * can leave the bare space and accept "new room spray" right along with
     * it; no pattern here can keep one and lose the other. What the bare
     * space still costs, spelled out because it is a real cost and not an
     * oversight: "new room spray" makes a place called "spray" rather than
     * one called "room spray" - the same price Spanish pays on "nueva zona
     * de cultivo" and Portuguese on "nova area externa", for the same reason.
     *
     * Nothing is written on that guess. `CREATE_LOCATION` is one of the
     * `WRITING_INTENTS`, `execute` proposes a `NEW_LOCATION` rather than
     * writing one, and "new room spray" reaches the user as a card headed
     * "spray" that reads "No place is called spray. Confirming makes it." -
     * with a Cancel button beside the one that would make it - the same check
     * every other guess in this grammar goes through before anything lands in
     * the database.
     */
    name: 'CREATE_LOCATION',
    pattern:
      /^(?:new\s+(?:an?\s+)?(?:place|location|spot|area|room)(?:\s+(?:called|named)\s+|\s*:\s*|\s+)(.+)|(?:create|add|make)\s+(?:an?\s+)?(?:new\s+)?(?:place|location|spot|area|room)(?:\s+(?:called|named)\s+|\s*:\s*)(.+))$/,
    build: (match): Intent | null => {
      const name = stripLeadingArticle((match[1] ?? match[2] ?? '').trim());
      return name === '' ? null : { kind: 'CREATE_LOCATION', name };
    },
  },

  {
    /*
     * Beside CREATE_LOCATION, and before ADJUST_QUANTITY for the reason that
     * rule gives: "add" is in ADD_VERBS. Moving this one below ADJUST_QUANTITY
     * was run rather than argued about, over the whole sweep corpus below, and
     * exactly the sentences that open with "add" change - "add a category
     * called tools" becomes one more of an item named "category called tools".
     *
     * Its position relative to CREATE_LOCATION, CREATE_ITEM and MOVE_ITEM is
     * not load-bearing, and those are two different claims rather than one.
     *
     * Against the first two there is nothing to collide with. This pattern's
     * nouns are category and group; theirs are place, location, spot, area and
     * room, and item, product, entry and thing. 11,880 generated sentences -
     * every opener crossed with every article, every one of all three rules'
     * nouns, every connector and a spread of tails - produced not one that
     * this pattern and either of theirs both accept.
     *
     * Against MOVE_ITEM there genuinely is something to collide with, which is
     * why the claim is checked rather than assumed. MOVE_ITEM's verb slot is a
     * bare `[a-z]+`, filtered against MOVE_VERBS only once it has matched, so
     * 96 of those same sentences satisfy both patterns - "create a group
     * called storage in the pantry" among them, which was run through both
     * patterns rather than eyeballed. What settles those is the VERB SETS at
     * build time: MOVE_VERBS holds none of create, add, new or make, so
     * MOVE_ITEM declines the moment it inspects the verb it captured. Moving
     * this rule to sit below MOVE_ITEM changes none of the 11,880.
     *
     * The narrowing is CREATE_LOCATION's, here for its reason and a sharper
     * one. "group" is an ordinary English noun inside ordinary things a
     * household buys and does - a group buy, group therapy, a group photo - so
     * "called" or "named" (or the colon) is REQUIRED whenever the sentence
     * opens with create, add or make. "add a group buy" has a noun and a name
     * back to back with nothing marking the second as a name, and stays the
     * stock addition it always was. The separator after the noun is a REAL one
     * - `\s+`, or a colon with optional space - never the empty match, so
     * "grouper" and "categorised" are not split into a noun and a name.
     *
     * "new" keeps the bare space, and that is the decision the place rule
     * made, not an oversight to close up next. "new category tools" and "new
     * group photo" are token-for-token identical - a creating word, a noun
     * this rule watches for, one more word - and a regex has no lexicon to
     * tell a heading from a photograph with. Requiring the connector after
     * "new" too would refuse "new category tools" itself, the plainest way
     * anyone names a category. What the bare space costs, spelled out because
     * it is a real cost and not an oversight: "new group buy" makes a category
     * called "buy" - the same price this file already pays on "new room
     * spray", Spanish on "nueva zona de cultivo" and Portuguese on "nova area
     * externa".
     *
     * Nothing is written on that guess. `CREATE_CATEGORY` is one of the
     * `WRITING_INTENTS`, `execute` proposes a `NEW_CATEGORY` rather than
     * writing one, and "new group buy" reaches the user as a card headed "buy"
     * reading "No category is called this. Confirming makes it." - with a
     * Cancel button beside the one that would make it.
     *
     * The catalog was swept in this language as it was for places: all 194
     * names in `data/catalog.generated.ts` after ten creating and adding verbs
     * and seven articles, 13,580 sentences, and not one parses differently
     * with this rule present - no catalog name contains "category" or "group"
     * at all. The hand-built probes above are what actually earned their keep.
     */
    name: 'CREATE_CATEGORY',
    pattern:
      /^(?:new\s+(?:an?\s+)?(?:category|group)(?:\s+(?:called|named)\s+|\s*:\s*|\s+)(.+)|(?:create|add|make)\s+(?:an?\s+)?(?:new\s+)?(?:category|group)(?:\s+(?:called|named)\s+|\s*:\s*)(.+))$/,
    build: (match): Intent | null => {
      const name = stripLeadingArticle((match[1] ?? match[2] ?? '').trim());
      return name === '' ? null : { kind: 'CREATE_CATEGORY', name };
    },
  },

  {
    /*
     * Beside the two rules above, and before ADJUST_QUANTITY for their reason:
     * "add" is in ADD_VERBS, so without this rule running first "add a contact
     * called ana" is one more of an item named "contact called ana". That was
     * checked by running the sentence through this grammar with this rule
     * taken back out, not assumed. The other three openers - create, make,
     * save - are in neither verb map, so those sentences simply reached
     * UNKNOWN before this rule existed.
     *
     * Its position relative to CREATE_LOCATION, CREATE_CATEGORY, CREATE_ITEM
     * and MOVE_ITEM is not load-bearing. The first three cannot collide at
     * all: their nouns are place, location, spot, area and room; category and
     * group; item, product, entry and thing - and none of them is "contact".
     * MOVE_ITEM genuinely can, its verb slot being a bare `[a-z]+` filtered
     * against MOVE_VERBS only after a match; what settles it is the VERB SETS
     * at build time, and MOVE_VERBS holds none of create, add, make, save or
     * new. The whole sweep below was run with this rule moved under MOVE_ITEM
     * and nothing changed.
     *
     * THE NARROWING IS THE OTHER TWO RULES', and it earns its place here on a
     * collision that is not hypothetical: CONTACT LENSES. "add contact lenses"
     * is a real sentence about a real thing to stock, and a bare space after
     * the noun would read it as a person called "lenses". So "called" or
     * "named" (or a colon) is REQUIRED whenever the sentence opens with
     * create, add, make or save, and "add contact lenses" stays the stock
     * addition it always was. The separator is never the empty match either -
     * always a real space, or a colon - so "contacted" and "contactless" are
     * not split into a noun and a name.
     *
     * "new" keeps the bare space, and that is the decision this branch already
     * made twice rather than an oversight to close up next. "new contact ana"
     * and "new contact lenses" are token-for-token identical - a creating
     * word, the noun, one more word - and a regex has no lexicon to tell a
     * person from a pair of lenses with. What the bare space costs, spelled
     * out because it is a real cost: "new contact lenses" makes a contact
     * called "lenses", the same price this grammar already pays on "new room
     * spray" and "new group buy". Nothing is written on it - `execute`
     * proposes a `NEW_CONTACT`, the card asks first, and it asks with the
     * name and the number on it.
     *
     * THE SHAPE IS ONE ALTERNATION AND ONE TAIL, where the place and category
     * rules write the tail out twice. Those capture a name and nothing else,
     * so duplicating `(.+)` costs a few characters; this one would have to
     * duplicate three groups, and leave `build` reading whichever half of them
     * is not undefined.
     *
     * THE NUMBER IS PEELED OFF THE TAIL IN `readContact`, NOT IN THE PATTERN -
     * the shape CREATE_ITEM below already uses for the expiry date it peels
     * off its own capture. That is not style, it is a bug this rule shipped
     * with. An optional phone group inside the pattern cannot attach at the
     * FIRST character of the name: it has to open with a separator, and a lazy
     * name has to take at least one character before it. So "new contact my
     * doctor phone 5551234" - a first-class sentence, since "my doctor" is
     * exactly the handle this rule captures relationships for - put the whole
     * of "phone 5551234" into the name, left the phone field null, and by
     * leaving it null left the card with no `heardDigits` warning either,
     * because that reason is keyed on there being a number. A blind user heard
     * "Confirm: phone 5551234, Relationship: doctor, New contact" and was told
     * to check nothing. `readContact` reads the tail as a whole and can see a
     * marker standing at the front of it; the four things it does about one
     * are in its own comment.
     *
     * WHAT DECLINING ACTUALLY DOES, spelled out because an earlier draft of
     * this comment got it wrong. Returning null does not refuse the SENTENCE,
     * it declines the RULE, and `parse` carries on down the list. After "new
     * contact ana phone five hundred" nothing else matches and the sheet says
     * it did not understand, which is what this rule wants. After "add a
     * contact called ana phone five hundred" the sentence still opens with an
     * add verb, so ADJUST_QUANTITY takes it, finds no such item, and offers to
     * create a stock row called "contact called ana phone five hundred". That
     * is the price of declining inside a rule rather than refusing a sentence
     * outright, and `parse.ts` has no way to do the second: a rule can decline
     * or produce an intent, and there is no third answer meaning "this one was
     * mine and it was wrong". Nothing is written either way - what the user
     * gets is a button, not a row.
     *
     * The catalog was swept in this language as it was for places and
     * categories: all 194 names in `data/catalog.generated.ts` after the five
     * creating verbs above and seven articles, 6,790 sentences, and not one
     * parses differently with this rule present. Nor does moving this rule
     * below MOVE_ITEM change any of them, which is the check the paragraph
     * above rests on.
     *
     * Unlike those two sweeps, this one had something to find. "Emergency
     * Contact List" is one of the 194, and it is the first catalog name on
     * this branch to contain one of these rules' nouns at all - the place and
     * category sweeps found none. It comes through unchanged because the noun
     * is not the word after the verb: "add the emergency contact list" has
     * "emergency" there, so the pattern never reaches its own noun and the
     * sentence stays one more of that item. The contact-lens probes above are
     * still what earned their keep, and so does "new contact list", which is
     * the bare space's cost in a phrase somebody could really say.
     */
    name: 'CREATE_CONTACT',
    pattern:
      /^(?:new\s+(?:an?\s+)?contact(?:\s+(?:called|named)\s+|\s*:\s*|\s+)|(?:create|add|make|save)\s+(?:an?\s+)?(?:new\s+)?contact(?:\s+(?:called|named)\s+|\s*:\s*))(?:(my\s+([a-z]+))\s+)?(.+)$/,
    build: (match, tools): Intent | null =>
      readContact(tools.numbers, match[1], match[2], (match[3] ?? '').trim()),
  },

  {
    // Before ADJUST, because "add a new item" also matches an add verb.
    name: 'CREATE_ITEM',
    pattern:
      /^(?:create|add|new|register|track)\s+(?:an?\s+)?(?:new\s+)?(?:item|product|entry|thing)\s*(?:called\s+|named\s+)?:?\s*(.+)$/,
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
    /*
     * After CREATE_ITEM and before ADJUST_QUANTITY, and both halves matter.
     *
     * AFTER CREATE_ITEM, because "add an item: rice in the pantry" names a
     * shelf too, and a creation read as a move would put nothing in the
     * inventory at all.
     *
     * BEFORE ADJUST_QUANTITY, because several verbs below - put, stored, took -
     * also say that stock arrived or left. The destination separates them: "i
     * put the rice IN THE CELLAR" moves the row that exists, "i put 5 cans of
     * beans" says five more cans are in the house. This rule cannot match the
     * second, because there is no destination in it, so the sentence falls
     * through to the adjustment it really is.
     *
     * A number in front of the item declines the match for the same reason. An
     * item holds ONE location, so "put 2 kg of rice in the pantry" cannot be
     * performed as a partial move, and two kilos arriving on a named shelf is
     * much the likelier sentence.
     */
    name: 'MOVE_ITEM',
    pattern:
      /^(?:i\s+|we\s+)?([a-z]+)\s+(?:the\s+|an?\s+|my\s+|some\s+)?(.+?)\s+(?:to|into|in|onto|on|over to|inside)\s+(?:the\s+|an?\s+|my\s+)?(.+)$/,
    build: (match, tools): Intent | null => {
      const verb = match[1] ?? '';
      if (!MOVE_VERBS.includes(verb)) return null;

      const spoken = match[2] ?? '';
      if (splitLeadingAmount(tools.numbers, spoken).amount !== null) return null;

      const item = cleanItemPhrase(spoken);
      const location = (match[3] ?? '').trim();
      if (item === '' || location === '') return null;

      return { kind: 'MOVE_ITEM', item, location };
    },
  },

  {
    name: 'QUERY_MISSING',
    pattern:
      /^(?:what (?:do|should) i (?:need|buy|restock|replace|get|pick up)(?: to (?:buy|restock|replace|get|pick up))?|what am i (?:missing|out of|low on|nearly out of|almost out of)|what(?:'?s| is) (?:missing|running out|running low|low|almost gone|out of stock|finished|gone|empty)|what have i run out of|what ran out|what needs (?:buying|restocking|replacing|topping up)|(?:the )?shopping list|what(?:'?s| is) on the shopping list|what to buy)$/,
    build: (): Intent => ({ kind: 'QUERY_MISSING' }),
  },

  {
    name: 'QUERY_EXPIRING',
    pattern:
      /^(?:what|what'?s|which items?|which things|anything|is anything|is there anything)\s+(?:is\s+|are\s+|has\s+|have\s+|will\s+|already\s+|about to\s+|going to\s+|due to\s+|close to\s+)*(?:expiring|expired|expires|expire|going bad|gone bad|go bad|going off|gone off|go off|spoiling|spoiled|spoil)\s*(.*)$/,
    build: (match, tools): Intent => {
      const tail = (match[1] ?? '').trim();
      const expiredOnly = /\bexpired\b|\bgone bad\b|\bgone off\b|\bspoiled\b/.test(match[0]);
      return {
        kind: 'QUERY_EXPIRING',
        withinDays: readWindow(tools.numbers, tail),
        expiredOnly,
      };
    },
  },

  {
    name: 'QUERY_SCORE',
    pattern:
      /^(?:how prepared am i|how ready am i|how prepared are we|what(?:'?s| is) my (?:preparedness|readiness)(?: score| level)?|what(?:'?s| is) my score|preparedness score|am i prepared|am i ready)$/,
    build: (): Intent => ({ kind: 'QUERY_SCORE' }),
  },

  {
    /*
     * Before QUERY_QUANTITY, which would read "how many items do i have" as a
     * question about a product called "items" and answer, with confidence,
     * that there is none of it.
     *
     * The `$` after a short list of tails is what keeps the two apart: "how
     * many items OF RICE do i have" cannot reach the end of this pattern, so
     * it falls through to the quantity rule that can answer it.
     */
    name: 'QUERY_TOTAL',
    pattern:
      /^(?:how many (?:items|things|products)(?:\s+(?:do (?:i|we) have|are there|do (?:i|we) own|have i got))?(?:\s+(?:in total|altogether|in my inventory|in stock))?|what(?:'?s| is) my total(?: item count)?|total items|how big is my (?:inventory|stock))$/,
    build: (): Intent => ({ kind: 'QUERY_TOTAL' }),
  },

  {
    /*
     * A read that can never become a write: nothing below produces a contact
     * and no branch of `commit` can store one.
     *
     * The phrase keeps its inner words - see `cleanContactPhrase`. Only the
     * article in front and the possessive on the end come off, because
     * `contacts.search` asks whether a stored field CONTAINS what was said.
     */
    name: 'QUERY_CONTACT',
    pattern:
      /^(?:what(?:'?s| is) (?:the )?(?:phone |cell |mobile )?(?:number|phone|contact)\s+(?:of|for)\s+(.+)|what(?:'?s| is) (.+?) (?:phone |cell |mobile )?(?:number|phone|contact)|(?:the )?(?:phone |cell )?(?:number|contact) for\s+(.+)|how do i (?:call|contact|reach)\s+(.+))$/,
    build: (match): Intent | null => {
      const query = cleanContactPhrase(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
      return query === '' ? null : { kind: 'QUERY_CONTACT', query };
    },
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
      /^(?:when (?:does|do|will|is|are|did)\s+(.+?)\s+(?:expires|expiring|expire|expired|go bad|go off|run out)|what(?:'?s| is) the (?:expiry|expiration|use by) date (?:of|for)\s+(.+))$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? match[2] ?? '');
      return item === '' ? null : { kind: 'QUERY_EXPIRY_OF', item };
    },
  },

  {
    /*
     * After QUERY_EXPIRY_OF and before SET_EXPIRY, which is the only place it
     * can go.
     *
     * "when did i buy rice" opens like "when does the rice expire", so the
     * expiry question is tried first and declines everything that is not about
     * a date. And it has to come before SET_EXPIRY, whose loose leading
     * capture would read a history question with a date in it as a write.
     */
    name: 'QUERY_HISTORY',
    pattern:
      /^(?:when did (?:i|we) (?:last )?(?:buy|bought|use|used|get|got|open|opened|restock|restocked)\s+(.+)|when was the last time (?:i|we) (?:bought|used|got|opened)\s+(.+)|(?:the )?history (?:of|for)\s+(.+)|(?:the )?last (?:purchase of|time i bought)\s+(.+))$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
      return item === '' ? null : { kind: 'QUERY_HISTORY', item };
    },
  },

  {
    // After QUERY_EXPIRY_OF, so "when does the milk expire" is not read as a
    // write. The spoken date is captured whole, preposition and all, because
    // "in march" and "in 10 days" only parse WITH it - see `parseDatePhrase`.
    //
    // The first alternative is the one QUERY_EXPIRY_OF deliberately does not
    // claim: that rule reads "WHAT IS the expiry date of the milk" and stops
    // there, so "the expiry date of the milk is october 10" arrives here as
    // the statement it is.
    name: 'SET_EXPIRY',
    pattern:
      /^(?:(?:the )?(?:expiry|expiration|use by) date (?:of|for)\s+(.+?)\s+is\s+(.+)|(?:the\s+|an?\s+)?(.+?)\s+(?:expires|expire|will expire|goes bad|goes off|is good until)\s+(.+))$/,
    build: (match, tools, context): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? match[3] ?? '');
      const date = parseDatePhrase(tools, context, match[2] ?? match[4] ?? '');
      if (item === '' || date === null) return null;
      return { kind: 'SET_EXPIRY', item, expiresOn: date.date, dateAssumed: date.assumed };
    },
  },

  {
    /*
     * Before QUERY_WHERE_LOCATION, which would otherwise read "what's in the
     * food category" as a place called "food category" and report that no such
     * shelf exists.
     *
     * This rule is the half of the question that says which it means. The
     * ambiguous half - "what's in food" - is left to the location rule below,
     * which falls back to the category when no place fits. The comment on
     * QUERY_WHERE in `services/voice/execute.ts` says why the place wins that
     * race.
     */
    name: 'QUERY_CATEGORY',
    pattern:
      /^(?:(?:what|what'?s|which items?|which things)\s+(?:is\s+|are\s+|do i have\s+|have i got\s+)?in (?:the\s+)?(.+?)\s+category|(?:show|list)\s+(?:me\s+)?(?:the\s+)?(.+?)\s+category|category\s+(.+))$/,
    build: (match): Intent | null => {
      const category = cleanContactPhrase(match[1] ?? match[2] ?? match[3] ?? '');
      return category === '' ? null : { kind: 'QUERY_CATEGORY', category };
    },
  },

  {
    name: 'QUERY_WHERE_LOCATION',
    pattern:
      /^(?:(?:show|list)\s+me\s+)?(?:what(?:'?s| is| are)?|what do i (?:have|keep|store)|what have i got|what is stored|what(?:'?s| is) stored)\s+(?:in|inside|on|at)\s+(?:the\s+|an?\s+|my\s+)?(.+)$/,
    build: (match): Intent | null => {
      // A bare article is not a place. "whats in the" is a sentence the
      // recognizer cut short, and asking the database for a shelf called "the"
      // would answer a question nobody finished asking.
      const location = (match[1] ?? '').replace(/^(?:the|a|an|my|our)$/, '').trim();
      return location === '' ? null : { kind: 'QUERY_WHERE', item: null, location };
    },
  },

  {
    name: 'QUERY_WHERE_ITEM',
    pattern:
      /^(?:where (?:is|are|do i keep|do we keep|did i put|did i leave|can i find|do i store)|where'?s|where'?re)\s+(.+)$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      return item === '' ? null : { kind: 'QUERY_WHERE', item, location: null };
    },
  },

  {
    /*
     * SET_MINIMUM, SET_TARGET and SET_QUANTITY are three ways of saying "X is
     * N", and they are tried from the most marked to the least.
     *
     * This one goes first because it is the only one carrying "minimum" or "at
     * least", and because SET_TARGET's opener swallows it: "i want to keep at
     * least 5 kg of rice" is a minimum, and a target rule reading it first
     * would set the wrong field. (It would in fact decline - "at" is not a
     * number - but relying on that would be relying on an accident.)
     *
     * A number is required and never assumed. There is no sensible default for
     * a threshold nobody stated: not one, not the current quantity, not zero.
     */
    name: 'SET_MINIMUM',
    pattern:
      /^(?:(?:the\s+)?(?:minimum|min|minimum level|reorder level|low stock level)\s+(?:for|of)\s+(.+?)\s+is\s+(?:at least\s+)?(.+)|(?:(?:i\s+)?(?:want|need|like|have)\s+to\s+)?(?:keep|have|hold|stock)\s+at least\s+(.+))$/,
    build: (match, tools): Intent | null => {
      const named = match[1];
      const spoken = match[2] ?? match[3] ?? '';
      const { amount, rest } = splitLeadingAmount(tools.numbers, spoken);
      // Zero is a legitimate minimum: it says "never warn me about this one".
      if (amount === null || amount < 0) return null;

      const item = cleanItemPhrase(named ?? rest);
      if (item === '') return null;
      return { kind: 'SET_MINIMUM', item, amount, unit: findUnit(spoken) };
    },
  },

  {
    /*
     * After SET_MINIMUM for the reason given there, and before SET_QUANTITY
     * because "i want 20 cans" and "now i have 20 cans" are different claims:
     * one is the level being aimed at, the other is what is on the shelf right
     * now. Neither opener can match the other's sentence, so the order is
     * documentation rather than load-bearing - but it keeps the three "X is N"
     * rules in one readable run.
     */
    name: 'SET_TARGET',
    pattern:
      /^(?:(?:the\s+)?(?:target|goal|ideal|ideal level|par level)\s+(?:for|of)\s+(.+?)\s+is\s+(.+)|(?:i\s+)?(?:want|would like|aim)(?:\s+to\s+(?:have|keep|hold|stock|get to))?\s+(.+))$/,
    build: (match, tools): Intent | null => {
      const named = match[1];
      const spoken = match[2] ?? match[3] ?? '';
      const { amount, rest } = splitLeadingAmount(tools.numbers, spoken);
      if (amount === null || amount < 0) return null;

      const item = cleanItemPhrase(named ?? rest);
      if (item === '') return null;
      return { kind: 'SET_TARGET', item, amount, unit: findUnit(spoken) };
    },
  },

  {
    /*
     * Before ADJUST and before QUERY_QUANTITY, both of which match "have".
     *
     * Three shapes, and two of them are here because they are what people
     * actually say when a number changes to a number:
     *
     *   "now i have 12 cans" states the new count outright.
     *   "i ran out of rice" states it as zero. Read as a removal it would take
     *   one bag off a shelf that is already empty, which is both wrong and
     *   useless; the speaker is saying the rice is gone.
     *   "there are only 2 eggs left" states what is left rather than what went.
     *
     * The emptying shape declines when a number was spoken - "i finished 2
     * eggs" is two eggs eaten, not an empty shelf - and the last shape
     * declines when one was not, which is what lets a question about what is
     * left fall through to the rule that answers questions.
     */
    name: 'SET_QUANTITY',
    pattern:
      /^(?:(?:(?:now|actually|correction)\s+(?:i\s+|we\s+|there\s+)?(?:have|has|is|are|got)|i (?:now|actually) have)\s+(.+)|(?:i\s+|we\s+)?(?:'ve\s+)?(?:ran out of|run out of|used up|used all|ate all|drank all|finished|out of)\s+(?:the\s+|my\s+|all\s+the\s+)?(.+)|(?:there(?:'?s| is| are)\s+)?only\s+(.+?)\s+left|there(?:'?s| is| are)\s+(.+?)\s+left)$/,
    build: (match, tools): Intent | null => {
      const emptied = match[2];
      if (emptied !== undefined) {
        // A number here means the sentence is about what was used, not about
        // an empty shelf: "i finished 2 eggs" is an adjustment, and declining
        // hands it to the rule that performs one.
        if (splitLeadingAmount(tools.numbers, emptied).amount !== null) return null;
        const item = cleanItemPhrase(emptied);
        return item === '' ? null : { kind: 'SET_QUANTITY', item, amount: 0, unit: null };
      }

      const spoken = match[1] ?? match[3] ?? match[4] ?? '';
      const { amount, rest } = splitLeadingAmount(tools.numbers, spoken);
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
      // other order and the particles that belong to a phrasal verb - "threw
      // OUT 2 eggs", "topped UP 3 cans". Either way the word carries no
      // arithmetic of its own: the verb already said which way the stock moves,
      // so "take more 2" removes two more rather than adding them.
      //
      // "less" and "fewer" are deliberately NOT stripped. "add fewer 2 eggs"
      // has no settled meaning, and the verb says add, so every reading of it
      // is a guess at a write. It stays UNKNOWN.
      const spoken = (match[2] ?? '').replace(/^(?:more|out|away|up)\s+/, '');

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
    //
    // The openers now include the clipped forms - "any rice left", "got any
    // rice" - and a courtesy opening, because "tell me how much rice is left"
    // is the same question with the manners left in.
    name: 'QUERY_QUANTITY',
    pattern:
      /^(?:(?:tell|show)\s+me\s+)?(?:how much|how many|do i (?:still )?have|do we have|have i got|got any|got|is there|are there|any|what(?:'?s| is) left of|how(?:'?s| is) my)\s+(?:(?:do|did) i (?:have|got)\s+)?(?:of\s+|any\s+)?(.+?)(?:\s+(?:do i have|do we have|do i still have|is left|are left|is there|are there|is remaining|are remaining|remains|remain|left|have i got))?$/,
    build: (match, tools): Intent | null => {
      const item = stripQueryWords(cleanItemPhrase(match[1] ?? ''));
      if (item === '') return null;
      /*
       * An item phrase that opens with a number is not an item.
       *
       * "only 2 left" is a sentence with the noun clipped off, and "got 3 cans
       * of beans" is a statement of stock rather than a question about it. The
       * openers above are loose enough to catch both. Answering would send "2"
       * or "3 beans" to the search, find nothing, and tell the user with
       * confidence that they have none of it.
       */
      if (splitLeadingAmount(tools.numbers, item).amount !== null) return null;
      return { kind: 'QUERY_QUANTITY', item };
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
  /**
   * The sentences this file offers a reader who does not know what to say.
   *
   * They are read in two places, and the difference between them is why the
   * ORDER below is load-bearing rather than decorative. `VoiceSheet` puts the
   * first few on screen as tappable chips at the two moments somebody does not
   * know what to say - before anything has been asked, and straight after a
   * sentence it could not read - with the rest a press away. Only HELP still
   * reads the whole list out. So the opening run is chosen to teach as many
   * different SHAPES as it can in as few lines - one item's quantity, what is
   * going off, what to buy, stock arriving, stock going, and a place being
   * made - and the tail carries the rarer forms and the longest sentence here.
   * Moving one of these is a change to what the sheet shows on open. See the
   * chip list in `features/voice/VoiceSheet.tsx`.
   *
   * Every line is a phrase the rules above actually accept, worded after the
   * forms pinned in `en.phrases.test.ts` rather than invented. An example that
   * did not parse would be worse than offering none at all, so the whole list
   * is held to it: `registry.test.ts` parses every example of every grammar
   * and refuses UNKNOWN.
   */
  examples: [
    'how much rice do i have?',
    'what is expiring?',
    'what do i need to buy?',
    'add five cans of beans',
    'i used 3 eggs',
    'new place, cellar',
    'where is the rice?',
    'how many items do i have?',
    'the minimum for rice is 5 kg',
    'move the rice to the cellar',
    'new category, tools',
    'new contact ana phone number 555 1234',
  ],
};
