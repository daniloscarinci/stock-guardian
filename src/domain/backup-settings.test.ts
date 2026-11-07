import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEVICE_ONLY_SETTING_KEYS,
  isDeviceOnlySettingKey,
  parseSettings,
} from './settings';

describe('backup settings', () => {
  it('defaults to no backup yet, the reminder on, and a 30 day window', () => {
    expect(DEFAULT_SETTINGS.lastBackupAt).toBeNull();
    expect(DEFAULT_SETTINGS.backupReminderEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.backupReminderDays).toBe(30);
  });

  it('keeps a valid lastBackupAt', () => {
    const { settings, invalidKeys } = parseSettings([
      { key: 'lastBackupAt', value: JSON.stringify('2026-11-07T12:00:00.000Z') },
    ]);
    expect(settings.lastBackupAt).toBe('2026-11-07T12:00:00.000Z');
    expect(invalidKeys).toEqual([]);
  });

  it('falls back to null for a damaged lastBackupAt without losing other settings', () => {
    const { settings, invalidKeys } = parseSettings([
      { key: 'lastBackupAt', value: JSON.stringify('not a date') },
      { key: 'language', value: JSON.stringify('es') },
    ]);
    expect(settings.lastBackupAt).toBeNull();
    expect(settings.language).toBe('es');
    expect(invalidKeys).toContain('lastBackupAt');
  });

  it('rejects a reminder window outside 1 to 365 days', () => {
    for (const bad of [0, -3, 400, 7.5]) {
      const { settings, invalidKeys } = parseSettings([
        { key: 'backupReminderDays', value: JSON.stringify(bad) },
      ]);
      expect(settings.backupReminderDays).toBe(30);
      expect(invalidKeys).toContain('backupReminderDays');
    }
  });

  it('names the Anthropic key, and only secrets like it, as device-only', () => {
    expect(DEVICE_ONLY_SETTING_KEYS).toContain('anthropicApiKey');
    expect(isDeviceOnlySettingKey('anthropicApiKey')).toBe(true);
    expect(isDeviceOnlySettingKey('aiEnabled')).toBe(false);
    expect(isDeviceOnlySettingKey('language')).toBe(false);
    expect(isDeviceOnlySettingKey('lastBackupAt')).toBe(false);
  });
});
