import { describe, expect, it } from 'vitest';
import { translate, type TranslateFn } from '../../i18n/translate';
import type { DateFormat, Language } from '../../domain/settings';
import type { ReplenishmentLine } from '../../domain/replenishment';
import type { Contact, InventoryItemView } from '../../types/domain';
import type { DashboardStats } from '../../repositories/items.repository';
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

function contact(over: Partial<Contact> & { name: string }): Contact {
  return {
    id: over.name,
    relationship: null,
    phone: null,
    email: null,
    location: null,
    notes: null,
    priority: 3,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    ...over,
  };
}

function stats(over: Partial<DashboardStats> = {}): DashboardStats {
  return {
    totalItems: 0,
    totalQuantity: 0,
    categoriesUsed: 0,
    locationsUsed: 0,
    expired: 0,
    expiringToday: 0,
    expiringSoon: 0,
    noExpiration: 0,
    critical: 0,
    low: 0,
    archived: 0,
    recentlyModified: 0,
    ...over,
  };
}

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
  it('names a category and what it holds', () => {
    expect(renderAnswer(pt, {
      kind: 'CATEGORY', categoryName: 'Alimentos', items: named(2), total: 2,
    }, ptOptions)).toBe('Alimentos tem 2 itens: Item 1, Item 2.');
  });

  it('says a category is empty rather than reading an empty list', () => {
    expect(renderAnswer(pt, {
      kind: 'CATEGORY', categoryName: 'Alimentos', items: [], total: 0,
    }, ptOptions)).toBe('Não há nada em Alimentos.');
  });

  /**
   * A category can hold more than the page that was read.
   *
   * The rows stop at the list limit and the total does not, so the remainder
   * is counted from the TOTAL - "and 77 more", not the "and 47 more" a count
   * of the rows would produce.
   */
  it('counts the remainder from the total rather than from the page', () => {
    expect(renderAnswer(en, {
      kind: 'CATEGORY', categoryName: 'Food', items: named(50), total: 80,
    }, enOptions)).toBe('Food holds 80 items: Item 1, Item 2, Item 3 and 77 more.');
  });

  it('gives a contact its name, its number and its relationship', () => {
    expect(renderAnswer(pt, {
      kind: 'CONTACT',
      query: 'medico',
      contacts: [contact({ name: 'Dra. Silva', phone: '11 5555-0000', relationship: 'Médico' })],
    }, ptOptions)).toBe('Dra. Silva, Médico: 11 5555-0000.');
  });

  it('leaves out a relationship a contact does not have', () => {
    expect(renderAnswer(pt, {
      kind: 'CONTACT',
      query: 'ana',
      contacts: [contact({ name: 'Ana', phone: '11 5555-0001' })],
    }, ptOptions)).toBe('Ana: 11 5555-0001.');
  });

  /** A contact with no number is still an answer, and a truer one than a gap. */
  it('says so when the contact has no phone number', () => {
    expect(renderAnswer(pt, {
      kind: 'CONTACT', query: 'ana', contacts: [contact({ name: 'Ana' })],
    }, ptOptions)).toBe('Ana está nos seus contatos, sem telefone.');
  });

  it('reads the first match and counts the others', () => {
    const sentence = renderAnswer(pt, {
      kind: 'CONTACT',
      query: 'silva',
      contacts: [
        contact({ name: 'Dra. Silva', phone: '11 5555-0000' }),
        contact({ name: 'João Silva', phone: '11 5555-0002' }),
        contact({ name: 'Ana Silva', phone: '11 5555-0003' }),
      ],
    }, ptOptions);
    expect(sentence).toContain('Dra. Silva');
    expect(sentence).toContain('2');
    expect(sentence).not.toContain('João Silva');
  });

  it('says no contact matched, naming what was asked for', () => {
    expect(renderAnswer(pt, {
      kind: 'CONTACT', query: 'dentista', contacts: [],
    }, ptOptions)).toBe('Não encontrei nenhum contato para "dentista".');
  });

  it('reads a history as a type, a number and a day', () => {
    const sentence = renderAnswer(pt, {
      kind: 'HISTORY',
      item: view({ name: 'Arroz', unit: 'kg' }),
      entries: [
        { type: 'purchase', quantity: 5, on: '2026-09-05' },
        { type: 'consume', quantity: 2, on: '2026-09-01' },
      ],
    }, ptOptions);
    expect(sentence).toBe(
      'Últimas 2 movimentações de Arroz: Comprado 5 kg em 05/09/2026; Usado 2 kg em 01/09/2026.',
    );
  });

  it('says an item has never moved rather than reading an empty list', () => {
    expect(renderAnswer(pt, {
      kind: 'HISTORY', item: view({ name: 'Arroz' }), entries: [],
    }, ptOptions)).toBe('Arroz não tem movimentações registradas.');
  });

  it('counts the whole inventory, with its categories and its places', () => {
    expect(renderAnswer(pt, {
      kind: 'TOTAL', stats: stats({ totalItems: 12, categoriesUsed: 4, locationsUsed: 3 }),
    }, ptOptions)).toBe('Você tem 12 itens, em 4 categorias e 3 locais.');
  });

  it('gives every number in the count its own plural', () => {
    expect(renderAnswer(en, {
      kind: 'TOTAL', stats: stats({ totalItems: 1, categoriesUsed: 1, locationsUsed: 1 }),
    }, enOptions)).toBe('You have 1 item, across 1 category and 1 location.');
  });

  it('says an empty inventory is empty rather than counting nothing', () => {
    expect(renderAnswer(pt, { kind: 'TOTAL', stats: stats() }, ptOptions))
      .toBe('Seu estoque está vazio.');
  });

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
      { kind: 'CATEGORY', categoryName: 'Alimentos', items: [], total: 0 },
      { kind: 'CATEGORY', categoryName: 'Alimentos', items: named(1), total: 1 },
      { kind: 'CATEGORY', categoryName: 'Alimentos', items: named(4), total: 9 },
      { kind: 'CONTACT', query: 'medico', contacts: [] },
      { kind: 'CONTACT', query: 'medico', contacts: [contact({ name: 'Ana' })] },
      {
        kind: 'CONTACT',
        query: 'medico',
        contacts: [
          contact({ name: 'Ana', phone: '1', relationship: 'Médico' }),
          contact({ name: 'João', phone: '2' }),
        ],
      },
      { kind: 'HISTORY', item: view({ name: 'Arroz' }), entries: [] },
      {
        kind: 'HISTORY',
        item: view({ name: 'Arroz' }),
        entries: [{ type: 'transfer', quantity: 1, on: '2026-09-05' }],
      },
      {
        kind: 'HISTORY',
        item: view({ name: 'Arroz' }),
        entries: [
          { type: 'correction', quantity: 1, on: '2026-09-05' },
          { type: 'remove', quantity: 2, on: '2026-09-04' },
        ],
      },
      { kind: 'TOTAL', stats: stats() },
      { kind: 'TOTAL', stats: stats({ totalItems: 1, categoriesUsed: 1, locationsUsed: 1 }) },
      { kind: 'TOTAL', stats: stats({ totalItems: 9, categoriesUsed: 3, locationsUsed: 2 }) },
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
