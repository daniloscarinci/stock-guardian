/**
 * Types for the translation system.
 *
 * `TranslationKey` is derived from the English tree, which makes a mistyped or
 * missing key a compile error instead of a raw `inventory.addItm` appearing in
 * the interface. `LocaleTree` forces every other locale to have exactly the same
 * shape - the original application shipped two translation keys that existed in
 * all three languages and were never read by any code, which this prevents.
 */
import type { TranslationTree } from './locales/en';

/** Same shape as English, with any string value. */
export type LocaleTree = {
  readonly [Section in keyof TranslationTree]: {
    readonly [Key in keyof TranslationTree[Section]]: string;
  };
};

/** Every valid `section.key` path. */
export type TranslationKey = {
  [Section in keyof TranslationTree & string]: `${Section}.${keyof TranslationTree[Section] & string}`;
}[keyof TranslationTree & string];

/** Values substituted into `{placeholders}`. */
export type TranslationValues = Readonly<Record<string, string | number>>;
