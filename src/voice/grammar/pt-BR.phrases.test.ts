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
    'tem acucar', 'tenho agua', 'quanta agua eu tenho', 'ainda tem cafe',
    // The clipped register, which is most of what a phone actually receives:
    // no article, "ta" for "esta", and the leftover verbs standing alone.
    'sobrou arroz', 'sobrou cafe', 'ainda tenho feijao', 'ainda tem acucar',
    'resta cafe', 'restam ovos', 'temos arroz', 'quanto de arroz ainda tem',
    'quantos ovos ainda tem', 'me diz quanto arroz tem', 'me fala quanto cafe tem',
    'mostra quanto arroz tem'];
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
    'quais itens estao vencendo',
    'o que ta vencendo', 'o que ta pra vencer', 'o que ta para vencer',
    'tem alguma coisa vencendo', 'tem algo vencendo', 'algo vencendo',
    'quais coisas estao vencendo', 'quais produtos vao vencer',
    'o que anda vencendo', 'o que esta estragando'];
  for (const phrase of expiring) {
    it(`"${phrase}" asks what is expiring`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: false });
    });
  }

  const expired = ['o que ja venceu', 'o que venceu', 'o que esta vencido',
    'o que ja expirou', 'o que estragou', 'o que passou da validade'];
  for (const phrase of expired) {
    it(`"${phrase}" asks only for what is already past`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', expiredOnly: true });
    });
  }

  /**
   * A period is a window too.
   *
   * "essa semana" and "esse mes" are the ordinary way to ask, and the number
   * behind each is this application's own - seven and thirty, the figures the
   * expiry screen already uses. Saying it out loud in a row here is what keeps
   * that choice honest: nobody said seven.
   */
  const windows: ReadonlyArray<readonly [string, number]> = [
    ['o que vence hoje', 0],
    ['o que vence amanha', 1],
    ['o que vence essa semana', 7],
    ['o que vence esta semana', 7],
    ['o que vence esse mes', 30],
    ['o que vence nos proximos 15 dias', 15],
    ['o que vence daqui a 10 dias', 10],
  ];
  for (const [phrase, withinDays] of windows) {
    it(`"${phrase}" asks about ${withinDays} days`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'QUERY_EXPIRING', withinDays });
    });
  }

  it('reads a window out of the question', () => {
    expect(say('o que vence nos proximos 30 dias')).toMatchObject({
      kind: 'QUERY_EXPIRING', withinDays: 30,
    });
  });

  const missing = ['o que falta', 'o que esta faltando', 'o que eu preciso comprar',
    'lista de compras', 'o que esta acabando',
    'o que ta faltando', 'ta faltando o que', 'faltando o que',
    'o que preciso repor', 'o que preciso comprar', 'o que tenho que comprar',
    'preciso comprar o que', 'o que acabou', 'o que ta acabando',
    'o que ta no fim', 'o que esta em falta', 'lista do mercado',
    'o que comprar', 'o que repor', 'o que falta comprar'];
  for (const phrase of missing) {
    it(`"${phrase}" asks what is missing`, () => {
      expect(say(phrase).kind).toBe('QUERY_MISSING');
    });
  }

  const whereItem: ReadonlyArray<readonly [string, string]> = [
    ['onde esta o arroz', 'arroz'],
    ['onde ta o arroz', 'arroz'],
    ['onde fica o arroz', 'arroz'],
    ['onde estao as pilhas', 'pilhas'],
    ['onde eu guardei o arroz', 'arroz'],
    ['onde coloquei o arroz', 'arroz'],
    ['onde eu deixei o arroz', 'arroz'],
    ['em que lugar ta o arroz', 'arroz'],
  ];
  for (const [phrase, item] of whereItem) {
    it(`"${phrase}" asks where ${item} is`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_WHERE', item, location: null });
    });
  }

  const whereLocation: ReadonlyArray<readonly [string, string]> = [
    ['o que tem na despensa', 'despensa'],
    ['o que ta na despensa', 'despensa'],
    ['o que tem no porao', 'porao'],
    ['o que tem dentro da geladeira', 'geladeira'],
    ['o que eu guardo no porao', 'porao'],
    ['me mostra o que tem na despensa', 'despensa'],
    ['o que tem guardado na garagem', 'garagem'],
  ];
  for (const [phrase, location] of whereLocation) {
    it(`"${phrase}" asks what is in the ${location}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_WHERE', item: null, location });
    });
  }

  const expiryOf = ['quando vence o leite', 'quando o leite vence',
    'quando expira o leite', 'quando que vence o leite',
    'qual a validade do leite', 'qual e a validade do leite',
    'quando o leite vai vencer', 'quando estraga o leite'];
  for (const phrase of expiryOf) {
    it(`"${phrase}" asks when milk expires`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_EXPIRY_OF', item: 'leite' });
    });
  }

  const score = ['como esta minha preparacao', 'como ta minha preparacao',
    'qual e a minha pontuacao', 'quao preparado eu estou', 'estou preparado',
    'to preparado', 'minha pontuacao', 'como estou de preparacao'];
  for (const phrase of score) {
    it(`"${phrase}" asks for the preparedness score`, () => {
      expect(say(phrase).kind).toBe('QUERY_SCORE');
    });
  }

  const help = ['ajuda', 'me ajuda', 'socorro', 'o que voce entende',
    'o que vc sabe', 'o que eu posso dizer', 'quais comandos', 'como funciona'];
  for (const phrase of help) {
    it(`"${phrase}" asks for help`, () => {
      expect(say(phrase).kind).toBe('HELP');
    });
  }
});

describe('pt-BR phrases: the whole stock, the address book and the past', () => {
  const total = ['quantos itens eu tenho', 'quantos itens tem', 'quantos itens',
    'quantas coisas eu tenho', 'quantos produtos eu tenho',
    'quantos itens no estoque', 'quantos itens ao todo',
    'qual o total de itens', 'total de itens', 'tamanho do estoque'];
  for (const phrase of total) {
    it(`"${phrase}" counts the whole inventory`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_TOTAL' });
    });
  }

  /**
   * The counting question and the whole-stock question are one word apart.
   *
   * "quantos itens de arroz eu tenho" is about rice, and it has to survive
   * QUERY_TOTAL to reach the rule that can answer it - the `$` on that rule is
   * what lets it through.
   */
  it('still asks about one item when the sentence names one', () => {
    expect(say('quantos itens de arroz eu tenho')).toEqual({
      kind: 'QUERY_QUANTITY', item: 'arroz',
    });
  });

  const contact: ReadonlyArray<readonly [string, string]> = [
    ['qual o telefone do medico', 'medico'],
    ['qual e o telefone do medico', 'medico'],
    ['qual o numero do medico', 'medico'],
    ['telefone do medico', 'medico'],
    ['numero da ana', 'ana'],
    ['celular do vizinho', 'vizinho'],
    ['contato do vizinho', 'vizinho'],
    ['me passa o telefone do medico', 'medico'],
    ['como eu falo com a ana', 'ana'],
  ];
  for (const [phrase, query] of contact) {
    it(`"${phrase}" looks up ${query} in the contacts`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_CONTACT', query });
    });
  }

  /**
   * The article comes off the front and nothing else does.
   *
   * `contacts.search` asks whether a stored field CONTAINS the phrase, so "o
   * medico" matches nothing and "medico" matches the doctor - while a name
   * with a preposition inside it has to survive whole.
   */
  it('keeps the inside of a name and drops only the article', () => {
    expect(say('telefone de ana de souza')).toEqual({
      kind: 'QUERY_CONTACT', query: 'ana de souza',
    });
  });

  const history: ReadonlyArray<readonly [string, string]> = [
    ['quando comprei arroz', 'arroz'],
    ['quando eu comprei arroz', 'arroz'],
    ['quando foi que eu comprei arroz', 'arroz'],
    ['quando usei o feijao', 'feijao'],
    ['quando abri o leite', 'leite'],
    ['historico do arroz', 'arroz'],
    ['o historico do arroz', 'arroz'],
    ['movimentacoes do arroz', 'arroz'],
    ['a ultima compra de arroz', 'arroz'],
    ['ultima vez que comprei arroz', 'arroz'],
  ];
  for (const [phrase, item] of history) {
    it(`"${phrase}" asks for the history of ${item}`, () => {
      expect(say(phrase)).toEqual({ kind: 'QUERY_HISTORY', item });
    });
  }

  /**
   * "quando comprei" and "quando vence" open identically, and only one of them
   * is about a date in the future. The expiry question is tried first and
   * declines everything that is not about a date, which is what keeps these
   * two apart.
   */
  it('does not read a history question as an expiry question', () => {
    expect(say('quando comprei o leite')).toEqual({ kind: 'QUERY_HISTORY', item: 'leite' });
    expect(say('quando vence o leite')).toEqual({ kind: 'QUERY_EXPIRY_OF', item: 'leite' });
  });

  const category: ReadonlyArray<readonly [string, string]> = [
    ['o que tem na categoria alimentos', 'alimentos'],
    ['o que tem em categoria alimentos', 'alimentos'],
    ['quais itens na categoria agua', 'agua'],
    ['mostra a categoria alimentos', 'alimentos'],
    ['me mostra a categoria alimentos', 'alimentos'],
    ['lista a categoria alimentos', 'alimentos'],
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
   * "o que tem em alimentos" names something that could be a shelf or could be
   * a category, and the words cannot say which - so the grammar does not try.
   * It produces the LOCATION question, and `execute` looks for a place first
   * and falls back to the category when there is none. A place wins because it
   * is the more concrete of the two: locations are things the user made and
   * named, categories are twenty fixed labels that ship with the application.
   *
   * The unambiguous form above says "categoria" out loud and skips the race
   * entirely.
   */
  it('leaves the ambiguous form as a place, for execute to resolve', () => {
    expect(say('o que tem em alimentos')).toEqual({
      kind: 'QUERY_WHERE', item: null, location: 'alimentos',
    });
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

  /**
   * Stock arrives in more ways than it is "adicionado".
   *
   * Each of these is a sentence somebody says out loud in a kitchen, and each
   * one used to be a transcript on the screen and nothing else.
   */
  const arriving: ReadonlyArray<readonly [string, string, number]> = [
    ['chegou mais 3 latas de arroz', 'arroz', 3],
    ['chegaram 3 latas de arroz', 'arroz', 3],
    ['coloca 2 quilos de arroz', 'arroz', 2],
    ['coloquei 2 quilos de arroz', 'arroz', 2],
    ['guardei 5 latas de feijao', 'feijao', 5],
    ['botei 4 pacotes de arroz', 'arroz', 4],
    ['recebi 4 caixas de leite', 'leite', 4],
    ['ganhei 2 pacotes de arroz', 'arroz', 2],
    ['trouxe 3 garrafas de agua', 'agua', 3],
    ['entrou 6 latas de feijao', 'feijao', 6],
    ['reabasteci 10 kg de arroz', 'arroz', 10],
  ];
  for (const [phrase, item, amount] of arriving) {
    it(`"${phrase}" adds ${amount} of ${item}`, () => {
      expect(say(phrase)).toMatchObject({
        kind: 'ADJUST_QUANTITY', item, amount, direction: 'up',
      });
    });
  }

  const leaving: ReadonlyArray<readonly [string, string, number]> = [
    ['peguei 2 latas de feijao', 'feijao', 2],
    ['joguei fora 2 ovos', 'ovos', 2],
    ['perdi 3 ovos', 'ovos', 3],
    ['bebi 2 litros de agua', 'agua', 2],
    ['comemos 6 ovos', 'ovos', 6],
    ['abri uma lata de feijao', 'feijao', 1],
    ['diminui 2 kg de arroz', 'arroz', 2],
  ];
  for (const [phrase, item, amount] of leaving) {
    it(`"${phrase}" removes ${amount} of ${item}`, () => {
      expect(say(phrase)).toMatchObject({
        kind: 'ADJUST_QUANTITY', item, amount, direction: 'down',
      });
    });
  }

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
   * "acabou o arroz" is a number, not a removal.
   *
   * Read as an adjustment it would take one bag off a shelf that is already
   * empty - wrong, and useless. The speaker is stating what is there now,
   * which is nothing, so it sets the quantity to zero the way "agora tenho 12"
   * sets it to twelve.
   */
  const emptied = ['acabou o arroz', 'acabaram os ovos', 'terminou o arroz',
    'nao tem mais arroz', 'zerou o arroz', 'acabei com o arroz',
    'gastei tudo o arroz', 'usei todo o arroz', 'comi todos os ovos'];
  for (const phrase of emptied) {
    it(`"${phrase}" sets the quantity to zero`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_QUANTITY', amount: 0 });
    });
  }

  it('names the item that ran out', () => {
    expect(say('acabou o arroz')).toEqual({
      kind: 'SET_QUANTITY', item: 'arroz', amount: 0, unit: null,
    });
  });

  /**
   * "sobrou so 2 ovos" says what is left, which is a correction rather than a
   * removal: two is the count now, not the count that went.
   */
  const leftovers: ReadonlyArray<readonly [string, string, number]> = [
    ['sobrou so 2 ovos', 'ovos', 2],
    ['sobraram 2 ovos', 'ovos', 2],
    ['restaram 3 latas de feijao', 'feijao', 3],
    ['ficou so 1 pacote de arroz', 'arroz', 1],
    ['so tem 2 ovos', 'ovos', 2],
    ['so restam 4 latas de feijao', 'feijao', 4],
  ];
  for (const [phrase, item, amount] of leftovers) {
    it(`"${phrase}" corrects ${item} to ${amount}`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_QUANTITY', item, amount });
    });
  }

  /**
   * The same opener with no number is a QUESTION, and it has to stay one.
   *
   * The rule above declines a phrase it cannot find a number in, which is what
   * lets "sobrou arroz" fall through to the quantity question it really is.
   */
  it('leaves the same opener as a question when no number was spoken', () => {
    expect(say('sobrou arroz')).toEqual({ kind: 'QUERY_QUANTITY', item: 'arroz' });
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

describe('pt-BR phrases: moving and thresholds', () => {
  const moves: ReadonlyArray<readonly [string, string, string]> = [
    ['move o arroz para o porao', 'arroz', 'porao'],
    ['mova o feijao pra despensa', 'feijao', 'despensa'],
    ['mover o arroz para a garagem', 'arroz', 'garagem'],
    ['transfere o feijao para o porao', 'feijao', 'porao'],
    ['passa o arroz para a cozinha', 'arroz', 'cozinha'],
    ['leva o arroz para a garagem', 'arroz', 'garagem'],
    ['muda o arroz para o armario', 'arroz', 'armario'],
    ['guardei o arroz na despensa', 'arroz', 'despensa'],
    ['coloca o feijao no porao', 'feijao', 'porao'],
    ['poe o arroz na despensa', 'arroz', 'despensa'],
    ['move o arroz para dentro da geladeira', 'arroz', 'geladeira'],
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
   * "guardei" is both. With a shelf it moves the row that exists; without one
   * it is stock arriving. And a NUMBER in front of the item means the sentence
   * is about a quantity, not about a row changing shelf - an item holds one
   * location, so a partial move is not something this application can perform.
   */
  it('reads the same verb as an addition when no destination was named', () => {
    expect(say('guardei 5 latas de feijao')).toMatchObject({
      kind: 'ADJUST_QUANTITY', item: 'feijao', amount: 5, direction: 'up',
    });
  });

  it('reads a numbered phrase as an addition even with a shelf in it', () => {
    expect(say('coloca 2 quilos de arroz na despensa')).toMatchObject({
      kind: 'ADJUST_QUANTITY', amount: 2, direction: 'up',
    });
  });

  const minimums: ReadonlyArray<readonly [string, string, number]> = [
    ['o minimo de arroz e 5 quilos', 'arroz', 5],
    ['o minimo de arroz e de 5 quilos', 'arroz', 5],
    ['minimo de arroz e 5 quilos', 'arroz', 5],
    ['o estoque minimo de arroz e 5 quilos', 'arroz', 5],
    ['o nivel minimo de agua e 20 litros', 'agua', 20],
    ['o minimo de feijao deve ser 10 latas', 'feijao', 10],
    ['quero ter no minimo 5 quilos de arroz', 'arroz', 5],
    ['preciso ter no minimo 10 latas de feijao', 'feijao', 10],
    ['no minimo 10 latas de feijao', 'feijao', 10],
    ['pelo minimo 3 pacotes de arroz', 'arroz', 3],
  ];
  for (const [phrase, item, amount] of minimums) {
    it(`"${phrase}" sets the minimum for ${item} to ${amount}`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_MINIMUM', item, amount });
    });
  }

  it('keeps the unit the minimum was spoken in', () => {
    expect(say('o minimo de arroz e 5 quilos')).toEqual({
      kind: 'SET_MINIMUM', item: 'arroz', amount: 5, unit: 'quilos',
    });
  });

  /** Zero is a minimum: it says "never warn me about this one again". */
  it('accepts a minimum of zero', () => {
    expect(say('o minimo de arroz e 0')).toMatchObject({ kind: 'SET_MINIMUM', amount: 0 });
  });

  const targets: ReadonlyArray<readonly [string, string, number]> = [
    ['quero ter 20 latas de feijao', 'feijao', 20],
    ['quero ter 20 ovos', 'ovos', 20],
    ['quero manter 20 latas de feijao', 'feijao', 20],
    ['preciso ter 12 garrafas de agua', 'agua', 12],
    ['a meta de feijao e 20 latas', 'feijao', 20],
    ['o ideal de feijao e 20 latas', 'feijao', 20],
    ['o objetivo de agua e 50 litros', 'agua', 50],
    ['o alvo de arroz e de 30 quilos', 'arroz', 30],
  ];
  for (const [phrase, item, amount] of targets) {
    it(`"${phrase}" sets the target for ${item} to ${amount}`, () => {
      expect(say(phrase)).toMatchObject({ kind: 'SET_TARGET', item, amount });
    });
  }

  /**
   * The two thresholds share an opener, and the order decides it.
   *
   * "quero ter no minimo 5 quilos de arroz" is a MINIMUM, and SET_MINIMUM runs
   * first precisely so that the target rule never sees it.
   */
  it('reads "quero ter no minimo" as a minimum rather than a target', () => {
    expect(say('quero ter no minimo 5 quilos de arroz')).toMatchObject({
      kind: 'SET_MINIMUM', item: 'arroz', amount: 5,
    });
  });

  it('reads the same opener without "minimo" as a target', () => {
    expect(say('quero ter 5 quilos de arroz')).toMatchObject({
      kind: 'SET_TARGET', item: 'arroz', amount: 5,
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
  const clipped = ['tira de arroz', 'adiciona latas de',
    // The same argument with a shelf instead of a measure: "guardei [o arroz]
    // na despensa" lost its item, and adding one of a product called
    // "despensa" would invent a row named after the shelf it was going on.
    'guardei na despensa', 'adiciona na despensa', 'coloca no porao',
    // A number with nothing to count. "sobrou so 2" and "chegou mais 3 latas"
    // are both sentences with the noun clipped off, and answering either would
    // send a bare number to the item search.
    'sobrou so 2', 'chegou mais 3 latas', 'usei tudo', 'acabou'];
  for (const phrase of clipped) {
    it(`"${phrase}" is a fragment, so it stays UNKNOWN`, () => {
      expect(say(phrase).kind).toBe('UNKNOWN');
    });
  }

  /**
   * The new rules refuse as much as they accept.
   *
   * Every one of these is the opening of a sentence the grammar understands,
   * with the part that carries the meaning missing. A move with no
   * destination is not a move; a threshold with no number is not a threshold;
   * a category or a contact with nothing named is not a question anyone can
   * answer.
   */
  const halfSaid = [
    'move o arroz', 'move para o porao', 'mova', 'leva para a cozinha',
    'o minimo de arroz', 'o minimo de arroz e muito', 'no minimo de arroz',
    'quero ter', 'quero ter muito arroz', 'a meta de feijao',
    'categoria',
    'telefone', 'qual o telefone', 'contato de',
    'quando comprei', 'historico de', 'a ultima compra de',
    'o que tem na', 'onde esta',
  ];
  for (const phrase of halfSaid) {
    it(`"${phrase}" says half a command, so it stays UNKNOWN`, () => {
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
