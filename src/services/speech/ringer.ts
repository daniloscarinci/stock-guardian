/**
 * The switch on the side of the phone.
 *
 * It is here because the speaker needs it. Reading an answer aloud is a sound
 * the device makes; a phone on silent should make none, and a WebView cannot
 * see the ringer mode on its own. `speak.ts` deliberately knows nothing about
 * platforms, so the voice sheet composes the two: this answers "would anybody
 * hear it", the setting answers "did the user ask for speech at all", and
 * either one saying no is enough.
 *
 * TWO FUNCTIONS, AND THE SECOND IS THE ONE TO REACH FOR. `androidIsSilent` is
 * the narrow question - the switch on the side of the phone - and the welcome
 * asks nothing else, because a greeting has no reply to wait for and no reason
 * to explain itself. `androidAudibility` is the whole answer in one bridge
 * call, and it is what the ask sheet and the Settings preview use: both of them
 * have to say WHICH silence it was, and asking two predicates would cross the
 * bridge twice for one plugin result.
 *
 * THIS AND `capacitor.ts` WERE ONE MODULE, AND THEY ARE NOT AGAIN. The
 * microphone was removed once, this half stayed behind because the speaker
 * could not do without it, and when the microphone came back the two were left
 * apart on purpose: the ringer belongs to the output, the recognizer to the
 * input, and nothing about playing a sentence should drag a speech recognizer
 * into its module graph. `android/.../RingerPlugin.java` is the matching
 * remnant on the other side of the bridge, one method wide.
 *
 * `isNativeAndroid` is exported and `capacitor.ts` imports it rather than
 * keeping a second copy, because two copies of one predicate is how they drift.
 *
 * Off Android this is false and the bridge is never asked: a browser cannot
 * read that state, so there the setting is the only control there is.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface RingerPlugin {
  isSilent: () => Promise<{ silent: boolean; mediaVolume?: number }>;
}

const Ringer = registerPlugin<RingerPlugin>('Ringer');

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * Whether the phone is silenced.
 *
 * Fails to false in every direction - not Android, no plugin, a rejected call,
 * an older APK that has no such method - because the failure mode of guessing
 * wrong is a sentence read aloud that need not have been, and the failure mode
 * of refusing to answer is an application that never speaks.
 */
export async function androidIsSilent(): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  return Ringer.isSilent()
    .then((r) => r.silent)
    .catch(() => false);
}

/**
 * Whether a sentence read out right now would reach anybody, and if not, why.
 *
 * TWO DIFFERENT SILENCES, AND THEY HAVE DIFFERENT ANSWERS. The ringer switch is
 * somebody saying "not now". The media volume is a slider they may not know they
 * moved: `TextToSpeech` plays on the media stream, and the ringer says nothing
 * about it, so a phone with the ringer ON and media turned all the way down
 * speaks perfectly and is heard by nobody. Telling those apart is the difference
 * between "you asked for quiet" and "turn the volume up with the side keys".
 *
 * ONE BRIDGE CALL FOR BOTH, AND THAT IS THE REASON THIS FUNCTION EXISTS RATHER
 * THAN TWO PREDICATES. `RingerPlugin.isSilent` reports the ringer mode and the
 * media volume in one result, and asking it twice per sentence - which is what a
 * caller composing two predicates would do - is two round trips across the
 * Capacitor bridge for one question. The conversation loop asks this before every
 * answer it reads out, so the cost is per sentence rather than per press.
 *
 * THE RINGER WINS WHEN BOTH ARE TRUE. A phone on silent with the media slider
 * also at zero is reported as `silenced`, because that is the one of the two the
 * person chose on purpose and the one whose sentence is worth showing them.
 *
 * `audible` wherever the question cannot be asked - a browser, an older APK
 * whose plugin does not report the field, a rejected call. The failure mode of
 * guessing wrong in that direction is a sentence read aloud that need not have
 * been; the failure mode of the other is an application that never speaks and a
 * conversation that never starts.
 */
export type Audibility = 'audible' | 'silenced' | 'mediaMuted';

export async function androidAudibility(): Promise<Audibility> {
  if (!isNativeAndroid()) return 'audible';
  return Ringer.isSilent()
    .then(({ silent, mediaVolume }): Audibility => {
      if (silent) return 'silenced';
      return mediaVolume === 0 ? 'mediaMuted' : 'audible';
    })
    .catch((): Audibility => 'audible');
}
