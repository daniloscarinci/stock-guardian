/**
 * The seam, with the plugin replaced by a fake alarm manager.
 *
 * Nothing here schedules a real notification, and the fake is a store rather
 * than a set of return values: `schedule` puts rows in it and `getPending`
 * reads them back, so "rescheduling twice does not leave two of everything" is
 * something the test can watch happen instead of inferring from call counts.
 *
 * The plugin proxy in ringer.ts is created when the module loads, so both mocks
 * have to exist before the import - `vi.mock` is hoisted above it and the state
 * lives in a `vi.hoisted` object for the same reason `capacitor.test.ts` does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../i18n/translate';
import { NOTICE_ID_BASE } from './plan';

interface FakePending {
  id: number;
  title: string;
  body: string;
}

const bridge = vi.hoisted(() => ({
  native: true,
  platform: 'android',
  /** What the fake alarm manager is holding. */
  pending: [] as { id: number; title: string; body: string }[],
  display: 'granted' as string,
  requested: 'granted' as string,
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getPending: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn(),
  createChannel: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => bridge.native,
    getPlatform: () => bridge.platform,
  },
  // ringer.ts registers the Ringer plugin at module load; nothing in this file
  // asks it anything.
  registerPlugin: () => ({ isSilent: () => Promise.resolve({ silent: false }) }),
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: bridge.checkPermissions,
    requestPermissions: bridge.requestPermissions,
    getPending: bridge.getPending,
    cancel: bridge.cancel,
    schedule: bridge.schedule,
    createChannel: bridge.createChannel,
    addListener: bridge.addListener,
  },
}));

const {
  cancelExpiryNotices,
  forgetScheduledPlan,
  lastScheduleFailure,
  notificationPermission,
  onExpiryNoticeTapped,
  refreshExpiryNotices,
  requestNotificationPermission,
} = await import('./notifier');

const t = (key: string, values?: Record<string, string | number>) => translate('en', key, values);

const NOW = new Date(2026, 2, 14, 8, 0, 0, 0);

const MILK = { id: 'a', name: 'Milk', expirationDate: '2026-04-01' };
const BREAD = { id: 'b', name: 'Bread', expirationDate: '2026-05-01' };

function refresh(overrides: Partial<Parameters<typeof refreshExpiryNotices>[0]> = {}) {
  return refreshExpiryNotices({
    enabled: true,
    items: [MILK, BREAD],
    t,
    leadDays: 7,
    time: '09:00',
    now: NOW,
    ...overrides,
  });
}

beforeEach(() => {
  // The module remembers the plan it last handed to Android so that pressing
  // `+` on a tin does not reschedule forty alarms. It is process-local, and a
  // test file is one process.
  forgetScheduledPlan();

  bridge.native = true;
  bridge.platform = 'android';
  bridge.pending = [];
  bridge.display = 'granted';
  bridge.requested = 'granted';

  bridge.checkPermissions.mockReset();
  bridge.checkPermissions.mockImplementation(() => Promise.resolve({ display: bridge.display }));

  bridge.requestPermissions.mockReset();
  bridge.requestPermissions.mockImplementation(() => Promise.resolve({ display: bridge.requested }));

  bridge.getPending.mockReset();
  bridge.getPending.mockImplementation(() => Promise.resolve({ notifications: [...bridge.pending] }));

  bridge.cancel.mockReset();
  bridge.cancel.mockImplementation((options: { notifications: { id: number }[] }) => {
    const gone = new Set(options.notifications.map((n) => n.id));
    bridge.pending = bridge.pending.filter((n) => !gone.has(n.id));
    return Promise.resolve();
  });

  bridge.schedule.mockReset();
  bridge.schedule.mockImplementation((options: { notifications: FakePending[] }) => {
    bridge.pending.push(
      ...options.notifications.map((n) => ({ id: n.id, title: n.title, body: n.body })),
    );
    return Promise.resolve({ notifications: options.notifications.map((n) => ({ id: n.id })) });
  });

  bridge.createChannel.mockReset();
  bridge.createChannel.mockResolvedValue(undefined);

  bridge.addListener.mockReset();
  bridge.addListener.mockResolvedValue({ remove: () => Promise.resolve() });
});

