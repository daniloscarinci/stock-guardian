import { describe, expect, it } from 'vitest';
import { translate, type TranslateFn } from '../../i18n/translate';
import type { DateFormat, Language } from '../../domain/settings';
import type { ReplenishmentLine } from '../../domain/replenishment';
import type { InventoryItemView } from '../../types/domain';
import type { Answer } from './execute';
import { renderAnswer, type AnswerOptions } from './answer';

const withLanguage = (language: Language): TranslateFn =>
  (key, values) => translate(language, key, values);

const pt = withLanguage('pt-BR');
const en = withLanguage('en');

const options = (language: Language, dateFormat: DateFormat = 'DD/MM/YYYY'): AnswerOptions => ({
  language,
  dateFormat,
});

const ptOptions = options('pt-BR');
const enOptions = options('en');

function view(over: Partial<InventoryItemView> & { name: string }): InventoryItemView {
  return {
    id: over.name,
    categoryId: null,
    locationId: null,
    quantity: 1,
    unit: 'un',
    minimumQuantity: null,
    idealQuantity: null,
    expirationDate: null,
    purchaseDate: null,
    openedDate: null,
    condition: null,
    priority: 3,
    notes: null,
    barcode: null,
    photoId: null,
    catalogItemId: null,
    archivedAt: null,
    migrationNotes: null,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    stockStatus: 'adequate',
    expiryBucket: 'none',
    daysUntilExpiry: null,
    needed: 0,
    effectiveMinimum: 0,
    categoryName: null,
    locationName: null,
    ...over,
  };
}

function line(name: string): ReplenishmentLine {
  return {
    itemId: name,
    name,
    unit: 'kg',
    categoryId: null,
    reason: 'below-target',
    status: 'low',
    priority: 3,
    current: 1,
    minimum: 5,
    target: 5,
    needed: 4,
    originalNeeded: 4,
    purchased: 0,
    expirationDate: null,
  };
}

const named = (count: number): InventoryItemView[] =>
  Array.from({ length: count }, (_, index) => view({ name: `Item ${index + 1}` }));

