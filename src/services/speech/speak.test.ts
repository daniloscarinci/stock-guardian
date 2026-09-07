import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeaker } from './speak';

afterEach(() => vi.unstubAllGlobals());

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
});
