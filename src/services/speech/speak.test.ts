import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeaker, inferVoiceGender, listVoices, onVoicesChanged } from './speak';

afterEach(() => vi.unstubAllGlobals());

describe('createSpeaker', () => {
  it('says nothing when the setting is off', async () => {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => [] });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });

    await createSpeaker(() => false).say('doze latas', 'pt-BR');
    expect(speak).not.toHaveBeenCalled();
  });

  it('speaks when the setting is on', async () => {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => [] });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });

    await createSpeaker(() => true).say('doze latas', 'pt-BR');
    expect(speak).toHaveBeenCalledOnce();
  });

  it('does not throw where speechSynthesis does not exist', async () => {
    vi.stubGlobal('speechSynthesis', undefined);
    await expect(createSpeaker(() => true).say('oi', 'pt-BR')).resolves.toBeUndefined();
  });

  it('cancels anything still being spoken before starting', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel, getVoices: () => [] });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });

    await createSpeaker(() => true).say('oi', 'pt-BR');
    expect(cancel).toHaveBeenCalled();
  });

  // An empty answer means "nothing to say now", and the sentence in flight is
  // about a screen the user has already left. The empty-text check used to
  // return before the cancel, so that sentence kept reading.
  it('cancels a sentence in flight even when the new answer is empty', async () => {
    const cancel = vi.fn();
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => [] });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });

    const speaker = createSpeaker(() => true);
    await speaker.say('doze latas', 'pt-BR');
    cancel.mockClear();

    await speaker.say('', 'pt-BR');
    expect(cancel).toHaveBeenCalledOnce();
    // Cancelled, but nothing new queued: an empty string is not a sentence.
    expect(speak).toHaveBeenCalledOnce();
  });

  it('stops what is being spoken', () => {
    const cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel, getVoices: () => [] });

    createSpeaker(() => true).stop();
    expect(cancel).toHaveBeenCalledOnce();
  });

  // `stop()` runs from teardown paths, where refusing to throw matters more
  // than anywhere else - and the setting being off is no reason to leave a
  // sentence already in flight playing on.
  it('stops even when the setting is off', () => {
    const cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel, getVoices: () => [] });

    createSpeaker(() => false).stop();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not throw when stopping where speechSynthesis does not exist', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(() => createSpeaker(() => true).stop()).not.toThrow();
  });

  // The answer names what is in someone's pantry. A server-synthesised voice
  // would send it to a synthesis service, in an application whose claim is that
  // it makes no network request of its own - so a remote voice is never named,
  // even when the platform lists it first and it sounds better.
  describe('voice selection', () => {
    const remote = {
      lang: 'pt-BR',
      localService: false,
      name: 'Remote',
      voiceURI: 'urn:pt-BR/Remote',
    };
    const local = {
      lang: 'pt-BR',
      localService: true,
      name: 'Local',
      voiceURI: 'urn:pt-BR/Local',
    };
    const camila = {
      lang: 'pt-BR',
      localService: true,
      name: 'Camila',
      voiceURI: 'urn:pt-BR/Camila',
    };

    function speakWith(voices: readonly unknown[]) {
      const speak = vi.fn();
      vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => voices });
      vi.stubGlobal(
        'SpeechSynthesisUtterance',
        class {
          lang = '';
          voice: unknown = undefined;
          constructor(public text: string) {}
        },
      );
      return speak;
    }

    /** The utterance the platform was handed. */
    function spoken(speak: ReturnType<typeof vi.fn>) {
      return speak.mock.calls[0]?.[0] as {
        voice?: { name: string } | undefined;
        lang: string;
        text: string;
      };
    }

    it('never picks a remote voice, even when it is listed first', async () => {
      const speak = speakWith([remote, local]);
      await createSpeaker(() => true).say('doze latas', 'pt-BR');

      expect(spoken(speak).voice?.name).toBe('Local');
    });

    it('names no voice at all rather than falling back to a remote one', async () => {
      const speak = speakWith([remote]);
      await createSpeaker(() => true).say('doze latas', 'pt-BR');

      // `lang` alone is left to the platform. That can still resolve to a remote
      // voice - the API offers no way to refuse - which is why the docs call
      // this a best effort rather than a guarantee.
      expect(spoken(speak).voice).toBeUndefined();
      expect(spoken(speak).lang).toBe('pt-BR');
    });

    it('ignores a local voice in another language', async () => {
      const speak = speakWith([{ lang: 'en-US', localService: true, name: 'English' }]);
      await createSpeaker(() => true).say('doze latas', 'pt-BR');

      expect(spoken(speak).voice).toBeUndefined();
    });

    /*
     * The setting arrived after all of the above, and none of it moved. An
     * empty stored value is the default and has to behave exactly like the
     * one-argument form the sheet used before there was a setting at all.
     */
    describe('with nothing stored', () => {
      it('makes the same local-first choice as the form that takes no voice', async () => {
        const speak = speakWith([remote, local]);
        await createSpeaker(
          () => true,
          () => '',
        ).say('doze latas', 'pt-BR');

        expect(spoken(speak).voice?.name).toBe('Local');
      });

      it('still refuses a remote voice rather than naming one', async () => {
        const speak = speakWith([remote]);
        await createSpeaker(
          () => true,
          () => '',
        ).say('doze latas', 'pt-BR');

        expect(spoken(speak).voice).toBeUndefined();
      });

      it('still ignores a local voice in another language', async () => {
        const speak = speakWith([{ lang: 'en-US', localService: true, name: 'Karen' }]);
        await createSpeaker(
          () => true,
          () => '',
        ).say('doze latas', 'pt-BR');

        expect(spoken(speak).voice).toBeUndefined();
      });
    });

    describe('with a voice stored', () => {
      it('uses it when the device has it', async () => {
        const speak = speakWith([local, camila]);
        await createSpeaker(
          () => true,
          () => 'urn:pt-BR/Camila',
        ).say('doze latas', 'pt-BR');

        expect(spoken(speak).voice?.name).toBe('Camila');
      });

      /*
       * The one place a remote voice is allowed, and it is allowed because
       * somebody chose it in front of a label saying the sentences are
       * synthesised on a server. The automatic path still refuses; this is not
       * the automatic path.
       */
      it('honours a remote one, which is the decision the user made', async () => {
        const speak = speakWith([local, remote]);
        await createSpeaker(
          () => true,
          () => 'urn:pt-BR/Remote',
        ).say('doze latas', 'pt-BR');

        expect(spoken(speak).voice?.name).toBe('Remote');
      });

      /*
       * `voiceURI` is what is stored, but some engines shuffle it between
       * releases and keep the display name. Matching either rescues a choice
       * that would otherwise revert without anyone being told.
       */
      it('matches on the name too, so a changed voiceURI does not lose the choice', async () => {
        const renamed = {
          lang: 'pt-BR',
          localService: true,
          name: 'Camila',
          voiceURI: 'urn:pt-BR/Camila-v2',
        };
        const speak = speakWith([local, renamed]);
        await createSpeaker(
          () => true,
          () => 'Camila',
        ).say('doze latas', 'pt-BR');

        expect(spoken(speak).voice?.name).toBe('Camila');
      });

      /*
       * A voice vanishes for ordinary reasons: a language pack uninstalled, a
       * phone restored from another phone's backup, the interface switched to a
       * language the voice does not speak. None of them may end in silence.
       */
      it('falls back to the local-first choice when it has gone, and still speaks', async () => {
        const speak = speakWith([remote, local]);
        await createSpeaker(
          () => true,
          () => 'urn:pt-BR/Uninstalled',
        ).say('doze latas', 'pt-BR');

        expect(speak).toHaveBeenCalledOnce();
        expect(spoken(speak).voice?.name).toBe('Local');
      });

      it('speaks with no voice named when it has gone and no local one matches', async () => {
        const speak = speakWith([remote]);
        await createSpeaker(
          () => true,
          () => 'urn:pt-BR/Uninstalled',
        ).say('doze latas', 'pt-BR');

        expect(speak).toHaveBeenCalledOnce();
        expect(spoken(speak).voice).toBeUndefined();
        expect(spoken(speak).lang).toBe('pt-BR');
      });

      it('never selects one belonging to another language', async () => {
        const karen = {
          lang: 'en-US',
          localService: true,
          name: 'Karen',
          voiceURI: 'urn:en-US/Karen',
        };
        const speak = speakWith([karen, local]);
        await createSpeaker(
          () => true,
          () => 'urn:en-US/Karen',
        ).say('doze latas', 'pt-BR');

        expect(spoken(speak).voice?.name).toBe('Local');
      });

      /*
       * `getVoices()` is empty on the first call in Chrome and the list arrives
       * with `voiceschanged` some milliseconds later. A sentence spoken in that
       * window names no voice and is read by the platform's own - which is what
       * happened before the setting existed, and is not silence.
       */
      it('speaks anyway while getVoices() is still empty', async () => {
        const speak = speakWith([]);
        await createSpeaker(
          () => true,
          () => 'urn:pt-BR/Camila',
        ).say('doze latas', 'pt-BR');

        expect(speak).toHaveBeenCalledOnce();
        expect(spoken(speak).voice).toBeUndefined();
        expect(spoken(speak).text).toBe('doze latas');
      });

      /*
       * Read on every sentence rather than captured when the speaker was built,
       * so a voice that loads a moment after the page does is used by the next
       * answer with nothing rebuilt.
       */
      it('picks up a voice that appears after the speaker was built', async () => {
        let voices: readonly unknown[] = [];
        const speak = vi.fn();
        vi.stubGlobal('speechSynthesis', {
          speak,
          cancel: vi.fn(),
          getVoices: () => voices,
        });
        vi.stubGlobal(
          'SpeechSynthesisUtterance',
          class {
            lang = '';
            voice: unknown = undefined;
            constructor(public text: string) {}
          },
        );

        const speaker = createSpeaker(
          () => true,
          () => 'urn:pt-BR/Camila',
        );
        await speaker.say('doze latas', 'pt-BR');
        expect((speak.mock.calls[0]?.[0] as { voice?: unknown }).voice).toBeUndefined();

        voices = [camila];
        await speaker.say('treze latas', 'pt-BR');
        expect((speak.mock.calls[1]?.[0] as { voice?: { name: string } }).voice?.name).toBe(
          'Camila',
        );
      });
    });
  });
});

