import { describe, expect, it } from 'vitest';
import { evaluateStock } from './stock';

const DEFAULT_THRESHOLD = 5;
const evaluate = (
  input: { quantity: number; minimumQuantity?: number | null; idealQuantity?: number | null },
  threshold = DEFAULT_THRESHOLD,
) =>
  evaluateStock(
    {
      quantity: input.quantity,
      minimumQuantity: input.minimumQuantity ?? null,
      idealQuantity: input.idealQuantity ?? null,
    },
    threshold,
  );

describe('stock evaluation', () => {
  describe('the specification worked example', () => {
    it('reports rice at 4 kg against a 10 kg minimum and 30 kg target as critical, needing 26', () => {
      const result = evaluate({ quantity: 4, minimumQuantity: 10, idealQuantity: 30 });
      expect(result.status).toBe('critical');
      expect(result.needed).toBe(26);
    });
  });

  describe('status thresholds', () => {
    it('reports nothing in stock as critical', () => {
      expect(evaluate({ quantity: 0, minimumQuantity: 10 }).status).toBe('critical');
    });

    it('reports below half the minimum as critical', () => {
      expect(evaluate({ quantity: 4.9, minimumQuantity: 10 }).status).toBe('critical');
    });

    it('reports half the minimum as low, not critical', () => {
      expect(evaluate({ quantity: 5, minimumQuantity: 10 }).status).toBe('low');
    });

    it('reports just under the minimum as low', () => {
      expect(evaluate({ quantity: 9.9, minimumQuantity: 10 }).status).toBe('low');
    });

    it('reports exactly the minimum as adequate', () => {
      expect(evaluate({ quantity: 10, minimumQuantity: 10 }).status).toBe('adequate');
    });

    it('reports above the minimum but below the target as adequate', () => {
      expect(evaluate({ quantity: 20, minimumQuantity: 10, idealQuantity: 30 }).status).toBe('adequate');
    });

    it('reports the target as adequate, not surplus', () => {
      expect(evaluate({ quantity: 30, minimumQuantity: 10, idealQuantity: 30 }).status).toBe('adequate');
    });

    it('reports above the target as surplus', () => {
      expect(evaluate({ quantity: 31, minimumQuantity: 10, idealQuantity: 30 }).status).toBe('surplus');
    });
  });

  describe('preserving the original low-stock rule', () => {
    it('falls back to the global threshold when no minimum is set', () => {
      const result = evaluate({ quantity: 3 });
      expect(result.status).toBe('low');
      expect(result.usedDefaultThreshold).toBe(true);
      expect(result.effectiveMinimum).toBe(5);
    });

    it('treats a quantity equal to the threshold as low, exactly as the original did', () => {
      // The original rule was `parseFloat(qty) <= lowThreshold`, inclusive.
      expect(evaluate({ quantity: 5 }).status).toBe('low');
    });

    it('treats a quantity above the threshold as adequate', () => {
      expect(evaluate({ quantity: 6 }).status).toBe('adequate');
    });

    it('does NOT apply the inclusive rule when an explicit minimum is set', () => {
      // Meeting a minimum you set yourself is meeting it. The inclusive
      // comparison only makes sense for a blanket "anything at or under N is
      // getting low" threshold.
      expect(evaluate({ quantity: 10, minimumQuantity: 10 }).status).toBe('adequate');
      expect(evaluate({ quantity: 10, minimumQuantity: 10 }).usedDefaultThreshold).toBe(false);
    });
  });

  describe('a threshold of zero', () => {
    it('is honoured rather than silently becoming five', () => {
      // `parseFloat(localStorage.getItem(...)) || 5` made zero unreachable in
      // the original app: it fell through to the default on every render.
      const result = evaluate({ quantity: 0 }, 0);
      expect(result.effectiveMinimum).toBe(0);
      expect(result.status).toBe('adequate');
    });

    it('treats an explicit minimum of zero as "no minimum required"', () => {
      expect(evaluate({ quantity: 0, minimumQuantity: 0 }).status).toBe('adequate');
    });

    it('still reports surplus against a target when the minimum is zero', () => {
      expect(evaluate({ quantity: 12, minimumQuantity: 0, idealQuantity: 10 }).status).toBe('surplus');
    });
  });

  describe('quantity needed', () => {
    it('is the gap to the target when one is set', () => {
      expect(evaluate({ quantity: 4, minimumQuantity: 10, idealQuantity: 30 }).needed).toBe(26);
    });

    it('is the gap to the minimum when no target is set', () => {
      expect(evaluate({ quantity: 4, minimumQuantity: 10 }).needed).toBe(6);
    });

    it('is zero once the target is met', () => {
      expect(evaluate({ quantity: 30, minimumQuantity: 10, idealQuantity: 30 }).needed).toBe(0);
    });

    it('is never negative', () => {
      expect(evaluate({ quantity: 100, minimumQuantity: 10, idealQuantity: 30 }).needed).toBe(0);
    });

    it('avoids floating-point dust', () => {
      // 0.3 - 0.1 is 0.19999999999999998 in binary floating point; a shopping
      // list that says "buy 0.19999999999999998 L" is not acceptable output.
      expect(evaluate({ quantity: 0.1, minimumQuantity: 0.3 }).needed).toBe(0.2);
    });
  });

  describe('coverage ratio', () => {
    it('is the fraction of the minimum that is held', () => {
      expect(evaluate({ quantity: 4, minimumQuantity: 10 }).coverage).toBeCloseTo(0.4);
    });

    it('is capped at 1 so a surplus cannot inflate a score', () => {
      expect(evaluate({ quantity: 100, minimumQuantity: 10 }).coverage).toBe(1);
    });

    it('is 1 when nothing is required and something is held', () => {
      expect(evaluate({ quantity: 3, minimumQuantity: 0 }).coverage).toBe(1);
    });

    it('is 1 when nothing is required and nothing is held', () => {
      // Requiring zero is satisfied by zero. Reporting 0% coverage for an item
      // the user explicitly said they need none of would be misleading.
      expect(evaluate({ quantity: 0, minimumQuantity: 0 }).coverage).toBe(1);
    });
  });

  describe('robustness', () => {
    it('treats a negative quantity as zero rather than producing nonsense', () => {
      const result = evaluate({ quantity: -5, minimumQuantity: 10 });
      expect(result.status).toBe('critical');
      expect(result.needed).toBe(10);
    });

    it('survives a non-finite quantity from corrupt data', () => {
      const result = evaluate({ quantity: Number.NaN, minimumQuantity: 10 });
      expect(result.status).toBe('critical');
      expect(Number.isFinite(result.needed)).toBe(true);
    });
  });
});
