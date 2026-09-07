import { describe, expect, it } from 'vitest';
import { translate, type TranslateFn } from '../../i18n/translate';
import type { Language } from '../../domain/settings';
import type { ReplenishmentLine } from '../../domain/replenishment';
import type { InventoryItemView } from '../../types/domain';
import type { Answer } from './execute';
import { renderAnswer } from './answer';

const withLanguage = (language: Language): TranslateFn =>
  (key, values) => translate(language, key, values);

const pt = withLanguage('pt-BR');
const en = withLanguage('en');

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
    });
    expect(sentence).toBe('Arroz Branco: 10 kg, em Despensa.');
  });

  it('leaves out a location an item does not have', () => {
    const sentence = renderAnswer(pt, {
      kind: 'QUANTITY',
      item: view({ name: 'Leite', quantity: 2, unit: 'l' }),
    });
    expect(sentence).toBe('Leite: 2 l.');
  });

  it('answers an empty expiring result with a sentence, not an empty list', () => {
    const sentence = renderAnswer(pt, {
      kind: 'EXPIRING', items: [], withinDays: 30, expiredOnly: false,
    });
    expect(sentence).toBe('Nada vence nos próximos 30 dias.');
    expect(sentence).not.toContain('undefined');
  });

  it('says nothing has expired when the question was about the past', () => {
    const sentence = renderAnswer(pt, {
      kind: 'EXPIRING', items: [], withinDays: 30, expiredOnly: true,
    });
    expect(sentence).toBe('Nada venceu.');
  });

  it('names three and counts the rest', () => {
    const sentence = renderAnswer(pt, {
      kind: 'EXPIRING', items: named(7), withinDays: 30, expiredOnly: false,
    });
    expect(sentence).toBe('7 itens vencem em 30 dias: Item 1, Item 2, Item 3 e mais 4.');
    expect(sentence).not.toContain('Item 4');
  });

  it('names all three when there are exactly three, with nothing left to count', () => {
    const sentence = renderAnswer(pt, {
      kind: 'EXPIRING', items: named(3), withinDays: 7, expiredOnly: false,
    });
    expect(sentence).toBe('3 itens vencem em 7 dias: Item 1, Item 2, Item 3.');
    expect(sentence).not.toContain('mais');
  });

  it('says "1 item" and not "1 itens"', () => {
    const sentence = renderAnswer(pt, {
      kind: 'WHERE_LOCATION', locationName: 'Despensa', items: [view({ name: 'Arroz' })],
    });
    expect(sentence).toBe('Despensa tem 1 item: Arroz.');
  });

  it('says "2 itens" for the plural of the same sentence', () => {
    const sentence = renderAnswer(pt, {
      kind: 'WHERE_LOCATION', locationName: 'Despensa', items: named(2),
    });
    expect(sentence).toBe('Despensa tem 2 itens: Item 1, Item 2.');
  });

  it('picks the English singular from the same answer', () => {
    const sentence = renderAnswer(en, {
      kind: 'WHERE_LOCATION', locationName: 'Pantry', items: [view({ name: 'Rice' })],
    });
    expect(sentence).toBe('Pantry holds 1 item: Rice.');
  });

  it('says an empty shelf is empty', () => {
    expect(renderAnswer(pt, { kind: 'WHERE_LOCATION', locationName: 'Garagem', items: [] }))
      .toBe('Não há nada em Garagem.');
  });

  it('reports nothing missing rather than an empty list', () => {
    expect(renderAnswer(pt, { kind: 'MISSING', lines: [] })).toBe('Não falta nada.');
  });

  it('counts what is missing and names the first three', () => {
    const lines = ['Arroz', 'Feijão', 'Leite', 'Sal', 'Óleo'].map(line);
    expect(renderAnswer(pt, { kind: 'MISSING', lines }))
      .toBe('5 itens estão abaixo do mínimo: Arroz, Feijão, Leite e mais 2.');
  });

  it('places an item, or says it has no place', () => {
    expect(renderAnswer(pt, {
      kind: 'WHERE_ITEM', item: view({ name: 'Arroz', locationName: 'Despensa' }),
    })).toBe('Arroz está em Despensa.');

    expect(renderAnswer(pt, { kind: 'WHERE_ITEM', item: view({ name: 'Arroz' }) }))
      .toBe('Arroz não tem local definido.');
  });

  it('gives an expiry date, or says there is none', () => {
    expect(renderAnswer(pt, {
      kind: 'EXPIRY_OF', item: view({ name: 'Leite', expirationDate: '2026-09-12' }),
    })).toBe('Leite vence em 2026-09-12.');

    expect(renderAnswer(pt, { kind: 'EXPIRY_OF', item: view({ name: 'Sal' }) }))
      .toBe('Sal não tem data de validade.');
  });

  it('reads a score, including zero', () => {
    expect(renderAnswer(pt, { kind: 'SCORE', score: 67 }))
      .toBe('Sua pontuação de preparação é 67.');
    expect(renderAnswer(pt, { kind: 'SCORE', score: 0 }))
      .toBe('Sua pontuação de preparação é 0.');
  });

  it('offers help as a title alone when the caller supplied no examples', () => {
    expect(renderAnswer(pt, { kind: 'HELP', examples: [] })).toBe('Tente um destes');
  });

  it('lists the examples the caller filled in from the grammar', () => {
    expect(renderAnswer(pt, { kind: 'HELP', examples: ['quanto arroz eu tenho', 'o que vence'] }))
      .toBe('Tente um destes: quanto arroz eu tenho; o que vence');
  });

  /*
   * A placeholder this module forgets to pass survives into the sentence as
   * `{days}` and is then read aloud. Sweeping every branch in every language is
   * cheaper than remembering to check each one by hand.
   */
  it('leaves no placeholder unfilled and no undefined in any language', () => {
    const answers: Answer[] = [
      { kind: 'QUANTITY', item: view({ name: 'Arroz', locationName: 'Despensa' }) },
      { kind: 'QUANTITY', item: view({ name: 'Arroz' }) },
      { kind: 'EXPIRING', items: [], withinDays: 30, expiredOnly: false },
      { kind: 'EXPIRING', items: [], withinDays: 30, expiredOnly: true },
      { kind: 'EXPIRING', items: named(4), withinDays: 30, expiredOnly: false },
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
      for (const answer of answers) {
        const sentence = renderAnswer(t, answer);
        expect(sentence.length).toBeGreaterThan(0);
        expect(sentence, `${language} / ${answer.kind}`).not.toContain('undefined');
        expect(sentence, `${language} / ${answer.kind}`).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