/*
 * The guess, and everything it refuses to guess at.
 *
 * These are the shapes real devices produce, not invented ones: Google TTS
 * identifiers with and without the `#female` marker, engines that write the
 * word out in Portuguese, Apple and Microsoft voices named after people, and
 * the opaque three-letter codes that a stock Android phone actually ships.
 */
describe('inferVoiceGender', () => {
  describe('the marker the engine writes out', () => {
    it('reads #female and #male out of a Google TTS identifier', () => {
      expect(inferVoiceGender('pt-br-x-afm#female_1-local')).toBe('female');
      expect(inferVoiceGender('en-us-x-tpf#male_2-network')).toBe('male');
    });
  });

  describe('the word, spelled out', () => {
    it('reads the Portuguese words a plain engine name uses', () => {
      expect(inferVoiceGender('Português (Brasil) - Feminino')).toBe('female');
      expect(inferVoiceGender('Português (Brasil) - Masculino')).toBe('male');
    });

    it('reads the Spanish and English ones', () => {
      expect(inferVoiceGender('Español de España — Femenina')).toBe('female');
      expect(inferVoiceGender('Spanish (Spain) Male')).toBe('male');
      expect(inferVoiceGender('English (UK) Female')).toBe('female');
    });

    it('does not read "female" as "male"', () => {
      // `\bmale\b` inside `female` is the classic way to get this backwards.
      expect(inferVoiceGender('Voice Female')).toBe('female');
      expect(inferVoiceGender('woman')).toBe('female');
    });

    it('ignores case and accents', () => {
      expect(inferVoiceGender('VOZ MASCULINA')).toBe('male');
      expect(inferVoiceGender('Mónica')).toBe('female');
    });
  });

  describe('the given name', () => {
    it('recognises voices Apple and Microsoft ship', () => {
      expect(inferVoiceGender('Luciana')).toBe('female');
      expect(inferVoiceGender('Felipe')).toBe('male');
      expect(inferVoiceGender('Microsoft Maria - Portuguese (Brazil)')).toBe('female');
      expect(inferVoiceGender('Microsoft Daniel - Portuguese (Brazil)')).toBe('male');
    });

    it('matches whole words only, so Alexandra is not Alex', () => {
      expect(inferVoiceGender('Alex')).toBe('male');
      expect(inferVoiceGender('Alexandra')).toBeNull();
    });
  });

  /*
   * THE IMPORTANT HALF. A guess presented as a fact is worse than no guess, and
   * these are the names where nothing can honestly be said.
   */
  describe('names that give nothing away', () => {
    /*
     * The identifiers a stock Android phone actually lists. Reading the last
     * letter of `afm` as a gender is tempting and does not survive the rest of
     * the set - `en-gb-x-gba`, `gbb`, `gbc` and `gbd` are four voices of mixed
     * gender lettered in sequence.
     */
    it('refuses to decode Google TTS three-letter codes', () => {
      expect(inferVoiceGender('pt-br-x-afm-local')).toBeNull();
      expect(inferVoiceGender('pt-br-x-pte-network')).toBeNull();
      expect(inferVoiceGender('en-gb-x-gbb-local')).toBeNull();
      expect(inferVoiceGender('es-es-x-eef-local')).toBeNull();
    });

    it('says nothing about a voice named only for its language', () => {
      expect(inferVoiceGender('Google português do Brasil')).toBeNull();
      expect(inferVoiceGender('Portuguese (Brazil)')).toBeNull();
    });

    it('says nothing about a name that ships as both', () => {
      // Apple's Eddy, Flo, Reed, Rocko, Sandy and Shelley now come in male and
      // female variants under one name. Neither table has them, on purpose.
      expect(inferVoiceGender('Eddy (Português (Brasil))')).toBeNull();
      expect(inferVoiceGender('Shelley (Español (España))')).toBeNull();
    });

    it('says nothing about an empty name', () => {
      expect(inferVoiceGender('')).toBeNull();
    });
  });
});

