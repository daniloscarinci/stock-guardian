/**
 * Report construction.
 *
 * The assertion that matters most is the last group: a report must show the same
 * numbers as the screen the user was just looking at. These tests feed the
 * builders the output of the same `domain/` functions the dashboard uses, and
 * check the report agrees.
 */
import { describe, expect, it } from 'vitest';
import {
  buildExpirationReport,
  buildInventoryReport,
  buildPreparednessReport,
  buildReplenishmentReport,
  reportFilename,
  reportToCsvRows,
} from './reports';
import { evaluatePreparedness } from '../domain/preparedness';
import { buildReplenishmentList } from '../domain/replenishment';
import { toCsv } from './download';
import type { InventoryItemView } from '../types/domain';

const TODAY = '2026-08-14';

const context = {
  // A translator that returns the key, so assertions do not depend on copy.
  t: (key: string) => key,
  dateFormat: 'DD/MM/YYYY' as const,
  today: TODAY,
  categoryName: (id: string | null) => id ?? 'none',
};

const item = (overrides: Partial<InventoryItemView> = {}): InventoryItemView => ({
  id: 'i1',
  name: 'Arroz',
  categoryId: 'food',
  locationId: null,
  quantity: 4,
  unit: 'kg',
  minimumQuantity: 10,
  idealQuantity: 30,
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
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  stockStatus: 'critical',
  expiryBucket: 'none',
  daysUntilExpiry: null,
  needed: 26,
  effectiveMinimum: 10,
  categoryName: 'Food',
  locationName: null,
  ...overrides,
});

