import { describe, expect, it } from 'vitest';
import { buildReplenishmentList } from './replenishment';
import type { ReplenishmentInput } from './replenishment';

const TODAY = '2026-08-14';

const item = (overrides: Partial<ReplenishmentInput['items'][number]> = {}) => ({
  id: 'i1',
  name: 'Rice',
  unit: 'kg',
  categoryId: 'food',
  quantity: 4,
  minimumQuantity: 10,
  idealQuantity: 30,
  expirationDate: null,
  priority: 3,
  ...overrides,
});

const run = (input: Partial<ReplenishmentInput>) =>
  buildReplenishmentList({
    items: [],
    today: TODAY,
    defaultThreshold: 5,
    expiryWindows: [7, 30, 90],
    dismissedItemIds: [],
    ...input,
  });

describe('replenishment list', () => {
  describe('what appears on it', () => {
    it('includes an item short of its target', () => {
      const lines = run({ items: [item()] });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ itemId: 'i1', name: 'Rice', needed: 26, unit: 'kg' });
    });

    it('omits an item that has reached its target', () => {
      expect(run({ items: [item({ quantity: 30 })] })).toEqual([]);
    });

    it('omits an item in surplus', () => {
      expect(run({ items: [item({ quantity: 100 })] })).toEqual([]);
    });

    it('includes expired stock even when the quantity looks sufficient', () => {
      // Expired stock is not stock. The count says 30 kg; none of it is usable.
      const lines = run({
        items: [item({ quantity: 30, expirationDate: '2026-01-01' })],
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ reason: 'expired', needed: 30 });
    });

    it('asks for the full target when stock has expired', () => {
      const lines = run({
        items: [item({ quantity: 12, idealQuantity: 30, expirationDate: '2026-01-01' })],
      });
      expect(lines[0]?.needed).toBe(30);
    });

    it('omits a dismissed item', () => {
      expect(run({ items: [item()], dismissedItemIds: ['i1'] })).toEqual([]);
    });

    it('uses the minimum as the target when no ideal quantity is set', () => {
      const lines = run({ items: [item({ idealQuantity: null })] });
      expect(lines[0]).toMatchObject({ needed: 6, target: 10 });
    });

    it('falls back to the global threshold for items with no minimum', () => {
      const lines = run({ items: [item({ minimumQuantity: null, idealQuantity: null, quantity: 2 })] });
      expect(lines[0]).toMatchObject({ needed: 3, minimum: 5 });
    });
  });

  describe('ordering', () => {
    it('puts expired stock first', () => {
      const lines = run({
        items: [
          item({ id: 'low', quantity: 4 }),
          item({ id: 'gone', quantity: 30, expirationDate: '2026-01-01' }),
        ],
      });
      expect(lines.map((l) => l.itemId)).toEqual(['gone', 'low']);
    });

    it('then orders critical before low', () => {
      const lines = run({
        items: [
          item({ id: 'low', quantity: 9, minimumQuantity: 10 }),
          item({ id: 'critical', quantity: 1, minimumQuantity: 10 }),
        ],
      });
      expect(lines.map((l) => l.itemId)).toEqual(['critical', 'low']);
    });

    it('then orders by item priority', () => {
      const lines = run({
        items: [
          item({ id: 'normal', priority: 3, quantity: 1 }),
          item({ id: 'urgent', priority: 1, quantity: 1 }),
        ],
      });
      expect(lines.map((l) => l.itemId)).toEqual(['urgent', 'normal']);
    });

    it('breaks remaining ties by name so the order is stable', () => {
      const lines = run({
        items: [
          item({ id: 'b', name: 'Beans', quantity: 1 }),
          item({ id: 'a', name: 'Almonds', quantity: 1 }),
        ],
      });
      expect(lines.map((l) => l.name)).toEqual(['Almonds', 'Beans']);
    });
  });

  describe('partial purchases', () => {
    it('reduces what is still needed', () => {
      const lines = run({ items: [item()], purchased: { i1: 6 } });
      expect(lines[0]?.needed).toBe(20);
    });

    it('drops the line once enough has been bought', () => {
      expect(run({ items: [item()], purchased: { i1: 26 } })).toEqual([]);
    });

    it('does not go negative when more was bought than needed', () => {
      expect(run({ items: [item()], purchased: { i1: 999 } })).toEqual([]);
    });

    it('records how much was already bought so the interface can show progress', () => {
      const lines = run({ items: [item()], purchased: { i1: 6 } });
      expect(lines[0]).toMatchObject({ purchased: 6, originalNeeded: 26 });
    });
  });

  describe('totals', () => {
    it('avoids floating-point dust in the quantities it reports', () => {
      const lines = run({
        items: [item({ quantity: 0.1, minimumQuantity: 0.3, idealQuantity: null })],
      });
      expect(lines[0]?.needed).toBe(0.2);
    });
  });
});
