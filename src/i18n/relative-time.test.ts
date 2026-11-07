import { describe, expect, it } from 'vitest';
import { formatDaysAgo } from './relative-time';

describe('formatDaysAgo', () => {
  it.each([
    ['en', 0, 'today'],
    ['en', 1, 'yesterday'],
    ['en', 12, '12 days ago'],
    ['pt-BR', 0, 'hoje'],
    ['pt-BR', 1, 'ontem'],
    ['pt-BR', 12, 'há 12 dias'],
    ['es', 0, 'hoy'],
    ['es', 1, 'ayer'],
    ['es', 12, 'hace 12 días'],
  ] as const)('%s, %i days -> "%s"', (language, days, expected) => {
    expect(formatDaysAgo(language, days)).toBe(expected);
  });

  it('never goes into the future', () => {
    expect(formatDaysAgo('en', -3)).toBe('today');
  });
});
