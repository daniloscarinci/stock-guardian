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
