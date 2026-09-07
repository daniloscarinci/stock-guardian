import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('settings', () => {
  describe('voice defaults', () => {
    it('defaults voice on, and speaking on', () => {
      expect(DEFAULT_SETTINGS.voiceEnabled).toBe(true);
      expect(DEFAULT_SETTINGS.voiceSpeakAnswers).toBe(true);
    });
  });

  describe('corrupt values', () => {
    it('keeps the application startable when a voice setting is corrupt', () => {
      const { settings, invalidKeys } = parseSettings([{ key: 'voiceEnabled', value: '"nonsense"' }]);
      expect(settings.voiceEnabled).toBe(true);
      expect(invalidKeys).toContain('voiceEnabled');
    });
  });
});
