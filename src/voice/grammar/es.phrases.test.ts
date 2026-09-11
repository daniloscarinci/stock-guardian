/**
 * Every Spanish phrase form the application claims to understand.
 *
 * A transcript arrives without capitals and usually without accents, which is
 * why most rows below are written the way a recognizer actually returns them.
 * The rows that keep their accents and their `¿` are there on purpose: they
 * prove the fold and the punctuation strip in `parse.ts` reach the patterns.
 *
 * When a real phrase fails in real use, add it here first.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../parse';
import { esGrammar } from './es';
import type { Intent } from '../intents';

const CTX = { today: '2026-09-07' };
const say = (text: string): Intent => parse(esGrammar, text, CTX);

describe('es phrases: asking', () => {
  const quantity = ['cuanto arroz tengo', 'cuanto arroz', 'cuantas latas de frijoles tengo',
    'hay azucar', 'tengo agua', 'cuanta agua tengo', 'cuanto queda de cafe',
    // The clipped register, which is most of what a phone actually receives.
    'queda arroz', 'quedan huevos', 'todavia tengo frijoles', 'todavia hay cafe',
    'aun tengo arroz', 'sobra arroz', 'dime cuanto arroz hay',
    'muestrame cuanto arroz tengo', 'cuanto arroz me queda'];
  for (const phrase of quantity) {
    it(`"${phrase}" asks a quantity`, () => {
      expect(say(phrase).kind).toBe('QUERY_QUANTITY');
    });
  }

  it('recovers the item from a quantity question', () => {
    expect(say('cuantas latas de frijoles negros tengo')).toEqual({
      kind: 'QUERY_QUANTITY', item: 'frijoles negros',
    });
  });

  /**
   * The verb can trail the item. A leftover in the item phrase means the
   * search looks for a product by that name and reports, confidently, that the
   * user has none of it.
   */
  const trailingVerb: ReadonlyArray<readonly [string, string]> = [
    ['cuantos huevos quedan', 'huevos'],
    ['cuanto arroz sobra', 'arroz'],
    ['cuanta leche hay', 'leche'],
  ];
  for (const [phrase, item] of trailingVerb) {
    it(`"${phrase}" asks about ${item}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_QUANTITY', item });
    });
  }

  /** Inverted order, answerable because these are read-only questions. */
  const inverted: ReadonlyArray<readonly [string, string]> = [
    ['cuanto tengo de azucar', 'azucar'],
    ['cuanto queda de arroz', 'arroz'],
    ['cuantos huevos me quedan', 'huevos'],
  ];
  for (const [phrase, item] of inverted) {
    it(`"${phrase}" asks about ${item} despite the word order`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_QUANTITY', item });
    });
  }

  const expiring = ['que esta venciendo', 'que vence', 'cuales items estan venciendo',
    'que va a vencer',
    'que esta por vencer', 'que se vence', 'hay algo venciendo', 'algo venciendo',
    'que productos estan venciendo', 'que cosas van a vencer',
    'que esta caducando', 'que va a caducar', 'que se esta echando a perder'];
  for (const phrase of expiring) {
    it(`"${phrase}" asks what is expiring`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: false });
    });
  }

  const expired = ['que ha vencido', 'que ya vencio', 'que vencio',
    'que esta vencido', 'que ha caducado', 'que ya caduco'];
  for (const phrase of expired) {
    it(`"${phrase}" asks only for what is already past`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: true });
    });
  }

  it('reads a window out of the question', () => {
    expect(say('que vence en los proximos 30 dias')).toMatchObject({
      kind: 'QUERY_EXPIRING', withinDays: 30,
    });
  });

  /**
   * A period is a window too.
   *
   * "esta semana" and "este mes" are the ordinary way to ask, and the number
   * behind each is this application's own - seven and thirty, the figures the
   * expiry screen already uses. Saying it out loud in a row here is what keeps
   * that choice honest: nobody said seven.
   */
  const windows: ReadonlyArray<readonly [string, number]> = [
    ['que vence hoy', 0],
    ['que vence manana', 1],
    ['que vence esta semana', 7],
    ['que vence este mes', 30],
    ['que vence dentro de 10 dias', 10],
  ];
  for (const [phrase, withinDays] of windows) {
    it(`"${phrase}" asks about ${withinDays} days`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', withinDays });
    });
  }

  const missing = ['que falta', 'que me falta', 'que necesito comprar',
    'lista de compras', 'que esta acabando',
    'que me hace falta', 'que faltan', 'que se acabo', 'que se termino',
    'que tengo que comprar', 'que hay que comprar', 'que debo comprar',
    'que necesito reponer', 'que tengo que reponer', 'que falta comprar',
    'lista del super', 'lista del mercado', 'que comprar', 'que reponer'];
  for (const phrase of missing) {
    it(`"${phrase}" asks what is missing`, () => {
      expect(say(phrase).kind).toBe('QUERY_MISSING');
    });
  }

  const whereItem: ReadonlyArray<readonly [string, string]> = [
    ['donde esta el arroz', 'arroz'],
    ['donde estan las pilas', 'pilas'],
    ['donde guardo el arroz', 'arroz'],
    ['donde guarde el arroz', 'arroz'],
    ['donde puse el arroz', 'arroz'],
    ['donde deje el arroz', 'arroz'],
    ['donde quedo el arroz', 'arroz'],
    ['en que lugar esta el arroz', 'arroz'],
  ];
  for (const [phrase, item] of whereItem) {
    it(`"${phrase}" asks where ${item} is`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_WHERE', item, location: null });
    });
  }

  const whereLocation: ReadonlyArray<readonly [string, string]> = [
    ['que hay en la despensa', 'despensa'],
    ['que tengo en el congelador', 'congelador'],
    ['que guardo en el sotano', 'sotano'],
    ['que esta en la despensa', 'despensa'],
    ['que hay dentro de la nevera', 'nevera'],
    ['que hay guardado en el garaje', 'garaje'],
    ['muestrame que hay en la despensa', 'despensa'],
  ];
  for (const [phrase, location] of whereLocation) {
    it(`"${phrase}" asks what is in the ${location}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_WHERE', item: null, location });
    });
  }

  const expiryOf = ['cuando vence la leche', 'cuando caduca la leche',
    'cuando se vence la leche', 'cuando la leche se vence',
    'cuando la leche caduca', 'cuando expira la leche',
    'cual es la fecha de vencimiento de la leche',
    'cual es la caducidad de la leche'];
  for (const phrase of expiryOf) {
    it(`"${phrase}" asks when milk expires`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_EXPIRY_OF', item: 'leche' });
    });
  }

  const score = ['como estoy de preparacion', 'que tan preparado estoy',
    'como voy de preparacion', 'que tan listo estoy', 'cual es mi puntuacion',
    'cual es mi nivel', 'mi puntuacion', 'estoy preparado', 'estoy listo'];
  for (const phrase of score) {
    it(`"${phrase}" asks for the preparedness score`, () => {
      expect(say(phrase).kind).toBe('QUERY_SCORE');
    });
  }

  const help = ['ayuda', 'que puedes hacer', 'ayudame', 'que entiendes',
    'que sabes hacer', 'que puedo decir', 'que puedo preguntar',
    'cuales son los comandos', 'como funciona', 'como se usa'];
  for (const phrase of help) {
    it(`"${phrase}" asks for help`, () => {
      expect(say(phrase).kind).toBe('HELP');
    });
  }
});

