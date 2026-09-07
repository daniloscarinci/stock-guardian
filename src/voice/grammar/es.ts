/**
 * Spanish.
 *
 * The same twelve rules as `pt-BR.ts`, in the same order, with the same
 * helpers. Rule order is load-bearing and the comments there say why; the
 * comments here cover only what Spanish does differently.
 *
 * Every pattern runs against folded text, so no accented character appears
 * below: `añade` arrives as `anade`, `cuánto` as `cuanto` and `compré` as
 * `compre`. Writing an accent here produces a rule that can never match.
 *
 * The inverted question mark is NOT an accent. `foldText` decomposes and drops
 * combining marks, and U+00BF is neither, so "¿cuánto arroz tengo?" would reach
 * this file with the opener still attached and every rule anchored at `^` would
 * silently never match. `parse.ts` removes it before any rule is tried, which
 * is why no pattern below mentions it.
 */
import type { Grammar, Rule, RuleTools, SlotContext } from './types';
import type { Intent } from '../intents';
import { esNumbers } from './es.numbers';
import { esDates } from './es.dates';
import { parseNumber, type NumberWords } from '../numbers';
import { readSpokenDate, type SpokenDate } from '../dates';

/**
 * Words removed from an item phrase.
 *
 * "en" is deliberately absent, though it looks like it belongs beside "de".
 * Spanish names real products with it - "leche en polvo" is powdered milk, not
 * milk - and dropping it would search for something nobody stocks. The rules
 * that need to see a location consume "en" in their own pattern instead.
 */
const FILLERS = ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'mas'];

/**
 * Prepositions that hang a measure off the item: "quita [dos kilos] DE arroz".
 *
 * They matter only where no number was spoken. A phrase that opens with one is
 * not a short sentence, it is a clipped one - the words the preposition
 * belonged to are missing - so "quita de arroz" stays UNKNOWN where "quita
 * arroz" is read as one. Everywhere else "de" is an ordinary filler.
 */
const PARTITIVES = ['de', 'del'];

const UNITS = [
  'lata', 'latas', 'caja', 'cajas', 'botella', 'botellas', 'bolsa', 'bolsas',
  'paquete', 'paquetes', 'frasco', 'frascos', 'kg', 'kilo', 'kilos',
  'kilogramo', 'kilogramos', 'g', 'gramo', 'gramos', 'l', 'litro', 'litros',
  'ml', 'unidad', 'unidades', 'pieza', 'piezas',
];

/**
 * Strips a leading quantity, a unit word and filler words from an item phrase,
 * leaving something worth handing to the search. "cinco latas de frijoles
 * negros" becomes "frijoles negros".
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
 * The item capture in QUERY_QUANTITY is the loosest in the grammar, and when a
 * speaker inverts the usual order - "tengo cuanto azucar", "cuanto queda de
 * arroz" - one of these survives into it. That is not cosmetic: the search then
 * looks for a product called "cuanto azucar", finds none, and tells the user
 * with confidence that they have none of it.
 *
 * Removing them from the ITEM is safe in a way that loosening the PATTERN would
 * not be. It cannot make a new sentence match, because the rule has already
 * matched by the time this runs; it can only shorten what was captured, and a
 * phrase it empties is declined rather than answered.
 */
