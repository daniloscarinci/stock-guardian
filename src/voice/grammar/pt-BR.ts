/**
 * Brazilian Portuguese.
 *
 * Every pattern runs against folded text, so no accented character appears
 * below: `feijão` arrives as `feijao` and `você` as `voce`. Writing an accent
 * here produces a rule that can never match, which is the single easiest
 * mistake to make in this file.
 */
import type { Grammar, Rule, RuleTools, SlotContext } from './types';
import type { Intent } from '../intents';
import { ptBRNumbers } from './pt-BR.numbers';
import { ptBRDates } from './pt-BR.dates';
import { parseNumber, type NumberWords } from '../numbers';
import { parseSpokenDate } from '../dates';

const FILLERS = ['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'no', 'na'];

const UNITS = [
  'lata', 'latas', 'pacote', 'pacotes', 'caixa', 'caixas', 'garrafa', 'garrafas',
  'saco', 'sacos', 'kg', 'quilo', 'quilos', 'g', 'grama', 'gramas',
  'l', 'litro', 'litros', 'ml', 'unidade', 'unidades', 'peca', 'pecas',
];

/**
 * Strips a leading quantity, a unit word and filler words from an item phrase,
 * leaving something worth handing to the search. "cinco latas de feijao preto"
 * becomes "feijao preto".
 */
function cleanItemPhrase(phrase: string): string {
  const kept = phrase
    .split(' ')
    .filter((word) => word !== '' && !UNITS.includes(word) && !FILLERS.includes(word));
  return kept.join(' ').trim();
}

/** Pulls the unit word out of a phrase, if one is there. */
function findUnit(phrase: string): string | null {
  const found = phrase.split(' ').find((word) => UNITS.includes(word));
  return found ?? null;
}

/**
 * Splits "vinte e cinco latas de feijao" into the number it opens with (25) and
 * everything after it ("latas de feijao").
 *
 * It has to be a loop rather than a regex group, because a Portuguese numeral
 * is not one word: "vinte e cinco" is three, "meia duzia" is two. A pattern
 * that captures the amount as a single token reads "vinte e cinco ovos" as
 * twenty of something called "e cinco ovos", which is wrong in both fields at
 * once. So words are fed to `parseNumber` one at a time and kept for as long as
 * the whole prefix still parses; the first word that breaks it starts the item.
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
 * A spoken date, tried as said and then again without a leading preposition.
 *
 * Both attempts are needed, because the preposition is load-bearing for some
 * forms and noise in others. `dayOnlyPattern` needs the word "dia" ("dia 10"),
 * `monthOnlyPattern` needs "em" ("em marco") and `inDaysPattern` needs "em"
 * again ("em 5 dias") - strip it and all three stop matching. But "em 10 de
 * outubro" only parses once "em" is gone, because "em 10" is not a number.
 * Trying the phrase whole first means the forms that carry meaning in their
 * preposition win, and the rest get a second chance.
 */
function parseDatePhrase(tools: RuleTools, context: SlotContext, spoken: string): string | null {
  const text = spoken.trim();
  const asSpoken = parseSpokenDate(tools.dates, tools.numbers, text, context.today);
  if (asSpoken !== null) return asSpoken;

  const stripped = text.replace(/^(?:em|ate|para|no|na)\s+/, '');
  if (stripped === text) return null;
  return parseSpokenDate(tools.dates, tools.numbers, stripped, context.today);
}

/** Verbs that add stock, mapped to why they added it. */
const ADD_VERBS: Readonly<Record<string, 'add' | 'purchase'>> = {
  adiciona: 'add', adicionar: 'add', acrescenta: 'add', acrescentar: 'add',
  poe: 'add', bota: 'add', soma: 'add', entrou: 'add', chegou: 'add',
  comprei: 'purchase', compramos: 'purchase', comprou: 'purchase',
};

/** Verbs that remove stock, mapped to why. */
const REMOVE_VERBS: Readonly<Record<string, 'remove' | 'consume'>> = {
  tira: 'remove', tirar: 'remove', remove: 'remove', remover: 'remove',
  retira: 'remove', tirei: 'remove', diminui: 'remove',
  usei: 'consume', usamos: 'consume', gastei: 'consume', gastamos: 'consume',
  consumi: 'consume', comi: 'consume', abri: 'consume',
};

const rules: readonly Rule[] = [
  {
    name: 'HELP',
    pattern: /^(?:ajuda|socorro|o que (?:voce|vc) (?:entende|sabe|faz)|como (?:usa|funciona))\??$/,
    build: (): Intent => ({ kind: 'HELP' }),
  },

  {
    // Before ADJUST, because "adiciona um item novo" also matches an add verb.
    name: 'CREATE_ITEM',
    pattern:
      /^(?:criar?|novo|nova|adicionar?|cadastrar?)\s+(?:um\s+|uma\s+)?(?:item|produto)\s*(?:novo|nova)?\s*:?\s*(.+)$/,
    build: (match, tools, context): Intent | null => {
      const body = match[1];
      if (body === undefined || body.trim() === '') return null;

      let rest = body.trim();
      let expiresOn: string | null = null;
      let location: string | null = null;

      const expiry = rest.match(/\s+(?:que\s+)?(?:vence|validade|valido ate)\s+(.+)$/);
      if (expiry?.[1] !== undefined && expiry.index !== undefined) {
        expiresOn = parseDatePhrase(tools, context, expiry[1]);
        if (expiresOn !== null) rest = rest.slice(0, expiry.index).trim();
      }

      const place = rest.match(/\s+(?:na|no|em)\s+(.+)$/);
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
      /^(?:o que (?:esta )?(?:falta|faltando|acabando|no fim)|o que (?:eu )?(?:preciso|tenho que) comprar|lista de compras|o que comprar)\??$/,
    build: (): Intent => ({ kind: 'QUERY_MISSING' }),
  },

  {
    name: 'QUERY_EXPIRING',
    pattern:
      /^(?:o que|quais itens|quais coisas)\s+(?:esta |estao |ja |vai )?(?:vencendo|vencer|venceu|venceram|vence|expirou|expirando)\s*(.*)$/,
    build: (match, tools): Intent => {
      const tail = (match[1] ?? '').trim();
      const expiredOnly = /(?:ja )?venceu|venceram|expirou|vencido/.test(match[0]);
      const days = tail.match(/(?:em|nos proximos|dentro de|daqui a)\s+(.+?)\s+dias?/);
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
      /^(?:como esta (?:minha|a) (?:preparacao|prontidao)|qual (?:e )?(?:minha|a) (?:pontuacao|nota|preparacao)|estou preparado)\??$/,
    build: (): Intent => ({ kind: 'QUERY_SCORE' }),
  },

  {
    name: 'QUERY_EXPIRY_OF',
    pattern: /^(?:quando (?:vence|expira)|qual (?:e )?a validade (?:de|do|da))\s+(.+?)\??$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      return item === '' ? null : { kind: 'QUERY_EXPIRY_OF', item };
    },
  },

  {
    // After QUERY_EXPIRY_OF, so "quando vence o leite" is not read as a write.
    //
    // The spoken date is captured whole, prepositions and all: "no dia 10" and
    // "em marco" only parse WITH the preposition, so stripping it in the
    // pattern would silently kill both. `parseDatePhrase` handles the two cases.
    name: 'SET_EXPIRY',
    pattern: /^(?:o |a )?(.+?)\s+(?:vence|expira|tem validade)\s+(.+)$/,
    build: (match, tools, context): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      const expiresOn = parseDatePhrase(tools, context, match[2] ?? '');
      if (item === '' || expiresOn === null) return null;
      return { kind: 'SET_EXPIRY', item, expiresOn };
    },
  },

  {
    name: 'QUERY_WHERE_LOCATION',
    pattern: /^(?:o que (?:tem|ha|esta)|o que eu tenho)\s+(?:na|no|em|dentro d[ao])\s+(.+?)\??$/,
    build: (match): Intent | null => {
      const location = (match[1] ?? '').trim();
      return location === '' ? null : { kind: 'QUERY_WHERE', item: null, location };
    },
  },

  {
    name: 'QUERY_WHERE_ITEM',
    pattern: /^(?:onde (?:esta|fica|estao|ficam)|em que lugar esta)\s+(.+?)\??$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      return item === '' ? null : { kind: 'QUERY_WHERE', item, location: null };
    },
  },

  {
    // Before ADJUST and before QUERY_QUANTITY, both of which match "tenho".
    name: 'SET_QUANTITY',
    pattern: /^(?:agora |na verdade )(?:eu )?(?:tenho|tem|sao|ficaram|restam)\s+(.+)$/,
    build: (match, tools): Intent | null => {
      const { amount, rest } = splitLeadingAmount(tools.numbers, match[1] ?? '');
      const item = cleanItemPhrase(rest);
      // Zero is a legitimate correction here - "agora tenho zero ovos" is the
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

      const { amount, rest } = splitLeadingAmount(tools.numbers, match[2] ?? '');
      if (amount === null || amount <= 0) return null;

      const item = cleanItemPhrase(rest);
      if (item === '') return null;

      return {
        kind: 'ADJUST_QUANTITY',
        item,
        amount,
        direction: add !== undefined ? 'up' : 'down',
        transaction: add ?? remove ?? 'add',
        unit: findUnit(rest),
      };
    },
  },

  {
    // Last, because it is the most permissive.
    //
    // The verb can fall on either side of the item - "quanto arroz eu tenho"
    // and "quanto tem de arroz" are both ordinary - so it is optional in two
    // places. Without the leading one, "tem" survives into the item phrase and
    // the search goes looking for a product called "tem arroz".
    name: 'QUERY_QUANTITY',
    pattern:
      /^(?:quanto|quanta|quantos|quantas|tem|tenho|ainda tem|resta|restam)\s+(?:(?:eu\s+)?(?:tenho|tem|temos|sobrou|resta|restam)\s+)?(?:de\s+)?(.+?)(?:\s+(?:eu\s+)?(?:tenho|tem|temos|sobrou|resta))?\??$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      return item === '' ? null : { kind: 'QUERY_QUANTITY', item };
    },
  },
];

export const ptBRGrammar: Grammar = {
  language: 'pt-BR',
  rules,
  numbers: ptBRNumbers,
  dates: ptBRDates,
  units: UNITS,
  fillers: FILLERS,
  examples: [
    'quanto arroz eu tenho?',
    'o que esta vencendo?',
    'o que falta?',
    'adiciona cinco latas de feijao',
    'usei 3 ovos',
    'onde esta o arroz?',
  ],
};
