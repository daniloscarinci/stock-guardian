/**
 * The notification seam: the one module that talks to the plugin.
 *
 * Above this, nothing knows that `@capacitor/local-notifications` exists - the
 * same separation `SqlDriver` gives the database and `SpeechRecognizer` gives
 * the microphone. Below it, `plan.ts` decides what to say and this decides
 * whether anything may be said at all.
 *
 * ANDROID ONLY, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT. The plugin has
 * a web implementation, and it works by holding a `setTimeout` in the open page
 * and posting a browser notification when it fires. For a reminder that has to
 * survive three months of the application being closed, that is not a weaker
 * version of the feature - it is the opposite of it, and it would spend a
 * browser permission prompt on something that cannot deliver. So every entry
 * point here answers `unsupported` off Android and asks the bridge nothing.
 *
 * THE PERMISSION IS RAISED BY ONE PRESS AND NEVER BY A START-UP. Android 13
 * requires POST_NOTIFICATIONS, and the plugin's own `schedule()` will request
 * it implicitly if it is missing - which would mean a dialog on the first
 * launch after an update, about a feature the person never asked for. So
 * `refreshExpiryNotices` checks the permission itself and refuses to schedule
 * without it. The only thing in this application that ever calls
 * `requestNotificationPermission` is the switch in Settings, and the switch
 * only calls it when it is being turned on.
 *
 * A REFUSAL IS AN OUTCOME, NOT AN ERROR, AND IT IS RETURNED RATHER THAN
 * SWALLOWED. Two of them, kept apart for the same reason the microphone keeps
 * them apart: `permission-denied` can be asked again, and `permission-blocked`
 * cannot be asked again at all, so the only way back from the second is this
 * application's own page in Android's settings. See `MicNotice` and
 * `SpeechPlugin` - that pattern was settled there and this follows it.
 *
 * INEXACT ALARMS, ON PURPOSE. `isExactNotification: false` on every notice.
 * Left at its default of true, the plugin opens Android's "Alarms & reminders"
 * settings screen the first time it schedules on Android 12 or later, and this
 * application would be demanding a second permission - SCHEDULE_EXACT_ALARM -
 * so that a digest about tinned food could arrive at 09:00:00 rather than
 * 09:04. It is a daily reminder. It does not need a stopwatch, and the manifest
 * removes that permission rather than holding one it cannot justify.
 *
 * `allowWhileIdle` IS SET, AND IT IS NOT THE SAME THING. Inexact alarms are
 * deferred while the device is in Doze, which for a phone that spends the night
 * on a table means "next time somebody picks it up". `setAndAllowWhileIdle`
 * fires during Doze anyway, at most once every nine minutes per application,
 * and needs no permission of any kind. So the reminder arrives in the morning
 * rather than whenever the phone is next unlocked.
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import { isNativeAndroid } from '../speech/ringer';
import type { TranslateFn } from '../../i18n/translate';
import {
  isExpiryNoticeId,
  planExpiryNotices,
  renderExpiryNotice,
  type DatedItem,
  type ExpiryNotice,
} from './plan';

export { MAX_SCHEDULED_NOTICES } from './plan';
export type { DatedItem } from './plan';

/**
 * Its own channel rather than the plugin's "Default".
 *
 * Android shows channels by name under Settings -> Apps -> Stock Guardian ->
 * Notifications, and that screen is where somebody goes to turn one kind of
 * message off without turning the application off. A channel called "Default"
 * tells them nothing about what they would be silencing.
 */
export const EXPIRY_CHANNEL_ID = 'expiry-reminders';

/**
 * IMPORTANCE_DEFAULT. It makes a sound and does not take over the screen.
 *
 * High would push a heads-up banner over whatever the person is doing, which is
 * for a message that cannot wait. Food going off next week can wait until the
 * phone is looked at. Vibration is deliberately not enabled: a channel that
 * vibrates needs `android.permission.VIBRATE`, and one more permission is not
 * worth a buzz.
 */
const CHANNEL_IMPORTANCE = 3;

/** Granted, askable, or refused for good. The same three the microphone has. */
export type NotificationPermission = 'granted' | 'prompt' | 'blocked';

/** The two refusals, kept apart because the ways out are different. */
export type NotificationRefusal = 'permission-denied' | 'permission-blocked';

