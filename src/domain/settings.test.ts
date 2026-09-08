import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('settings', () => {
  describe('asking defaults', () => {
    it('defaults the ask button on, and speaking on', () => {
      expect(DEFAULT_SETTINGS.askEnabled).toBe(true);
      expect(DEFAULT_SETTINGS.voiceSpeakAnswers).toBe(true);
    });

    /*
     * `voiceAllowOnline` was the only setting that could send anything off the
     * device, and it is gone with the recognizer it controlled. A stored row is
     * skipped rather than migrated - `parseSettings` ignores any key the schema
     * does not have - so an old database neither restores it nor trips over it.
     */
    it('ignores the online opt-in that no longer exists', () => {
      const { settings, invalidKeys } = parseSettings([
        { key: 'voiceAllowOnline', value: 'true' },
        { key: 'language', value: '"es"' },
      ]);
      expect('voiceAllowOnline' in settings).toBe(false);
      expect(invalidKeys).not.toContain('voiceAllowOnline');
      expect(settings.language).toBe('es');
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
  });
});
