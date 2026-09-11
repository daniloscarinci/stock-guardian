/**
 * Spanish.
 *
 * The same rules as `pt-BR.ts`, in the same order, with the same
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
import { parseNumber, spokenDigits, type NumberWords } from '../numbers';
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

/**
 * Prepositions that introduce a PLACE: "guarde [cinco latas] EN la despensa".
 *
 * The same argument as the partitives above, about a different missing piece.
 * A phrase that opens with one has lost the thing being put somewhere, not
 * just the number - "guarde en la despensa" would otherwise add one of a
 * product called "despensa", inventing a row named after the shelf it was
 * going on. This is also why "en" can be a locative here and never a filler:
 * "leche en polvo" is a real product, so the word is only ever consumed by a
 * rule that means it as a place.
 */
const LOCATIVES = ['en', 'dentro'];

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
  'todavia', 'aun', 'solo', 'solamente', 'unicamente',
  // "cuantos items de arroz tengo" asks about rice, and the word for a stock
  // line is never part of the name of one.
  'items', 'item', 'cosas', 'productos', 'articulos',
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
 *   A leading partitive or locative: "quita DE arroz" is "quita [dos kilos] de
 *   arroz" and "guarde EN la despensa" is "guarde [el arroz] en la despensa",
 *   both with words clipped off by the recognizer.
 *   A numeral anywhere else in the phrase: "pon menos 2 huevos" says two, and
 *   no reading of "menos" here is better than a guess.
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

/**
 * Leading articles taken off a contact phrase.
 *
 * NOT `cleanItemPhrase`, which drops every filler wherever it stands. A
 * contact is matched by `contacts.search`, which asks whether a stored field
 * CONTAINS the phrase, so "ana de la clinica" has to survive with its "de"
 * intact - `cleanItemPhrase` would hand over "ana la clinica", which is in
 * nobody's address book. Only the words in front are noise: "el medico" finds
 * nothing, "medico" finds the doctor.
 */
function cleanContactPhrase(phrase: string): string {
  return phrase
    .replace(/^(?:el|la|los|las|un|una|mi|mis|al|del|de)(?:\s+|$)/, '')
    .trim();
}

/**
 * The window a "what is expiring" question carried, in days.
 *
 * Two shapes, and both of them are things people say. "en los proximos 30
 * dias" states the number; "esta semana" and "este mes" state a period, and
 * the number behind it is this application's own - seven and thirty, the same
 * figures the expiry screen uses. A phrase with neither returns null and the
 * caller falls back to the user's own first warning window.
 */
function readWindow(numbers: NumberWords, tail: string): number | null {
  // The longest opener has to come first in the alternation. "en los proximos
  // 30 dias" starts with "en", so a bare "en" tried first captures "los
  // proximos 30" and `parseNumber` rejects the whole thing.
  const stated = tail.match(/(?:en los proximos|los proximos|dentro de|en)\s+(.+?)\s+dias?/);
  if (stated?.[1] !== undefined) {
    const value = parseNumber(numbers, stated[1]);
    if (value !== null) return Math.round(value);
  }

  if (/\bhoy\b/.test(tail)) return 0;
  if (/\bmanana\b/.test(tail)) return 1;
  if (/\b(?:esta|la) semana\b/.test(tail)) return 7;
  if (/\b(?:este|el) mes\b/.test(tail)) return 30;
  return null;
}

/**
 * Verbs that add stock, mapped to why they added it.
 *
 * Both sides of the Atlantic, because both are spoken: "coger" is ordinary in
 * Spain and startling in much of Latin America, where "agarrar" does the same
 * work, and a grammar that knows only one of them is a grammar that fails for
 * half its speakers.
 */
const ADD_VERBS: Readonly<Record<string, 'add' | 'purchase'>> = {
  agrega: 'add', agregar: 'add', agregue: 'add', agrego: 'add',
  anade: 'add', anadir: 'add', anado: 'add', anadi: 'add',
  pon: 'add', poner: 'add', puse: 'add', pusimos: 'add',
  mete: 'add', meter: 'add', meti: 'add',
  coloca: 'add', colocar: 'add', coloque: 'add',
  suma: 'add', sume: 'add', llego: 'add', llegaron: 'add',
  guarde: 'add', guardamos: 'add', recibi: 'add', recibimos: 'add',
  traje: 'add', trajimos: 'add', consegui: 'add', repuse: 'add',
  compre: 'purchase', compramos: 'purchase', compro: 'purchase',
  compraron: 'purchase',
};

/** Verbs that remove stock, mapped to why. */
const REMOVE_VERBS: Readonly<Record<string, 'remove' | 'consume'>> = {
  quita: 'remove', quitar: 'remove', quite: 'remove', saca: 'remove',
  sacar: 'remove', saque: 'remove', retira: 'remove', retirar: 'remove',
  tira: 'remove', tire: 'remove', tiramos: 'remove', bote: 'remove',
  botamos: 'remove', perdi: 'remove', perdimos: 'remove',
  cogi: 'remove', coge: 'remove', agarre: 'remove', agarro: 'remove',
  use: 'consume', usamos: 'consume', uso: 'consume', gaste: 'consume',
  gastamos: 'consume', consumi: 'consume', consumimos: 'consume',
  comi: 'consume', comimos: 'consume', bebi: 'consume', bebimos: 'consume',
  tome: 'consume', tomamos: 'consume', abri: 'consume', abrimos: 'consume',
};