/**
 * What a refresh did, in enough detail that Settings can say it and a test can
 * assert it. Nothing here throws for an ordinary outcome.
 */
export type RefreshOutcome =
  /** Not Android. Nothing was asked of the bridge and nothing was scheduled. */
  | { readonly status: 'unsupported' }
  /** The setting is off. Anything previously scheduled has been taken back. */
  | { readonly status: 'off'; readonly cancelled: number }
  /** The setting is on and Android will not let this application post. */
  | { readonly status: 'refused'; readonly reason: NotificationRefusal }
  | {
      readonly status: 'scheduled';
      readonly cancelled: number;
      readonly scheduled: number;
      /** Left out by the cap. Non-zero is worth saying out loud. */
      readonly dropped: number;
    }
  /** The plan is identical to the one Android is already holding. See `applied`. */
  | { readonly status: 'unchanged'; readonly scheduled: number }
  /** The plugin rejected. Reported rather than hidden - see the module note. */
  | { readonly status: 'failed'; readonly reason: string };

export interface RefreshInput {
  readonly enabled: boolean;
  readonly items: readonly DatedItem[];
  readonly t: TranslateFn;
  /** Smallest of the user's `expiryWarningDays`. */
  readonly leadDays: number;
  /** `HH:MM`, local. */
  readonly time: string;
  readonly now?: Date;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Capacitor's four states as this application's three.
 *
 * `prompt` and `prompt-with-rationale` are the same answer to the only question
 * being asked - will Android show a dialog if we ask - so they collapse.
 * `denied` does not: on Android 13 it is what the system reports once it has
 * stopped asking, and an application that kept requesting would raise nothing
 * at all and look broken.
 */
function toPermission(state: string): NotificationPermission {
  if (state === 'granted') return 'granted';
  if (state === 'denied') return 'blocked';
  return 'prompt';
}

/**
 * What Android currently allows, without asking it for anything.
 *
 * Safe to call on start-up and from a settings screen: `checkPermissions`
 * raises no dialog on any Android version.
 */
export async function notificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNativeAndroid()) return 'unsupported';
  try {
    const status = await LocalNotifications.checkPermissions();
    return toPermission(status.display);
  } catch {
    // A bridge that cannot answer is not a grant. Failing to `blocked` would
    // claim the user refused something they were never asked; `prompt` is the
    // honest fallback, and the request that follows it will find out.
    return 'prompt';
  }
}

/**
 * Raises Android's prompt, if Android is still willing to raise one.
 *
 * Called from exactly one place: the moment somebody switches the reminders on.
 * Never from start-up, never after a failure, never as a retry.
 */
export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!isNativeAndroid()) return 'unsupported';
  try {
    const status = await LocalNotifications.requestPermissions();
    return toPermission(status.display);
  } catch {
    return 'prompt';
  }
}

/**
 * Takes back every pending reminder this application scheduled, and nothing
 * else.
 *
 * `cancelAll()` would be one line and would also cancel anything else that ever
 * schedules from this package. Reading the pending list and cancelling by id
 * band is the version that stays correct when something else is added.
 *
 * Returns how many were cancelled, which is what makes "rescheduling twice does
 * not double-schedule" a thing a test can see rather than infer.
 */
export async function cancelExpiryNotices(): Promise<number> {
  if (!isNativeAndroid()) return 0;
  try {
    const pending = await LocalNotifications.getPending();
    const ours = pending.notifications.filter((notice) => isExpiryNoticeId(notice.id));
    if (ours.length === 0) return 0;
    await LocalNotifications.cancel({ notifications: ours.map((notice) => ({ id: notice.id })) });
    return ours.length;
  } catch {
    // Cancelling is best-effort by nature: the ids are re-used by the schedule
    // that follows, so a duplicate cannot survive it even if this failed.
    return 0;
  }
}

/**
 * Creates the channel if it is not already there.
 *
 * Rejects below Android 8, where channels do not exist and notifications work
 * without one, so the failure is swallowed here rather than reported - there is
 * nothing for anybody to do about it and the reminder still arrives.
 */