describe('listVoices', () => {
  function withVoices(voices: readonly unknown[]) {
    vi.stubGlobal('speechSynthesis', { getVoices: () => voices });
  }

  const voice = (
    name: string,
    lang: string,
    localService = true,
    voiceURI = `urn:${lang}/${name}`,
  ) => ({ name, lang, localService, voiceURI });

  it('is empty where there is no speechSynthesis at all', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(listVoices('pt-BR')).toEqual([]);
  });

  it('is empty where speechSynthesis cannot list voices', () => {
    vi.stubGlobal('speechSynthesis', {});
    expect(listVoices('pt-BR')).toEqual([]);
  });

  /*
   * The empty first call, from the picker's side. An empty list is a legitimate
   * answer and must not throw or invent anything - SettingsScreen decides
   * whether it means "still asking" or "this device has none".
   */
  it('is empty, and not broken, while the platform is still loading its voices', () => {
    withVoices([]);
    expect(listVoices('pt-BR')).toEqual([]);
  });

  it('offers only the language being spoken', () => {
    withVoices([voice('Luciana', 'pt-BR'), voice('Karen', 'en-US'), voice('Monica', 'es-ES')]);
    expect(listVoices('pt-BR').map((v) => v.name)).toEqual(['Luciana']);
  });

  /*
   * The interface tags are `en`, `pt-BR` and `es`; the voices are `en-GB`,
   * `pt-PT`, `es-419`. Matching on the exact tag would leave an English user
   * with an empty menu, so the match is on the primary subtag and the list
   * shows the region.
   */
  it('matches on the primary subtag, so an "en" interface is not left with nothing', () => {
    withVoices([voice('Daniel', 'en-GB'), voice('Karen', 'en-US'), voice('Luciana', 'pt-BR')]);
    expect(listVoices('en').map((v) => v.name).sort()).toEqual(['Daniel', 'Karen']);
  });

  it('offers a pt-PT voice to a pt-BR interface, below the pt-BR ones', () => {
    withVoices([voice('Joana', 'pt-PT'), voice('Luciana', 'pt-BR')]);
    expect(listVoices('pt-BR').map((v) => v.name)).toEqual(['Luciana', 'Joana']);
  });

  it('puts on-device voices above server-synthesised ones', () => {
    withVoices([voice('Remota', 'pt-BR', false), voice('Local', 'pt-BR', true)]);
    expect(listVoices('pt-BR').map((v) => v.name)).toEqual(['Local', 'Remota']);
  });

  it('orders the rest by name, so the menu does not shuffle between renders', () => {
    withVoices([voice('Zeta', 'pt-BR'), voice('Alfa', 'pt-BR')]);
    expect(listVoices('pt-BR').map((v) => v.name)).toEqual(['Alfa', 'Zeta']);
  });

  it('carries the guess, and the null where there is none', () => {
    withVoices([voice('Luciana', 'pt-BR'), voice('pt-br-x-afm-local', 'pt-BR')]);
    expect(listVoices('pt-BR').map((v) => v.gender)).toEqual(['female', null]);
  });

  it('carries what a label needs: the identifier, the name, the tag and locality', () => {
    withVoices([voice('Joana', 'pt-PT', false, 'urn:joana')]);
    expect(listVoices('pt-BR')).toEqual([
      {
        voiceURI: 'urn:joana',
        name: 'Joana',
        lang: 'pt-PT',
        localService: false,
        gender: 'female',
      },
    ]);
  });
});

describe('onVoicesChanged', () => {
  it('subscribes to the event the platform fires when the list arrives', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal('speechSynthesis', { addEventListener, removeEventListener });

    const listener = vi.fn();
    const unsubscribe = onVoicesChanged(listener);
    expect(addEventListener).toHaveBeenCalledWith('voiceschanged', listener);

    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith('voiceschanged', listener);
  });

  // A device that cannot tell us is a device whose first list is its only one.
  // Unsubscribing still has to be safe, because a component will call it.
  it('returns a harmless unsubscribe where there is no speechSynthesis', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(() => {
      onVoicesChanged(vi.fn())();
    }).not.toThrow();
  });

  it('returns a harmless unsubscribe where the event cannot be subscribed to', () => {
    vi.stubGlobal('speechSynthesis', { getVoices: () => [] });
    expect(() => {
      onVoicesChanged(vi.fn())();
    }).not.toThrow();
  });
});
