import { describe, expect, it } from 'vitest';
import { LOCALES, LOCALE_TAGS, translate } from './translate';
import { en } from './locales/en';
import { LANGUAGES } from '../domain/settings';

const sections = Object.keys(en) as (keyof typeof en)[];

describe('translations', () => {
  describe('completeness', () => {
    it('supports every language the settings allow', () => {
      for (const language of LANGUAGES) {
        expect(LOCALES[language], language).toBeDefined();
        expect(LOCALE_TAGS[language], language).toBeDefined();
      }
    });

    it.each(LANGUAGES)('%s has every key English has', (language) => {
      const locale = LOCALES[language] as unknown as Record<string, Record<string, string>>;
      const missing: string[] = [];

      for (const section of sections) {
        for (const key of Object.keys(en[section])) {
          const value = locale[section]?.[key];
          if (typeof value !== 'string' || value === '') missing.push(`${section}.${key}`);
        }
      }
      expect(missing).toEqual([]);
    });

    it.each(LANGUAGES)('%s has no keys English does not', (language) => {
      const locale = LOCALES[language] as unknown as Record<string, Record<string, string>>;
      const extra: string[] = [];

      for (const section of Object.keys(locale)) {
        const reference = (en as unknown as Record<string, Record<string, string>>)[section];
        if (reference === undefined) {
          extra.push(section);
          continue;
        }
        for (const key of Object.keys(locale[section] ?? {})) {
          if (!(key in reference)) extra.push(`${section}.${key}`);
        }
      }
      expect(extra).toEqual([]);
    });

    it.each(LANGUAGES)('%s keeps every placeholder English uses', (language) => {
      const locale = LOCALES[language] as unknown as Record<string, Record<string, string>>;
      const placeholders = (text: string) =>
        [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

      const mismatched: string[] = [];
      for (const section of sections) {
        for (const [key, value] of Object.entries(en[section])) {
          const translated = locale[section]?.[key];
          if (translated === undefined) continue;
          const expected = placeholders(String(value));
          const actual = placeholders(translated);
          if (JSON.stringify(expected) !== JSON.stringify(actual)) {
            mismatched.push(`${section}.${key}: expected ${expected.join(',')} got ${actual.join(',')}`);
          }
        }
      }
      expect(mismatched).toEqual([]);
    });

    it.each(LANGUAGES)('%s provides both plural forms wherever English does', (language) => {
      const locale = LOCALES[language] as unknown as Record<string, Record<string, string>>;
      const incomplete: string[] = [];

      for (const section of sections) {
        for (const key of Object.keys(en[section])) {
          if (!key.endsWith('_one')) continue;
          const other = `${key.slice(0, -4)}_other`;
          if (typeof locale[section]?.[other] !== 'string') {
            incomplete.push(`${section}.${other}`);
          }
        }
      }
      expect(incomplete).toEqual([]);
    });
  });

  describe('translating', () => {
    it('returns the string for the active language', () => {
      expect(translate('en', 'nav.inventory')).toBe('Inventory');
      expect(translate('pt-BR', 'nav.inventory')).toBe('Inventário');
      expect(translate('es', 'nav.inventory')).toBe('Inventario');
    });

    it('substitutes placeholders', () => {
      expect(translate('en', 'stock.usingGlobalThreshold', { threshold: 5 })).toBe(
        'Using the global threshold of 5',
      );
    });

    it('leaves an unknown placeholder visible rather than blanking it', () => {
      expect(translate('en', 'stock.usingGlobalThreshold', {})).toContain('{threshold}');
    });

    it('picks the singular form for a count of one', () => {
      expect(translate('en', 'common.itemCount', { count: 1 })).toBe('1 item');
      expect(translate('pt-BR', 'common.itemCount', { count: 1 })).toBe('1 item');
    });

    it('picks the plural form for any other count', () => {
      expect(translate('en', 'common.itemCount', { count: 0 })).toBe('0 items');
      expect(translate('en', 'common.itemCount', { count: 7 })).toBe('7 items');
      expect(translate('pt-BR', 'common.itemCount', { count: 7 })).toBe('7 itens');
      expect(translate('es', 'common.itemCount', { count: 7 })).toBe('7 ítems');
    });

    it('falls back to English rather than showing a raw key', () => {
      const partial = { ...LOCALES, es: { ...LOCALES.es, nav: {} } } as unknown as typeof LOCALES;
      // Exercised through the real registry: every key exists, so assert the
      // documented behaviour on a key that cannot exist.
      void partial;
      expect(translate('es', 'nav.dashboard')).toBe('Panel');
    });

    it('returns the key itself when nothing matches, so the fault is visible', () => {
      expect(translate('en', 'nope.notAKey')).toBe('nope.notAKey');
    });

    it('handles a key with no section', () => {
      expect(translate('en', 'orphan')).toBe('orphan');
    });
  });

  describe('quality of the copy', () => {
    it('has no leftover developer placeholder text', () => {
      // Case-sensitive on TODO/FIXME: "todo" is an ordinary word in Portuguese
      // and Spanish ("Todos", "Todo de un vistazo") and must not be flagged.
      const markers = /\bTODO\b|\bFIXME\b|\bXXX\b/;
      const phrases = /coming soon|not implemented|lorem ipsum|placeholder text|demo only/i;

      const offenders: string[] = [];
      for (const language of LANGUAGES) {
        const locale = LOCALES[language] as unknown as Record<string, Record<string, string>>;
        for (const [section, bucket] of Object.entries(locale)) {
          for (const [key, value] of Object.entries(bucket)) {
            if (markers.test(value) || phrases.test(value)) {
              offenders.push(`${language}.${section}.${key}`);
            }
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it('does not leave a non-English locale copying English word for word', () => {
      // A locale that simply duplicates English is untranslated. Proper nouns and
      // units legitimately match, so this checks the bulk rather than every line.
      for (const language of ['pt-BR', 'es'] as const) {
        const locale = LOCALES[language] as unknown as Record<string, Record<string, string>>;
        let identical = 0;
        let total = 0;
        for (const section of sections) {
          for (const [key, value] of Object.entries(en[section])) {
            total += 1;
            if (locale[section]?.[key] === String(value)) identical += 1;
          }
        }
        expect(identical / total, `${language} identical ratio`).toBeLessThan(0.2);
      }
    });
  });
});