describe('refreshExpiryNotices', () => {
  describe('with the setting off', () => {
    /*
     * The whole promise of the switch: somebody who never turns it on is never
     * asked about notifications, on start-up or at any other time. Android's
     * prompt is raised by a press in Settings and by nothing else.
     */
    it('schedules nothing and asks for no permission', async () => {
      const outcome = await refresh({ enabled: false });

      expect(outcome).toEqual({ status: 'off', cancelled: 0 });
      expect(bridge.schedule).not.toHaveBeenCalled();
      expect(bridge.requestPermissions).not.toHaveBeenCalled();
      expect(bridge.checkPermissions).not.toHaveBeenCalled();
    });

    /*
     * Switching off has to undo, not merely stop. Forty alarms were left with
     * Android when it was on, and a switch that let them keep arriving for a
     * year would not be a switch.
     */
    it('takes back everything it had already scheduled', async () => {
      await refresh();
      expect(bridge.pending.length).toBeGreaterThan(0);

      const outcome = await refresh({ enabled: false });

      expect(outcome).toEqual({ status: 'off', cancelled: 4 });
      expect(bridge.pending).toEqual([]);
    });
  });

  describe('the permission', () => {
    /*
     * Reported, not swallowed - and the two refusals stay apart, because
     * `permission-denied` can be asked again by pressing the switch and
     * `permission-blocked` cannot be asked again at all.
     */
    it('reports a refusal rather than returning as though it had scheduled', async () => {
      bridge.display = 'denied';

      const outcome = await refresh();

      expect(outcome).toEqual({ status: 'refused', reason: 'permission-blocked' });
      expect(bridge.schedule).not.toHaveBeenCalled();
    });

    it('reports an askable refusal as the other one', async () => {
      bridge.display = 'prompt-with-rationale';

      expect(await refresh()).toEqual({ status: 'refused', reason: 'permission-denied' });
    });

    /*
     * The plugin's own `schedule()` requests the permission implicitly when it
     * is missing, which would put Android's dialog in front of somebody who had
     * only opened the application. Checking first is what stops that.
     */
    it('never requests, even when the setting is on and the permission is gone', async () => {
      bridge.display = 'prompt';

      await refresh();

      expect(bridge.requestPermissions).not.toHaveBeenCalled();
    });

    it('reads the four Capacitor states as three', async () => {
      for (const [state, expected] of [
        ['granted', 'granted'],
        ['denied', 'blocked'],
        ['prompt', 'prompt'],
        ['prompt-with-rationale', 'prompt'],
      ] as const) {
        bridge.display = state;
        expect(await notificationPermission(), state).toBe(expected);
      }
    });

    it('asks only when asked to', async () => {
      bridge.requested = 'denied';

      expect(await requestNotificationPermission()).toBe('blocked');
      expect(bridge.requestPermissions).toHaveBeenCalledTimes(1);
    });
  });

  describe('scheduling', () => {
    it('hands Android one notification per day, with its text already written', async () => {
      const outcome = await refresh();

      expect(outcome).toEqual({ status: 'scheduled', cancelled: 0, scheduled: 4, dropped: 0 });

      const sent = bridge.schedule.mock.calls[0]?.[0] as { notifications: FakePending[] };
      expect(sent.notifications.map((n) => [n.id, n.title, n.body])).toEqual([
        [NOTICE_ID_BASE, '1 item expires in 7 days', 'Milk'],
        [NOTICE_ID_BASE + 1, '1 item expires today', 'Milk'],
        [NOTICE_ID_BASE + 2, '1 item expires in 7 days', 'Bread'],
        [NOTICE_ID_BASE + 3, '1 item expires today', 'Bread'],
      ]);
    });

    /*
     * Exact alarms would make this application ask for SCHEDULE_EXACT_ALARM and
     * would open Android's "Alarms & reminders" screen the first time it
     * scheduled. A daily digest does not need a stopwatch. `allowWhileIdle` is
     * the part that matters and it needs no permission at all.
     */
    it('asks for an inexact alarm that still fires in Doze', async () => {
      await refresh();

      const sent = bridge.schedule.mock.calls[0]?.[0] as {
        notifications: { isExactNotification: boolean; schedule: { allowWhileIdle: boolean } }[];
      };
      expect(sent.notifications.every((n) => n.isExactNotification === false)).toBe(true);
      expect(sent.notifications.every((n) => n.schedule.allowWhileIdle === true)).toBe(true);
    });

    it('carries the screen a tap should open', async () => {
      await refresh();

      const sent = bridge.schedule.mock.calls[0]?.[0] as {
        notifications: { extra: { route: string } }[];
      };
      expect(sent.notifications.every((n) => n.extra.route === '/expiration')).toBe(true);
    });

    /*
     * The one that matters most. Rescheduling on every open, without cancelling
     * first, would leave a phone holding one copy per visit - and the person
     * would get eleven identical notifications on the morning of the eleventh
     * opening.
     *
     * Driven through a real change and back again rather than by calling twice
     * with the same input, because the same input short-circuits on the memo
     * below and would prove nothing about the cancel.
     */
    it('does not leave two of everything when the plan is rebuilt', async () => {
      await refresh();
      const afterFirst = [...bridge.pending];

      await refresh({ items: [MILK, BREAD, { id: 'c', name: 'Rice', expirationDate: '2026-06-01' }] });
      expect(bridge.pending).toHaveLength(6);

      const outcome = await refresh();

      expect(outcome).toEqual({ status: 'scheduled', cancelled: 6, scheduled: 4, dropped: 0 });
      expect(bridge.pending).toEqual(afterFirst);
    });

    /*
     * The refresh runs on every write, and most writes are a quantity going up
     * by one. Reading the pending list, cancelling forty alarms and registering
     * forty more for a plan that has not moved is work a phone can feel.
     */
    it('does not touch the alarm manager when the plan has not moved', async () => {
      await refresh();
      bridge.getPending.mockClear();
      bridge.cancel.mockClear();
      bridge.schedule.mockClear();

      expect(await refresh()).toEqual({ status: 'unchanged', scheduled: 4 });
      expect(bridge.getPending).not.toHaveBeenCalled();
      expect(bridge.cancel).not.toHaveBeenCalled();
      expect(bridge.schedule).not.toHaveBeenCalled();
    });

    it('reschedules when only the words changed', async () => {
      await refresh();
      bridge.schedule.mockClear();

      const pt = (key: string, values?: Record<string, string | number>) =>
        translate('pt-BR', key, values);
      expect((await refresh({ t: pt })).status).toBe('scheduled');

      const sent = bridge.schedule.mock.calls[0]?.[0] as { notifications: FakePending[] };
      expect(sent.notifications[0]?.title).toBe('1 item vence em 7 dias');
    });

    /*
     * A memo that survived a refusal would hide it: the permission is checked
     * first, and a plan believed scheduled but never accepted is the worst
     * failure this feature has.
     */
    it('forgets what it scheduled when Android refuses, so the next open retries', async () => {
      await refresh();

      bridge.schedule.mockRejectedValueOnce(new Error('Notifications not enabled'));
      expect((await refresh({ items: [MILK] })).status).toBe('failed');

      bridge.schedule.mockClear();
      expect((await refresh({ items: [MILK] })).status).toBe('scheduled');
      expect(bridge.schedule).toHaveBeenCalledTimes(1);
    });

    it('forgets it when the setting goes off, and again when the permission does', async () => {
      await refresh();
      await refresh({ enabled: false });
      expect((await refresh()).status).toBe('scheduled');

      bridge.display = 'denied';
      expect((await refresh()).status).toBe('refused');

      bridge.display = 'granted';
      bridge.schedule.mockClear();
      expect((await refresh()).status).toBe('scheduled');
      expect(bridge.schedule).toHaveBeenCalledTimes(1);
    });

    /*
     * `cancelAll()` would be one line and would also cancel anything else this
     * package ever schedules. The id band is what makes "only our own" true.
     */
    it('cancels only the ids in its own band', async () => {
      bridge.pending = [{ id: 42, title: 'Someone else', body: '' }];

      await refresh();

      expect(bridge.pending.some((n) => n.id === 42)).toBe(true);
      expect(await cancelExpiryNotices()).toBe(4);
      expect(bridge.pending).toEqual([{ id: 42, title: 'Someone else', body: '' }]);
    });

    /*
     * Scheduling first would leave both sets pending for the length of a bridge
     * call, and a failure in between would leave them there.
     */
    it('cancels before it schedules, never after', async () => {
      await refresh();
      bridge.cancel.mockClear();
      bridge.schedule.mockClear();

      await refresh({ items: [MILK] });

      expect(bridge.cancel.mock.invocationCallOrder[0]).toBeLessThan(
        bridge.schedule.mock.invocationCallOrder[0] ?? Infinity,
      );
    });

    it('says so when there is nothing to schedule', async () => {
      const outcome = await refresh({ items: [{ id: 'c', name: 'Hammer', expirationDate: null }] });

      expect(outcome).toEqual({ status: 'scheduled', cancelled: 0, scheduled: 0, dropped: 0 });
      expect(bridge.schedule).not.toHaveBeenCalled();
    });

    /*
     * Android can refuse a schedule outright - notifications disabled for the
     * whole application, a channel blocked, a bridge that is not there. Turning
     * that into a silent success would be the worst failure this feature could
     * have, because nothing on the phone would ever say a word about it.
     */
    it('reports a rejection instead of swallowing it', async () => {
      bridge.schedule.mockRejectedValue(new Error('Notifications not enabled'));

      expect(await refresh()).toEqual({
        status: 'failed',
        reason: 'Notifications not enabled',
      });
    });

    /*
     * A rejection has to be findable afterwards, because there is nothing on the
     * phone to see: the switch says on, the permission is granted, and nothing
     * arrives. Settings reads this and says what Android said.
     */
    it('keeps the rejection where Settings can say it, until one succeeds', async () => {
      expect(lastScheduleFailure()).toBeNull();

      bridge.schedule.mockRejectedValueOnce(new Error('Notifications not enabled'));
      await refresh();
      expect(lastScheduleFailure()).toBe('Notifications not enabled');

      await refresh();
      expect(lastScheduleFailure()).toBeNull();
    });

    it('does not leave a rejection standing next to a refusal', async () => {
      bridge.schedule.mockRejectedValueOnce(new Error('Notifications not enabled'));
      await refresh();

      bridge.display = 'denied';
      await refresh();

      expect(lastScheduleFailure()).toBeNull();
    });

    it('does not let a channel that cannot be created stop the reminders', async () => {
      bridge.createChannel.mockRejectedValue(new Error('Not available on Android 7'));

      expect((await refresh()).status).toBe('scheduled');
      expect(bridge.schedule).toHaveBeenCalledTimes(1);
    });
  });

  describe('off Android', () => {
    it('answers unsupported and asks the bridge nothing', async () => {
      bridge.native = false;
      bridge.platform = 'web';

      expect(await refresh()).toEqual({ status: 'unsupported' });
      expect(await notificationPermission()).toBe('unsupported');
      expect(await requestNotificationPermission()).toBe('unsupported');
      expect(await cancelExpiryNotices()).toBe(0);

      expect(bridge.checkPermissions).not.toHaveBeenCalled();
      expect(bridge.requestPermissions).not.toHaveBeenCalled();
      expect(bridge.getPending).not.toHaveBeenCalled();
      expect(bridge.schedule).not.toHaveBeenCalled();
    });
  });
});

