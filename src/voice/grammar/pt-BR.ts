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
import { parseNumber, spokenDigits, type NumberWords } from '../numbers';
import { readSpokenDate, type SpokenDate } from '../dates';

/**
 * Words removed from an item phrase.
 *
 * "tudo" and its gendered forms are here for the same reason English needs
 * "more": they attach to what is being counted and can never be part of a
 * product name. "gastei tudo o feijao" is read by the rule that sets a
 * quantity to zero, but "usei tudo" reaches ADJUST with nothing else in it -
 * and without this line the application would remove one of a product called
 * "tudo", inventing a row nobody has.
 */
const FILLERS = [
  'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'no', 'na',
  'tudo', 'todo', 'toda', 'todos', 'todas',
];

/**
 * Prepositions that hang a measure off the item: "tira [dois quilos] DE arroz".
 *
 * They matter only where no number was spoken. A phrase that opens with one is
 * not a short sentence, it is a clipped one - the words the preposition
 * belonged to are missing - so "tira de arroz" stays UNKNOWN where "tira
 * arroz" is read as one. Everywhere else "de" is an ordinary filler.
 */
const PARTITIVES = ['de', 'do', 'da', 'dos', 'das'];

/**
 * Prepositions that introduce a PLACE: "guardei [5 latas de arroz] NA despensa".
 *
 * The same argument as the partitives above, about a different missing piece.
 * A phrase that opens with one has lost the thing being put somewhere, not
 * just the number - "guardei na despensa" would otherwise add one of a product
 * called "despensa", inventing a row named after the shelf it was going on.
 *
 * They are not simply added to `PARTITIVES`, because the two lists say
 * different things: a partitive means a MEASURE was clipped, a locative means
 * the ITEM was.
 */
const LOCATIVES = ['na', 'no', 'em', 'nas', 'nos'];

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

/**
 * Words that open or close a question but can never be part of a product name.
 *
 * The item capture in QUERY_QUANTITY is the loosest in the grammar, and when a
 * speaker inverts the usual order - "tenho quanto de acucar", "restam quantos
 * ovos" - one of these survives into it. That is not a cosmetic defect: the
 * search then looks for a product called "quantos ovos", finds none, and tells
 * the user with confidence that they have none of it.
 *
 * Removing them from the ITEM is safe in a way that loosening the PATTERN
 * would not be. It cannot make a new sentence match, because the rule has
 * already matched by the time this runs; it can only shorten what was
 * captured, and a phrase it empties is declined rather than answered.
 */
