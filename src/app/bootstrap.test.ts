/**
 * Start-up must happen exactly once.
 *
 * This pins a real bug. The OPFS SAH-pool VFS permits a single connection:
 * whichever worker acquires the sync access handles keeps them, and a second
 * worker asking for the same pool fails with `NoModificationAllowedError`.
 *
 * React StrictMode double-invokes effects in development, so `startApplication`
 * ran twice. The first call opened a worker that took the pool; the second
 * opened another that could never get it, and the application showed "Stock
 * Guardian cannot start" over a perfectly healthy database. The effect's
 * cleanup could not help - it can stop a result being used, but the worker it
 * started is already holding the pool.
 *
 * The production build hid this, because StrictMode only double-invokes in
 * development. It only appeared when the dev server was actually run.
 */
import { describe, expect, it } from 'vitest';
import { startApplication } from './bootstrap';

describe('application start-up', () => {
  it('returns the same promise however many times it is called', async () => {
    const first = startApplication();
    const second = startApplication();
    const third = startApplication();

    // Identity, not equality: two promises that each opened a worker would
    // satisfy a deep comparison while still fighting over the database.
    expect(second).toBe(first);
    expect(third).toBe(first);

    // Settling it keeps the run clean. Under Node there is no secure context
    // and no OPFS, so this reports a failure rather than a working database -
    // which is the correct behaviour, and not what this test is about.
    await expect(first).resolves.toHaveProperty('status');
  });
});