describe('onExpiryNoticeTapped', () => {
  /** The listener the plugin was handed, so a tap can be delivered to it. */
  function tap(extra: unknown): void {
    const listener = bridge.addListener.mock.calls[0]?.[1] as (event: unknown) => void;
    listener({ notification: { extra } });
  }

  it('sends a tap to the screen the notification was about', async () => {
    const go = vi.fn();
    onExpiryNoticeTapped(go);
    await Promise.resolve();

    expect(bridge.addListener).toHaveBeenCalledWith(
      'localNotificationActionPerformed',
      expect.any(Function),
    );
    tap({ route: '/expiration' });
    expect(go).toHaveBeenCalledWith('/expiration');
  });

  /*
   * `extra` crosses the bridge as JSON and comes back as `any`. Navigating on
   * whatever it turns out to be is how a tap ends up somewhere nobody chose.
   */
  it('ignores anything that is not a route this application wrote', async () => {
    const go = vi.fn();
    onExpiryNoticeTapped(go);
    await Promise.resolve();

    for (const extra of [null, undefined, 'expiration', 42, {}, { route: 5 }, { route: 'https://elsewhere' }]) {
      tap(extra);
    }
    expect(go).not.toHaveBeenCalled();
  });

  it('registers nothing off Android', () => {
    bridge.native = false;
    bridge.platform = 'web';

    const stop = onExpiryNoticeTapped(vi.fn());

    expect(bridge.addListener).not.toHaveBeenCalled();
    expect(() => {
      stop();
    }).not.toThrow();
  });
});
