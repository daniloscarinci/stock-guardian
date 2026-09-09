/**
 * What the application says on the way in, at every hour and every shape of
 * inventory - and in all three languages, because the greeting is the one
 * sentence here that cannot be translated word for word.
 *
 * Nothing speaks. `composeWelcome` produces a string and this file reads it.
 */
import { describe, expect, it } from 'vitest';
import { composeWelcome, timeOfDay, type WelcomeFacts } from './welcome';
import { translate } from '../../i18n/translate';
import type { Language } from '../../domain/settings';

/** Nothing wrong anywhere, which is the shape most launches have. */
const CALM: WelcomeFacts = {
  expired: 0,
  expiringToday: 0,
  expiringSoon: 0,
  belowMinimum: 0,
  horizonDays: 90,
};

const say = (language: Language, facts: Partial<WelcomeFacts>, hour: number) =>
  composeWelcome((key, values) => translate(language, key, values), { ...CALM, ...facts }, hour);

describe('timeOfDay', () => {
  /*
   * The bands are Portuguese and Spanish, and English is given the same ones.
   * Being told "bom dia" at four in the afternoon is worse than not being
   * greeted at all, which is why this is tested at the edges rather than in the
   * middle of each band.
   */
  it('is morning from five until noon', () => {
    expect(timeOfDay(5)).toBe('morning');
    expect(timeOfDay(11)).toBe('morning');
  });

  it('is afternoon from noon until six', () => {
    expect(timeOfDay(12)).toBe('afternoon');
    expect(timeOfDay(17)).toBe('afternoon');
  });

  it('is evening from six until midnight', () => {
    expect(timeOfDay(18)).toBe('evening');
    expect(timeOfDay(23)).toBe('evening');
  });

  // At three o'clock a Brazilian says boa noite. "Bom dia" there is the same
  // mistake as "good morning" at four in the afternoon, in the other direction.
  it('counts the small hours as night rather than morning', () => {
    expect(timeOfDay(0)).toBe('evening');
    expect(timeOfDay(4)).toBe('evening');
  });
});

describe('composeWelcome', () => {
  describe('the greeting', () => {
    it('uses the three Portuguese greetings', () => {
      expect(say('pt-BR', {}, 9)).toBe('Bom dia. Nada precisa de atenção.');
      expect(say('pt-BR', {}, 15)).toBe('Boa tarde. Nada precisa de atenção.');
      expect(say('pt-BR', {}, 21)).toBe('Boa noite. Nada precisa de atenção.');
    });

    it('uses the three Spanish ones', () => {
      expect(say('es', {}, 9)).toBe('Buenos días. No hay nada que necesite atención.');
      expect(say('es', {}, 15)).toBe('Buenas tardes. No hay nada que necesite atención.');
      expect(say('es', {}, 21)).toBe('Buenas noches. No hay nada que necesite atención.');
    });

    it('uses the English ones', () => {
      expect(say('en', {}, 9)).toBe('Good morning. Nothing needs your attention.');
      expect(say('en', {}, 21)).toBe('Good evening. Nothing needs your attention.');
    });
  });

  /*
   * A greeting alone is a novelty. Every one of these is why somebody would
   * have opened the application anyway, said before they have to look for it.
   */
  describe('what it reports', () => {
    it('names what has already gone off, first', () => {
      expect(say('en', { expired: 3 }, 9)).toBe('Good morning. 3 items have expired.');
      expect(say('pt-BR', { expired: 3 }, 9)).toBe('Bom dia. 3 itens venceram.');
    });

    it('names what goes off today', () => {
      expect(say('en', { expiringToday: 2 }, 9)).toBe('Good morning. 2 items expire today.');
      expect(say('pt-BR', { expiringToday: 2 }, 9)).toBe('Bom dia. 2 itens vencem hoje.');
    });

    /*
     * With the number of days rather than the word "soon". `expiringSoon` is
     * counted against the furthest warning window, so "soon" would be this
     * application's word for something between tomorrow and three months away.
     */
    it('says how far ahead "expiring" reaches, rather than saying soon', () => {
      expect(say('en', { expiringSoon: 3, horizonDays: 7 }, 9)).toBe(
        'Good morning. 3 items expire within 7 days.',
      );
      expect(say('pt-BR', { expiringSoon: 3, horizonDays: 7 }, 9)).toBe(
        'Bom dia. 3 itens vencem nos próximos 7 dias.',
      );
      expect(say('es', { expiringSoon: 3, horizonDays: 7 }, 9)).toBe(
        'Buenos días. 3 ítems vencen en los próximos 7 días.',
      );
    });

    it('names what is below its minimum', () => {
      expect(say('en', { belowMinimum: 4 }, 9)).toBe('Good morning. 4 items are below their minimum.');
    });

    it('says the singular as a word rather than as a numeral', () => {
      expect(say('en', { expired: 1 }, 9)).toBe('Good morning. One item has expired.');
      expect(say('pt-BR', { expired: 1 }, 9)).toBe('Bom dia. Um item venceu.');
      expect(say('es', { expired: 1 }, 9)).toBe('Buenos días. Un ítem ha vencido.');
    });
  });

  describe('how much it is willing to say', () => {
    it('reports two facts, most urgent first', () => {
      expect(say('en', { expired: 2, expiringToday: 1 }, 9)).toBe(
        'Good morning. 2 items have expired. One item expires today.',
      );
    });

    /*
     * A spoken list cannot be scrolled back through, and the screen behind it
     * shows all four at once. Two is what somebody can hold.
     */
    it('stops at two, even when everything is wrong at once', () => {
      expect(
        say('en', { expired: 2, expiringToday: 1, expiringSoon: 9, belowMinimum: 5 }, 9),
      ).toBe('Good morning. 2 items have expired. One item expires today.');
    });

    it('falls through to whatever is left when the urgent ones are clear', () => {
      expect(say('en', { expiringSoon: 9, belowMinimum: 5, horizonDays: 30 }, 9)).toBe(
        'Good morning. 9 items expire within 30 days. 5 items are below their minimum.',
      );
    });

    // Worth saying, and worth saying briefly. An application that answers
    // "everything is fine" in one breath is one somebody keeps switched on.
    it('says so, briefly, when there is nothing to report', () => {
      expect(say('en', {}, 9)).toBe('Good morning. Nothing needs your attention.');
    });

    it('never runs on: one greeting and at most two facts', () => {
      const spoken = say('en', { expired: 2, expiringToday: 1, expiringSoon: 9, belowMinimum: 5 }, 9);
      expect(spoken.split('.').filter((part) => part.trim() !== '')).toHaveLength(3);
    });
  });
});
