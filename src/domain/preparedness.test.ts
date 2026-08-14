import { describe, expect, it } from 'vitest';
import { PREPAREDNESS_PRIORITY_WEIGHTS, evaluatePreparedness } from './preparedness';
import type { PreparednessInput } from './preparedness';

const TODAY = '2026-08-14';

const item = (overrides: Partial<PreparednessInput['items'][number]> = {}) => ({
  id: 'i1',
  name: 'Rice',
  categoryId: 'food',
  quantity: 10,
  minimumQuantity: 10,
  idealQuantity: null,
  expirationDate: null,
  priority: 3,
  ...overrides,
});

const run = (input: Partial<PreparednessInput>) =>
  evaluatePreparedness({
    items: [],
    today: TODAY,
    defaultThreshold: 5,
    trackedCategoryIds: [],
    expiryWindows: [7, 30, 90],
    ...input,
  });

describe('preparedness scoring', () => {
  describe('the score itself', () => {
    it('is 100 when every tracked item meets its minimum', () => {
      const report = run({ items: [item(), item({ id: 'i2', categoryId: 'water' })] });
      expect(report.score).toBe(100);
    });

    it('is 0 when nothing is stocked', () => {
      const report = run({ items: [item({ quantity: 0 })] });
      expect(report.score).toBe(0);
    });

    it('is proportional to coverage', () => {
      // 4 of a 10 minimum is 40% covered.
      const report = run({ items: [item({ quantity: 4 })] });
      expect(report.score).toBe(40);
    });

    it('does not let a surplus in one item mask a shortfall in another', () => {
      const report = run({
        items: [
          item({ id: 'a', quantity: 1000, minimumQuantity: 10 }),
          item({ id: 'b', quantity: 0, minimumQuantity: 10 }),
        ],
      });
      // Coverage is capped at 1, so this is (1 + 0) / 2, not (100 + 0) / 2.
      expect(report.score).toBe(50);
    });

    it('scores an expired item as zero however much of it there is', () => {
      const report = run({
        items: [item({ quantity: 1000, minimumQuantity: 10, expirationDate: '2020-01-01' })],
      });
      expect(report.score).toBe(0);
    });

    it('is 0 with no items at all rather than a misleading 100', () => {
      const report = run({ items: [] });
      expect(report.score).toBe(0);
      expect(report.categories).toEqual([]);
    });
  });

  describe('weighting', () => {
    it('weights each category equally regardless of how many items it holds', () => {
      // Having 500 tins of food must not offset having no water. Equal weight
      // per category is what makes the number mean "prepared across domains".
      const report = run({
        items: [
          item({ id: 'f1', categoryId: 'food', quantity: 10, minimumQuantity: 10 }),
          item({ id: 'f2', categoryId: 'food', quantity: 10, minimumQuantity: 10 }),
          item({ id: 'f3', categoryId: 'food', quantity: 10, minimumQuantity: 10 }),
          item({ id: 'w1', categoryId: 'water', quantity: 0, minimumQuantity: 10 }),
        ],
      });
      expect(report.score).toBe(50);
    });

    it('weights critical items above low-priority ones within a category', () => {
      const report = run({
        items: [
          item({ id: 'a', priority: 1, quantity: 0, minimumQuantity: 10 }),
          item({ id: 'b', priority: 4, quantity: 10, minimumQuantity: 10 }),
        ],
      });
      // weights 4 and 1: (4*0 + 1*1) / 5 = 0.2
      expect(report.score).toBe(20);
    });

    it('exposes the weights it used', () => {
      expect(PREPAREDNESS_PRIORITY_WEIGHTS).toEqual({ 1: 4, 2: 3, 3: 2, 4: 1 });
    });
  });

  describe('which categories count', () => {
    it('counts only categories that hold items, by default', () => {
      const report = run({ items: [item({ categoryId: 'food' })] });
      expect(report.categories.map((c) => c.categoryId)).toEqual(['food']);
      expect(report.score).toBe(100);
    });

    it('counts an explicitly tracked but empty category as zero', () => {
      // Opting a category in is a statement of intent: "I mean to stock this".
      // Silently excluding it would report 100% for a household with no water.
      const report = run({
        items: [item({ categoryId: 'food' })],
        trackedCategoryIds: ['food', 'water'],
      });
      expect(report.score).toBe(50);
      expect(report.categories.find((c) => c.categoryId === 'water')).toMatchObject({
        score: 0,
        itemCount: 0,
      });
    });

    it('ignores items outside the tracked set', () => {
      const report = run({
        items: [
          item({ id: 'a', categoryId: 'food', quantity: 10 }),
          item({ id: 'b', categoryId: 'tools', quantity: 0 }),
        ],
        trackedCategoryIds: ['food'],
      });
      expect(report.score).toBe(100);
    });

    it('reports the weakest category first', () => {
      const report = run({
        items: [
          item({ id: 'a', categoryId: 'food', quantity: 10, minimumQuantity: 10 }),
          item({ id: 'b', categoryId: 'water', quantity: 2, minimumQuantity: 10 }),
          item({ id: 'c', categoryId: 'medical', quantity: 5, minimumQuantity: 10 }),
        ],
      });
      expect(report.categories.map((c) => c.categoryId)).toEqual(['water', 'medical', 'food']);
    });
  });

  describe('transparency', () => {
    it('reports how the number was reached', () => {
      const report = run({ items: [item({ quantity: 4 })] });
      expect(report.method).toEqual({
        formula: 'mean-of-category-scores',
        itemScore: 'min(quantity / minimum, 1), or 0 if expired',
        categoryScore: 'priority-weighted mean of item scores',
        overall: 'unweighted mean of category scores',
        priorityWeights: PREPAREDNESS_PRIORITY_WEIGHTS,
      });
    });

    it('itemizes every shortfall rather than only reporting a number', () => {
      const report = run({
        items: [
          item({ id: 'low', name: 'Rice', quantity: 4, minimumQuantity: 10 }),
          item({ id: 'ok', name: 'Beans', quantity: 10, minimumQuantity: 10 }),
          item({ id: 'gone', name: 'Water', quantity: 0, minimumQuantity: 20, categoryId: 'water' }),
        ],
      });

      expect(report.deficits.map((d) => d.itemId)).toEqual(['gone', 'low']);
      expect(report.deficits[0]).toMatchObject({
        itemId: 'gone',
        name: 'Water',
        reason: 'below-minimum',
        needed: 20,
      });
    });

    it('lists expired stock as its own kind of deficit', () => {
      const report = run({
        items: [item({ id: 'x', quantity: 50, minimumQuantity: 10, expirationDate: '2020-01-01' })],
      });
      expect(report.deficits[0]).toMatchObject({ itemId: 'x', reason: 'expired' });
    });

    it('lists an empty tracked category as uncovered', () => {
      const report = run({ items: [item()], trackedCategoryIds: ['food', 'water'] });
      expect(report.deficits.some((d) => d.reason === 'category-empty' && d.categoryId === 'water')).toBe(true);
    });

    it('counts what it summarised', () => {
      const report = run({
        items: [
          item({ id: 'a', quantity: 4, minimumQuantity: 10 }),
          item({ id: 'b', quantity: 10, minimumQuantity: 10 }),
          item({ id: 'c', quantity: 10, minimumQuantity: 10, expirationDate: '2020-01-01' }),
        ],
      });
      expect(report.totals).toEqual({
        itemsCounted: 3,
        belowMinimum: 1,
        expired: 1,
        categoriesCounted: 1,
        categoriesEmpty: 0,
      });
    });
  });

  describe('items with no minimum', () => {
    it('falls back to the global threshold, as the rest of the app does', () => {
      const report = run({ items: [item({ minimumQuantity: null, quantity: 5 })], defaultThreshold: 10 });
      expect(report.score).toBe(50);
    });

    it('treats a zero threshold as fully covered', () => {
      const report = run({
        items: [item({ minimumQuantity: null, quantity: 0 })],
        defaultThreshold: 0,
      });
      expect(report.score).toBe(100);
    });
  });

  describe('archived and excluded stock', () => {
    it('rounds the score to a whole percent', () => {
      const report = run({
        items: [
          item({ id: 'a', quantity: 1, minimumQuantity: 3 }),
          item({ id: 'b', quantity: 1, minimumQuantity: 3, categoryId: 'water' }),
        ],
      });
      expect(Number.isInteger(report.score)).toBe(true);
      expect(report.score).toBe(33);
    });
  });
});