describe('reports', () => {
  describe('inventory', () => {
    it('lists every item with its status', () => {
      const report = buildInventoryReport([item(), item({ id: 'i2', name: 'Feijão' })], context);
      expect(report.sections[0]?.rows).toHaveLength(2);
      expect(report.sections[0]?.rows[0]?.[0]).toBe('Arroz');
    });

    it('totals the quantity', () => {
      const report = buildInventoryReport(
        [item({ quantity: 4 }), item({ id: 'i2', quantity: 6.5 })],
        context,
      );
      expect(report.summary.find((s) => s.label === 'dashboard.totalQuantity')?.value).toBe('10.5');
    });

    it('avoids floating-point dust in the total', () => {
      const report = buildInventoryReport(
        [item({ quantity: 0.1 }), item({ id: 'i2', quantity: 0.2 })],
        context,
      );
      expect(report.summary.find((s) => s.label === 'dashboard.totalQuantity')?.value).toBe('0.3');
    });

    it('reports empty when there is nothing', () => {
      expect(buildInventoryReport([], context).empty).toBe(true);
    });

    it('formats dates in the chosen format', () => {
      const report = buildInventoryReport([item({ expirationDate: '2026-12-25' })], context);
      expect(report.sections[0]?.rows[0]).toContain('25/12/2026');
    });
  });

  describe('expiration', () => {
    const items = [
      item({ id: 'a', name: 'Expired', expiryBucket: 'expired', daysUntilExpiry: -5, expirationDate: '2026-08-09' }),
      item({ id: 'b', name: 'Today', expiryBucket: 'today', daysUntilExpiry: 0, expirationDate: TODAY }),
      item({ id: 'c', name: 'Soon', expiryBucket: 'soon', daysUntilExpiry: 6, expirationDate: '2026-08-20' }),
      item({ id: 'd', name: 'Valid', expiryBucket: 'valid', daysUntilExpiry: 300, expirationDate: '2027-06-10' }),
      item({ id: 'e', name: 'Forever', expiryBucket: 'none' }),
    ];

    it('groups by urgency, worst first', () => {
      const report = buildExpirationReport(items, context);
      expect(report.sections.map((s) => s.title)).toEqual([
        'expiry.expired (1)',
        'expiry.today (1)',
        'expiry.soon (1)',
      ]);
    });

    it('omits items that need no action', () => {
      // In-date and non-expiring items are not deficiencies; listing them here
      // would bury the three that matter.
      const report = buildExpirationReport(items, context);
      const names = report.sections.flatMap((s) => s.rows.map((r) => r[0]));
      expect(names).toEqual(['Expired', 'Today', 'Soon']);
    });

    it('still counts them in the summary', () => {
      const report = buildExpirationReport(items, context);
      expect(report.summary.find((s) => s.label === 'expiry.none')?.value).toBe('1');
    });

    it('is empty when nothing needs attention', () => {
      const report = buildExpirationReport([item({ expiryBucket: 'valid' })], context);
      expect(report.empty).toBe(true);
    });
  });

  describe('replenishment', () => {
    it('carries the quantity to buy', () => {
      const lines = buildReplenishmentList({
        items: [
          {
            id: 'i1',
            name: 'Arroz',
            unit: 'kg',
            categoryId: 'food',
            quantity: 4,
            minimumQuantity: 10,
            idealQuantity: 30,
            expirationDate: null,
            priority: 3,
          },
        ],
        today: TODAY,
        defaultThreshold: 5,
        expiryWindows: [7, 30, 90],
      });

      const report = buildReplenishmentReport(lines, context);
      const row = report.sections[0]?.rows[0];
      expect(row?.[0]).toBe('Arroz');
      expect(row).toContain(26); // needed
    });

    it('is empty when nothing needs restocking', () => {
      expect(buildReplenishmentReport([], context).empty).toBe(true);
    });
  });

  describe('preparedness', () => {
    const evaluated = evaluatePreparedness({
      items: [
        {
          id: 'i1',
          name: 'Arroz',
          categoryId: 'food',
          quantity: 4,
          minimumQuantity: 10,
          idealQuantity: null,
          expirationDate: null,
          priority: 3,
        },
        {
          id: 'i2',
          name: 'Água',
          categoryId: 'water',
          quantity: 20,
          minimumQuantity: 20,
          idealQuantity: null,
          expirationDate: null,
          priority: 1,
        },
      ],
      today: TODAY,
      defaultThreshold: 5,
      trackedCategoryIds: [],
      expiryWindows: [7, 30, 90],
    });

    it('reports the same score the domain computed', () => {
      const report = buildPreparednessReport(evaluated, context);
      expect(report.summary[0]?.value).toBe(`${String(evaluated.score)}%`);
    });

    it('has a coverage row per category', () => {
      const report = buildPreparednessReport(evaluated, context);
      expect(report.sections[0]?.rows).toHaveLength(evaluated.categories.length);
    });

    it('lists every deficiency the domain found', () => {
      const report = buildPreparednessReport(evaluated, context);
      const deficiencies = report.sections[1];
      expect(deficiencies?.rows).toHaveLength(evaluated.deficits.length);
      expect(deficiencies?.rows[0]?.[0]).toBe('Arroz');
    });

    it('omits the deficiency section when there is nothing missing', () => {
      const perfect = evaluatePreparedness({
        items: [
          {
            id: 'i1',
            name: 'Arroz',
            categoryId: 'food',
            quantity: 20,
            minimumQuantity: 10,
            idealQuantity: null,
            expirationDate: null,
            priority: 3,
          },
        ],
        today: TODAY,
        defaultThreshold: 5,
        trackedCategoryIds: [],
        expiryWindows: [7, 30, 90],
      });
      expect(buildPreparednessReport(perfect, context).sections).toHaveLength(1);
    });
  });

  describe('CSV', () => {
    it('flattens a single-section report to headers and rows', () => {
      const report = buildInventoryReport([item()], context);
      const { headers, rows } = reportToCsvRows(report);
      expect(headers[0]).toBe('common.name');
      expect(rows).toHaveLength(1);
    });

    it('repeats headers for each further section, since they differ', () => {
      const report = buildExpirationReport(
        [
          item({ id: 'a', expiryBucket: 'expired', daysUntilExpiry: -1, expirationDate: '2026-08-13' }),
          item({ id: 'b', expiryBucket: 'soon', daysUntilExpiry: 3, expirationDate: '2026-08-17' }),
        ],
        context,
      );
      const { rows } = reportToCsvRows(report);
      // Section title, row, blank, title, headers, row.
      expect(rows.length).toBeGreaterThan(report.sections.length);
      expect(rows.some((row) => row[0] === 'expiry.soon (1)')).toBe(true);
    });

    it('produces CSV that escapes and guards its fields', () => {
      const report = buildInventoryReport(
        [item({ name: '=CMD("x"), "quoted"' })],
        context,
      );
      const { headers, rows } = reportToCsvRows(report);
      const csv = toCsv(headers, rows);

      // Leading = is neutralised so a spreadsheet cannot treat it as a formula,
      // and the embedded quotes and comma are escaped.
      expect(csv).toContain(`"'=CMD(""x""), ""quoted"""`);
    });

    it('names the file after the report and the date', () => {
      const report = buildInventoryReport([item()], context);
      expect(reportFilename(report)).toBe('stock-guardian-inventory-2026-08-14.csv');
    });
  });

  describe('agreement with the rest of the application', () => {
    it('does not recompute what the domain already decided', () => {
      // The report must carry the domain's status verbatim. If it derived its
      // own, the two could disagree and there would be no way to tell which was
      // right.
      const report = buildInventoryReport(
        [item({ stockStatus: 'surplus', quantity: 999 })],
        context,
      );
      expect(report.sections[0]?.rows[0]).toContain('stock.surplus');
    });
  });
});