async function ensureChannel(t: TranslateFn): Promise<void> {
  try {
    await LocalNotifications.createChannel({
      id: EXPIRY_CHANNEL_ID,
      name: t('notifications.channelName'),
      description: t('notifications.channelDescription'),
      importance: CHANNEL_IMPORTANCE,
      visibility: 1,
    });
  } catch {
    // Android 7, or a channel the system will not let us touch. Neither stops
    // a notification being posted.
  }
}

function toSchema(t: TranslateFn, notice: ExpiryNotice): LocalNotificationSchema {
  const { title, body } = renderExpiryNotice(t, notice);
  return {
    id: notice.id,
    title,
    body,
    // Repeated as the expanded style so a long list of names is readable when
    // the notification is pulled down rather than cut off at one line.
    largeBody: body,
    channelId: EXPIRY_CHANNEL_ID,
    schedule: { at: notice.at, allowWhileIdle: true },
    isExactNotification: false,
    /*
     * Read back by `useExpiryNotifications` when the notification is tapped.
     * The route is a string here rather than a boolean flag so that a second
     * kind of notification, if one is ever added, can send somebody somewhere
     * else without this shape changing.
     */
    extra: { route: '/expiration', expiresOn: notice.expiresOn, kind: notice.kind },
  };
}

/**
 * The whole cycle: decide, cancel, schedule.
 *
 * Called on start-up and after every write, because `revision` in AppContext
 * moves on every write and this is keyed to it. Cheap enough to run that often:
 * one query, some arithmetic, and at most forty rows across the bridge.
 *
 * The order is cancel-then-schedule and not the other way round. Scheduling
 * first would leave both sets pending for the length of a bridge call, and a
 * failure in between would leave them there.
 */
/**
 * One refresh at a time, application-wide.
 *
 * `revision` can move twice in a breath - a write followed by a settings save,
 * or a screen mounting while an import finishes - and two refreshes running at
 * once would interleave their cancels and their schedules. One could take back
 * the notices the other had just registered, leaving a phone holding nothing
 * and no error anywhere to say so. Serialising them costs a queued promise and
 * removes the whole class of it.
 *
 * A rejected refresh does not poison the queue: the next one runs either way,
 * because the failure belongs to that call and not to the chain.
 */
let inFlight: Promise<unknown> = Promise.resolve();

/**
 * The plan Android is already holding, as a string, or null for "unknown".
 *
 * This exists because the refresh is keyed to `revision`, and `revision` moves
 * on EVERY write - including pressing `+` on a tin of beans, which changes a
 * quantity and no expiry date at all. Without this, each of those presses would
 * read the pending list, cancel forty alarms and register forty more, on a
 * phone, for a plan that had not moved by a single character.
 *
 * It is deliberately process-local and deliberately not persisted. The failure
 * this could cause is the worst one this feature has - a plan believed to be
 * scheduled that is not - so the memory is thrown away every time the
 * application starts, which on a phone is often, and the first refresh of every
 * launch does the real work regardless. It is cleared on any outcome that is
 * not a confirmed schedule, so a refusal or a rejection is retried rather than
 * remembered.
 *
 * It is checked AFTER the permission, never before: a permission revoked in
 * Android's settings has to be noticed on the next open, and a memo that
 * short-circuited ahead of that check would hide it until something expired.
 */
let applied: string | null = null;

/** The plan as Android would see it: what fires, when, and what it will say. */
function signatureOf(notices: readonly ExpiryNotice[], t: TranslateFn): string {
  return JSON.stringify(
    notices.map((notice) => {
      const { title, body } = renderExpiryNotice(t, notice);
      return [notice.id, notice.at.getTime(), title, body];
    }),
  );
}

/**
 * The last thing Android said when it would not accept the reminders, or null.
 *
 * A rejection is rarer than a refused permission and worse to lose, because
 * there is nothing on the phone to see: the switch says on, the permission is
 * granted, and nothing ever arrives. The likeliest cause is somebody silencing
 * this application's notification channel in Android's own settings, which
 * leaves the permission intact.
 *
 * Module state rather than a return value because the refresh runs in the shell
 * and the sentence belongs in Settings, and passing it between them through
 * React would mean holding a failure in a context every screen re-renders on.
 * It is cleared by the next refresh that succeeds.
 */
let failure: string | null = null;

export function lastScheduleFailure(): string | null {
  return failure;
}

