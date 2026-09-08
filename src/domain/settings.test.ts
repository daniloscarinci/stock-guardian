import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('settings', () => {
  describe('asking defaults', () => {
    it('defaults the ask button on, and speaking on', () => {
      expect(DEFAULT_SETTINGS.askEnabled).toBe(true);
      expect(DEFAULT_SETTINGS.voiceSpeakAnswers).toBe(true);
    });

    /*
     * The one setting that can send a recording of somebody anywhere. A default
     * of `true` here would make the application's central claim false without
     * anybody choosing it, so this is asserted on its own rather than folded
     * into the test above.
     */
    it('defaults the online opt-in OFF', () => {
      expect(DEFAULT_SETTINGS.voiceAllowOnline).toBe(false);
    });

    it('leaves it off for a database that predates the setting', () => {
      const { settings } = parseSettings([{ key: 'askEnabled', value: 'true' }]);
      expect(settings.voiceAllowOnline).toBe(false);
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

    // A corrupt value must fall back to the private behaviour, never to the
    // one that sends audio away.
    it('falls back to off when the online opt-in is corrupt', () => {
      const { settings, invalidKeys } = parseSettings([
        { key: 'voiceAllowOnline', value: '"yes please"' },
      ]);
      expect(settings.voiceAllowOnline).toBe(false);
      expect(invalidKeys).toContain('voiceAllowOnline');
    });
  });
});
