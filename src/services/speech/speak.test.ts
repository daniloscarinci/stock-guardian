import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The seam has two sides, and both are exercised here in one process.
 *
 * `speak.ts` asks `isNativeAndroid()` on every call rather than resolving a
 * platform once, so flipping the two fields below is enough to send the next
 * sentence down the other path. The plugin proxies are created when the modules
 * load, so the mock has to exist before the import: `vi.mock` is hoisted above
 * it, and the state lives in a factory-scoped object because the factory may not
 * close over anything declared later in the file.
 *
 * NOTHING HERE SPEAKS. Both engines are stubs.
 */
const capacitor = vi.hoisted(() => ({
  native: false,
  platform: 'web',
  tts: {
    speak: vi.fn(async (_options: { text: string; lang: string; voice: string }) => undefined),
    stop: vi.fn(async () => undefined),
    voices: vi.fn(async (_options: { lang: string }) => ({ voices: [] as unknown[] })),
    isAvailable: vi.fn(async (_options: { lang: string }) => ({ available: true })),
    isSpeaking: vi.fn(async () => ({ speaking: false })),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitor.native,
    getPlatform: () => capacitor.platform,
  },
  registerPlugin: (name: string) =>
    name === 'Tts' ? capacitor.tts : { isSilent: async () => ({ silent: false }) },
}));

const { createSpeaker, inferVoiceGender, isSpeaking, listVoices, onVoicesChanged, speechAvailable } =
  await import('./speak');

/** Pretends the code is running inside the APK. */
function onAndroid(): void {
  capacitor.native = true;
  capacitor.platform = 'android';
}

