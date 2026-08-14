/**
 * The translation function.
 *
 * Deliberately small: a lookup, `{placeholder}` substitution, and plural
 * selection. No dependency, no runtime parsing of ICU message syntax, nothing
 * that needs to be fetched.
 *
 * Adding a language means adding one file to `locales/` and one entry to the
 * registry below. No application logic changes, which is what §13 asks for.
 */
import type { Language } from '../domain/settings';
import type { LocaleTree, TranslationKey, TranslationValues } from './types';
import { en } from './locales/en';
import { ptBR } from './locales/pt-BR';
import { es } from './locales/es';

export const LOCALES: Readonly<Record<Language, LocaleTree>> = {
  en: en as unknown as LocaleTree,
  'pt-BR': ptBR,
  es,
};

/** BCP-47 tags for `document.lang` and `Intl`. */
export const LOCALE_TAGS: Readonly<Record<Language, string>> = {
  en: 'en',
  'pt-BR': 'pt-BR',
  es: 'es',
};

function lookup(tree: LocaleTree, key: string): string | undefined {
  const separator = key.indexOf('.');
  if (separator === -1) return undefined;

  const section = key.slice(0, separator) as keyof LocaleTree;
  const leaf = key.slice(separator + 1);
  const bucket = tree[section] as Record<string, string> | undefined;
  return bucket?.[leaf];
}

function interpolate(template: string, values: TranslationValues | undefined): string {
  if (values === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Translates a key.
 *
 * When `values.count` is present, `key_one` or `key_other` is tried first, so a
 * plural form is chosen without the caller having to know whether one exists.
 * A key missing from the active language falls back to English rather than
 * showing the raw key - a partially translated interface is usable, a wall of
 * dotted identifiers is not.
 */
export function translate(
  language: Language,
  key: TranslationKey | string,
  values?: TranslationValues,
): string {
  const tree = LOCALES[language] ?? LOCALES.en;

  if (values !== undefined && typeof values.count === 'number') {
    const suffix = values.count === 1 ? '_one' : '_other';
    const plural = lookup(tree, `${key}${suffix}`) ?? lookup(LOCALES.en, `${key}${suffix}`);
    if (plural !== undefined) return interpolate(plural, values);
  }

  const template = lookup(tree, key) ?? lookup(LOCALES.en, key);
  if (template === undefined) {
    // Reaching here means a key was constructed at runtime that does not exist.
    // Showing the key is more useful than showing nothing, and in development
    // the warning points straight at it.
    if (import.meta.env.DEV) console.warn(`[i18n] Missing translation key: ${key}`);
    return key;
  }

  return interpolate(template, values);
}

export type TranslateFn = (key: TranslationKey | string, values?: TranslationValues) => string;
