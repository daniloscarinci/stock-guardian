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

  /** Shows or hides the microphone. The typed box stays either way. */
  voiceEnabled: z.boolean().default(true),

  /**
   * Reads answers aloud through the system voice. On Android this also yields
   * to the ringer switch; a browser cannot see that state, so there this is the
   * only control.
   */
  voiceSpeakAnswers: z.boolean().default(true),

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