/** Forgets what is scheduled, so the next refresh does the work again. */
export function forgetScheduledPlan(): void {
  applied = null;
  failure = null;
}

export function refreshExpiryNotices(input: RefreshInput): Promise<RefreshOutcome> {
  const next = inFlight.then(
    () => runRefresh(input),
    () => runRefresh(input),
  );
  inFlight = next.catch(() => undefined);
  return next;
}

async function runRefresh(input: RefreshInput): Promise<RefreshOutcome> {
  if (!isNativeAndroid()) return { status: 'unsupported' };

  /*
   * Off means off, and it also means undoing. Somebody who switches these off
   * has forty alarms already sitting in Android's alarm manager, and a switch
   * that stops adding new ones while the old ones keep arriving for a year is
   * not a switch. Nothing here requests a permission - `getPending` and
   * `cancel` never do - so an application whose reminders were never turned on
   * still asks the person nothing.
   */
  if (!input.enabled) {
    applied = null;
    failure = null;
    return { status: 'off', cancelled: await cancelExpiryNotices() };
  }

  const permission = await notificationPermission();
  if (permission !== 'granted') {
    // Deliberately does NOT request. The setting being on means somebody
    // granted this once; if Android has since taken it back, the way to ask
    // again is the switch, in front of the person, and not a dialog that
    // appears because the application was opened.
    applied = null;
    // A refusal has its own sentence next to the switch. Leaving a stale
    // rejection standing beside it would say two different things at once.
    failure = null;
    return {
      status: 'refused',
      reason: permission === 'blocked' ? 'permission-blocked' : 'permission-denied',
    };
  }

  const plan = planExpiryNotices(input.items, {
    now: input.now ?? new Date(),
    leadDays: input.leadDays,
    time: input.time,
  });

  const signature = signatureOf(plan.notices, input.t);
  if (signature === applied) {
    return { status: 'unchanged', scheduled: plan.notices.length };
  }

  const cancelled = await cancelExpiryNotices();

  if (plan.notices.length === 0) {
    applied = signature;
    failure = null;
    return { status: 'scheduled', cancelled, scheduled: 0, dropped: plan.dropped };
  }

  try {
    await ensureChannel(input.t);
    await LocalNotifications.schedule({
      notifications: plan.notices.map((notice) => toSchema(input.t, notice)),
    });
  } catch (cause) {
    applied = null;
    failure = messageOf(cause);
    return { status: 'failed', reason: failure };
  }

  applied = signature;
  failure = null;
  return { status: 'scheduled', cancelled, scheduled: plan.notices.length, dropped: plan.dropped };
}

/** Whether this device can deliver a reminder at all. See the module note. */
export function expiryNotificationsAvailable(): boolean {
  return isNativeAndroid();
}

/**
 * The route a tapped notification carries, if it carries one this application
 * put there.
 *
 * `extra` comes back across the bridge as `any`, having been JSON on the way
 * out and a `Bundle` in between, so it is treated as untrusted: an object, a
 * string field, and a leading slash, or nothing happens. A tap that lands
 * nowhere is better than one that navigates on whatever the bridge returned.
 */
function readRoute(extra: unknown): string | null {
  if (typeof extra !== 'object' || extra === null) return null;
  const route = (extra as { route?: unknown }).route;
  return typeof route === 'string' && route.startsWith('/') ? route : null;
}

/**
 * Sends a tap to the screen the notification is about.
 *
 * Opening the application is not the same as answering the notification.
 * Somebody who taps "3 items expire today" wants the list of them, and landing
 * on the dashboard makes them go and find it - which is exactly the friction
 * the reminder existed to remove.
 *
 * Registering the listener is asynchronous and unsubscribing is too, so the
 * returned function is synchronous and handles both orders: a caller that
 * unsubscribes before the handle arrives still gets it removed.
 */
export function onExpiryNoticeTapped(go: (route: string) => void): () => void {
  if (!isNativeAndroid()) return () => undefined;

  let handle: { remove: () => Promise<void> } | null = null;
  let stopped = false;

  void LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    const route = readRoute(event.notification.extra as unknown);
    if (route !== null) go(route);
  })
    .then((registered) => {
      if (stopped) void registered.remove();
      else handle = registered;
    })
    .catch(() => undefined);

  return () => {
    stopped = true;
    void handle?.remove();
  };
}
