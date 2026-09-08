/**
 * Application settings: the shape, the defaults, and validation.
 *
 * Stored one row per key in the `settings` table with a JSON value, so a
 * setting can grow from a scalar into an object without a schema migration.
 * Reading always goes through `parseSettings`, which fills in defaults for keys
 * that are missing or corrupt - a bad value in one setting can never prevent the
 * application from starting.
 */
import { z } from 'zod';

export const LANGUAGES = ['en', 'pt-BR', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const settingsSchema = z.object({
  /** Interface language. Persisted, unlike the original app which reset to PT every reload. */
  language: z.enum(LANGUAGES).default('en'),
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
  dateFormat: z.enum(DATE_FORMATS).default('DD/MM/YYYY'),
  measurementSystem: z.enum(['metric', 'imperial']).default('metric'),

  /**
   * Fallback low-stock threshold for items that set no minimum of their own.
   *
   * The original app's rule was `quantity <= threshold` with a default of 5, and
   * that behavior is preserved exactly. What is fixed is that 0 is now a real
   * value - `parseFloat(stored) || 5` silently turned zero back into five.
   */
  defaultLowStockThreshold: z.number().min(0).default(5),

  /**
   * Expiry warning windows in days, ascending. The original app had a single
   * hard-coded 30-day window; these are configurable, and 30 remains a default
   * so existing expectations still hold.
   */
  expiryWarningDays: z
    .array(z.number().int().min(1).max(3650))
    .min(1)
    .max(6)
    .default([7, 30, 90]),

  /** Pre-selected when adding an item. Null until the user sets one. */
  defaultLocationId: z.string().nullable().default(null),

  /**
   * Categories that count toward the preparedness score.
   *
   * Empty means "every category that has at least one item", which is the honest
   * default: scoring a household against 20 categories it never intended to
   * stock would produce a discouraging number that means nothing.
   */
  preparednessCategoryIds: z.array(z.string()).default([]),

  /** Whether the browser has been asked for persistent storage. */
  storagePersistenceRequested: z.boolean().default(false),

  /**
   * Shows or hides the ask button in the header, and with it the whole feature.
   *
   * WAS `voiceEnabled`, AND THE RENAME COST ONE STORED BOOLEAN. It used to mean
   * "show the microphone". The microphone is now one of two ways into the same
   * sheet - the other is a text box, and the box is on every platform - so the
   * setting is named for the sheet rather than for either way in. Switching it
   * off removes the button, the sheet, the box and the microphone together,
   * which is what somebody switching it off means.
   *
   * A stored `voiceEnabled` row is not read: `parseSettings` skips a key that
   * is not in the schema, so the row stays in the table, is ignored forever,
   * and this key falls back to its default. The default is `true` and so was
   * the old one.
   */
  askEnabled: z.boolean().default(true),

  /**
   * Reads answers aloud through the system voice. On Android this also yields
   * to the ringer switch; a browser cannot see that state, so there this is the
   * only control.
   */
  voiceSpeakAnswers: z.boolean().default(true),

  /**
   * WHICH voice reads them. Empty means whatever the platform picks.
   *
   * The request behind this was "a female or a male voice", and the Web Speech
   * API has no gender field to answer it with - `SpeechSynthesisVoice` offers a
   * name, a language tag, `localService`, `voiceURI` and nothing else. So this
   * does not store a gender. It stores one voice, chosen from the ones this
   * device actually has, and `speak.ts` guesses at male or female from the name
   * only to label the list. Storing a gender would mean inventing a fact the
   * platform never told us and then failing silently on the many phones that
   * ship one voice per language.
   *
   * A `voiceURI`, not a `name`. Both identify a voice, and the spec makes
   * `voiceURI` the identifier while `name` is a display string the platform is
   * free to translate - a phone switched from English to Portuguese can rename
   * `Portuguese (Brazil) Female` to `Portugues (Brasil) Feminino` and orphan
   * anything keyed on it. `speak.ts` matches on either when reading, because
   * some engines shuffle one and keep the other, and neither matching costs
   * anything.
   *
   * EMPTY IS THE DEFAULT AND IS NOT A FAILURE STATE. It is the behaviour this
   * application had before the setting existed: no voice named, `lang` left to
   * the platform, and a local voice preferred where one matches exactly. A
   * stored voice that is no longer installed falls back to precisely that
   * rather than to silence - see `pickVoice` for why that matters more than
   * honouring the stored value.
   */
  speakingVoiceUri: z.string().default(''),

  /**
   * Keeps recorded speech on the device even when that means no transcription
   * at all.
   *
   * FALSE, WHICH IS NOT THE SAME AS THE MICROPHONE BEING ONLINE. Every listen
   * still starts on the device, and on a phone with the language installed
   * nothing ever leaves. What this governs is the second attempt: when the
   * on-device one fails and the phone reports a connection, the recognizer is
   * asked again without the offline requirement, and the sheet marks that
   * exchange as transcribed over the internet. Switched on, that retry never
   * happens - a language with no offline pack simply will not transcribe, which
   * is exactly what somebody switching this on is asking for.
   *
   * IT IS NAMED FOR THE RESTRICTION BECAUSE THAT IS WHAT IT IS. It replaces
   * `voiceAllowOnline`, which was an opt-in to something exotic and defaulted
   * to off - and, on a phone with no offline Portuguese pack, made the
   * microphone refuse every single press. Twice. Offline is the standard here;
   * the internet is what the standard falls back to, and this is how to refuse
   * that fallback.
   *
   * WHAT HAPPENS TO A STORED `voiceAllowOnline` ROW: nothing reads it.
   * `parseSettings` skips a key that is not in the schema, so the row stays in
   * the table, is ignored forever, and this key falls back to its default of
   * false. It is not migrated, and it deliberately is not: `seedDatabase`
   * writes every default on first run, so a stored `voiceAllowOnline: false`
   * means "this install has never been touched" far more often than it means "a
   * person refused the network". Migrating it would restore the dead button for
   * everybody who never had an opinion, which is the failure this release
   * exists to end.
   *
   * The application is never the one to switch this on or off: not after a
   * failure, not as a retry, not on an upgrade. What a failure may do is put
   * the switch in front of the person, which is what the panel in MicNotice
   * does when this setting is why the microphone gave up.
   */
  voiceOfflineOnly: z.boolean().default(false),

  /**
   * Whether Claude may be asked anything at all.
   *
   * Off, and off is the whole application as it was: the typed box still runs
   * the twelve parser rules, offline and free, and no request is made. Turning
   * it on is not enough on its own - there also has to be a key - so the two
   * together are the only way anything is sent.
   */
  aiEnabled: z.boolean().default(false),

  /**
   * A SECRET, AT REST, IN A DATABASE ON A PHONE.
   *
   * It is the user's own key, pasted in by them, and it is stored exactly like
   * `dateFormat` - one row in the `settings` table, in plain text, because a
   * client-side application has nowhere better to put it. There is no server
   * here to hold it and no keystore this build reaches, so encrypting it would
   * mean storing the decryption key beside it and calling that security.
   *
   * What follows, and what Settings says rather than implies:
   *
   *   - A debug build is `debuggable`. Anyone with the phone and a cable can
   *     read the app's private storage, and that now includes this.
   *   - A release build is not, but an unlocked phone still is.
   *   - The bill is the key holder's, per question, invisibly.
   *
   * Nothing is compiled into the build, which is the property worth keeping:
   * the same APK handed to anyone carries no credential of anyone's.
   */
  anthropicApiKey: z.string().default(''),

  /** The model asked. Settings shows it, because it is what the questions cost. */
  aiModel: z.string().default('claude-haiku-4-5'),

  /**
   * Items the user has taken off the replenishment list.
   *
   * Dismissal is a decision ("I know, and I am not restocking it"), so it has to
   * survive a reload or the list nags forever. Marking something as bought is
   * NOT stored here - that adds the quantity to the item, which removes it from
   * the list on its own and leaves a purchase in the item's history.
   */
  replenishmentDismissed: z.array(z.string()).default([]),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export type SettingsKey = keyof Settings;

export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingsKey[];

/**
 * Builds a complete `Settings` from stored key/value rows.
 *
 * Unknown keys are ignored and invalid values fall back to their default rather
 * than throwing: a settings row corrupted by a bad import must not be able to
 * lock the user out of their own inventory.
 */
export function parseSettings(rows: Iterable<{ key: string; value: string }>): {
  settings: Settings;
  invalidKeys: string[];
} {
  const raw: Record<string, unknown> = {};
  const invalidKeys: string[] = [];

  for (const row of rows) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      raw[row.key] = JSON.parse(row.value);
    } catch {
      invalidKeys.push(row.key);
    }
  }

  const result = settingsSchema.safeParse(raw);
  if (result.success) return { settings: result.data, invalidKeys };

  // One bad value must not discard every good one: drop only what failed.
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string') {
      delete raw[key];
      if (!invalidKeys.includes(key)) invalidKeys.push(key);
    }
  }
  return { settings: settingsSchema.parse(raw), invalidKeys };
}

/** Serializes settings back to storable rows. */
export function toSettingRows(settings: Partial<Settings>): { key: string; value: string }[] {
  return Object.entries(settings)
    .filter(([key]) => key in DEFAULT_SETTINGS)
    .map(([key, value]) => ({ key, value: JSON.stringify(value) }));
}
