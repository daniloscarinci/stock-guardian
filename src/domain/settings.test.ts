import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('settings', () => {
  describe('voice defaults', () => {
    it('defaults voice on, and speaking on', () => {
      expect(DEFAULT_SETTINGS.voiceEnabled).toBe(true);
      expect(DEFAULT_SETTINGS.voiceSpeakAnswers).toBe(true);
    });

    /*
     * The only setting that can send anything off the device. A default of
     * `true` here would make the application's central claim false without
     * anybody choosing it, so this is asserted on its own rather than folded
     * into the test above.
     */
    it('defaults sending audio to Google OFF', () => {
      expect(DEFAULT_SETTINGS.voiceAllowOnline).toBe(false);
    });

    it('leaves it off for a database that predates the setting', () => {
      const { settings } = parseSettings([{ key: 'voiceEnabled', value: 'true' }]);
      expect(settings.voiceAllowOnline).toBe(false);
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
      expect(DEFAULT_SETTINGS.aiModel).toBe('claude-opus-5');
    });

    it('leaves it off for a database that predates the assistant', () => {
      const { settings } = parseSettings([{ key: 'language', value: '"pt-BR"' }]);
      expect(settings.aiEnabled).toBe(false);
      expect(settings.anthropicApiKey).toBe('');
    });

    /*
     * A corrupt value falls back to the behaviour that sends nothing, the same
     * way `voiceAllowOnline` does. Failing open here would mean a bad settings
     * row could switch on the one feature that costs money and uses a network.
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
    it('keeps the application startable when a voice setting is corrupt', () => {
      const { settings, invalidKeys } = parseSettings([{ key: 'voiceEnabled', value: '"nonsense"' }]);
      expect(settings.voiceEnabled).toBe(true);
      expect(invalidKeys).toContain('voiceEnabled');
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