/**
 * Verbs that move an item from one place to another.
 *
 * Four of them - pon, mete, coloca, guarde - are also ways of saying stock
 * arrived, and all four are in `ADD_VERBS`. That overlap is settled by rule
 * ORDER and by the destination: MOVE_ITEM runs first and needs an "en la
 * despensa" to match at all, so "guarde el arroz en la despensa" is a move and
 * "guarde 5 latas de arroz" is five more cans. See the rule's own comment.
 */
const MOVE_VERBS = [
  'mueve', 'mover', 'mueva', 'movi',
  'muda', 'mudar', 'traslada', 'trasladar', 'traslade',
  'transfiere', 'transferir', 'transferi',
  'pasa', 'pasar', 'pase', 'lleva', 'llevar', 'lleve',
  'cambia', 'cambiar',
  'guarda', 'guardar', 'guarde',
  'pon', 'poner', 'puse', 'mete', 'meter', 'meti',
  'coloca', 'colocar', 'coloque',
];

/**
 * "el sotano" is a sotano. An article a speaker used is not part of the name.
 *
 * This can take a real word with it: a user who says "nuevo lugar llamado La
 * Cueva" gets a place named "cueva". That is accepted rather than fixed -
 * folding already lower-cased the sentence before this runs, so the capital
 * that would have marked "La" as part of a proper name is gone before this
 * function ever sees it, and the Locations screen can rename the row
 * afterwards - but it is a real cost this function pays, not a case it happens
 * to get right.
 *
 * NOT `cleanItemPhrase`, which would also drop "de" and "mas" from the middle
 * of the name: a shelf called "cuarto de servicio" has to keep its "de".
 */
function stripLeadingArticle(name: string): string {
  return name.replace(/^(?:el|la|los|las|un|una)\s+/, '').trim();
}

/**
 * Where a phone number starts in the words after the noun.
 *
 * `en.ts` says what this is for and what the longest-form-first ordering is
 * about. The Spanish list is "numero de telefono", "telefono", "numero" and
 * "tel", and the long form has to come first or "numero de telefono 5551234"
 * leaves "de telefono" sitting at the front of the digits.
 */
const PHONE_MARKER = /(?:^|\s)(?:numero de telefono|telefono|numero|tel)(?:\s+(.+))?$/;