beforeEach(() => {
  capacitor.native = false;
  capacitor.platform = 'web';
  capacitor.tts.voices.mockResolvedValue({ voices: [] });
  capacitor.tts.isAvailable.mockResolvedValue({ available: true });
  capacitor.tts.isSpeaking.mockResolvedValue({ speaking: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

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

  const names = async (tag: string) => (await listVoices(tag)).voices.map((v) => v.name);

  it('is empty where there is no speechSynthesis at all', async () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(await listVoices('pt-BR')).toEqual({ voices: [], settled: true });
  });

  it('is empty where speechSynthesis cannot list voices', async () => {
    vi.stubGlobal('speechSynthesis', {});
    expect(await listVoices('pt-BR')).toEqual({ voices: [], settled: true });
  });

  /*
   * The empty first call, from the picker's side. An empty list is a legitimate
   * answer and must not throw or invent anything - and it is reported as NOT
   * settled, which is how SettingsScreen tells "still asking" from "this device
   * has none".
   */
  it('is empty, unsettled and not broken while the platform is still loading', async () => {
    withVoices([]);
    expect(await listVoices('pt-BR')).toEqual({ voices: [], settled: false });
  });

  it('is settled once the platform has listed something', async () => {
    withVoices([voice('Luciana', 'pt-BR')]);
    expect((await listVoices('pt-BR')).settled).toBe(true);
  });

  it('offers only the language being spoken', async () => {
    withVoices([voice('Luciana', 'pt-BR'), voice('Karen', 'en-US'), voice('Monica', 'es-ES')]);
    expect(await names('pt-BR')).toEqual(['Luciana']);
  });

  /*
   * The interface tags are `en`, `pt-BR` and `es`; the voices are `en-GB`,
   * `pt-PT`, `es-419`. Matching on the exact tag would leave an English user
   * with an empty menu, so the match is on the primary subtag and the list
   * shows the region.
   */
  it('matches on the primary subtag, so an "en" interface is not left with nothing', async () => {
    withVoices([voice('Daniel', 'en-GB'), voice('Karen', 'en-US'), voice('Luciana', 'pt-BR')]);
    expect((await names('en')).sort()).toEqual(['Daniel', 'Karen']);
  });

  it('offers a pt-PT voice to a pt-BR interface, below the pt-BR ones', async () => {
    withVoices([voice('Joana', 'pt-PT'), voice('Luciana', 'pt-BR')]);
    expect(await names('pt-BR')).toEqual(['Luciana', 'Joana']);
  });

  it('puts on-device voices above server-synthesised ones', async () => {
    withVoices([voice('Remota', 'pt-BR', false), voice('Local', 'pt-BR', true)]);
    expect(await names('pt-BR')).toEqual(['Local', 'Remota']);
  });

  it('orders the rest by name, so the menu does not shuffle between renders', async () => {
    withVoices([voice('Zeta', 'pt-BR'), voice('Alfa', 'pt-BR')]);
    expect(await names('pt-BR')).toEqual(['Alfa', 'Zeta']);
  });

  it('carries the guess, and the null where there is none', async () => {
    withVoices([voice('Luciana', 'pt-BR'), voice('pt-br-x-afm-local', 'pt-BR')]);
    expect((await listVoices('pt-BR')).voices.map((v) => v.gender)).toEqual(['female', null]);
  });

  it('carries what a label needs: the identifier, the name, the tag and locality', async () => {
    withVoices([voice('Joana', 'pt-PT', false, 'urn:joana')]);
    expect((await listVoices('pt-BR')).voices).toEqual([
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

describe('the automatic local-first choice, across language tags', () => {
  // LOCALE_TAGS says 'en' and 'es'; real voices say 'en-US', 'es-ES'. A strict
  // comparison matched neither, so the local-first preference - the reason this
  // prefers localService at all - did nothing for two languages out of three.
  const local = (lang: string, name: string) => ({ lang, name, voiceURI: name, localService: true });
  const remote = (lang: string, name: string) => ({ lang, name, voiceURI: name, localService: false });

  function spoken(voices: readonly unknown[], tag: string) {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => voices });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      lang = ''; voice: unknown = undefined; constructor(public text: string) {}
    });
    return { speak, say: () => createSpeaker(() => true).say('doze latas', tag) };
  }

  it('finds a local en-US voice for the tag "en"', async () => {
    const { speak, say } = spoken([remote('en-US', 'Remote'), local('en-US', 'Local')], 'en');
    await say();
    expect((speak.mock.calls[0]?.[0] as { voice?: { name: string } }).voice?.name).toBe('Local');
  });

  it('finds a local es-ES voice for the tag "es"', async () => {
    const { speak, say } = spoken([local('es-ES', 'Jorge')], 'es');
    await say();
    expect((speak.mock.calls[0]?.[0] as { voice?: { name: string } }).voice?.name).toBe('Jorge');
  });

  it('prefers the exact region over a sibling of the same language', async () => {
    const { speak, say } = spoken([local('pt-PT', 'Joana'), local('pt-BR', 'Luciana')], 'pt-BR');
    await say();
    expect((speak.mock.calls[0]?.[0] as { voice?: { name: string } }).voice?.name).toBe('Luciana');
  });

  it('still names no voice at all rather than a remote one', async () => {
    const { speak, say } = spoken([remote('en-US', 'Remote')], 'en');
    await say();
    expect((speak.mock.calls[0]?.[0] as { voice?: unknown }).voice).toBeUndefined();
  });

  it('does not cross languages', async () => {
    const { speak, say } = spoken([local('pt-BR', 'Luciana')], 'en');
    await say();
    expect((speak.mock.calls[0]?.[0] as { voice?: unknown }).voice).toBeUndefined();
  });
});

/*
 * THE SEAM ITSELF.
 *
 * Everything above this point tests the browser side, which is the one that
 * always worked. These are about the choice between the two, and about the
 * behaviours that had to survive being moved: the ones the browser path learned
 * the hard way now have to be true on a phone as well, where the whole feature
 * was silent.
 */
describe('the seam', () => {
  function withSynthesis() {
    const speak = vi.fn();
    const cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => [] });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        lang = '';
        voice: unknown = undefined;
        constructor(public text: string) {}
      },
    );
    return { speak, cancel };
  }

  /** The engine's own name for a voice, in the shape TtsPlugin reports it. */
  const nativeVoice = (
    name: string,
    lang: string,
    networkRequired = false,
    features: string[] = [],
  ) => ({ name, lang, networkRequired, features });

  /** What the plugin was asked to say. */
  function saidNatively(index = 0) {
    const asked = capacitor.tts.speak.mock.calls[index]?.[0];
    if (asked === undefined) throw new Error('The plugin was never asked to say anything.');
    return asked;
  }

  describe('which engine reads the sentence', () => {
    it('uses the browser off Android', async () => {
      const { speak } = withSynthesis();
      await createSpeaker(() => true).say('doze latas', 'pt-BR');

      expect(speak).toHaveBeenCalledOnce();
      expect(capacitor.tts.speak).not.toHaveBeenCalled();
    });

    /*
     * The whole point. Inside the APK `speechSynthesis` EXISTS - it is stubbed
     * here for that reason - and it does nothing, so the seam must not reach it
     * however healthy it looks.
     */
    it('uses the plugin on Android, even though speechSynthesis is there', async () => {
      const { speak } = withSynthesis();
      onAndroid();
      await createSpeaker(() => true).say('doze latas', 'pt-BR');

      expect(capacitor.tts.speak).toHaveBeenCalledOnce();
      expect(saidNatively().text).toBe('doze latas');
      expect(saidNatively().lang).toBe('pt-BR');
      expect(speak).not.toHaveBeenCalled();
    });

    it('is not native on an iOS build either, which has no such plugin', async () => {
      const { speak } = withSynthesis();
      capacitor.native = true;
      capacitor.platform = 'ios';
      await createSpeaker(() => true).say('doze latas', 'pt-BR');

      expect(speak).toHaveBeenCalledOnce();
      expect(capacitor.tts.speak).not.toHaveBeenCalled();
    });

    // Asked per call rather than resolved once, so a speaker built before the
    // platform was known is not wrong forever.
    it('asks again on the next sentence rather than remembering', async () => {
      withSynthesis();
      const speaker = createSpeaker(() => true);
      await speaker.say('primeiro', 'pt-BR');
      onAndroid();
      await speaker.say('segundo', 'pt-BR');

      expect(capacitor.tts.speak).toHaveBeenCalledOnce();
      expect(saidNatively().text).toBe('segundo');
    });
  });

  describe('what the native path had to keep', () => {
    it('says nothing when the setting is off', async () => {
      onAndroid();
      await createSpeaker(() => false).say('doze latas', 'pt-BR');
      expect(capacitor.tts.speak).not.toHaveBeenCalled();
    });

    /*
     * Empty means "nothing to say now", and the sentence in flight is about a
     * screen the user has already left. It is stopped and nothing replaces it -
     * the same thing the browser path does with `cancel()`.
     */
    it('stops a sentence in flight when the new answer is empty, and queues nothing', async () => {
      onAndroid();
      await createSpeaker(() => true).say('', 'pt-BR');

      expect(capacitor.tts.stop).toHaveBeenCalledOnce();
      expect(capacitor.tts.speak).not.toHaveBeenCalled();
    });

    it('stops even when the setting is off', () => {
      onAndroid();
      createSpeaker(() => false).stop();
      expect(capacitor.tts.stop).toHaveBeenCalledOnce();
    });

    /*
     * The local-first preference, which is what stops a sentence naming
     * somebody's pantry being synthesised on a server. On Android it rests on
     * `isNetworkConnectionRequired()`, which the engine states rather than the
     * browser summarising.
     */
    it('never names a network voice, even when it is listed first', async () => {
      onAndroid();
      capacitor.tts.voices.mockResolvedValue({
        voices: [nativeVoice('pt-br-x-pte-network', 'pt-BR', true), nativeVoice('pt-br-x-afm-local', 'pt-BR')],
      });

      await createSpeaker(() => true).say('doze latas', 'pt-BR');
      expect(saidNatively().voice).toBe('pt-br-x-afm-local');
    });

    it('names no voice at all rather than falling back to a network one', async () => {
      onAndroid();
      capacitor.tts.voices.mockResolvedValue({
        voices: [nativeVoice('pt-br-x-pte-network', 'pt-BR', true)],
      });

      await createSpeaker(() => true).say('doze latas', 'pt-BR');
      // The engine is left to choose from the language alone, which is what
      // happened before there was a preference at all. Not silence.
      expect(saidNatively().voice).toBe('');
      expect(saidNatively().lang).toBe('pt-BR');
    });

    it('honours a stored voice, including a network one the user chose', async () => {
      onAndroid();
      capacitor.tts.voices.mockResolvedValue({
        voices: [nativeVoice('pt-br-x-afm-local', 'pt-BR'), nativeVoice('pt-br-x-pte-network', 'pt-BR', true)],
      });

      await createSpeaker(
        () => true,
        () => 'pt-br-x-pte-network',
      ).say('doze latas', 'pt-BR');

      expect(saidNatively().voice).toBe('pt-br-x-pte-network');
    });

    it('falls back to the local-first choice when the stored voice has gone', async () => {
      onAndroid();
      capacitor.tts.voices.mockResolvedValue({
        voices: [nativeVoice('pt-br-x-afm-local', 'pt-BR')],
      });

      await createSpeaker(
        () => true,
        () => 'pt-br-x-uninstalled-local',
      ).say('doze latas', 'pt-BR');

      expect(capacitor.tts.speak).toHaveBeenCalledOnce();
      expect(saidNatively().voice).toBe('pt-br-x-afm-local');
    });

    it('never crosses languages', async () => {
      onAndroid();
      capacitor.tts.voices.mockResolvedValue({
        voices: [nativeVoice('en-us-x-tpf-local', 'en-US')],
      });

      await createSpeaker(() => true).say('doze latas', 'pt-BR');
      expect(saidNatively().voice).toBe('');
    });

    /*
     * An engine that will not enumerate is not an engine that cannot speak, and
     * a preference must never cost somebody their speech - which is the bug this
     * release exists to end.
     */
    it('still speaks when the voice list cannot be read', async () => {
      onAndroid();
      capacitor.tts.voices.mockRejectedValue(new Error('no such plugin'));

      await createSpeaker(() => true).say('doze latas', 'pt-BR');
      expect(saidNatively().text).toBe('doze latas');
      expect(saidNatively().voice).toBe('');
    });

    // An older APK, or an engine that never initialised. The rejection reaches
    // whichever screen asked for the answer, and must not throw through it.
    it('does not throw when the plugin rejects the sentence itself', async () => {
      onAndroid();
      capacitor.tts.speak.mockRejectedValueOnce(new Error('no-engine'));

      await expect(createSpeaker(() => true).say('doze latas', 'pt-BR')).resolves.toBeUndefined();
    });

    it('does not throw when stopping through a plugin that rejects', () => {
      onAndroid();
      capacitor.tts.stop.mockRejectedValueOnce(new Error('no-engine'));

      expect(() => {
        createSpeaker(() => true).stop();
      }).not.toThrow();
    });
  });

  /*
   * THE VOICE PICKER, ON A PHONE WHOSE `getVoices()` WAS ALWAYS EMPTY. This is
   * the list Settings has never once been able to show.
   */
  describe('listing the engine voices', () => {
    it('maps the native payload into what the picker reads', async () => {
      onAndroid();
      capacitor.tts.voices.mockResolvedValue({
        voices: [nativeVoice('pt-br-x-pte#male_1-network', 'pt-BR', true, ['networkTts'])],
      });

      expect(await listVoices('pt-BR')).toEqual({
        settled: true,
        voices: [
          {
            voiceURI: 'pt-br-x-pte#male_1-network',
            name: 'pt-br-x-pte#male_1-network',
            lang: 'pt-BR',
            localService: false,
            gender: 'male',
          },
        ],
      });
    });

    /*
     * THE MARKER THE WEB API NEVER CARRIED. `inferVoiceGender` has trusted
     * `#female` above everything else since it was written, and never saw one:
     * the browser list inside the APK is empty, and `speechSynthesis` renames
     * these voices to prose anyway. This is the pattern finally reaching it.
     */
    it('carries the #female marker through to the guess', async () => {
      onAndroid();
      capacitor.tts.voices.mockResolvedValue({
        voices: [nativeVoice('pt-br-x-afm#female_1-local', 'pt-BR')],
      });

      const [voice] = (await listVoices('pt-BR')).voices;
      expect(voice?.gender).toBe('female');
      // And the engine's own name is kept, because it is the only label there
      // is for a voice nobody can describe any better.
      expect(voice?.name).toBe('pt-br-x-afm#female_1-local');
    });

    it('leaves out a voice whose data has not been downloaded', async () => {
      onAndroid();
      capacitor.tts.voices.mockResolvedValue({
        voices: [
          nativeVoice('pt-br-x-afm-local', 'pt-BR'),
          nativeVoice('pt-br-x-pte-network', 'pt-BR', true, ['notInstalled']),
        ],
      });

      expect((await listVoices('pt-BR')).voices.map((v) => v.name)).toEqual(['pt-br-x-afm-local']);
    });

    it('orders on-device above network, then by name', async () => {
      onAndroid();
      capacitor.tts.voices.mockResolvedValue({
        voices: [
          nativeVoice('zeta-network', 'pt-BR', true),
          nativeVoice('zeta-local', 'pt-BR'),
          nativeVoice('alfa-local', 'pt-BR'),
        ],
      });

      expect((await listVoices('pt-BR')).voices.map((v) => v.name)).toEqual([
        'alfa-local',
        'zeta-local',
        'zeta-network',
      ]);
    });

    /*
     * Settled on the first answer, always. The plugin waits for the engine to
     * initialise before answering, so unlike the browser there is no later list
     * to hold a picker open for - and an empty answer here is a real "this
     * device has no voice for this language" rather than "ask again".
     */
    it('is settled even when the engine has nothing, so the picker stops waiting', async () => {
      onAndroid();
      capacitor.tts.voices.mockResolvedValue({ voices: [] });

      expect(await listVoices('pt-BR')).toEqual({ voices: [], settled: true });
    });

    it('reports an empty settled list rather than throwing when the plugin fails', async () => {
      onAndroid();
      capacitor.tts.voices.mockRejectedValue(new Error('no-engine'));

      expect(await listVoices('pt-BR')).toEqual({ voices: [], settled: true });
    });

    it('subscribes to nothing on Android, and unsubscribing is harmless', () => {
      onAndroid();
      expect(() => {
        onVoicesChanged(vi.fn())();
      }).not.toThrow();
    });
  });

  describe('whether this device can speak at all', () => {
    it('asks the engine on Android', async () => {
      onAndroid();
      capacitor.tts.isAvailable.mockResolvedValue({ available: false });

      expect(await speechAvailable('pt-BR')).toBe(false);
      expect(capacitor.tts.isAvailable).toHaveBeenCalledWith({ lang: 'pt-BR' });
    });

    /*
     * AN ENGINE THAT NEVER INITIALISES REPORTS RATHER THAN HANGING. TtsPlugin
     * gives up after five seconds and rejects with `no-engine`; here that is a
     * plain false, which is what puts a sentence in front of somebody instead of
     * a button that does nothing.
     */
    it('reports false rather than hanging when the engine never starts', async () => {
      onAndroid();
      capacitor.tts.isAvailable.mockRejectedValue(new Error('no-engine'));

      await expect(speechAvailable('pt-BR')).resolves.toBe(false);
    });

    it('is true in a browser that has the API, and false in one that does not', async () => {
      withSynthesis();
      await expect(speechAvailable('pt-BR')).resolves.toBe(true);

      vi.stubGlobal('speechSynthesis', undefined);
      await expect(speechAvailable('pt-BR')).resolves.toBe(false);
    });
  });

  /*
   * What the welcome asks before it says good morning. Anything else that
   * speaks does so because a person asked for it, and may interrupt.
   */
  describe('whether something is already being read', () => {
    it('asks the engine on Android', async () => {
      onAndroid();
      capacitor.tts.isSpeaking.mockResolvedValue({ speaking: true });
      await expect(isSpeaking()).resolves.toBe(true);
    });

    it('counts a queued sentence in the browser as well as a playing one', async () => {
      vi.stubGlobal('speechSynthesis', { speaking: false, pending: true });
      await expect(isSpeaking()).resolves.toBe(true);
    });

    it('is false where there is no speechSynthesis', async () => {
      vi.stubGlobal('speechSynthesis', undefined);
      await expect(isSpeaking()).resolves.toBe(false);
    });

    // Failing to false, so a bridge that will not answer can never leave the
    // welcome permanently convinced that something else is talking.
    it('is false when the plugin will not answer', async () => {
      onAndroid();
      capacitor.tts.isSpeaking.mockRejectedValue(new Error('no-engine'));
      await expect(isSpeaking()).resolves.toBe(false);
    });
  });
});