const QUERY_WORDS = [
  'quanto', 'quanta', 'quantos', 'quantas', 'eu',
  'tem', 'tenho', 'temos', 'resta', 'restam', 'restaram',
  'sobrou', 'sobraram', 'sobram', 'sobra',
  'ainda', 'so', 'apenas', 'somente',
  // "quantos itens de arroz eu tenho" is a question about rice, and the word
  // for a stock line is never part of the name of one.
  'itens', 'item', 'coisas', 'produtos',
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
 * Whether "comprei arroz" may be read as one bag of rice.
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
 *   A leading partitive or locative: "tira DE arroz" is "tira [dois quilos] de
 *   arroz" and "guardei NA despensa" is "guardei [o arroz] na despensa", both
 *   with words clipped off by the recognizer.
 *   A numeral anywhere else in the phrase: "poe menos 2 ovos" says two, and no
 *   reading of "menos" here is better than a guess.
 */
function canAssumeOne(numbers: NumberWords, phrase: string): boolean {
  const tokens = phrase.split(' ').filter((token) => token !== '');
  const first = tokens[0];
  if (first === undefined || PARTITIVES.includes(first) || LOCATIVES.includes(first)) return false;
  return tokens.every((token) => parseNumber(numbers, token) === null);
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
function parseDatePhrase(
  tools: RuleTools,
  context: SlotContext,
  spoken: string,
): SpokenDate | null {
  const text = spoken.trim();
  const asSpoken = readSpokenDate(tools.dates, tools.numbers, text, context.today);
  if (asSpoken !== null) return asSpoken;

  const stripped = text.replace(/^(?:em|ate|para|no|na)\s+/, '');
  if (stripped === text) return null;
  return readSpokenDate(tools.dates, tools.numbers, stripped, context.today);
}

/**
 * Leading articles and possessives taken off a contact phrase.
 *
 * NOT `cleanItemPhrase`, which drops every filler wherever it stands. A
 * contact is matched by `contacts.search`, which asks whether a stored field
 * CONTAINS the phrase, so "ana de souza" has to survive with its "de" intact -
 * `cleanItemPhrase` would hand over "ana souza", which is in nobody's address
 * book. Only the words in front are noise: "o medico" finds nothing, "medico"
 * finds the doctor.
 */
function cleanContactPhrase(phrase: string): string {
  return phrase
    .replace(/^(?:o|a|os|as|um|uma|meu|minha|meus|minhas|do|da|de|dos|das)(?:\s+|$)/, '')
    .trim();
}

/**
 * The window a "what is expiring" question carried, in days.
 *
 * Two shapes, and both of them are things people say. "nos proximos 30 dias"
 * states the number; "essa semana" and "esse mes" state a period, and the
 * number behind it is this application's own - seven and thirty, the same
 * figures the expiry screen uses. A phrase with neither returns null and the
 * caller falls back to the user's own first warning window.
 */
function readWindow(numbers: NumberWords, tail: string): number | null {
  const stated = tail.match(/(?:em|nos proximos|dentro de|daqui a)\s+(.+?)\s+dias?/);
  if (stated?.[1] !== undefined) {
    const value = parseNumber(numbers, stated[1]);
    if (value !== null) return Math.round(value);
  }

  if (/\bhoje\b/.test(tail)) return 0;
  if (/\bamanha\b/.test(tail)) return 1;
  if (/(?:essa|esta|nessa|nesta)\s+semana|\bna semana\b/.test(tail)) return 7;
  if (/(?:esse|este|nesse|neste)\s+mes|\bno mes\b/.test(tail)) return 30;
  return null;
}

/** Verbs that add stock, mapped to why they added it. */
const ADD_VERBS: Readonly<Record<string, 'add' | 'purchase'>> = {
  adiciona: 'add', adicionar: 'add', acrescenta: 'add', acrescentar: 'add',
  poe: 'add', poem: 'add', bota: 'add', botei: 'add', botou: 'add', pus: 'add',
  coloca: 'add', colocar: 'add', coloquei: 'add', colocou: 'add',
  soma: 'add', somei: 'add', entrou: 'add', entraram: 'add',
  chegou: 'add', chegaram: 'add', recebi: 'add', recebemos: 'add',
  ganhei: 'add', ganhamos: 'add', trouxe: 'add', trouxemos: 'add',
  guardei: 'add', guardamos: 'add', guardou: 'add',
  repus: 'add', reabasteci: 'add', estoquei: 'add',
  comprei: 'purchase', compramos: 'purchase', comprou: 'purchase',
  compraram: 'purchase', adquiri: 'purchase',
};

/** Verbs that remove stock, mapped to why. */
const REMOVE_VERBS: Readonly<Record<string, 'remove' | 'consume'>> = {
  tira: 'remove', tirar: 'remove', tirei: 'remove', tiramos: 'remove',
  remove: 'remove', remover: 'remove', removi: 'remove',
  retira: 'remove', retirar: 'remove', retirei: 'remove',
  diminui: 'remove', diminuir: 'remove', peguei: 'remove', pegamos: 'remove',
  joguei: 'remove', jogamos: 'remove', perdi: 'remove', perdemos: 'remove',
  usei: 'consume', usamos: 'consume', usou: 'consume', gastei: 'consume',
  gastamos: 'consume', gastou: 'consume', consumi: 'consume',
  consumimos: 'consume', comi: 'consume', comemos: 'consume',
  bebi: 'consume', bebemos: 'consume', abri: 'consume', abrimos: 'consume',
};

/**
 * Verbs that move an item from one place to another.
 *
 * Three of them - guarda, coloca, poe - are also ways of saying stock arrived,
 * and two of those are in `ADD_VERBS` above. That overlap is settled by rule
 * ORDER and by the destination: MOVE_ITEM runs first and needs a "para o
 * porao" to match at all, so "guardei o arroz na despensa" is a move and
 * "guardei 5 latas de arroz" is five more cans. See the rule's own comment.
 */
const MOVE_VERBS = [
  'move', 'mova', 'mover', 'movi',
  'muda', 'mude', 'mudar', 'mudei',
  'transfere', 'transfira', 'transferir', 'transferi',
  'passa', 'passar', 'passei',
  'leva', 'levar', 'levei',
  'guarda', 'guardar', 'guardei', 'guardamos',
  'coloca', 'colocar', 'coloquei',
  'poe', 'bota',
];

/**
 * "o porao" is a porao. An article a speaker used is not part of the name.
 *
 * This can take a real word with it: a user who says "novo lugar chamado A
 * Casinha" gets a place named "casinha". That is accepted rather than fixed -
 * folding already lower-cased the sentence before this runs, so the capital
 * that would have marked "A" as part of a proper name is gone before this
 * function ever sees it, and the Locations screen can rename the row
 * afterwards - but it is a real cost this function pays, not a case it happens
 * to get right.
 *
 * NOT `cleanItemPhrase`, which would also drop "de", "do" and "da" from the
 * middle of the name: a shelf called "quarto de despejo" has to keep its "de".
 */
function stripLeadingArticle(name: string): string {
  return name.replace(/^(?:o|a|os|as|um|uma)\s+/, '').trim();
}

const rules: readonly Rule[] = [
  {
    name: 'HELP',
    pattern:
      /^(?:ajuda|me ajuda|socorro|o que (?:voce|vc) (?:entende|sabe|faz|pode fazer)|o que (?:eu )?posso (?:dizer|falar|perguntar)|quais (?:sao os )?comandos|como (?:se )?(?:usa|funciona)|como (?:eu )?uso(?: isso)?)$/,
    build: (): Intent => ({ kind: 'HELP' }),
  },

  {
    /*
     * Early - specifically before ADJUST_QUANTITY, whose `ADD_VERBS` map also
     * claims "adiciona" and "adicionar". Without this rule running first,
     * "adiciona um local chamado a garagem" is read as one more of an item
     * named "local chamado garagem" rather than as a place worth creating -
     * checked by running that sentence through this grammar with this rule
     * taken back out, not assumed. The other openers - criar, cria, novo,
     * nova - are in neither verb map, so "cria um local chamado o porao"
     * simply reached UNKNOWN before this rule existed.
     *
     * CREATE_ITEM never competes for the same sentence: its noun list is item,
     * produto and coisa, none of which can ever match this pattern's lugar,
     * local, area, comodo or prateleira. Sitting immediately above it groups
     * the two "cria um X chamado Y" rules together; it is not dodging a
     * collision, because there isn't one to dodge.
     *
     * MOVE_ITEM's own pattern is not anchored on a fixed list of verbs the way
     * this one is - its verb slot is a bare `[a-z]+`, filtered against
     * MOVE_VERBS only once a match has already been found. That makes the two
     * patterns genuinely able to match the same sentence, not merely alike in
     * shape: "cria uma area chamada deposito na garagem" satisfies this rule's
     * pattern (verb "cria", connector "chamada") AND MOVE_ITEM's (verb "cria",
     * item "uma area chamada deposito", destination "garagem") at once, which
     * was checked by running the sentence against both patterns rather than
     * reasoned about. What keeps them from fighting over it is not the
     * patterns but the VERB SETS checked at build time: MOVE_VERBS holds none
     * of criar, cria, adicionar, adiciona, novo or nova, and none of
     * MOVE_VERBS is among those six, so whichever rule's build runs first, the
     * loser declines the moment it inspects the verb it captured. That is also
     * why this rule's position relative to MOVE_ITEM is not load-bearing -
     * only its position relative to ADJUST_QUANTITY is.
     *
     * The shape below is English's, mapped onto Portuguese rather than copied
     * word for word. "novo" and "nova" are this language's "new" and may be
     * followed by a bare space - "novo lugar porao" is plainly a place being
     * named - while "criar" and "adicionar" are its "add" and have to carry
     * "chamado", "chamada" or a colon before anything after the noun is read
     * as the name of a place. The adjective stands on either side of the noun
     * - Portuguese says both "um novo local" and "um local novo" - and
     * allowing both loosens nothing, because on this branch the connector is
     * required either way.
     *
     * English needed that narrowing because "room", "spot" and "area" sit
     * inside ordinary product names. Portuguese was swept for the same
     * collision before the narrowing was kept: every one of the 194 catalog
     * names in `data/catalog.generated.ts`, after every creating verb and
     * every article, and the loose CREATE_ITEM-shaped form stole none of them,
     * because no Portuguese name in that file begins with lugar, local, area,
     * comodo or prateleira. The narrowing earns its place on the shelf the
     * catalog happens not to stock: the loose form read "adiciona uma
     * prateleira de aco" - a real thing to own one more of - as a place called
     * "de aco", and "adiciona area de lazer" as one called "de lazer".
     *
     * The separator between the noun and the name is never the empty match -
     * always a real space, or a colon - so a word that merely starts with one
     * of the nouns cannot be split into a noun and a name. "localizador" and
     * "localizacao" stay whole.
     *
     * What the bare space after "novo" still costs, spelled out because it is
     * a real cost and not an oversight: everything past the noun becomes the
     * name, so "nova area externa" makes a place called "externa" rather than
     * one called "area externa". English pays the same price on "new room
     * spray", and the Locations screen can rename the row.
     */
    name: 'CREATE_LOCATION',
    pattern:
      /^(?:(?:novo|nova)\s+(?:um\s+|uma\s+)?(?:lugar|local|area|comodo|prateleira)(?:\s+chamad[oa]\s+|\s*:\s*|\s+)(.+)|(?:criar|cria|adicionar|adiciona)\s+(?:um\s+|uma\s+)?(?:novo\s+|nova\s+)?(?:lugar|local|area|comodo|prateleira)(?:\s+(?:novo|nova))?(?:\s+chamad[oa]\s+|\s*:\s*)(.+))$/,
    build: (match): Intent | null => {
      const name = stripLeadingArticle((match[1] ?? match[2] ?? '').trim());
      return name === '' ? null : { kind: 'CREATE_LOCATION', name };
    },
  },

  {
    /*
     * Beside CREATE_LOCATION, and before ADJUST_QUANTITY for that rule's
     * reason: `ADD_VERBS` claims "adiciona" and "adicionar". Moving this one
     * below ADJUST_QUANTITY was run rather than argued about, over the sweep
     * corpus below, and "adiciona uma categoria chamada bunker" is what
     * changes - into one more of an item named "categoria chamada bunker".
     * The other openers - criar, cria, novo, nova - are in neither verb map,
     * so "cria uma categoria chamada ferramentas" simply reached UNKNOWN
     * before this rule existed.
     *
     * Its position relative to CREATE_LOCATION, CREATE_ITEM and MOVE_ITEM is
     * not load-bearing, and those are two different claims.
     *
     * Against the first two there is nothing to collide with: this pattern's
     * nouns are categoria and grupo, theirs are lugar, local, area, comodo and
     * prateleira, and item, produto and coisa. 27,720 generated sentences -
     * every opener crossed with every article, all three rules' nouns, every
     * connector and a spread of tails - produced not one that this pattern and
     * either of theirs both accept.
     *
     * Against MOVE_ITEM there genuinely is, which is why it was checked and
     * not assumed. Its verb slot is a bare `[a-z]+`, filtered against
     * MOVE_VERBS only once it has matched, so 88 of those sentences satisfy
     * both patterns - "cria uma categoria chamada deposito na garagem" among
     * them, run through both patterns rather than eyeballed. The VERB SETS
     * settle those at build time: MOVE_VERBS holds none of criar, cria,
     * adicionar, adiciona, novo or nova. Moving this rule below MOVE_ITEM
     * changes none of the 27,720.
     *
     * The shape is the place rule's, with the same split: "novo" and "nova"
     * may be followed by a bare space, while "criar" and "adicionar" have to
     * carry "chamado", "chamada" or a colon before anything past the noun is
     * read as a name. The adjective stands on either side of the noun, and
     * allowing both loosens nothing, because the connector is required either
     * way.
     *
     * That narrowing earns its place here more plainly than it did for places.
     * "grupo" is an ordinary Portuguese noun inside ordinary things people say
     * and own: um grupo gerador is a generator set, um grupo sanguineo is a
     * blood type, um grupo de risco is a phrase anybody has heard. All of them
     * stay what they were - "adiciona um grupo gerador" is still one more
     * generator - because "adiciona" cannot name a category without the
     * connector. The separator after the noun is never the empty match, always
     * a real space or a colon, so "agrupamento" stays whole.
     *
     * What the bare space after "novo" still costs, spelled out because it is
     * a real cost and not an oversight: everything past the noun becomes the
     * name, so "novo grupo de risco" makes a category called "de risco" and
     * "nova categoria de ferramentas" one called "de ferramentas". English
     * pays the same price on "new group buy", and nothing is written on it -
     * `execute` proposes a `NEW_CATEGORY` and the card asks first.
     *
     * The catalog was swept in Portuguese as it was for places: all 194 names
     * in `data/catalog.generated.ts` after eleven creating and adding verbs
     * and seven articles, 14,938 sentences, and not one parses differently
     * with this rule present - no catalog name contains "categoria" or "grupo"
     * at all. The hand-built probes above are what actually earned their keep.
     */
    name: 'CREATE_CATEGORY',
    pattern:
      /^(?:(?:novo|nova)\s+(?:um\s+|uma\s+)?(?:categoria|grupo)(?:\s+chamad[oa]\s+|\s*:\s*|\s+)(.+)|(?:criar|cria|adicionar|adiciona)\s+(?:um\s+|uma\s+)?(?:novo\s+|nova\s+)?(?:categoria|grupo)(?:\s+(?:novo|nova))?(?:\s+chamad[oa]\s+|\s*:\s*)(.+))$/,
    build: (match): Intent | null => {
      const name = stripLeadingArticle((match[1] ?? match[2] ?? '').trim());
      return name === '' ? null : { kind: 'CREATE_CATEGORY', name };
    },
  },

  {
    /*
     * Beside the two rules above, and before ADJUST_QUANTITY for their reason:
     * `ADD_VERBS` claims "adiciona" and "adicionar", so without this rule
     * running first "adiciona um contato chamado ana" is one more of an item
     * named "contato chamado ana" - checked by running that sentence through
     * this grammar with this rule taken back out, not assumed. "criar" and
     * "cria" are in neither verb map, so those sentences simply reached
     * UNKNOWN before this rule existed.
     *
     * Its position relative to CREATE_LOCATION, CREATE_CATEGORY, CREATE_ITEM
     * and MOVE_ITEM is not load-bearing. The first three cannot collide at
     * all: their nouns are lugar, local, area, comodo and prateleira;
     * categoria and grupo; item, produto and coisa - none of them "contato".
     * MOVE_ITEM genuinely can, its verb slot being a bare `[a-z]+` filtered
     * against MOVE_VERBS only after a match; the VERB SETS settle it at build
     * time, and MOVE_VERBS holds none of criar, cria, adicionar, adiciona,
     * novo or nova. The sweep below was run with this rule moved under
     * MOVE_ITEM and nothing changed.
     *
     * The shape is the place rule's, with the same split: "novo" and "nova"
     * may be followed by a bare space, while "criar" and "adicionar" have to
     * carry "chamado", "chamada" or a colon before anything past the noun is
     * read as a name. The adjective stands on either side of the noun, and
     * allowing both loosens nothing, because the connector is required either
     * way.
     *
     * That narrowing earns its place here on a collision that is not
     * hypothetical: AS LENTES DE CONTATO. "adiciona lente de contato" is a
     * real sentence about a real thing to stock, and it stays what it was -
     * twice over, in fact, because "lente" and not "contato" is the word that
     * follows the verb, so this pattern never reaches the noun at all. The
     * connector is what closes the case that does: "adiciona um contato bom"
     * names nobody without it. The separator after the noun is never the empty
     * match, always a real space or a colon, so "contatos" and "contatar" stay
     * whole.
     *
     * What the bare space after "novo" still costs, spelled out because it is
     * a real cost and not an oversight: everything past the noun becomes the
     * name, so "novo contato de emergencia" makes a contact called "de
     * emergencia". English pays the same price on "new contact lenses", and
     * nothing is written on it - `execute` proposes a `NEW_CONTACT` and the
     * card asks first, with the name and the number on it.
     *
     * One alternation and one tail, where the place and category rules write
     * the tail out twice: those capture a name and nothing else, and this one
     * captures a relationship, a name and a number. "meu" and "minha" are the
     * handles Portuguese reaches for - "minha irma", "meu medico" - and one
     * word after them is as much as a regex can safely claim.
     *
     * A PHONE SLOT THAT CANNOT BE READ DECLINES THE WHOLE RULE. `spokenDigits`
     * returns null for anything that is not digits - "telefone quinhentos" is
     * a quantity, and reading it as 5100 would store a number nobody said -
     * and somebody who said a number expects the number. Refusing the sentence
     * whole is what lets them see it was not understood.
     *
     * The catalog was swept in Portuguese as it was for places and categories:
     * all 194 names in `data/catalog.generated.ts` after the six creating and
     * adding verbs above and seven articles, 8,148 sentences, and not one
     * parses differently with this rule present. Nor does moving this rule
     * below MOVE_ITEM change any of them.
     *
     * Unlike those two sweeps, this one had something to find. "Lista de
     * Contatos de Emergência" is one of the 194, and it is the first catalog
     * name on this branch to contain one of these rules' nouns at all. It
     * comes through unchanged because the noun is not the word the pattern
     * looks at: "adiciona a lista de contatos de emergencia" has "lista"
     * after the article, so the pattern never reaches its own noun. The
     * contact-lens probes above are what earned their keep.
     */
    name: 'CREATE_CONTACT',
    pattern:
      /^(?:(?:novo|nova)\s+(?:um\s+|uma\s+)?contato(?:\s+chamad[oa]\s+|\s*:\s*|\s+)|(?:criar|cria|adicionar|adiciona)\s+(?:um\s+|uma\s+)?(?:novo\s+|nova\s+)?contato(?:\s+(?:novo|nova))?(?:\s+chamad[oa]\s+|\s*:\s*))(?:(?:meu|minha)\s+([a-z]+)\s+)?(.+?)(?:\s+(?:numero de telefone|telefone|numero|fone|tel)\s+(.+))?$/,
    build: (match, tools): Intent | null => {
      const name = stripLeadingArticle((match[2] ?? '').trim());
      if (name === '') return null;

      const relationship = match[1] ?? null;
      const spoken = match[3];
      if (spoken === undefined) {
        return { kind: 'CREATE_CONTACT', name, relationship, phone: null };
      }

      const phone = spokenDigits(tools.numbers, spoken);
      return phone === null ? null : { kind: 'CREATE_CONTACT', name, relationship, phone };
    },
  },

  {
    // Before ADJUST, because "adiciona um item novo" also matches an add verb.
    name: 'CREATE_ITEM',
    pattern:
      /^(?:criar?|novo|nova|adicionar?|cadastrar?|registrar?|anotar?)\s+(?:um\s+|uma\s+)?(?:item|produto|coisa)\s*(?:novo|nova)?\s*(?:chamad[oa]\s+)?:?\s*(.+)$/,
    build: (match, tools, context): Intent | null => {
      const body = match[1];
      if (body === undefined || body.trim() === '') return null;

      let rest = body.trim();
      let expiresOn: string | null = null;
      let location: string | null = null;

      const expiry = rest.match(/\s+(?:que\s+)?(?:vence|validade|valido ate)\s+(.+)$/);
      if (expiry?.[1] !== undefined && expiry.index !== undefined) {
        const date = parseDatePhrase(tools, context, expiry[1]);
        // A creation is confirmed whatever the date turned out to be, so how
        // the day was arrived at changes nothing here.
        if (date !== null) {
          expiresOn = date.date;
          rest = rest.slice(0, expiry.index).trim();
        }
      }

      /*
       * "na", "no", "em" - and deliberately not "para", which belongs to
       * MOVE_ITEM.
       *
       * The two rules never collide, because this one cannot match a sentence
       * that does not open with "criar item" or one of its synonyms, and no
       * move says that. Keeping the prepositions apart anyway is what makes
       * "cria um item: racao para o cachorro" a product name rather than a
       * shelf nobody has.
       */
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
    /*
     * After CREATE_ITEM and before ADJUST_QUANTITY, and both halves matter.
     *
     * AFTER CREATE_ITEM, because "cadastra um item: arroz na despensa" names a
     * shelf too, and a creation read as a move would put nothing in the
     * inventory at all.
     *
     * BEFORE ADJUST_QUANTITY, because four of the verbs below - guarda,
     * coloca, poe, bota - are also ways of saying stock arrived, and two of
     * them are in `ADD_VERBS`. The destination separates them: "guardei o
     * arroz NA DESPENSA" moves the row that exists, "guardei 5 latas de arroz"
     * says five more cans are in the house. This rule cannot match the second,
     * because there is no destination in it, so the sentence falls through to
     * the adjustment it really is.
     *
     * A number in front of the item declines the match for the same reason. An
     * item holds ONE location, so "coloca 2 quilos de arroz na despensa"
     * cannot be performed as a partial move, and two kilos arriving on a named
     * shelf is much the likelier sentence. Declining hands it to ADJUST, which
     * can carry it out.
     */
    name: 'MOVE_ITEM',
    pattern:
      /^([a-z]+)\s+(?:o\s+|a\s+|os\s+|as\s+)?(.+?)\s+(?:para dentro d[ao]|pra dentro d[ao]|dentro d[ao]|dentro de|para|pra|pro|ate|na|no|em)\s+(?:o\s+|a\s+|os\s+|as\s+|meu\s+|minha\s+)?(.+)$/,
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
      /^(?:o que (?:esta |ta |anda )?(?:falta|faltando|acabando|acabou|acabaram|terminando|no fim|em falta)|(?:esta |ta )?faltando o que|o que (?:eu )?(?:preciso|tenho que|tem que|devo) (?:comprar|repor)|(?:eu )?preciso comprar o que|lista de compras|lista d[eo] mercado|o que comprar|o que repor|o que falta comprar)$/,
    build: (): Intent => ({ kind: 'QUERY_MISSING' }),
  },

  {
    name: 'QUERY_EXPIRING',
    pattern:
      /^(?:o que|o que e que|quais itens|quais coisas|quais produtos|que itens|tem (?:alguma coisa|algo)|alguma coisa|algo)\s+(?:esta |ta |estao |tao |ja |vai |vao |anda |andam |para |pra |perto de )*(?:vencendo|vencer|venceu|venceram|vence|vencido|vencidos|vencida|vencidas|expirou|expirando|expirado|expirados|estragando|estragou|estragado|passou da validade|fora da validade)\s*(.*)$/,
    build: (match, tools): Intent => {
      const tail = (match[1] ?? '').trim();
      const expiredOnly =
        /(?:ja )?venceu|venceram|expirou|vencid[ao]|expirad[ao]|estragou|estragado|passou da validade|fora da validade/
          .test(match[0]);
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
      /^(?:como (?:esta|ta) (?:minha|a) (?:preparacao|prontidao)|como (?:estou|to) de (?:preparacao|estoque)|qual (?:e )?(?:a )?(?:minha|a) (?:pontuacao|nota|preparacao|prontidao)|quao preparado (?:eu )?estou|estou preparado|to preparado|minha (?:pontuacao|preparacao))$/,
    build: (): Intent => ({ kind: 'QUERY_SCORE' }),
  },

  {
    /*
     * Before QUERY_QUANTITY, which would read "quantos itens eu tenho" as a
     * question about a product called "itens" and answer, with confidence,
     * that there is none of it.
     *
     * The `$` after a short list of tails is what keeps the two apart:
     * "quantos itens DE ARROZ eu tenho" cannot reach the end of this pattern,
     * so it falls through to the quantity rule that can answer it.
     */
    name: 'QUERY_TOTAL',
    pattern:
      /^(?:(?:quantos|quantas)\s+(?:itens|coisas|produtos)(?:\s+(?:eu\s+)?(?:tenho|tem|temos|existem|ha))?(?:\s+(?:no total|ao todo|no estoque|no inventario|cadastrados))?|qual (?:e )?o total de (?:itens|produtos|coisas)|total de (?:itens|produtos)|tamanho do (?:estoque|inventario))$/,
    build: (): Intent => ({ kind: 'QUERY_TOTAL' }),
  },

  {
    /*
     * A read that can never become a write: nothing below produces a contact
     * and no branch of `commit` can store one.
     *
     * The phrase keeps its inner words - see `cleanContactPhrase`. Only the
     * article in front comes off, because `contacts.search` asks whether a
     * stored field CONTAINS what was said.
     */
    name: 'QUERY_CONTACT',
    pattern:
      /^(?:qual (?:e )?(?:o |a )?(?:telefone|numero|celular|contato|fone)\s+(?:de |do |da |dos |das )?(.+)|(?:o |a )?(?:telefone|numero|celular|contato|fone)\s+(?:de|do|da|dos|das)\s+(.+)|(?:me )?(?:passa|da) o (?:telefone|numero|contato)\s+(?:de|do|da)\s+(.+)|como (?:eu )?(?:falo|ligo|contato)\s+(?:com|para|pro|pra)\s+(.+))$/,
    build: (match): Intent | null => {
      const query = cleanContactPhrase(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
      return query === '' ? null : { kind: 'QUERY_CONTACT', query };
    },
  },

  {
    /*
     * Both orders, because both are spoken: "quando vence o leite" and "quando
     * o leite vence". The second alternative is what makes the inverted form
     * answerable, and it stays ANCHORED ON THE EXPIRY WORD - a looser capture
     * would read "quando comprei arroz" as a question about a product called
     * "comprei".
     */
    name: 'QUERY_EXPIRY_OF',
    pattern:
      /^(?:quando (?:que )?(?:vence|expira|estraga|vai vencer|vai estragar)\s+(.+)|quando (?:que )?(?:o |a )?(.+?)\s+(?:vence|expira|estraga|vai vencer|vai estragar)|qual (?:e )?a validade (?:de|do|da)\s+(.+))$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? match[2] ?? match[3] ?? '');
      return item === '' ? null : { kind: 'QUERY_EXPIRY_OF', item };
    },
  },

  {
    /*
     * After QUERY_EXPIRY_OF and before SET_EXPIRY, which is the only place it
     * can go.
     *
     * "quando comprei arroz" opens exactly like "quando vence o arroz", so the
     * expiry question is tried first and declines everything that is not about
     * a date. And it has to come before SET_EXPIRY, whose loose leading
     * capture would read a history question with a date in it as a write.
     */
    name: 'QUERY_HISTORY',
    pattern:
      /^(?:quando (?:foi que |que )?(?:eu |a gente )?(?:comprei|compramos|comprou|usei|usamos|gastei|peguei|abri|repus|reabasteci)\s+(.+)|(?:o )?historico (?:de|do|da|dos|das)\s+(.+)|(?:as )?movimentacoes (?:de|do|da)\s+(.+)|(?:qual foi a |a )?ultima (?:compra de|vez que (?:eu )?(?:comprei|usei))\s+(.+))$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
      return item === '' ? null : { kind: 'QUERY_HISTORY', item };
    },
  },

  {
    // After QUERY_EXPIRY_OF, so "quando vence o leite" is not read as a write.
    //
    // The spoken date is captured whole, prepositions and all: "no dia 10" and
    // "em marco" only parse WITH the preposition, so stripping it in the
    // pattern would silently kill both. `parseDatePhrase` handles the two cases.
    //
    // The first alternative is the one QUERY_EXPIRY_OF deliberately does not
    // claim: that rule reads "QUAL a validade do leite" and stops there, so
    // "a validade do leite e 12/09" arrives here as the statement it is.
    name: 'SET_EXPIRY',
    pattern:
      /^(?:(?:a )?validade (?:de|do|da)\s+(.+?)\s+(?:e|eh)\s+(.+)|(?:o |a )?(.+?)\s+(?:vence|expira|vai vencer|tem validade|e valido ate)\s+(.+))$/,
    build: (match, tools, context): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? match[3] ?? '');
      const date = parseDatePhrase(tools, context, match[2] ?? match[4] ?? '');
      if (item === '' || date === null) return null;
      return { kind: 'SET_EXPIRY', item, expiresOn: date.date, dateAssumed: date.assumed };
    },
  },

  {
    /*
     * Before QUERY_WHERE_LOCATION, which would otherwise read "o que tem na
     * categoria alimentos" as a place called "categoria alimentos" and report
     * that no such shelf exists.
     *
     * This rule is the half of the question that says which it means. The
     * ambiguous half - "o que tem em alimentos" - is left to the location rule
     * below, which falls back to the category when no place fits. The comment
     * on QUERY_WHERE in `services/voice/execute.ts` says why the place wins
     * that race.
     */
    name: 'QUERY_CATEGORY',
    pattern:
      /^(?:(?:o que|quais itens|quais coisas|que itens)\s+(?:tem\s+|ha\s+|esta\s+|estao\s+|eu tenho\s+|tenho\s+)?(?:na|no|em|da|do)\s+categoria\s+(?:de\s+)?(.+)|(?:me\s+)?(?:mostra|mostre|lista|liste)\s+(?:a\s+)?categoria\s+(?:de\s+)?(.+)|categoria\s+(?:de\s+)?(.+))$/,
    build: (match): Intent | null => {
      const category = cleanContactPhrase(match[1] ?? match[2] ?? match[3] ?? '');
      return category === '' ? null : { kind: 'QUERY_CATEGORY', category };
    },
  },

  {
    name: 'QUERY_WHERE_LOCATION',
    pattern:
      /^(?:(?:me\s+)?(?:mostra|mostre|lista|liste)\s+)?o que (?:tem guardado|tem|ha|esta|ta|eu guardo|guardo|eu tenho)\s+(?:na|no|em|dentro d[ao]|dentro de)\s+(?:meu\s+|minha\s+)?(.+)$/,
    build: (match): Intent | null => {
      const location = (match[1] ?? '').trim();
      return location === '' ? null : { kind: 'QUERY_WHERE', item: null, location };
    },
  },

  {
    name: 'QUERY_WHERE_ITEM',
    pattern:
      /^(?:onde (?:que )?(?:esta|ta|fica|estao|tao|ficam|eu guardei|guardei|eu coloquei|coloquei|eu botei|botei|eu deixei|deixei)|em que lugar (?:esta|ta|fica))\s+(.+)$/,
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
     * This one goes first because it is the only one carrying the word
     * "minimo", and because SET_TARGET's opener swallows it: "quero ter no
     * minimo 5 quilos de arroz" is a minimum, and a target rule reading it
     * first would set the wrong field. (It would in fact decline - "no" is not
     * a number - but relying on that would be relying on an accident.)
     *
     * A number is required and never assumed. There is no sensible default for
     * a threshold nobody stated: not one, not the current quantity, not zero.
     */
    name: 'SET_MINIMUM',
    pattern:
      /^(?:(?:o\s+)?(?:estoque\s+|nivel\s+)?minimo\s+(?:de|do|da|dos|das|para|pra)\s+(.+?)\s+(?:e de|eh de|e|eh|sao|deve ser|tem que ser|passa a ser)\s+(.+)|(?:eu\s+)?(?:quero|preciso|devo|tenho que)\s+(?:ter|manter|guardar)\s+(?:no|pelo)\s+minimo\s+(.+?)\s+(?:de|do|da)\s+(.+)|(?:no|pelo)\s+minimo\s+(.+?)\s+(?:de|do|da)\s+(.+))$/,
    build: (match, tools): Intent | null => {
      const spoken = match[2] ?? match[3] ?? match[5] ?? '';
      const item = cleanItemPhrase(match[1] ?? match[4] ?? match[6] ?? '');
      const { amount } = splitLeadingAmount(tools.numbers, spoken);
      // Zero is a legitimate minimum: it says "never warn me about this one".
      if (amount === null || amount < 0 || item === '') return null;
      return { kind: 'SET_MINIMUM', item, amount, unit: findUnit(spoken) };
    },
  },

  {
    /*
     * After SET_MINIMUM for the reason given there, and before SET_QUANTITY
     * because "quero ter 20 latas" and "agora tenho 20 latas" are different
     * claims: one is the level being aimed at, the other is what is on the
     * shelf right now. Neither opener can match the other's sentence, so the
     * order is documentation rather than load-bearing - but it keeps the three
     * "X is N" rules in one readable run.
     */
    name: 'SET_TARGET',
    pattern:
      /^(?:(?:o\s+|a\s+)?(?:ideal|alvo|meta|objetivo)\s+(?:de|do|da|para|pra)\s+(.+?)\s+(?:e de|eh de|e|eh|sao)\s+(.+)|(?:eu\s+)?(?:quero|preciso|pretendo|gostaria de)\s+(?:ter|manter|guardar|chegar a)\s+(.+))$/,
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
     * Before ADJUST and before QUERY_QUANTITY, both of which match "tenho".
     *
     * Four shapes, and three of them are here because they are what people
     * actually say when a number changes to a number:
     *
     *   "agora tenho 12 latas" states the new count outright.
     *   "acabou o arroz" states it as zero. Read as a removal it would take
     *   one bag off a shelf that is already empty, which is both wrong and
     *   useless; the speaker is saying the rice is gone.
     *   "gastei tudo o feijao" is the same zero said from the other end.
     *   "sobrou so 2 ovos" states what is left rather than what went.
     *
     * The last shape declines when no number was spoken, which is what lets
     * "sobrou arroz" fall through to the quantity QUESTION it really is.
     */
    name: 'SET_QUANTITY',
    pattern:
      /^(?:(?:agora|na verdade|na real|corrigindo)\s+(?:eu\s+)?(?:tenho|tem|temos|sao|ficaram|ficou|restam|restou|sobrou|sobraram)\s+(.+)|(?:acabou|acabaram|terminou|terminaram|zerou|acabei com|terminei com|nao tem mais|nao temos mais|nao tenho mais)\s+(.+)|(?:usei|gastei|comi|bebi|consumi|terminei|acabei)\s+(?:com\s+)?(?:tudo|todo|toda|todos|todas)\s+(.+)|(?:sobrou|sobraram|restou|restaram|ficou|ficaram|so tem|so restam|so restou)\s+(?:so\s+|apenas\s+|somente\s+)?(.+))$/,
    build: (match, tools): Intent | null => {
      const emptied = match[2] ?? match[3];
      if (emptied !== undefined) {
        const item = cleanItemPhrase(emptied);
        return item === '' ? null : { kind: 'SET_QUANTITY', item, amount: 0, unit: null };
      }

      const spoken = match[1] ?? match[4] ?? '';
      const { amount, rest } = splitLeadingAmount(tools.numbers, spoken);
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

      // "poe mais 2 ovos" is how the sentence is actually spoken. "mais" sits
      // between the verb and the number and carries no arithmetic of its own:
      // the verb already said which way the stock moves, so "tira mais 2"
      // removes two more rather than adding them. "joguei FORA 2 ovos" has the
      // same shape - a word between the verb and the number that belongs to
      // the verb rather than to the count.
      //
      // "menos" is deliberately NOT stripped here. "poe menos 2 ovos" has no
      // settled meaning - two fewer than what? - and the verb says "add", so
      // every reading of it is a guess at a write. It stays UNKNOWN.
      const spoken = (match[2] ?? '').replace(/^(?:mais|fora)\s+/, '');

      const leading = splitLeadingAmount(tools.numbers, spoken);
      // A missing number means one - see `canAssumeOne`, which says when it may
      // not. A spoken zero is not missing: "tira zero de arroz" changes nothing
      // and is declined here as it always was.
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
    // The verb can fall on either side of the item - "quanto arroz eu tenho"
    // and "quanto tem de arroz" are both ordinary - so it is optional in two
    // places. Without the leading one, "tem" survives into the item phrase and
    // the search goes looking for a product called "tem arroz".
    //
    // The trailing list carries the PLURAL forms as well. "quantos ovos
    // restam" is the most ordinary way to ask this and it ended at "ovos
    // restam", because the list held "resta" but not "restam" and "sobrou" but
    // not "sobraram".
    //
    // The openers now include the bare leftover forms - "sobrou arroz", "ainda
    // tenho feijao" - and a courtesy opening, because "me diz quanto arroz
    // tem" is the same question as "quanto arroz tem" with the manners left in.
    //
    // Whatever still leaks through either side is taken off the item by
    // `stripQueryWords`, which is what makes the inverted order - "tenho
    // quanto de acucar" - answerable instead of a search for a product called
    // "quanto acucar".
    name: 'QUERY_QUANTITY',
    pattern:
      /^(?:(?:me\s+)?(?:diz|diga|fala|fale|mostra|mostre)\s+)?(?:quanto|quanta|quantos|quantas|tem|tenho|temos|ainda tem|ainda tenho|ainda resta|ainda restam|ainda sobrou|resta|restam|sobrou|sobraram|sobra|sobram)\s+(?:(?:eu\s+)?(?:tenho|tem|temos|sobrou|sobra|resta|restam|ficou|ficaram)\s+)?(?:de\s+)?(.+?)(?:\s+(?:ainda\s+)?(?:eu\s+)?(?:tenho|tem|temos|sobraram|sobram|sobrou|restaram|restam|resta|ficou|ficaram))?$/,
    build: (match, tools): Intent | null => {
      const item = stripQueryWords(cleanItemPhrase(match[1] ?? ''));
      if (item === '') return null;
      /*
       * An item phrase that opens with a number is not an item.
       *
       * "sobrou so 2" is a sentence with the noun clipped off it, and the
       * openers above are loose enough to catch it. Answering would send "2"
       * to the search, find nothing, and tell the user with confidence that
       * they have no product called 2.
       */
      if (splitLeadingAmount(tools.numbers, item).amount !== null) return null;
      return { kind: 'QUERY_QUANTITY', item };
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
  /**
   * The sentences this file offers a reader who does not know what to say.
   *
   * `en.ts` carries the full note. The order here is the same one and is
   * load-bearing for the same reason: `VoiceSheet` shows the opening run as
   * tappable chips the moment the sheet opens, while HELP and an unrecognised
   * sentence read out the whole list.
   *
   * THIS IS THE ONE PLACE IN THIS FILE THAT KEEPS ITS ACCENTS, and the rule at
   * the top of the file is not being broken by it. That rule is about
   * PATTERNS: they run against folded text, so an accent written into one
   * produces a rule that can never match. These strings are matched against
   * nothing. They are shown to a reader and dropped into the box for that
   * reader to send, and `parse` folds on the way back in - `o que está
   * vencendo?` reaches the rules as `o que esta vencendo`, exactly as the same
   * sentence typed or spoken would. Writing them folded would put misspelt
   * Portuguese in front of a Portuguese speaker as the first thing the sheet
   * says.
   *
   * Every line is a phrase the rules above actually accept, worded after the
   * forms pinned in `pt-BR.phrases.test.ts` rather than invented;
   * `registry.test.ts` parses every example of every grammar and refuses
   * UNKNOWN.
   */
  examples: [
    'quanto arroz eu tenho?',
    'o que está vencendo?',
    'o que falta?',
    'adiciona cinco latas de feijão',
    'usei 3 ovos',
    'novo lugar, porão',
    'onde está o arroz?',
    'quantos itens eu tenho?',
    'o mínimo de arroz é 5 quilos',
    'move o arroz para o porão',
    'nova categoria, ferramentas',
    'novo contato ana telefone 555 1234',
  ],
};
