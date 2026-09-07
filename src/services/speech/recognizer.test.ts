import { describe, expect, it } from 'vitest';
import { noneRecognizer } from './none';

describe('noneRecognizer', () => {
  it('reports itself unavailable', async () => {
    expect(await noneRecognizer.availability()).toBe('unavailable');
  });

  it('rejects rather than resolving with an empty transcript', async () => {
    await expect(noneRecognizer.listen('pt-BR')).rejects.toThrow(/unavailable/i);
  });
});
