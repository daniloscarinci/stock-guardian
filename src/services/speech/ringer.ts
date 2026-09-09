/**
 * The switch on the side of the phone.
 *
 * It is here because the speaker needs it. Reading an answer aloud is a sound
 * the device makes; a phone on silent should make none, and a WebView cannot
 * see the ringer mode on its own. `speak.ts` deliberately knows nothing about
 * platforms, so the voice sheet composes the two: this answers "is the phone
 * silenced", the setting answers "did the user ask for speech at all", and
 * either one saying no is enough.
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
 * Whether speech would be inaudible even though the phone is not silenced.
 *
 * `TextToSpeech` plays on the media stream, and the ringer switch says nothing
 * about it - so a phone with the ringer on and media turned all the way down
 * speaks perfectly and is heard by nobody. That is a different answer from "the
 * person asked for quiet", and it is the one worth saying out loud: silence
 * that nobody can explain is the failure this whole feature keeps returning to.
 *
 * Fails to false wherever the question cannot be asked - an older APK whose
 * plugin does not report the field, a browser, a rejected call. Claiming the
 * volume is down when it is not would send somebody to fix a setting that was
 * never the problem.
 */
export async function androidMediaMuted(): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  return Ringer.isSilent()
    .then((r) => r.mediaVolume === 0)
    .catch(() => false);
}
