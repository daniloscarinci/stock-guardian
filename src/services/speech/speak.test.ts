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

  // The answer names what is in someone's pantry. A server-synthesised voice
  // would send it to a synthesis service, in an application whose claim is that
  // it makes no network request of its own - so a remote voice is never named,
  // even when the platform lists it first and it sounds better.
  describe('voice selection', () => {
    const remote = { lang: 'pt-BR', localService: false, name: 'Remote' };
    const local = { lang: 'pt-BR', localService: true, name: 'Local' };

    function speakWith(voices: readonly unknown[]) {
      const speak = vi.fn();
      vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => voices });
      vi.stubGlobal(
        'SpeechSynthesisUtterance',
        class {
          lang = '';
          voice: unknown = undefined;
          constructor(public text: string) {}
        },
      );
      return speak;
    }

    it('never picks a remote voice, even when it is listed first', async () => {
      const speak = speakWith([remote, local]);
      await createSpeaker(() => true).say('doze latas', 'pt-BR');

      const utterance = speak.mock.calls[0]?.[0] as { voice?: { name: string } };
      expect(utterance.voice?.name).toBe('Local');
    });

    it('names no voice at all rather than falling back to a remote one', async () => {
      const speak = speakWith([remote]);
      await createSpeaker(() => true).say('doze latas', 'pt-BR');

      // `lang` alone is left to the platform. That can still resolve to a remote
      // voice - the API offers no way to refuse - which is why the docs call
      // this a best effort rather than a guarantee.
      const utterance = speak.mock.calls[0]?.[0] as { voice?: unknown; lang: string };
      expect(utterance.voice).toBeUndefined();
      expect(utterance.lang).toBe('pt-BR');
    });

    it('ignores a local voice in another language', async () => {
      const speak = speakWith([{ lang: 'en-US', localService: true, name: 'English' }]);
      await createSpeaker(() => true).say('doze latas', 'pt-BR');

      const utterance = speak.mock.calls[0]?.[0] as { voice?: unknown };
      expect(utterance.voice).toBeUndefined();
    });
  });
});