/**
 * The words after the noun, read as a name, a relationship and a number.
 *
 * `en.ts` sets out the four cases and why each one is answered the way it is;
 * this is the same reading with this language's words. Two of those cases are
 * more than theory here. "nuevo contacto mi medico telefono 5551234" is how
 * somebody actually speaks, and "mi medico" is put back as the NAME rather
 * than declined, because "nuevo contacto mi medico" with no number already
 * makes a contact called "mi medico". And "numero de emergencia" is a label a
 * person really would keep in an emergency contact list: a marker at the front
 * with no digits behind it separated nothing, so the whole phrase is the name.
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
    if (before !== '' || possessive !== undefined) return null;
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
      /^(?:ayuda|ayudame|socorro|que puedes hacer|que entiendes|que sabes hacer|que puedo (?:decir|preguntar)|cuales son los comandos|que comandos hay|como funciona|como se usa)$/,
    build: (): Intent => ({ kind: 'HELP' }),
  },

  {
    /*
     * Early - specifically before ADJUST_QUANTITY, whose `ADD_VERBS` map also
     * claims "agrega", "agregar", "anade" and "anadir". Without this rule
     * running first, "agrega un lugar llamado el sotano" is read as one more
     * of an item named "lugar llamado sotano" rather than as a place worth
     * creating - checked by running that sentence through this grammar with
     * this rule taken back out, not assumed. The other four openers are in
     * neither verb map, so "crea un lugar llamado el sotano" simply reached
     * UNKNOWN before this rule existed.
     *
     * CREATE_ITEM never competes for the same sentence: its noun list is item,
     * articulo, producto and cosa, none of which can ever match this pattern's
     * lugar, sitio, ubicacion, zona or habitacion. Sitting immediately above
     * it groups the two "crea un X llamado Y" rules together; it is not
     * dodging a collision, because there isn't one to dodge.
     *
     * MOVE_ITEM's own pattern is not anchored on a fixed list of verbs the way
     * this one is - its verb slot is a bare `[a-z]+`, filtered against
     * MOVE_VERBS only once a match has already been found. That makes the two
     * patterns genuinely able to match the same sentence, not merely alike in
     * shape: "crea una zona llamada deposito en el garaje" satisfies this
     * rule's pattern (verb "crea", connector "llamada") AND MOVE_ITEM's (verb
     * "crea", item "una zona llamada deposito", destination "garaje") at once,
     * which was checked by running the sentence against both patterns rather
     * than reasoned about. What keeps them from fighting over it is not the
     * patterns but the VERB SETS checked at build time: MOVE_VERBS holds none
     * of crear, crea, agregar, agrega, anadir, anade, nuevo or nueva, and none
     * of MOVE_VERBS is among those eight, so whichever rule's build runs
     * first, the loser declines the moment it inspects the verb it captured.
     * That is also why this rule's position relative to MOVE_ITEM is not
     * load-bearing - only its position relative to ADJUST_QUANTITY is.
     *
     * The shape below is English's, mapped onto Spanish rather than copied
     * word for word. "nuevo" and "nueva" are this language's "new" and may be
     * followed by a bare space - "nuevo lugar sotano" is plainly a place being
     * named - while "crear", "agregar" and "anadir" are its "add" and have to
     * carry "llamado", "llamada" or a colon before anything after the noun is
     * read as the name of a place. The adjective stands on either side of the
     * noun - Spanish says both "un nuevo lugar" and "un lugar nuevo" - and
     * allowing both loosens nothing, because on this branch the connector is
     * required either way.
     *
     * English needed that narrowing because "room", "spot" and "area" sit
     * inside ordinary product names. Spanish was swept for the same collision
     * before the narrowing was kept: every one of the 194 catalog names in
     * `data/catalog.generated.ts`, after every creating verb and every
     * article, and the loose CREATE_ITEM-shaped form stole none of them,
     * because no Spanish name in that file begins with lugar, sitio,
     * ubicacion, zona or habitacion. The narrowing earns its place on a second
     * failure the catalog cannot show: the loose form read "agrega un sitio
     * web" as a place called "web" and "agrega una zona de cultivo" as one
     * called "de cultivo", naming a shelf after the tail of a phrase it had
     * only half understood.
     *
     * The separator between the noun and the name is never the empty match -
     * always a real space, or a colon - so a word that merely starts with one
     * of the nouns cannot be split into a noun and a name. "lugareno" and
     * "zonificacion" stay whole.
     *
     * What the bare space after "nuevo" still costs, spelled out because it is
     * a real cost and not an oversight: everything past the noun becomes the
     * name, so "nueva zona de cultivo" makes a place called "de cultivo"
     * rather than one called "zona de cultivo". English pays the same price on
     * "new room spray", and the Locations screen can rename the row.
     */
    name: 'CREATE_LOCATION',
    pattern:
      /^(?:(?:nuevo|nueva)\s+(?:un\s+|una\s+)?(?:lugar|sitio|ubicacion|zona|habitacion)(?:\s+(?:llamado|llamada)\s+|\s*:\s*|\s+)(.+)|(?:crear|crea|agregar|agrega|anadir|anade)\s+(?:un\s+|una\s+)?(?:nuevo\s+|nueva\s+)?(?:lugar|sitio|ubicacion|zona|habitacion)(?:\s+(?:nuevo|nueva))?(?:\s+(?:llamado|llamada)\s+|\s*:\s*)(.+))$/,
    build: (match): Intent | null => {
      const name = stripLeadingArticle((match[1] ?? match[2] ?? '').trim());
      return name === '' ? null : { kind: 'CREATE_LOCATION', name };
    },
  },

  {
    /*
     * Beside CREATE_LOCATION, and before ADJUST_QUANTITY for that rule's
     * reason: `ADD_VERBS` claims "agrega", "agregar", "anade" and "anadir".
     * Moving this one below ADJUST_QUANTITY was run rather than argued about,
     * over the sweep corpus below, and "agrega una categoria llamada bunker"
     * is what changes - into one more of an item named "categoria llamada
     * bunker". The other openers are in neither verb map, so "crea una
     * categoria llamada herramientas" simply reached UNKNOWN before this rule.
     *
     * Its position relative to CREATE_LOCATION, CREATE_ITEM and MOVE_ITEM is
     * not load-bearing, and those are two different claims.
     *
     * Against the first two there is nothing to collide with: this pattern's
     * nouns are categoria and grupo, theirs are lugar, sitio, ubicacion, zona
     * and habitacion, and item, articulo, producto and cosa. 37,268 generated
     * sentences - every opener crossed with every article, all three rules'
     * nouns, every connector and a spread of tails - produced not one that
     * this pattern and either of theirs both accept.
     *
     * Against MOVE_ITEM there genuinely is, which is why it was checked and
     * not assumed. Its verb slot is a bare `[a-z]+`, filtered against
     * MOVE_VERBS only once it has matched, so 228 of those sentences satisfy
     * both patterns - "crea una categoria llamada deposito en el garaje" among
     * them, run through both patterns rather than eyeballed. The VERB SETS
     * settle those at build time: MOVE_VERBS holds none of crear, crea,
     * agregar, agrega, anadir, anade, nuevo or nueva. Moving this rule below
     * MOVE_ITEM changes none of the 37,268.
     *
     * The shape is the place rule's, with the same split: "nuevo" and "nueva"
     * may be followed by a bare space, while "crear", "agregar" and "anadir"
     * have to carry "llamado", "llamada" or a colon before anything past the
     * noun is read as a name. The adjective stands on either side of the noun,
     * and allowing both loosens nothing, because the connector is required
     * either way.
     *
     * That narrowing earns its place here more plainly than it did for places.
     * "grupo" is an ordinary Spanish noun inside ordinary things a household
     * owns and knows: un grupo electrogeno is a generator set, un grupo
     * sanguineo is a blood type. Both stay what they were - "agrega un grupo
     * electrogeno" is still one more generator - because "agrega" cannot name
     * a category without the connector. The separator after the noun is never
     * the empty match, always a real space or a colon, so "agrupacion" stays
     * whole.
     *
     * What the bare space after "nuevo" still costs, spelled out because it is
     * a real cost and not an oversight: everything past the noun becomes the
     * name, so "nuevo grupo electrogeno" makes a category called "electrogeno"
     * and "nueva categoria de herramientas" one called "de herramientas".
     * English pays the same price on "new group buy", and nothing is written
     * on it - `execute` proposes a `NEW_CATEGORY` and the card asks first.
     *
     * The catalog was swept in Spanish as it was for places: all 194 names in
     * `data/catalog.generated.ts` after twelve creating and adding verbs and
     * seven articles, 16,296 sentences, and not one parses differently with
     * this rule present - no catalog name contains "categoria" or "grupo" at
     * all. The hand-built probes above are what actually earned their keep.
     */
    name: 'CREATE_CATEGORY',
    pattern:
      /^(?:(?:nuevo|nueva)\s+(?:un\s+|una\s+)?(?:categoria|grupo)(?:\s+(?:llamado|llamada)\s+|\s*:\s*|\s+)(.+)|(?:crear|crea|agregar|agrega|anadir|anade)\s+(?:un\s+|una\s+)?(?:nuevo\s+|nueva\s+)?(?:categoria|grupo)(?:\s+(?:nuevo|nueva))?(?:\s+(?:llamado|llamada)\s+|\s*:\s*)(.+))$/,
    build: (match): Intent | null => {
      const name = stripLeadingArticle((match[1] ?? match[2] ?? '').trim());
      return name === '' ? null : { kind: 'CREATE_CATEGORY', name };
    },
  },

  {
    /*
     * Beside the two rules above, and before ADJUST_QUANTITY for their reason:
     * `ADD_VERBS` claims "agrega", "agregar", "anade" and "anadir", so without
     * this rule running first "agrega un contacto llamado ana" is one more of
     * an item named "contacto llamado ana" - checked by running that sentence
     * through this grammar with this rule taken back out, not assumed. "crear"
     * and "crea" are in neither verb map, so those sentences simply reached
     * UNKNOWN before this rule existed.
     *
     * Its position relative to CREATE_LOCATION, CREATE_CATEGORY, CREATE_ITEM
     * and MOVE_ITEM is not load-bearing. The first three cannot collide at
     * all: their nouns are lugar, sitio, ubicacion, zona and habitacion;
     * categoria and grupo; item, articulo, producto and cosa - none of them
     * "contacto". MOVE_ITEM genuinely can, its verb slot being a bare `[a-z]+`
     * filtered against MOVE_VERBS only after a match; the VERB SETS settle it
     * at build time, and MOVE_VERBS holds none of crear, crea, agregar,
     * agrega, anadir, anade, nuevo or nueva. The sweep below was run with this
     * rule moved under MOVE_ITEM and nothing changed.
     *
     * The shape is the place rule's, with the same split: "nuevo" and "nueva"
     * may be followed by a bare space, while "crear", "agregar" and "anadir"
     * have to carry "llamado", "llamada" or a colon before anything past the
     * noun is read as a name. The adjective stands on either side of the noun,
     * and allowing both loosens nothing, because the connector is required
     * either way.
     *
     * That narrowing earns its place here on a collision that is not
     * hypothetical: LOS LENTES DE CONTACTO. "agrega lentes de contacto" is a
     * real sentence about a real thing to stock, and it stays what it was -
     * twice over, in fact, because "lentes" and not "contacto" is the word
     * that follows the verb, so this pattern never reaches the noun at all.
     * The connector is what closes the case that does: "agrega un contacto
     * bueno" names nobody without it. The separator after the noun is never
     * the empty match, always a real space or a colon, so "contactos" stays
     * whole and "agrega contactos de emergencia" stays stock rather than a
     * person.
     *
     * What the bare space after "nuevo" still costs, spelled out because it is
     * a real cost and not an oversight: everything past the noun becomes the
     * name, so "nuevo contacto de emergencia" makes a contact called "de
     * emergencia". English pays the same price on "new contact lenses", and
     * nothing is written on it - `execute` proposes a `NEW_CONTACT` and the
     * card asks first, with the name and the number on it.
     *
     * One alternation and one tail, where the place and category rules write
     * the tail out twice: those capture a name and nothing else. "mi" is the
     * handle Spanish reaches for - "mi hermana", "mi medico" - and one word
     * after it is as much as a regex can safely claim. The number is peeled
     * off the tail in `readContact` rather than by an optional group in the
     * pattern, for the reason `en.ts` gives at length: such a group cannot
     * attach at the first character of the name, so "nuevo contacto mi medico
     * telefono 5551234" stored the digits inside the name and showed no
     * warning about them.
     *
     * WHAT DECLINING ACTUALLY DOES, corrected here as it is in `en.ts`.
     * Returning null declines the RULE, not the sentence, and `parse` carries
     * on down the list. "nuevo contacto ana telefono quinientos" reaches
     * nothing else and the sheet says it did not understand. "agrega un
     * contacto llamado ana telefono quinientos" still opens with a verb in
     * `ADD_VERBS`, so ADJUST_QUANTITY takes it, finds no such item, and offers
     * to create a stock row named after the whole sentence. Nothing is written
     * either way; the offer is a button.
     *
     * The catalog was swept in Spanish as it was for places and categories:
     * all 194 names in `data/catalog.generated.ts` after the eight creating
     * and adding verbs above and seven articles, 10,864 sentences, and not one
     * parses differently with this rule present. Nor does moving this rule
     * below MOVE_ITEM change any of them.
     *
     * Unlike those two sweeps, this one had something to find. "Lista de
     * Contactos de Emergencia" is one of the 194, and it is the first catalog
     * name on this branch to contain one of these rules' nouns at all. It
     * comes through unchanged because the noun is not the word the pattern
     * looks at: "agrega la lista de contactos de emergencia" has "lista"
     * after the article, so the pattern never reaches its own noun. The
     * contact-lens probes above are what earned their keep.
     */
    name: 'CREATE_CONTACT',
    pattern:
      /^(?:(?:nuevo|nueva)\s+(?:un\s+|una\s+)?contacto(?:\s+(?:llamado|llamada)\s+|\s*:\s*|\s+)|(?:crear|crea|agregar|agrega|anadir|anade)\s+(?:un\s+|una\s+)?(?:nuevo\s+|nueva\s+)?contacto(?:\s+(?:nuevo|nueva))?(?:\s+(?:llamado|llamada)\s+|\s*:\s*))(?:(mi\s+([a-z]+))\s+)?(.+)$/,
    build: (match, tools): Intent | null =>
      readContact(tools.numbers, match[1], match[2], (match[3] ?? '').trim()),
  },

  {
    // Before ADJUST, because "agrega un producto nuevo" also matches an add verb.
    name: 'CREATE_ITEM',
    pattern:
      /^(?:crear|crea|nuevo|nueva|agregar|agrega|anadir|anade|registrar|registra)\s+(?:un\s+|una\s+)?(?:item|articulo|producto|cosa)\s*(?:nuevo|nueva)?\s*(?:llamado\s+|llamada\s+)?:?\s*(.+)$/,
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
    /*
     * After CREATE_ITEM and before ADJUST_QUANTITY, and both halves matter.
     *
     * AFTER CREATE_ITEM, because "agrega un producto: arroz en la despensa"
     * names a shelf too, and a creation read as a move would put nothing in
     * the inventory at all.
     *
     * BEFORE ADJUST_QUANTITY, because four of the verbs below - pon, mete,
     * coloca, guarde - are also ways of saying stock arrived, and all four are
     * in `ADD_VERBS`. The destination separates them: "guarde el arroz EN LA
     * DESPENSA" moves the row that exists, "guarde 5 latas de arroz" says five
     * more cans are in the house. This rule cannot match the second, because
     * there is no destination in it, so the sentence falls through to the
     * adjustment it really is.
     *
     * A number in front of the item declines the match for the same reason. An
     * item holds ONE location, so "pon 2 kilos de arroz en la despensa" cannot
     * be performed as a partial move, and two kilos arriving on a named shelf
     * is much the likelier sentence.
     */
    name: 'MOVE_ITEM',
    pattern:
      /^([a-z]+)\s+(?:el\s+|la\s+|los\s+|las\s+|mi\s+)?(.+?)\s+(?:para|hacia|hasta|dentro de|al|a la|a los|a las|a|en)\s+(?:el\s+|la\s+|los\s+|las\s+|mi\s+)?(.+)$/,
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
      /^(?:que (?:me )?faltan?|que me hace falta|que (?:se )?esta (?:faltando|acabando|terminando)|que (?:se )?(?:acabo|termino|agoto)|que (?:necesito|tengo que|hay que|debo) (?:comprar|reponer)|que falta comprar|lista (?:de compras|del super|del mercado)|que comprar|que reponer)$/,
    build: (): Intent => ({ kind: 'QUERY_MISSING' }),
  },

  {
    name: 'QUERY_EXPIRING',
    pattern:
      /^(?:que productos|que articulos|que cosas|que items|cuales items|cuales|hay algo|algo|que)\s+(?:esta\s+|estan\s+|ya\s+|va a\s+|van a\s+|se\s+|ha\s+|han\s+|por\s+|esta por\s+|estan por\s+)*(?:venciendo|vencidos|vencido|vencieron|vencen|vencio|vence|vencer|caducando|caducados|caducado|caducan|caduco|caduca|caducar|echando a perder|echado a perder)\s*(.*)$/,
    build: (match, tools): Intent => {
      const tail = (match[1] ?? '').trim();
      const expiredOnly =
        /\bvencidos?\b|\bvencio\b|\bvencieron\b|\bcaducados?\b|\bcaduco\b|\bechado a perder\b/
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
      /^(?:como estoy de (?:preparacion|preparado)|como voy de preparacion|que tan (?:preparado|listo) estoy|cual es mi (?:puntuacion|nota|preparacion|nivel)|mi puntuacion|estoy preparado|estoy listo)$/,
    build: (): Intent => ({ kind: 'QUERY_SCORE' }),
  },

  {
    /*
     * Before QUERY_QUANTITY, which would read "cuantos items tengo" as a
     * question about a product called "items" and answer, with confidence,
     * that there is none of it.
     *
     * The `$` after a short list of tails is what keeps the two apart:
     * "cuantos items DE ARROZ tengo" cannot reach the end of this pattern, so
     * it falls through to the quantity rule that can answer it.
     */
    name: 'QUERY_TOTAL',
    pattern:
      /^(?:(?:cuantos|cuantas)\s+(?:items|cosas|productos|articulos)(?:\s+(?:tengo|tenemos|hay|existen))?(?:\s+(?:en total|en el inventario|en stock|registrados))?|cual es (?:el|mi) total de (?:items|productos|cosas)|total de (?:items|productos)|que tan grande es mi inventario)$/,
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
      /^(?:cual es (?:el |la )?(?:telefono|numero|celular|movil|contacto)\s+(?:de |del |de la )?(.+)|(?:el |la )?(?:telefono|numero|celular|movil|contacto)\s+(?:de|del|de la)\s+(.+)|(?:me )?(?:pasa|da) el (?:telefono|numero|contacto)\s+(?:de|del|de la)\s+(.+)|como (?:lo |la )?(?:llamo|contacto|hablo)\s+(?:a|al|con|a la)\s+(.+))$/,
    build: (match): Intent | null => {
      const query = cleanContactPhrase(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
      return query === '' ? null : { kind: 'QUERY_CONTACT', query };
    },
  },

  {
    /*
     * Both orders, because both are spoken: "cuando vence la leche" and
     * "cuando la leche se vence". The second alternative is what makes the
     * inverted form answerable, and it stays ANCHORED ON THE EXPIRY WORD - a
     * looser capture would read "cuando compre arroz" as a question about a
     * product called "compre".
     */
    name: 'QUERY_EXPIRY_OF',
    pattern:
      /^(?:cuando (?:se vence|vence|caduca|expira)\s+(.+)|cuando (?:el |la |los |las )?(.+?)\s+(?:se vence|vence|caduca|expira)|cual es la (?:fecha de )?(?:vencimiento|caducidad) (?:del|de la|de)\s+(.+))$/,
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
     * "cuando compre arroz" opens exactly like "cuando vence el arroz", so the
     * expiry question is tried first and declines everything that is not about
     * a date. And it has to come before SET_EXPIRY, whose loose leading
     * capture would read a history question with a date in it as a write.
     */
    name: 'QUERY_HISTORY',
    pattern:
      /^(?:cuando (?:fue que )?(?:compre|compramos|compro|use|usamos|gaste|abri|repuse|consegui)\s+(.+)|cuando fue la ultima vez que (?:compre|use|abri)\s+(.+)|(?:el )?historial (?:del|de la|de)\s+(.+)|(?:los )?movimientos (?:del|de la|de)\s+(.+)|(?:la )?ultima compra de\s+(.+))$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(
        match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '',
      );
      return item === '' ? null : { kind: 'QUERY_HISTORY', item };
    },
  },

  {
    // After QUERY_EXPIRY_OF, so "cuando vence la leche" is not read as a write.
    //
    // The spoken date is captured whole, prepositions and all: "el 12" and "en
    // marzo" only parse WITH them, so stripping in the pattern would silently
    // kill both. `parseDatePhrase` handles the case that needs them gone.
    //
    // The first alternative is the one QUERY_EXPIRY_OF deliberately does not
    // claim: that rule reads "CUAL ES la fecha de vencimiento de la leche" and
    // stops there, so "la caducidad de la leche es el 12" arrives here as the
    // statement it is.
    name: 'SET_EXPIRY',
    pattern:
      /^(?:(?:la )?(?:caducidad|fecha de vencimiento|fecha de caducidad) (?:del|de la|de)\s+(.+?)\s+es\s+(.+)|(?:el\s+|la\s+|los\s+|las\s+)?(.+?)\s+(?:se vence|vence|caduca|tiene vencimiento)\s+(.+))$/,
    build: (match, tools, context): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? match[3] ?? '');
      const date = parseDatePhrase(tools, context, match[2] ?? match[4] ?? '');
      if (item === '' || date === null) return null;
      return { kind: 'SET_EXPIRY', item, expiresOn: date.date, dateAssumed: date.assumed };
    },
  },

  {
    /*
     * Before QUERY_WHERE_LOCATION, which would otherwise read "que hay en la
     * categoria alimentos" as a place called "categoria alimentos" and report
     * that no such shelf exists.
     *
     * This rule is the half of the question that says which it means. The
     * ambiguous half - "que hay en alimentos" - is left to the location rule
     * below, which falls back to the category when no place fits. The comment
     * on QUERY_WHERE in `services/voice/execute.ts` says why the place wins
     * that race.
     */
    name: 'QUERY_CATEGORY',
    pattern:
      /^(?:(?:que hay|que tengo|que items|cuales items)\s+(?:en|de)\s+(?:la\s+)?categoria\s+(?:de\s+)?(.+)|(?:me\s+)?(?:muestra|muestrame|lista)\s+(?:la\s+)?categoria\s+(?:de\s+)?(.+)|categoria\s+(?:de\s+)?(.+))$/,
    build: (match): Intent | null => {
      const category = cleanContactPhrase(match[1] ?? match[2] ?? match[3] ?? '');
      return category === '' ? null : { kind: 'QUERY_CATEGORY', category };
    },
  },

  {
    name: 'QUERY_WHERE_LOCATION',
    pattern:
      /^(?:(?:me\s+)?(?:muestra|muestrame|lista)\s+)?(?:que hay guardado|que hay|que tengo|que esta|que guardo)\s+(?:dentro de|en)\s+(?:el\s+|la\s+|los\s+|las\s+|mi\s+)?(.+)$/,
    build: (match): Intent | null => {
      // A bare article is not a place. "que hay en el" is a sentence the
      // recognizer cut short, and asking the database for a shelf called "el"
      // would answer a question nobody finished asking.
      const location = (match[1] ?? '').replace(/^(?:el|la|los|las|mi)$/, '').trim();
      return location === '' ? null : { kind: 'QUERY_WHERE', item: null, location };
    },
  },

  {
    name: 'QUERY_WHERE_ITEM',
    pattern:
      /^(?:donde (?:esta|estan|guardo|guarde|puse|deje|quedo|quedaron)|en que lugar (?:esta|estan))\s+(.+)$/,
    build: (match): Intent | null => {
      const item = cleanItemPhrase(match[1] ?? '');
      return item === '' ? null : { kind: 'QUERY_WHERE', item, location: null };
    },
  },

  {
    /*
     * SET_MINIMUM, SET_TARGET and SET_QUANTITY are three ways of saying "X es
     * N", and they are tried from the most marked to the least.
     *
     * This one goes first because it is the only one carrying "minimo" or "al
     * menos", and because SET_TARGET's opener swallows it: "quiero tener al
     * menos 5 kilos de arroz" is a minimum, and a target rule reading it first
     * would set the wrong field. (It would in fact decline - "al" is not a
     * number - but relying on that would be relying on an accident.)
     *
     * A number is required and never assumed. There is no sensible default for
     * a threshold nobody stated: not one, not the current quantity, not zero.
     */
    name: 'SET_MINIMUM',
    pattern:
      /^(?:(?:el\s+)?(?:stock\s+|nivel\s+)?minimo\s+(?:de|del|de la|para)\s+(.+?)\s+(?:es de|es|son|deberia ser|tiene que ser)\s+(.+)|(?:(?:yo\s+)?(?:quiero|necesito|debo)\s+)?(?:tener|mantener|guardar)\s+(?:al menos|por lo menos|como minimo)\s+(.+)|(?:al menos|por lo menos)\s+(.+?)\s+(?:de|del|de la)\s+(.+))$/,
    build: (match, tools): Intent | null => {
      const named = match[1];
      const spokenFirst = match[2] ?? match[3] ?? match[4] ?? '';
      const { amount, rest } = splitLeadingAmount(tools.numbers, spokenFirst);
      // Zero is a legitimate minimum: it says "never warn me about this one".
      if (amount === null || amount < 0) return null;

      const item = cleanItemPhrase(named ?? match[5] ?? rest);
      if (item === '') return null;
      return { kind: 'SET_MINIMUM', item, amount, unit: findUnit(spokenFirst) };
    },
  },

  {
    /*
     * After SET_MINIMUM for the reason given there, and before SET_QUANTITY
     * because "quiero tener 20 latas" and "ahora tengo 20 latas" are different
     * claims: one is the level being aimed at, the other is what is on the
     * shelf right now. Neither opener can match the other's sentence, so the
     * order is documentation rather than load-bearing - but it keeps the three
     * "X es N" rules in one readable run.
     */
    name: 'SET_TARGET',
    pattern:
      /^(?:(?:el\s+|la\s+)?(?:ideal|objetivo|meta|nivel ideal)\s+(?:de|del|de la|para)\s+(.+?)\s+(?:es de|es|son)\s+(.+)|(?:yo\s+)?(?:quiero|necesito|pretendo|me gustaria)\s+(?:tener|mantener|guardar|llegar a)\s+(.+))$/,
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
     * Before ADJUST and before QUERY_QUANTITY, both of which match "tengo".
     *
     * Three shapes, and two of them are here because they are what people
     * actually say when a number changes to a number:
     *
     *   "ahora tengo 12 latas" states the new count outright.
     *   "se acabo el arroz" states it as zero. Read as a removal it would take
     *   one bag off a shelf that is already empty, which is both wrong and
     *   useless; the speaker is saying the rice is gone.
     *   "solo quedan 2 huevos" states what is left rather than what went.
     *
     * The emptying shape declines when a number was spoken - "use todo 2" is
     * not a sentence, but "gaste 2 huevos" is, and it is an adjustment - and
     * the last shape declines when no number was spoken, which lets a question
     * about what is left fall through to the rule that answers questions.
     */
    name: 'SET_QUANTITY',
    pattern:
      /^(?:(?:ahora|en realidad|realmente)\s+(?:tengo|tenemos|hay|son|quedan|queda)\s+(.+)|(?:se acabo|se acabaron|se termino|se terminaron|ya no hay|ya no queda|ya no quedan|ya no tengo|me acabe|se agoto)\s+(?:el\s+|la\s+|los\s+|las\s+|todo el\s+|toda la\s+)?(.+)|(?:use|gaste|comi|bebi|tome|consumi|acabe con|termine)\s+(?:todo|toda|todos|todas)\s+(?:el\s+|la\s+|los\s+|las\s+)?(.+)|(?:solo|solamente|unicamente)\s+(?:hay|quedan|queda|tengo|me quedan)\s+(.+)|(?:quedan|queda|hay)\s+(?:solo|solamente|unicamente)\s+(.+))$/,
    build: (match, tools): Intent | null => {
      const emptied = match[2] ?? match[3];
      if (emptied !== undefined) {
        // A number here means the sentence is about what was used, not about
        // an empty shelf: declining hands it to the rule that performs an
        // adjustment.
        if (splitLeadingAmount(tools.numbers, emptied).amount !== null) return null;
        const item = cleanItemPhrase(emptied);
        return item === '' ? null : { kind: 'SET_QUANTITY', item, amount: 0, unit: null };
      }

      const spoken = match[1] ?? match[4] ?? match[5] ?? '';
      const { amount, rest } = splitLeadingAmount(tools.numbers, spoken);
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
    //
    // The openers now include the clipped forms - "queda arroz", "todavia
    // tengo frijoles" - and a courtesy opening, because "dime cuanto arroz hay"
    // is the same question as "cuanto arroz hay" with the manners left in.
    name: 'QUERY_QUANTITY',
    pattern:
      /^(?:(?:me\s+)?(?:dime|di|dice|muestra|muestrame)\s+)?(?:cuanto|cuanta|cuantos|cuantas|hay|tengo|tenemos|queda|quedan|sobra|sobran|todavia tengo|todavia hay|todavia queda|aun tengo|aun hay|aun queda)\s+(?:(?:me\s+)?(?:tenemos|tengo|quedan|queda|hay|sobra|sobran)\s+)?(?:de\s+)?(.+?)(?:\s+(?:todavia\s+)?(?:me\s+)?(?:tenemos|tengo|quedan|queda|hay|sobran|sobra))?$/,
    build: (match, tools): Intent | null => {
      const item = stripQueryWords(cleanItemPhrase(match[1] ?? ''));
      if (item === '') return null;
      /*
       * An item phrase that opens with a number is not an item.
       *
       * "quedan solo 2" is a sentence with the noun clipped off, and the
       * openers above are loose enough to catch it. Answering would send "2"
       * to the search, find nothing, and tell the user with confidence that
       * they have no product called 2.
       */
      if (splitLeadingAmount(tools.numbers, item).amount !== null) return null;
      return { kind: 'QUERY_QUANTITY', item };
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
   * reader to send, and `parse` folds on the way back in - `¿cuánto arroz
   * tengo?` reaches the rules as `cuanto arroz tengo`, exactly as the same
   * sentence typed or spoken would. Writing them folded would put misspelt
   * Spanish in front of a Spanish speaker as the first thing the sheet says.
   *
   * Every line is a phrase the rules above actually accept, worded after the
   * forms pinned in `es.phrases.test.ts` rather than invented;
   * `registry.test.ts` parses every example of every grammar and refuses
   * UNKNOWN.
   */
  examples: [
    '¿cuánto arroz tengo?',
    '¿qué está venciendo?',
    '¿qué falta?',
    'agrega cinco latas de frijoles',
    'usé 3 huevos',
    'nuevo lugar, sótano',
    '¿dónde está el arroz?',
    '¿cuántos ítems tengo?',
    'el mínimo de arroz es 5 kilos',
    'mueve el arroz al sótano',
    'nueva categoría, herramientas',
    'nuevo contacto ana teléfono 555 1234',
  ],
};