describe('es phrases: the whole stock, the address book and the past', () => {
  const total = ['cuantos items tengo', 'cuantos items', 'cuantas cosas tengo',
    'cuantos productos tengo', 'cuantos articulos hay', 'cuantos items en total',
    'cual es el total de items', 'total de items', 'que tan grande es mi inventario'];
  for (const phrase of total) {
    it(`"${phrase}" counts the whole inventory`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_TOTAL' });
    });
  }

  /**
   * The counting question and the whole-stock question are one word apart.
   *
   * "cuantos items de arroz tengo" is about rice, and it has to survive
   * QUERY_TOTAL to reach the rule that can answer it - the `$` on that rule is
   * what lets it through.
   */
  it('still asks about one item when the sentence names one', () => {
    expect(say('cuantos items de arroz tengo')).toEqual({
      kind: 'QUERY_QUANTITY', item: 'arroz',
    });
  });

  const contact: ReadonlyArray<readonly [string, string]> = [
    ['cual es el telefono del medico', 'medico'],
    ['cual es el numero del medico', 'medico'],
    ['telefono del medico', 'medico'],
    ['numero de ana', 'ana'],
    ['celular del vecino', 'vecino'],
    ['contacto del vecino', 'vecino'],
    ['me pasa el telefono del medico', 'medico'],
    ['como llamo al medico', 'medico'],
    ['como contacto a ana', 'ana'],
  ];
  for (const [phrase, query] of contact) {
    it(`"${phrase}" looks up ${query} in the contacts`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_CONTACT', query });
    });
  }

  /**
   * The article comes off the front and nothing else does.
   *
   * `contacts.search` asks whether a stored field CONTAINS the phrase, so "el
   * medico" matches nothing and "medico" matches the doctor - while a name
   * with a preposition inside it has to survive whole.
   */
  it('keeps the inside of a name and drops only the article', () => {
    expect(say('telefono de ana de la clinica')).toEqual({
      kind: 'QUERY_CONTACT', query: 'ana de la clinica',
    });
  });

  const history: ReadonlyArray<readonly [string, string]> = [
    ['cuando compre arroz', 'arroz'],
    ['cuando compramos arroz', 'arroz'],
    ['cuando fue que compre arroz', 'arroz'],
    ['cuando use los frijoles', 'frijoles'],
    ['cuando abri la leche', 'leche'],
    ['cuando fue la ultima vez que compre arroz', 'arroz'],
    ['historial del arroz', 'arroz'],
    ['el historial de arroz', 'arroz'],
    ['movimientos del arroz', 'arroz'],
    ['la ultima compra de arroz', 'arroz'],
  ];
  for (const [phrase, item] of history) {
    it(`"${phrase}" asks for the history of ${item}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_HISTORY', item });
    });
  }

  /**
   * "cuando compre" and "cuando vence" open identically, and only one of them
   * is about a date in the future. The expiry question is tried first and
   * declines everything that is not about a date, which keeps these apart.
   */
  it('does not read a history question as an expiry question', () => {
    expect(say('cuando compre la leche')).toEqual({ kind: 'QUERY_HISTORY', item: 'leche' });
    expect(say('cuando vence la leche')).toEqual({ kind: 'QUERY_EXPIRY_OF', item: 'leche' });
  });

  const category: ReadonlyArray<readonly [string, string]> = [
    ['que hay en la categoria alimentos', 'alimentos'],
    ['que tengo en la categoria agua', 'agua'],
    ['que items en categoria alimentos', 'alimentos'],
    ['muestra la categoria alimentos', 'alimentos'],
    ['muestrame la categoria alimentos', 'alimentos'],
    ['lista la categoria alimentos', 'alimentos'],
    ['categoria alimentos', 'alimentos'],
  ];
  for (const [phrase, name] of category) {
    it(`"${phrase}" asks for the ${name} category`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_CATEGORY', category: name });
    });
  }

  /**
   * THE DECISION, written down.
   *
   * "que hay en alimentos" names something that could be a shelf or could be a
   * category, and the words cannot say which - so the grammar does not try. It
   * produces the LOCATION question, and `execute` looks for a place first and
   * falls back to the category when there is none. A place wins because it is
   * the more concrete of the two: locations are things the user made and
   * named, categories are twenty fixed labels that ship with the application.
   *
   * The unambiguous form above says "categoria" out loud and skips the race.
   */
  it('leaves the ambiguous form as a place, for execute to resolve', () => {
    expect(say('que hay en alimentos')).toEqual({
      kind: 'QUERY_WHERE', item: null, location: 'alimentos',
    });
  });
});

describe('es phrases: changing', () => {
  it('adds with a spoken number', () => {
    expect(say('agrega cinco latas de frijoles')).toEqual({
      kind: 'ADJUST_QUANTITY', item: 'frijoles', amount: 5,
      direction: 'up', transaction: 'add', unit: 'latas', amountAssumed: false,
    });
  });

  it('adds with a single-word numeral above twenty', () => {
    expect(say('anade veinticinco latas de frijoles')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'frijoles', amount: 25, direction: 'up',
    });
  });

  it('adds with a multi-word numeral', () => {
    expect(say('agrega treinta y cinco latas de frijoles')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'frijoles', amount: 35, direction: 'up',
    });
  });

  it('records a purchase as a purchase', () => {
    expect(say('compre 2 kg de arroz')).toMatchObject({
      direction: 'up', transaction: 'purchase', amount: 2, item: 'arroz',
    });
  });

  it('records consumption as consumption', () => {
    expect(say('use 3 huevos')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'huevos', amount: 3,
      direction: 'down', transaction: 'consume',
    });
  });

  /**
   * Stock arrives in more ways than it is "agregado", and the words differ by
   * half a continent: "coger" is ordinary in Spain and startling in much of
   * Latin America, where "agarrar" does the same work. Both are here.
   */
  const arriving: ReadonlyArray<readonly [string, string, number]> = [
    ['recibi 4 cajas de leche', 'leche', 4],
    ['meti 2 latas de frijoles', 'frijoles', 2],
    ['puse 3 botellas de agua', 'agua', 3],
    ['coloque 2 kilos de arroz', 'arroz', 2],
    ['guarde 5 latas de frijoles', 'frijoles', 5],
    ['traje 3 bolsas de arroz', 'arroz', 3],
    ['consegui 2 paquetes de arroz', 'arroz', 2],
    ['llegaron 6 latas de frijoles', 'frijoles', 6],
  ];
  for (const [phrase, item, amount] of arriving) {
    it(`"${phrase}" adds ${amount} of ${item}`, () => {
      expect(say(phrase)).toMatchObject({
        kind: 'ADJUST_QUANTITY', item, amount, direction: 'up',
      });
    });
  }

  const leaving: ReadonlyArray<readonly [string, string, number]> = [
    ['cogi 3 huevos', 'huevos', 3],
    ['agarre 2 latas de frijoles', 'frijoles', 2],
    ['bote 2 huevos', 'huevos', 2],
    ['tome 2 litros de agua', 'agua', 2],
    ['bebi 1 litro de agua', 'agua', 1],
    ['comimos 6 huevos', 'huevos', 6],
    ['abri una lata de frijoles', 'frijoles', 1],
    ['perdi 3 huevos', 'huevos', 3],
    ['saque 2 kilos de arroz', 'arroz', 2],
  ];
  for (const [phrase, item, amount] of leaving) {
    it(`"${phrase}" removes ${amount} of ${item}`, () => {
      expect(say(phrase)).toMatchObject({
        kind: 'ADJUST_QUANTITY', item, amount, direction: 'down',
      });
    });
  }

  it('removes with a fraction', () => {
    expect(say('quita medio kilo de arroz')).toMatchObject({
      direction: 'down', amount: 0.5, item: 'arroz',
    });
  });

  it('consumes half a dozen', () => {
    expect(say('comi media docena de huevos')).toMatchObject({
      direction: 'down', amount: 6, item: 'huevos',
    });
  });

  it('adds a pair', () => {
    expect(say('agrega un par de pilas')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'pilas', amount: 2, direction: 'up',
    });
  });

  /**
   * Spanish says it both ways round - "pon mas 2 huevos" and "agrega 2 huevos
   * mas" - so "mas" is stripped ahead of the numeral AND listed as a filler.
   * Either way it carries no arithmetic of its own: the verb already said which
   * direction the stock moves.
   */
  it('tolerates "mas" between the verb and the number', () => {
    expect(say('pon mas 2 huevos')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'huevos', amount: 2, direction: 'up',
    });
  });

  it('tolerates "mas" after the item', () => {
    expect(say('agrega 2 huevos mas')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'huevos', amount: 2, direction: 'up',
    });
  });

  it('keeps the verb in charge of the direction', () => {
    expect(say('quita mas 2 huevos')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'huevos', amount: 2, direction: 'down',
    });
  });

  it('sets an absolute quantity', () => {
    expect(say('ahora tengo 12 latas de frijoles')).toMatchObject({
      kind: 'SET_QUANTITY', amount: 12, item: 'frijoles', unit: 'latas',
    });
  });

  it('sets an absolute quantity of zero', () => {
    expect(say('ahora tengo cero huevos')).toMatchObject({
      kind: 'SET_QUANTITY', amount: 0, item: 'huevos',
    });
  });

  /**
   * "se acabo el arroz" is a number, not a removal.
   *
   * Read as an adjustment it would take one bag off a shelf that is already
   * empty - wrong, and useless. The speaker is stating what is there now,
   * which is nothing, so it sets the quantity to zero the way "ahora tengo 12"
   * sets it to twelve.
   */
  const emptied = ['se acabo el arroz', 'se acabaron los huevos', 'se termino el arroz',
    'ya no hay arroz', 'ya no queda arroz', 'ya no tengo arroz',
    'use todo el arroz', 'comi todos los huevos', 'se agoto el arroz'];
  for (const phrase of emptied) {
    it(`"${phrase}" sets the quantity to zero`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_QUANTITY', amount: 0 });
    });
  }

  it('names the item that ran out', () => {
    expect(say('se acabo el arroz')).toEqual({
      kind: 'SET_QUANTITY', item: 'arroz', amount: 0, unit: null,
    });
  });

  /**
   * "solo quedan 2 huevos" says what is left, which is a correction rather
   * than a removal: two is the count now, not the count that went.
   */
  const leftovers: ReadonlyArray<readonly [string, string, number]> = [
    ['solo quedan 2 huevos', 'huevos', 2],
    ['quedan solo 2 huevos', 'huevos', 2],
    ['solo hay 3 latas de frijoles', 'frijoles', 3],
    ['solamente tengo 1 kilo de arroz', 'arroz', 1],
    ['queda solo 1 litro de agua', 'agua', 1],
  ];
  for (const [phrase, item, amount] of leftovers) {
    it(`"${phrase}" corrects ${item} to ${amount}`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_QUANTITY', item, amount });
    });
  }

  /**
   * A write with no number is read as one, and says so.
   *
   * These rows used to sit under "what must NOT parse": nothing in "compre
   * arroz" says one, and guessing writes a number the user never said. None of
   * that reasoning was wrong, but on a real phone it turned the most ordinary
   * sentence anyone says into a transcript on the screen and no change at all.
   *
   * The number is now assumed AND FLAGGED. `amountAssumed` is what carries the
   * old caution: a flagged amount reaches the confirmation card, never the
   * database, so the guess is offered rather than stored behind the user's back.
   */
  const assumedOne: ReadonlyArray<readonly [string, string, 'up' | 'down']> = [
    ['compre arroz', 'arroz', 'up'],
    ['use huevos', 'huevos', 'down'],
    ['agrega frijoles', 'frijoles', 'up'],
    ['quita arroz', 'arroz', 'down'],
    ['compre latas de frijoles', 'frijoles', 'up'],
  ];
  for (const [phrase, item, direction] of assumedOne) {
    it(`"${phrase}" means one ${item}, marked as assumed`, () => {
      expect(say(phrase)).toMatchObject({
        kind: 'ADJUST_QUANTITY', item, amount: 1, direction, amountAssumed: true,
      });
    });
  }

  it('does not mark an amount that was spoken', () => {
    expect(say('use 3 huevos')).toMatchObject({ amount: 3, amountAssumed: false });
  });

  it('sets an expiry date with a bare day', () => {
    expect(say('la leche vence el 12')).toEqual({
      kind: 'SET_EXPIRY', item: 'leche', expiresOn: '2026-09-12', dateAssumed: false,
    });
  });

  /**
   * A month with no day, and a period rather than a day, are dates this
   * application chose. "en marzo" is stored as the 31st because a deadline has
   * to be some day; the speaker never said the 31st, so it is flagged.
   */
  it('sets an expiry date with a month, and marks the day as its own', () => {
    expect(say('la leche vence en marzo')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'leche', expiresOn: '2027-03-31', dateAssumed: true,
    });
  });

  it('marks a relative period as a date it chose', () => {
    expect(say('la leche vence la semana que viene')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'leche', expiresOn: '2026-09-14', dateAssumed: true,
    });
  });

  it('sets an expiry date with a day and month', () => {
    expect(say('el arroz vence el 10 de octubre')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'arroz', expiresOn: '2026-10-10',
    });
  });

  it('sets an expiry date a number of days out', () => {
    expect(say('el pan vence en 10 dias')).toMatchObject({
      kind: 'SET_EXPIRY', item: 'pan', expiresOn: '2026-09-17', dateAssumed: true,
    });
  });

  it('creates an item with everything it was told', () => {
    expect(say('crear item 10 kg de arroz en la despensa')).toMatchObject({
      kind: 'CREATE_ITEM', name: 'arroz', amount: 10, unit: 'kg', location: 'despensa',
    });
  });

  /**
   * "nuevo lugar, sotano" - a place with no item and nowhere else in the
   * sentence for one to be.
   *
   * The comma is not a word the rule sees: `parse.ts` strips a comma that is
   * not holding a decimal together before any rule runs, so this reaches
   * CREATE_LOCATION as "nuevo lugar sotano" - the noun and the name separated
   * by nothing but the single space the comma leaves behind. The accent goes
   * the same way: `foldText` runs first, so "sotano" is what the pattern sees
   * and what the name is captured from.
   */
  it('reads "nuevo lugar, sotano" as a place to create', () => {
    expect(say('nuevo lugar, sótano')).toEqual({ kind: 'CREATE_LOCATION', name: 'sotano' });
  });

  /**
   * The connector form, on the verb that proves this rule has to sit above
   * ADJUST_QUANTITY: "agrega" is in `ADD_VERBS`, so with the rules the other
   * way round the sentence is one more of a product called "lugar llamado
   * sotano".
   */
  it('drops the article from "agrega un lugar llamado el sotano"', () => {
    expect(say('agrega un lugar llamado el sotano')).toEqual({
      kind: 'CREATE_LOCATION', name: 'sotano',
    });
  });

  /** The colon is the written form of the same connector, and survives the strip. */
  it('reads "crear zona: garaje" as a place to create', () => {
    expect(say('crear zona: garaje')).toEqual({ kind: 'CREATE_LOCATION', name: 'garaje' });
  });

  /** Spanish puts the adjective on either side of the noun, and means the same thing. */
  const bothSides = ['crea un nuevo lugar llamado el sotano', 'crea un lugar nuevo llamado el sotano'];
  for (const phrase of bothSides) {
    it(`"${phrase}" creates a place called sotano`, () => {
      expect(say(phrase)).toEqual({ kind: 'CREATE_LOCATION', name: 'sotano' });
    });
  }

  /**
   * The sweep that earned this test: every one of the 194 catalog names in
   * `data/catalog.generated.ts` was spoken after every creating verb and
   * every article, and the loose CREATE_ITEM-shaped pattern stole none of
   * them - no Spanish product name in that file begins with lugar, sitio,
   * ubicacion, zona or habitacion. The collision it did find was a different
   * one: with a loose separator, "agrega un sitio web" became a place called
   * "web", because everything after the noun was read as the name of a shelf.
   * It stays an addition here, because "agrega" names no place at all without
   * "llamado", "llamada" or a colon after the noun.
   */
  it('does not read "agrega un sitio web" as a place worth making', () => {
    expect(say('agrega un sitio web')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'sitio web', direction: 'up',
    });
  });

  /**
   * The same bug on a verb with no fallback reading at all. "crear" is in
   * nobody's verb map - not ADD_VERBS, not REMOVE_VERBS, not MOVE_VERBS - so
   * where "agrega un sitio web" at least falls back to a stock addition,
   * "crear una zona de cultivo" fell all the way to UNKNOWN before
   * CREATE_LOCATION existed. The loose pattern turned that UNKNOWN into a
   * place called "de cultivo"; requiring a connector after "crear" leaves the
   * phrase exactly where it was.
   */
  it('does not read "crear una zona de cultivo" as a place, and stays UNKNOWN', () => {
    expect(say('crear una zona de cultivo').kind).toBe('UNKNOWN');
  });

  /**
   * "nueva categoria, herramientas" - a heading with no item and nowhere else
   * in the sentence for one to be.
   *
   * The comma and the accent both go before any rule runs, exactly as they do
   * for the place above, so this reaches CREATE_CATEGORY as "nueva categoria
   * herramientas".
   */
  it('reads "nueva categoria, herramientas" as a category to create', () => {
    expect(say('nueva categoría, herramientas')).toEqual({
      kind: 'CREATE_CATEGORY', name: 'herramientas',
    });
  });

  /**
   * The connector form, on the verb that proves this rule has to sit above
   * ADJUST_QUANTITY: "agrega" is in `ADD_VERBS`, so with the rules the other
   * way round the sentence is one more of a product called "categoria llamada
   * bunker".
   */
  it('drops the article from "agrega una categoria llamada las herramientas"', () => {
    expect(say('agrega una categoría llamada las herramientas')).toEqual({
      kind: 'CREATE_CATEGORY', name: 'herramientas',
    });
  });

  /** The colon is the written form of the same connector, on the other noun. */
  it('reads "crear grupo: agua" as a category to create', () => {
    expect(say('crear grupo: agua')).toEqual({ kind: 'CREATE_CATEGORY', name: 'agua' });
  });

  /** The adjective stands on either side of the noun, and means the same thing. */
  const categoryBothSides = [
    'crea una nueva categoria llamada herramientas',
    'crea una categoria nueva llamada herramientas',
  ];
  for (const phrase of categoryBothSides) {
    it(`"${phrase}" creates a category called herramientas`, () => {
      expect(say(phrase)).toEqual({ kind: 'CREATE_CATEGORY', name: 'herramientas' });
    });
  }

  /**
   * "grupo" is an ordinary Spanish noun inside things a household actually
   * owns: un grupo electrógeno is a generator set. With a loose separator
   * after the noun this became a place-shaped theft - a category called
   * "electrogeno" - instead of one more generator. It stays an addition here,
   * because "agrega" names no category without "llamado", "llamada" or a
   * colon after the noun.
   */
  it('does not read "agrega un grupo electrogeno" as a category worth making', () => {
    expect(say('agrega un grupo electrógeno')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'grupo electrogeno', direction: 'up',
    });
  });

  /**
   * The same on a verb with no fallback reading: "crear" is in nobody's verb
   * map, so this fell all the way to UNKNOWN before, and requiring the
   * connector leaves it exactly where it was.
   */
  it('does not read "crear un grupo de riesgo" as a category, and stays UNKNOWN', () => {
    expect(say('crear un grupo de riesgo').kind).toBe('UNKNOWN');
  });

  /** The separator is a real space or a colon, never the empty match. */
  it('leaves "agrupacion" whole', () => {
    expect(say('agrega una agrupación')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'agrupacion',
    });
  });

  /**
   * What the bare space after "nuevo" costs, pinned rather than left to be
   * discovered - and this is the shipped behaviour, not a bug to quietly
   * narrow away.
   *
   * "nuevo grupo electrogeno" and "nueva categoria despensa" are the same
   * shape in the same order, and no pattern here can accept the second without
   * accepting the first. Requiring the connector after "nuevo" too would
   * refuse the plainest way anyone names a category, and "nuevo" is in no verb
   * map, so there is no fallback reading to land on - the phrase would go
   * UNKNOWN rather than become an addition. What catches it instead is the
   * confirmation card, which is headed with the name below and asks before
   * anything is written.
   */
  it('reads "nuevo grupo electrogeno" as a category too, and pays for it on the card', () => {
    expect(say('nuevo grupo electrógeno')).toEqual({
      kind: 'CREATE_CATEGORY', name: 'electrogeno',
    });
  });

  /**
   * "nuevo contacto, ana" - a person, and the first sentence in this grammar
   * whose slots are more than a name. The comma is gone before any rule runs.
   */
  it('reads "nuevo contacto, ana" as a contact to create', () => {
    expect(say('nuevo contacto, ana')).toEqual({
      kind: 'CREATE_CONTACT', name: 'ana', relationship: null, phone: null,
    });
  });

  it('reads the other creating verbs, the connectors and the colon', () => {
    expect(say('crea un contacto llamado ana')).toEqual({
      kind: 'CREATE_CONTACT', name: 'ana', relationship: null, phone: null,
    });
    expect(say('anade un contacto nuevo llamado ana')).toEqual({
      kind: 'CREATE_CONTACT', name: 'ana', relationship: null, phone: null,
    });
    expect(say('agrega un contacto: ana')).toEqual({
      kind: 'CREATE_CONTACT', name: 'ana', relationship: null, phone: null,
    });
  });

  it('drops the article from "crea un contacto llamado el medico"', () => {
    expect(say('crea un contacto llamado el medico')).toEqual({
      kind: 'CREATE_CONTACT', name: 'medico', relationship: null, phone: null,
    });
  });

  /**
   * "mi" is the handle a Spanish speaker asks for the number by afterwards,
   * and `contacts.search` looks in every field, so "como llamo a mi hermana"
   * finds the row by exactly that word.
   */
  it('keeps the relationship "mi" introduces', () => {
    expect(say('nuevo contacto mi hermana ana')).toEqual({
      kind: 'CREATE_CONTACT', name: 'ana', relationship: 'hermana', phone: null,
    });
  });

  /**
   * A number said one digit at a time comes out as those digits, not as
   * arithmetic: "cinco cinco cinco" is 555 to anybody reading it back and 15
   * to anything that adds.
   */
  it('reads a spoken number as digits, however it was given', () => {
    expect(say('nuevo contacto ana telefono cinco cinco cinco uno dos tres cuatro')).toEqual({
      kind: 'CREATE_CONTACT', name: 'ana', relationship: null, phone: '5551234',
    });
    expect(say('agrega un contacto llamado ana numero de telefono 555 1234')).toEqual({
      kind: 'CREATE_CONTACT', name: 'ana', relationship: null, phone: '5551234',
    });
  });

  /**
   * And a number that was spoken and cannot be read as digits refuses the
   * whole sentence rather than storing the contact without it. "quinientos" is
   * a quantity; read digit by digit it would become 5100, a number nobody said
   * in the one field where a wrong value looks exactly like a right one.
   */
  it('refuses the whole sentence when a spoken number is not digits', () => {
    expect(say('nuevo contacto ana telefono quinientos').kind).toBe('UNKNOWN');
  });

  /**
   * LOS LENTES DE CONTACTO. A real thing to stock, and it stays one - twice
   * over, because "lentes" and not "contacto" is the word after the verb, so
   * the pattern never reaches its own noun.
   */
  it('does not read "agrega lentes de contacto" as a person', () => {
    expect(say('agrega lentes de contacto')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'lentes contacto', direction: 'up',
    });
  });

  /**
   * The catalog's own "Lista de Contactos de Emergencia", the first entry in
   * `data/catalog.generated.ts` to contain one of these rules' nouns at all.
   */
  it('leaves the Lista de Contactos de Emergencia a stock item', () => {
    expect(say('agrega la lista de contactos de emergencia')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'lista contactos emergencia',
    });
  });

  /**
   * "nuevo contacto de emergencia" is a documented cost, not a bug this test
   * guards against fixing - the same one "nueva zona de cultivo" and "nuevo
   * grupo electrogeno" pay above. Everything past the noun becomes the name,
   * because "nuevo" trusts a bare space and no pattern here can keep "nuevo
   * contacto ana" while refusing this. Nothing is written on it: the card
   * asks first, with the name and the number on it.
   */
  it('reads "nuevo contacto de emergencia" as a contact too, and pays for it on the card', () => {
    expect(say('nuevo contacto de emergencia')).toEqual({
      kind: 'CREATE_CONTACT', name: 'de emergencia', relationship: null, phone: null,
    });
  });

  /**
   * A RELATIONSHIP FOLLOWED STRAIGHT BY THE NUMBER - the sentence the first
   * shape of this rule got wrong. `en.ts`'s test says what went wrong and why
   * the pattern no longer carries an optional phone group; this file's own
   * comment is what makes the sentence first-class, since it names "mi medico"
   * as the handle a Spanish speaker reaches for.
   */
  it('reads a possessive followed straight by the number as the name', () => {
    expect(say('nuevo contacto mi medico telefono 5551234')).toEqual({
      kind: 'CREATE_CONTACT', name: 'mi medico', relationship: null, phone: '5551234',
    });
    expect(say('nuevo contacto mi hermana ana telefono 5551234')).toEqual({
      kind: 'CREATE_CONTACT', name: 'ana', relationship: 'hermana', phone: '5551234',
    });
  });

  it('refuses a number with no name in front of it, and a marker with nothing after it', () => {
    expect(say('nuevo contacto telefono 5551234').kind).toBe('UNKNOWN');
    expect(say('nuevo contacto ana telefono').kind).toBe('UNKNOWN');
  });

  /**
   * "numero de emergencia" is a label somebody really would keep in an
   * emergency contact list. The marker stands at the front with nothing that
   * reads as digits behind it, so it separated nothing and the whole phrase is
   * the name.
   */
  it('keeps a name that merely begins with the phone word', () => {
    expect(say('nuevo contacto numero de emergencia')).toEqual({
      kind: 'CREATE_CONTACT', name: 'numero de emergencia', relationship: null, phone: null,
    });
  });

  /**
   * And the separator after the noun is a real one, so the plural is not split
   * into a noun and a name - which is what keeps the catalog's own emergency
   * contact list a thing to stock.
   */
  it('leaves "contactos" whole', () => {
    expect(say('agrega contactos de emergencia')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'contactos emergencia',
    });
  });
});

describe('es phrases: moving and thresholds', () => {
  const moves: ReadonlyArray<readonly [string, string, string]> = [
    ['mueve el arroz al sotano', 'arroz', 'sotano'],
    ['mueve el arroz para el sotano', 'arroz', 'sotano'],
    ['mover el arroz a la cocina', 'arroz', 'cocina'],
    ['traslada los frijoles al garaje', 'frijoles', 'garaje'],
    ['transfiere el agua al sotano', 'agua', 'sotano'],
    ['pasa el arroz a la cocina', 'arroz', 'cocina'],
    ['lleva los frijoles a la cocina', 'frijoles', 'cocina'],
    ['guarde el arroz en la despensa', 'arroz', 'despensa'],
    ['pon el arroz en la despensa', 'arroz', 'despensa'],
    ['mete los frijoles en el sotano', 'frijoles', 'sotano'],
    ['coloca el arroz dentro de la nevera', 'arroz', 'nevera'],
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
   * "guardar" is both. With a shelf it moves the row that exists; without one
   * it is stock arriving. And a NUMBER in front of the item means the sentence
   * is about a quantity, not about a row changing shelf - an item holds one
   * location, so a partial move is not something this application can perform.
   */
  it('reads the same verb as an addition when no destination was named', () => {
    expect(say('guarde 5 latas de frijoles')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'frijoles', amount: 5, direction: 'up',
    });
  });

  it('reads a numbered phrase as an addition even with a shelf in it', () => {
    expect(say('pon 2 kilos de arroz en la despensa')).toMatchObject({
      kind: 'ADJUST_QUANTITY', amount: 2, direction: 'up',
    });
  });

  const minimums: ReadonlyArray<readonly [string, string, number]> = [
    ['el minimo de arroz es 5 kilos', 'arroz', 5],
    ['el minimo de arroz es de 5 kilos', 'arroz', 5],
    ['minimo de arroz es 5 kilos', 'arroz', 5],
    ['el stock minimo de arroz es 5 kilos', 'arroz', 5],
    ['el nivel minimo de agua es 20 litros', 'agua', 20],
    ['quiero tener al menos 5 kilos de arroz', 'arroz', 5],
    ['necesito mantener al menos 10 latas de frijoles', 'frijoles', 10],
    ['tener por lo menos 12 botellas de agua', 'agua', 12],
    ['al menos 10 latas de frijoles', 'frijoles', 10],
  ];
  for (const [phrase, item, amount] of minimums) {
    it(`"${phrase}" sets the minimum for ${item} to ${amount}`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_MINIMUM', item, amount });
    });
  }

  it('keeps the unit the minimum was spoken in', () => {
    expect(say('el minimo de arroz es 5 kilos')).toEqual({
      kind: 'SET_MINIMUM', item: 'arroz', amount: 5, unit: 'kilos',
    });
  });

  /** Zero is a minimum: it says "never warn me about this one again". */
  it('accepts a minimum of zero', () => {
    expect(say('el minimo de arroz es 0')).toMatchObject({
      kind: 'SET_MINIMUM', amount: 0,
    });
  });

  const targets: ReadonlyArray<readonly [string, string, number]> = [
    ['quiero tener 20 latas de frijoles', 'frijoles', 20],
    ['quiero tener 20 huevos', 'huevos', 20],
    ['quiero mantener 20 latas de frijoles', 'frijoles', 20],
    ['necesito tener 12 botellas de agua', 'agua', 12],
    ['la meta de frijoles es 20 latas', 'frijoles', 20],
    ['el objetivo de agua es 50 litros', 'agua', 50],
    ['el ideal de arroz es de 30 kilos', 'arroz', 30],
  ];
  for (const [phrase, item, amount] of targets) {
    it(`"${phrase}" sets the target for ${item} to ${amount}`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_TARGET', item, amount });
    });
  }

  /**
   * The two thresholds share an opener, and the order decides it.
   *
   * "quiero tener al menos 5 kilos de arroz" is a MINIMUM, and SET_MINIMUM
   * runs first precisely so that the target rule never sees it.
   */
  it('reads "al menos" as a minimum rather than a target', () => {
    expect(say('quiero tener al menos 5 kilos de arroz')).toMatchObject({
      kind: 'SET_MINIMUM', item: 'arroz', amount: 5,
    });
  });

  it('reads the same opener without "al menos" as a target', () => {
    expect(say('quiero tener 5 kilos de arroz')).toMatchObject({
      kind: 'SET_TARGET', item: 'arroz', amount: 5,
    });
  });
});

describe('es phrases: what must NOT parse', () => {
  const rejected = ['', '   ', 'arroz', 'frijoles negros', 'y', 'aaa bbb ccc',
    'gracias'];
  for (const phrase of rejected) {
    it(`"${phrase}" is UNKNOWN rather than a guess`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * A question with no item is a question the application cannot answer, and
   * the item is what is missing rather than something it failed to hear.
   */
  const itemless = ['cuanto hay', 'cuanto tengo', 'tengo cuanto'];
  for (const phrase of itemless) {
    it(`"${phrase}" names no item, so it is UNKNOWN`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * The other half of "a missing number means one".
   *
   * "compre arroz" is now read as +1 and flagged, but these two are not short
   * sentences - they are clipped ones, and what is missing from each is more
   * than the number.
   *
   *   "quita de arroz" opens with a partitive. "de" belonged to a measure the
   *   recognizer dropped - "quita [dos kilos] de arroz" - so the phrase is
   *   evidence that something was said and lost, not that nothing was said.
   *   "agrega latas de" has no item left once the unit and the filler come
   *   off, and an adjustment with no item is not an adjustment.
   */
  const clipped = ['quita de arroz', 'agrega latas de',
    // The same argument with a shelf instead of a measure: "guarde [el arroz]
    // en la despensa" lost its item, and adding one of a product called
    // "despensa" would invent a row named after the shelf it was going on.
    'guarde en la despensa', 'agrega en la despensa', 'pon en el sotano',
    // A number with nothing to count. Answering would send a bare number to
    // the item search.
    'quedan solo 2', 'solo hay 3'];
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
    'mueve el arroz', 'mueve al sotano', 'traslada', 'lleva a la cocina',
    'el minimo de arroz', 'el minimo de arroz es mucho', 'al menos de arroz',
    'quiero tener', 'quiero tener mucho arroz', 'la meta de frijoles',
    'categoria', 'muestra la categoria',
    'telefono', 'cual es el telefono', 'contacto de',
    'cuando compre', 'historial de', 'la ultima compra de',
    'cuantos items de', 'que hay en',
  ];
  for (const phrase of halfSaid) {
    it(`"${phrase}" says half a command, so it stays UNKNOWN`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * "menos" is deliberately not tolerated where "mas" is. "pon menos 2 huevos"
   * has no settled meaning - two fewer than what? - and the verb says add, so
   * any reading is a guess at a write.
   *
   * The assumed one cannot rescue it either, and must not: a numeral WAS
   * spoken here. Reading this as one egg would not fill a gap, it would
   * overrule the two the user said.
   */
  it('"pon menos 2 huevos" is UNKNOWN, because only "mas" is a filler', () => {
    expect(say('pon menos 2 huevos').kind).toBe('UNKNOWN');
  });

  /** An impossible date is refused rather than repaired. */
  it('"el arroz vence el 31 de abril" is UNKNOWN, because that date never happens', () => {
    expect(say('el arroz vence el 31 de abril').kind).toBe('UNKNOWN');
  });
});

describe('es phrases: as a recognizer returns them', () => {
  it('survives missing accents', () => {
    expect(say('cuanto azucar tengo')).toEqual({ kind: 'QUERY_QUANTITY', item: 'azucar' });
  });

  it('survives full accents', () => {
    expect(say('Cuánto azúcar tengo')).toEqual({ kind: 'QUERY_QUANTITY', item: 'azucar' });
  });

  /**
   * The opener is the row that matters most in this file. `foldText` strips
   * combining marks and U+00BF is not one, so without the punctuation strip in
   * `parse.ts` every rule anchored at `^` would silently never match and the
   * whole language would answer UNKNOWN to correctly spoken Spanish.
   */
  it('survives the inverted question mark', () => {
    expect(say('¿Cuánto azúcar tengo?')).toEqual({ kind: 'QUERY_QUANTITY', item: 'azucar' });
  });

  it('survives an inverted opener on a write', () => {
    expect(say('¿Cuántas latas de frijoles tengo?')).toEqual({
      kind: 'QUERY_QUANTITY', item: 'frijoles',
    });
  });

  it('survives collapsed whitespace', () => {
    expect(say('  cuanto   arroz  ')).toEqual({ kind: 'QUERY_QUANTITY', item: 'arroz' });
  });
});
