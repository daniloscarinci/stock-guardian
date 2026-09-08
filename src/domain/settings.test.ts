import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('settings', () => {
  describe('asking defaults', () => {
    it('defaults the ask button on, and speaking on', () => {
      expect(DEFAULT_SETTINGS.askEnabled).toBe(true);
      expect(DEFAULT_SETTINGS.voiceSpeakAnswers).toBe(true);
    });

    /*
     * The refusal, off by default - which is not the same as the microphone
     * being online. Every listen still starts on the device; what this permits
     * is the second attempt after the device has failed, and the sheet marks
     * the exchanges that took it. Asserted on its own because it is the one
     * setting that governs whether a recording can ever leave.
     */
    it('defaults the on-device-only refusal OFF', () => {
      expect(DEFAULT_SETTINGS.voiceOfflineOnly).toBe(false);
    });

    it('leaves it off for a database that predates the setting', () => {
      const { settings } = parseSettings([{ key: 'askEnabled', value: 'true' }]);
      expect(settings.voiceOfflineOnly).toBe(false);
    });

    /*
     * `voiceAllowOnline` became `voiceOfflineOnly`, and the old row is not
     * migrated in either direction. `seedDatabase` writes every default on
     * first run, so a stored `voiceAllowOnline: false` says "this install was
     * never touched" far more often than it says "somebody refused the
     * network" - and reading it as the latter would restore the dead
     * microphone for everyone who never had an opinion.
     */
    it('does not read a stored voiceAllowOnline into the refusal, either way', () => {
      for (const value of ['false', 'true']) {
        const { settings } = parseSettings([{ key: 'voiceAllowOnline', value }]);
        expect(settings.voiceOfflineOnly).toBe(false);
      }
    });

    /*
     * `voiceEnabled` became `askEnabled` when the microphone went. The old row
     * is unread for the same reason, and the key falls back to its default -
     * which is `true`, exactly as the old default was.
     */
    it('does not read a stored voiceEnabled into the ask button', () => {
      const { settings } = parseSettings([{ key: 'voiceEnabled', value: 'false' }]);
      expect(settings.askEnabled).toBe(true);
    });
  });

  /*
   * WHICH voice reads the answers, and the reason it is not a gender.
   *
   * `SpeechSynthesisVoice` has a name, a language tag and `localService`. There
   * is no gender field and no way to ask for one, so a stored `'female'` would
   * be a fact this application invented and then failed to honour on every
   * phone that ships a single voice per language. What is stored is one voice
   * out of the ones the device actually has.
   */
  describe('the speaking voice', () => {
    it('defaults to empty, meaning whatever the platform picks', () => {
      expect(DEFAULT_SETTINGS.speakingVoiceUri).toBe('');
    });

    it('stores a voiceURI rather than a gender', () => {
      const { settings } = parseSettings([
        { key: 'speakingVoiceUri', value: '"urn:moz-tts:speechd:Camila"' },
      ]);
      expect(settings.speakingVoiceUri).toBe('urn:moz-tts:speechd:Camila');
    });

    it('leaves it empty for a database that predates the setting', () => {
      const { settings } = parseSettings([{ key: 'voiceSpeakAnswers', value: 'true' }]);
      expect(settings.speakingVoiceUri).toBe('');
    });

    /*
     * Empty is the behaviour that always worked - no voice named, the platform
     * left to resolve `lang`, a local voice preferred where one matches. So a
     * corrupt value falls back to it rather than to a voice nobody chose.
     */
    it('falls back to empty when the value is corrupt, and says so', () => {
      const { settings, invalidKeys } = parseSettings([
        { key: 'speakingVoiceUri', value: '{"gender":"female"}' },
      ]);
      expect(settings.speakingVoiceUri).toBe('');
      expect(invalidKeys).toContain('speakingVoiceUri');
    });

    /*
     * A voice that is not installed on this device is still a legitimate stored
     * value - the setting cannot see the device, and `speak.ts` is where a
     * missing voice falls back rather than falling silent. Validating it here
     * would discard a choice that comes back when a language pack does.
     */
    it('keeps a voice this device may not have, because speak.ts is what falls back', () => {
      const { settings, invalidKeys } = parseSettings([
        { key: 'speakingVoiceUri', value: '"pt-br-x-afm-local"' },
      ]);
      expect(settings.speakingVoiceUri).toBe('pt-br-x-afm-local');
      expect(invalidKeys).toEqual([]);
    });
  });

  describe('assistant defaults', () => {
    /*
     * Two switches, and the application sends nothing unless BOTH are set: the
     * assistant has to be turned on, and a key has to be pasted. A fresh
     * install has neither, so a fresh install is the offline application it
     * has always been.
     */
    it('defaults the assistant off, with no key', () => {
      expect(DEFAULT_SETTINGS.aiEnabled).toBe(false);
      expect(DEFAULT_SETTINGS.anthropicApiKey).toBe('');
    });

    it('names the model rather than leaving it to a caller to guess', () => {
      // Haiku, not Opus. This application asks small, concrete questions about
      // a pantry, and answering them at roughly a fifth the cost is worth more
      // than reasoning depth nobody needs. Settings still offers Opus.
      expect(DEFAULT_SETTINGS.aiModel).toBe('claude-haiku-4-5');
    });

    it('defaults to a model whose request parameters the code actually sends', () => {
      // The pairing is a 400 when wrong, so the default must match the branch
      // in `thinkingFor`: Haiku takes budget_tokens and rejects effort.
      expect(DEFAULT_SETTINGS.aiModel).toContain('haiku');
    });

    it('leaves it off for a database that predates the assistant', () => {
      const { settings } = parseSettings([{ key: 'language', value: '"pt-BR"' }]);
      expect(settings.aiEnabled).toBe(false);
      expect(settings.anthropicApiKey).toBe('');
    });

    /*
     * A corrupt value falls back to the behaviour that sends nothing. Failing
     * open here would mean a bad settings row could switch on the one feature
     * that costs money and uses a network.
     */
    it('falls back to off when the switch is corrupt', () => {
      const { settings, invalidKeys } = parseSettings([
        { key: 'aiEnabled', value: '"yes please"' },
      ]);
      expect(settings.aiEnabled).toBe(false);
      expect(invalidKeys).toContain('aiEnabled');
    });

    it('falls back to no key when the key is corrupt', () => {
      const { settings, invalidKeys } = parseSettings([{ key: 'anthropicApiKey', value: '42' }]);
      expect(settings.anthropicApiKey).toBe('');
      expect(invalidKeys).toContain('anthropicApiKey');
    });
  });

  describe('corrupt values', () => {
    it('keeps the application startable when a setting is corrupt', () => {
      const { settings, invalidKeys } = parseSettings([{ key: 'askEnabled', value: '"nonsense"' }]);
      expect(settings.askEnabled).toBe(true);
      expect(invalidKeys).toContain('askEnabled');
    });

    // A corrupt value must fall back to the behaviour a working microphone
    // needs, and say that it was corrupt.
    it('falls back to off when the refusal is corrupt', () => {
      const { settings, invalidKeys } = parseSettings([
        { key: 'voiceOfflineOnly', value: '"yes please"' },
      ]);
      expect(settings.voiceOfflineOnly).toBe(false);
      expect(invalidKeys).toContain('voiceOfflineOnly');
    });
  });
});
