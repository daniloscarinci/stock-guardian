/**
 * The microphone itself: the recognizer, the one listen it may hold open, and
 * the way back out of one.
 *
 * WHY THIS IS A HOOK AND NOT A COMPONENT ANY MORE. All of it lived in
 * `MicButton` until the conversation loop arrived, and it could not stay there.
 * Two callers now open the microphone - the button, for the press that starts
 * everything, and the loop in `useVoice`, for every utterance after the first -
 * and they have to be the SAME caller as far as the platform is concerned.
 * `SpeechPlugin.java` holds one recognizer at a time and answers a second
 * `startListening` with `CODE_BUSY`; two components each with their own
 * `useAsyncData` and their own `active` ref would be exactly that. So the
 * recognizer, the guard and the release live here, once, and `MicButton` is the
 * button that presses this.
 *
 * IT RESOLVES WITH THE FAILURE RATHER THAN REJECTING, and that is the other
 * reason it is not the recognizer's own `listen`. A loop that awaits a listen
 * must branch on why one ended - `no-match` is how a conversation is meant to
 * finish, `cancelled` is somebody pressing stop, `busy` is a plugin that will
 * not be helped by asking again - and a rejection inside a loop is either a
 * try/catch around every iteration or an exception through the sheet. The seam
 * below is unchanged: `listen` still rejects, `speechFailureReason` still reads
 * the code out of whatever the platform threw, and this is the one place that
 * turns it into a value.
 *
 * `selectRecognizer` is called once per language and per refusal setting rather
 * than once per press, because both change the honest answer to "can this
 * device transcribe" - availability is per-language, and a device with no local
 * model for a language can still transcribe over the network unless its owner
 * has forbidden that.
 *
 * ONE PRESS CAN BE TWO ATTEMPTS, AND NOTHING HERE KNOWS IT. The on-device
 * attempt and the network retry are inside `listen`, where they can be tested
 * without a device; what comes back is one transcript and whether it was made on
 * the phone. That flag travels with the sentence, because the sheet marks the
 * exchange and a person has to be able to see when audio left.
 *
 * NO RECOGNIZER IS HELD OPEN BETWEEN TURNS, and the conversation loop deliberately
 * does not ask for one. `Session.finish` in SpeechPlugin.java destroys the
 * recognizer on every settle, so a ten-turn conversation is ten binds; keeping
 * one alive across turns would weaken "the microphone is released on every path",
 * which is the strongest guarantee that file makes. The cap on turns and the
 * spoken answer between them are what stand in for it.
 *
 * IT ALSO RELEASES ON THE WAY OUT. Closing the sheet mid-listen used to close a
 * system screen; now it has to close a microphone this process is holding.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  selectRecognizer,
  speechFailureReason,
  type SpeechFailure,
  type SpeechRecognizer,
} from '../../services/speech/recognizer';
import { LOCALE_TAGS } from '../../i18n/translate';

/**
 * One utterance, or the reason there was not one.
 *
 * `online` is true only where the on-device attempt failed and the retry
 * transcribed instead, which is the fact the sheet marks the exchange with.
 */
export type ListenResult =
  | { readonly kind: 'heard'; readonly text: string; readonly online: boolean }
  | { readonly kind: 'failed'; readonly reason: SpeechFailure };

/**
 * The two things anything above here does with a microphone.
 *
 * Held apart from the rendering state below on purpose, so the conversation
 * loop can close over it without capturing a stale `listening`. It is stable
 * across the renders that happen during a conversation - `open` is not one of
 * its dependencies - rather than stable unconditionally: `tag`, `options` and
 * the resolved recogniser all rebuild it. That is harmless, because the guard
 * the loop actually depends on is a ref and is shared by every version of it.
 */
export interface Microphone {
  /** Opens the microphone for one utterance. Never rejects, and settles once. */
  readonly listen: () => Promise<ListenResult>;
  /**
   * Lets the microphone go, where the platform implements it.
   *
   * It settles nothing by itself: the listen in flight then rejects with
   * `cancelled` and comes back through `listen` above, which is the one path out
   * however it was reached. Safe when nothing is listening.
   */
  readonly stop: () => Promise<void>;
}

export interface Listening {
  /** True while the microphone is open, which is what the status line renders. */
  readonly open: boolean;
  /**
   * True where the platform implements `cancel`.
   *
   * Chrome's recognizer ends a listen on silence by itself and offers no way to
   * end one early, and a button that cannot do anything is worse than no button.
   */
  readonly cancellable: boolean;
  readonly microphone: Microphone;
}

export function useListen(): Listening {
  const { settings } = useApp();
  const tag = LOCALE_TAGS[settings.language];

  const [open, setOpen] = useState(false);

  /*
   * The recognizer currently holding the microphone, if any.
   *
   * A ref rather than state because nothing renders from it: it exists so that
   * unmounting can release a microphone this process opened, and a render caused
   * by that would be a render of a component that is already gone. It is also
   * the guard - a listen that finds it set refuses rather than asking the
   * platform for a second one.
   */
  const active = useRef<SpeechRecognizer | null>(null);

  useEffect(
    () => () => {
      void active.current?.cancel?.();
      active.current = null;
    },
    [],
  );

  /**
   * What the caller forbids for one utterance.
   *
   * Only the refusal travels. Whether to transcribe on the device is not a
   * setting and never was: it is what every listen does first. This says whether
   * the failed one may be tried again over the network.
   */
  const options = useMemo(
    () => ({ offlineOnly: settings.voiceOfflineOnly }),
    [settings.voiceOfflineOnly],
  );

  // Probed again when the language or the refusal changes, because both change
  // the answer. Flipping the switch on the panel therefore takes effect on the
  // next press rather than on the next reload.
  const speech = useAsyncData(async () => {
    const recognizer = await selectRecognizer(tag, options);
    return { recognizer, availability: await recognizer.availability(tag, options) };
  }, [tag, options]);

  const listen = useCallback(async (): Promise<ListenResult> => {
    const state = speech.data;
    /*
     * Only `unavailable` blocks. An `installable` device has a working
     * microphone path - Android's own recognizer will offer to fetch the pack,
     * or the listen will fail with `no-offline-model` and the panel will say so,
     * which is a better answer than refusing to try.
     */
    if (state === undefined || state.availability === 'unavailable') {
      return { kind: 'failed', reason: 'no-recognizer' };
    }

    /*
     * One at a time, reported as the platform would report it.
     *
     * `busy` is the code Android answers a second `startListening` with, so a
     * caller that races itself is told the same thing whether this guard caught
     * it or the plugin did - and the loop treats it as the end of a conversation
     * either way, rather than asking again into a recognizer that is already
     * holding the microphone.
     */
    if (active.current !== null) return { kind: 'failed', reason: 'busy' };

    setOpen(true);
    active.current = state.recognizer;
    try {
      const heard = await state.recognizer.listen(tag, options);
      return { kind: 'heard', text: heard.text, online: heard.online };
    } catch (cause) {
      // Every reason, named. The bug this replaces read anything it did not
      // recognise as a cancellation, and answered a cancellation with silence.
      return { kind: 'failed', reason: speechFailureReason(cause) };
    } finally {
      active.current = null;
      setOpen(false);
    }
  }, [options, speech.data, tag]);

  const stop = useCallback(async () => {
    await speech.data?.recognizer.cancel?.();
  }, [speech.data]);

  const microphone = useMemo<Microphone>(() => ({ listen, stop }), [listen, stop]);

  return { open, cancellable: speech.data?.recognizer.cancel !== undefined, microphone };
}