const QUERY_WORDS = [
  'cuanto', 'cuanta', 'cuantos', 'cuantas', 'yo', 'me',
  'tengo', 'tenemos', 'tiene', 'hay', 'queda', 'quedan', 'sobra', 'sobran',
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
 * Splits "veinticinco latas de frijoles" into the number it opens with (25) and
 * everything after it ("latas de frijoles").
 *
 * A loop rather than a regex group, for the reason spelled out in `pt-BR.ts`: a
 * Spanish numeral is not one word either. "veinticinco" happens to be, but
 * "treinta y cinco" is three and "media docena" is two.
 */
function splitLeadingAmount(
  numbers: NumberWords,
  phrase: string,
): { amount: number | null; rest: string } {
  const tokens = phrase.split(' ').filter((token) => token !== '');
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
 * Whether "compre arroz" may be read as one bag of rice.
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
 *   A leading partitive: "quita DE arroz" is "quita [dos kilos] de arroz" with
 *   the measure clipped off by the recognizer.
 *   A numeral anywhere else in the phrase: "pon menos 2 huevos" says two, and
 *   no reading of "menos" here is better than a guess.
 */
function canAssumeOne(numbers: NumberWords, phrase: string): boolean {
  const tokens = phrase.split(' ').filter((token) => token !== '');
  const first = tokens[0];
  if (first === undefined || PARTITIVES.includes(first)) return false;
  return tokens.every((token) => parseNumber(numbers, token) === null);
}

/**
 * A spoken date, tried as said and then again without a leading preposition.
 *
 * Both attempts are needed for the reason given in `pt-BR.ts`: "en marzo" and
 * "en 5 dias" only parse WITH the preposition, while "el 10 de octubre" reads
 * fine either way and "para diciembre" needs it kept.
 */
function parseDatePhrase(
  tools: RuleTools,
  context: SlotContext,
  spoken: string,
): SpokenDate | null {
  const text = spoken.trim();
  const asSpoken = readSpokenDate(tools.dates, tools.numbers, text, context.today);
  if (asSpoken !== null) return asSpoken;

  const stripped = text.replace(/^(?:en|el|la|hasta|para|antes de)\s+/, '');
  if (stripped === text) return null;
  return readSpokenDate(tools.dates, tools.numbers, stripped, context.today);
}

/** Verbs that add stock, mapped to why they added it. */
const ADD_VERBS: Readonly<Record<string, 'add' | 'purchase'>> = {
  agrega: 'add', agregar: 'add', agregue: 'add', anade: 'add', anadir: 'add',
  anado: 'add', pon: 'add', poner: 'add', mete: 'add', suma: 'add',
  llego: 'add', llegaron: 'add',
  compre: 'purchase', compramos: 'purchase', compro: 'purchase',
  compraron: 'purchase',
};

/** Verbs that remove stock, mapped to why. */
const REMOVE_VERBS: Readonly<Record<string, 'remove' | 'consume'>> = {
  quita: 'remove', quitar: 'remove', quite: 'remove', saca: 'remove',
  sacar: 'remove', saque: 'remove', retira: 'remove', retirar: 'remove',
  tira: 'remove', tire: 'remove',
  use: 'consume', usamos: 'consume', gaste: 'consume', gastamos: 'consume',
  consumi: 'consume', comi: 'consume', comimos: 'consume', bebi: 'consume',
  abri: 'consume',
};

const rules: readonly Rule[] = [
  {
    name: 'HELP',
    pattern:
      /^(?:ayuda|socorro|que puedes hacer|que entiendes|que puedo decir|como funciona|como se usa)$/,
    build: (): Intent => ({ kind: 'HELP' }),
  },

  {
    // Before ADJUST, because "agrega un producto nuevo" also matches an add verb.
    name: 'CREATE_ITEM',
    pattern:
      /^(?:crear|crea|nuevo|nueva|agregar|agrega|anadir|anade|registrar|registra)\s+(?:un\s+|una\s+)?(?:item|articulo|producto)\s*(?:nuevo|nueva)?\s*:?\s*(.+)$/,
    build: (match, tools, context): Intent | null => {
      const body = match[1];
      if (body === undefined || body.trim() === '') return null;

      let rest = body.trim();
      let expiresOn: string | null = null;
      let location: string | null = null;

      const expiry = rest.match(
        /\s+(?:que\s+)?(?:vence|caduca|con vencimiento|valido hasta)\s+(.+)$/,
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

      const place = rest.match(/\s+(?:dentro de|en)\s+(?:el\s+|la\s+|los\s+|las\s+)?(.+)$/);
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
      /^(?:que (?:me )?faltan?|que (?:se )?esta (?:faltando|acabando|terminando)|que (?:necesito|tengo que) comprar|lista de compras|que comprar)$/,
    build: (): Intent => ({ kind: 'QUERY_MISSING' }),
  },

  {
    name: 'QUERY_EXPIRING',
    pattern:
      /^(?:que productos|que articulos|que cosas|que items|cuales items|cuales|que)\s+(?:esta\s+|estan\s+|ya\s+|va a\s+|van a\s+|se\s+|ha\s+|han\s+)*(?:venciendo|vencidos|vencido|vencieron|vencen|vencio|vence|caducando|caducados|caducado|caducan|caduco|caduca)\s*(.*)$/,
    build: (match, tools): Intent => {
      const tail = (match[1] ?? '').trim();
      const expiredOnly = /\bvencidos?\b|\bvencio\b|\bvencieron\b|\bcaducados?\b|\bcaduco\b/
        .test(match[0]);
      // The longest opener has to come first in the alternation. "en los
      // proximos 30 dias" starts with "en", so a bare "en" tried first captures
      // "los proximos 30" and `parseNumber` rejects the whole thing.
      const days = tail.match(/(?:en los proximos|los proximos|dentro de|en)\s+(.+?)\s+dias?/);
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
      /^(?:como estoy de (?:preparacion|preparado)|que tan preparado estoy|cual es mi (?:puntuacion|nota|preparacion)|estoy preparado)$/,
    build: (): Intent => ({ kind: 'QUERY_SCORE' }),
  },

  {
    name: 'QUERY_EXPIRY_OF',
    pattern:
      /^(?:cuando (?:se vence|vence|caduca|expira)|cual es la (?:fecha de )?(?:vencimiento|caducidad) (?:del|de))\s+(.+)$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      return item === '' ? null : { kind: 'QUERY_EXPIRY_OF', item };
    },
  },

  {
    // After QUERY_EXPIRY_OF, so "cuando vence la leche" is not read as a write.
    //
    // The spoken date is captured whole, prepositions and all: "el 12" and "en
    // marzo" only parse WITH them, so stripping in the pattern would silently
    // kill both. `parseDatePhrase` handles the case that needs them gone.
    name: 'SET_EXPIRY',
    pattern:
      /^(?:el\s+|la\s+|los\s+|las\s+)?(.+?)\s+(?:se vence|vence|caduca|tiene vencimiento)\s+(.+)$/,
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
      /^(?:que hay|que tengo|que esta|que guardo)\s+(?:dentro de|en)\s+(?:el\s+|la\s+|los\s+|las\s+)?(.+)$/,
    build: (match): Intent | null => {
      const location = (match[1] ?? '').trim();
      return location === '' ? null : { kind: 'QUERY_WHERE', item: null, location };
    },
  },

  {
    name: 'QUERY_WHERE_ITEM',
    pattern: /^(?:donde (?:esta|estan|guardo|puse)|en que lugar esta)\s+(.+)$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      return item === '' ? null : { kind: 'QUERY_WHERE', item, location: null };
    },
  },

  {
    // Before ADJUST and before QUERY_QUANTITY, both of which match "tengo".
    name: 'SET_QUANTITY',
    pattern:
      /^(?:ahora|en realidad|realmente)\s+(?:tengo|tenemos|hay|son|quedan|queda)\s+(.+)$/,
    build: (match, tools): Intent | null => {
      const { amount, rest } = splitLeadingAmount(tools.numbers, match[1] ?? '');
      const item = cleanItemPhrase(rest);
      // Zero is a legitimate correction here - "ahora tengo cero huevos" is the
      // whole point of a rule that sets rather than adjusts.
      if (amount === null || amount < 0 || item === '') return null;
      return { kind: 'SET_QUANTITY', item, amount, unit: findUnit(rest) };
    },
  },

  {
    name: 'ADJUST_QUANTITY',
    pattern: /^([a-z]+)\s+(.+)$/,
    build: (match, tools): Intent | null => {
      const verb = match[1] ?? '';
      const add = ADD_VERBS[verb];
      const remove = REMOVE_VERBS[verb];
      if (add === undefined && remove === undefined) return null;

      // "pon mas 2 huevos" is how the sentence is actually spoken, and Spanish
      // also says it the other way round - "agrega 2 huevos mas" - which is why
      // "mas" is a filler as well. It carries no arithmetic either way: the verb
      // already said which direction the stock moves, so "quita mas 2" removes
      // two more rather than adding them.
      //
      // "menos" is deliberately NOT stripped. "pon menos 2 huevos" has no
      // settled meaning - two fewer than what? - and the verb says add, so every
      // reading of it is a guess at a write. It stays UNKNOWN.
      const spoken = (match[2] ?? '').replace(/^mas\s+/, '');

      const leading = splitLeadingAmount(tools.numbers, spoken);
      // A missing number means one - see `canAssumeOne`, which says when it may
      // not. A spoken zero is not missing: "quita cero de arroz" changes
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
    // The verb can fall on either side of the item - "cuanto arroz tengo" and
    // "cuanto queda de arroz" are both ordinary - so it is optional in two
    // places. Whatever still leaks through either side is taken off the item by
    // `stripQueryWords`, which is what makes the inverted order answerable
    // instead of a search for a product called "cuanto azucar".
    name: 'QUERY_QUANTITY',
    pattern:
      /^(?:cuanto|cuanta|cuantos|cuantas|hay|tengo|queda|quedan)\s+(?:(?:me\s+)?(?:tenemos|tengo|quedan|queda|hay)\s+)?(?:de\s+)?(.+?)(?:\s+(?:me\s+)?(?:tenemos|tengo|quedan|queda|hay|sobran|sobra))?$/,
    build: (match): Intent | null => {
      const item = stripQueryWords(cleanItemPhrase(match[1] ?? ''));
      return item === '' ? null : { kind: 'QUERY_QUANTITY', item };
    },
  },
];

export const esGrammar: Grammar = {
  language: 'es',
  rules,
  numbers: esNumbers,
  dates: esDates,
  units: UNITS,
  fillers: FILLERS,
  examples: [
    '¿cuanto arroz tengo?',
    '¿que esta venciendo?',
    '¿que falta?',
    'agrega cinco latas de frijoles',
    'use 3 huevos',
    '¿donde esta el arroz?',
  ],
};