describe('renderAnswer', () => {
  it('states the name, the number and the unit', () => {
    const sentence = renderAnswer(pt, {
      kind: 'QUANTITY',
      item: view({ name: 'Arroz Branco', quantity: 10, unit: 'kg', locationName: 'Despensa' }),
    }, ptOptions);
    expect(sentence).toBe('Arroz Branco: 10 kg, em Despensa.');
  });

  it('leaves out a location an item does not have', () => {
    const sentence = renderAnswer(pt, {
      kind: 'QUANTITY',
      item: view({ name: 'Leite', quantity: 2, unit: 'l' }),
    }, ptOptions);
    expect(sentence).toBe('Leite: 2 l.');
  });

  /*
   * `adjustQuantity` rounds to six decimal places, so a third of a kilo is
   * stored as 0.333333 and read aloud as thirteen syllables of "three".
   */
  it('speaks a quantity in the local notation, not the stored one', () => {
    expect(renderAnswer(pt, {
      kind: 'QUANTITY',
      item: view({ name: 'Arroz', quantity: 0.333333, unit: 'kg' }),
    }, ptOptions)).toBe('Arroz: 0,333 kg.');

    expect(renderAnswer(en, {
      kind: 'QUANTITY',
      item: view({ name: 'Rice', quantity: 0.333333, unit: 'kg' }),
    }, enOptions)).toBe('Rice: 0.333 kg.');
  });

  it('answers an empty expiring result with a sentence, not an empty list', () => {
    const sentence = renderAnswer(pt, {
      kind: 'EXPIRING', items: [], withinDays: 30, expiredOnly: false,
    }, ptOptions);
    expect(sentence).toBe('Nada vence nos próximos 30 dias.');
    expect(sentence).not.toContain('undefined');
  });

  it('says nothing has expired when the question was about the past', () => {
    const sentence = renderAnswer(pt, {
      kind: 'EXPIRING', items: [], withinDays: 30, expiredOnly: true,
    }, ptOptions);
    expect(sentence).toBe('Nada venceu.');
  });

  it('names three and counts the rest', () => {
    const sentence = renderAnswer(pt, {
      kind: 'EXPIRING', items: named(7), withinDays: 30, expiredOnly: false,
    }, ptOptions);
    expect(sentence).toBe('7 itens vencem em 30 dias: Item 1, Item 2, Item 3 e mais 4.');
    expect(sentence).not.toContain('Item 4');
  });

  it('names all three when there are exactly three, with nothing left to count', () => {
    const sentence = renderAnswer(pt, {
      kind: 'EXPIRING', items: named(3), withinDays: 7, expiredOnly: false,
    }, ptOptions);
    expect(sentence).toBe('3 itens vencem em 7 dias: Item 1, Item 2, Item 3.');
    expect(sentence).not.toContain('mais');
  });

  /*
   * The defect this replaces: `expiredOnly` had no sentence of its own, so a
   * question about the past fell through to the future one and answered
   * "3 itens vencem em 30 dias" about food that is already bad.
   */
  it('puts an expired result in the past tense, with no window', () => {
    const one = renderAnswer(pt, {
      kind: 'EXPIRING', items: [view({ name: 'Leite' })], withinDays: 30, expiredOnly: true,
    }, ptOptions);
    expect(one).toBe('1 item venceu: Leite.');

    const three = renderAnswer(pt, {
      kind: 'EXPIRING', items: named(3), withinDays: 30, expiredOnly: true,
    }, ptOptions);
    expect(three).toBe('3 itens venceram: Item 1, Item 2, Item 3.');

    for (const sentence of [one, three]) {
      expect(sentence).not.toContain('30 dias');
      expect(sentence).not.toContain('vencem');
      expect(sentence).not.toContain('vence em');
    }
  });

  it('says the same in English and in Spanish', () => {
    expect(renderAnswer(en, {
      kind: 'EXPIRING', items: named(3), withinDays: 30, expiredOnly: true,
    }, enOptions)).toBe('3 items have expired: Item 1, Item 2, Item 3.');

    expect(renderAnswer(withLanguage('es'), {
      kind: 'EXPIRING', items: [view({ name: 'Leche' })], withinDays: 30, expiredOnly: true,
    }, options('es'))).toBe('1 ítem ha vencido: Leche.');
  });

  /*
   * `withinDays` is whatever number was spoken - "o que vence em um dia" - so a
   * window of one is ordinary, and "vence em 1 dias" is not a sentence.
   */
  it('agrees the window with its own number, not with the item count', () => {
    expect(renderAnswer(pt, {
      kind: 'EXPIRING', items: named(3), withinDays: 1, expiredOnly: false,
    }, ptOptions)).toBe('3 itens vencem em 1 dia: Item 1, Item 2, Item 3.');

    expect(renderAnswer(en, {
      kind: 'EXPIRING', items: [view({ name: 'Milk' })], withinDays: 1, expiredOnly: false,
    }, enOptions)).toBe('1 item expires within 1 day: Milk.');

    expect(renderAnswer(pt, {
      kind: 'EXPIRING', items: [], withinDays: 1, expiredOnly: false,
    }, ptOptions)).toBe('Nada vence no próximo dia.');
  });

  it('says "1 item" and not "1 itens"', () => {
    const sentence = renderAnswer(pt, {
      kind: 'WHERE_LOCATION', locationName: 'Despensa', items: [view({ name: 'Arroz' })],
    }, ptOptions);
    expect(sentence).toBe('Despensa tem 1 item: Arroz.');
  });

  it('says "2 itens" for the plural of the same sentence', () => {
    const sentence = renderAnswer(pt, {
      kind: 'WHERE_LOCATION', locationName: 'Despensa', items: named(2),
    }, ptOptions);
    expect(sentence).toBe('Despensa tem 2 itens: Item 1, Item 2.');
  });

  it('picks the English singular from the same answer', () => {
    const sentence = renderAnswer(en, {
      kind: 'WHERE_LOCATION', locationName: 'Pantry', items: [view({ name: 'Rice' })],
    }, enOptions);
    expect(sentence).toBe('Pantry holds 1 item: Rice.');
  });

  it('says an empty shelf is empty', () => {
    expect(renderAnswer(pt, {
      kind: 'WHERE_LOCATION', locationName: 'Garagem', items: [],
    }, ptOptions)).toBe('Não há nada em Garagem.');
  });

  it('reports nothing missing rather than an empty list', () => {
    expect(renderAnswer(pt, { kind: 'MISSING', lines: [] }, ptOptions)).toBe('Não falta nada.');
  });

  it('counts what is missing and names the first three', () => {
    const lines = ['Arroz', 'Feijão', 'Leite', 'Sal', 'Óleo'].map(line);
    expect(renderAnswer(pt, { kind: 'MISSING', lines }, ptOptions))
      .toBe('5 itens estão abaixo do mínimo: Arroz, Feijão, Leite e mais 2.');
  });

  it('places an item, or says it has no place', () => {
    expect(renderAnswer(pt, {
      kind: 'WHERE_ITEM', item: view({ name: 'Arroz', locationName: 'Despensa' }),
    }, ptOptions)).toBe('Arroz está em Despensa.');

    expect(renderAnswer(pt, { kind: 'WHERE_ITEM', item: view({ name: 'Arroz' }) }, ptOptions))
      .toBe('Arroz não tem local definido.');
  });

  it('gives an expiry date, or says there is none', () => {
    expect(renderAnswer(pt, {
      kind: 'EXPIRY_OF', item: view({ name: 'Leite', expirationDate: '2026-09-12' }),
    }, ptOptions)).toBe('Leite vence em 12/09/2026.');

    expect(renderAnswer(pt, { kind: 'EXPIRY_OF', item: view({ name: 'Sal' }) }, ptOptions))
      .toBe('Sal não tem data de validade.');
  });

  /*
   * The stored form is `2026-09-12`, which read aloud is a serial number. The
   * spoken date follows the same setting every screen follows.
   */
  it('reads a date in the format the user chose', () => {
    const milk: Answer = {
      kind: 'EXPIRY_OF', item: view({ name: 'Leite', expirationDate: '2026-09-12' }),
    };
    expect(renderAnswer(pt, milk, options('pt-BR', 'MM/DD/YYYY')))
      .toBe('Leite vence em 09/12/2026.');
    expect(renderAnswer(pt, milk, options('pt-BR', 'YYYY-MM-DD')))
      .toBe('Leite vence em 2026-09-12.');
  });

  it('treats a date it cannot parse as no date at all', () => {
    expect(renderAnswer(pt, {
      kind: 'EXPIRY_OF', item: view({ name: 'Leite', expirationDate: '2026-02-30' }),
    }, ptOptions)).toBe('Leite não tem data de validade.');
  });

  it('reads a score, including zero', () => {
    expect(renderAnswer(pt, { kind: 'SCORE', score: 67 }, ptOptions))
      .toBe('Sua pontuação de preparação é 67.');
    expect(renderAnswer(pt, { kind: 'SCORE', score: 0 }, ptOptions))
      .toBe('Sua pontuação de preparação é 0.');
  });

  it('offers help as a title alone when the caller supplied no examples', () => {
    expect(renderAnswer(pt, { kind: 'HELP', examples: [] }, ptOptions)).toBe('Tente um destes');
  });

  it('lists the examples the caller filled in from the grammar', () => {
    expect(renderAnswer(pt, {
      kind: 'HELP', examples: ['quanto arroz eu tenho', 'o que vence'],
    }, ptOptions)).toBe('Tente um destes: quanto arroz eu tenho; o que vence');
  });

  /*
   * A placeholder this module forgets to pass survives into the sentence as
   * `{days}` and is then read aloud. Sweeping every branch in every language is
   * cheaper than remembering to check each one by hand. The sweep also refuses a
   * raw `YYYY-MM-DD`, which is what let one through last time.
   */
  it('leaves no placeholder unfilled, no undefined and no raw date in any language', () => {
    const answers: Answer[] = [
      { kind: 'QUANTITY', item: view({ name: 'Arroz', locationName: 'Despensa' }) },
      { kind: 'QUANTITY', item: view({ name: 'Arroz' }) },
      { kind: 'QUANTITY', item: view({ name: 'Arroz', quantity: 0.333333 }) },
      { kind: 'EXPIRING', items: [], withinDays: 30, expiredOnly: false },
      { kind: 'EXPIRING', items: [], withinDays: 1, expiredOnly: false },
      { kind: 'EXPIRING', items: [], withinDays: 30, expiredOnly: true },
      { kind: 'EXPIRING', items: named(4), withinDays: 30, expiredOnly: false },
      { kind: 'EXPIRING', items: named(1), withinDays: 1, expiredOnly: false },
      { kind: 'EXPIRING', items: named(4), withinDays: 30, expiredOnly: true },
      { kind: 'EXPIRING', items: named(1), withinDays: 30, expiredOnly: true },
      { kind: 'MISSING', lines: [] },
      { kind: 'MISSING', lines: [line('Arroz')] },
      { kind: 'WHERE_ITEM', item: view({ name: 'Arroz', locationName: 'Despensa' }) },
      { kind: 'WHERE_ITEM', item: view({ name: 'Arroz' }) },
      { kind: 'WHERE_LOCATION', locationName: 'Despensa', items: [] },
      { kind: 'WHERE_LOCATION', locationName: 'Despensa', items: named(4) },
      { kind: 'EXPIRY_OF', item: view({ name: 'Leite', expirationDate: '2026-09-12' }) },
      { kind: 'EXPIRY_OF', item: view({ name: 'Sal' }) },
      { kind: 'SCORE', score: 42 },
      { kind: 'HELP', examples: [] },
    ];

    for (const language of ['en', 'pt-BR', 'es'] as const) {
      const t = withLanguage(language);
      for (const dateFormat of ['DD/MM/YYYY', 'MM/DD/YYYY'] as const) {
        for (const answer of answers) {
          const where = `${language} / ${dateFormat} / ${answer.kind}`;
          const sentence = renderAnswer(t, answer, options(language, dateFormat));
          expect(sentence.length).toBeGreaterThan(0);
          expect(sentence, where).not.toContain('undefined');
          expect(sentence, where).not.toMatch(/\{\w+\}/);
          expect(sentence, where).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        }
      }
    }
  });
});
