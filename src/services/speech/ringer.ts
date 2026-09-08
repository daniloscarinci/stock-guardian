/**
 * The switch on the side of the phone.
 *
 * All that is left of what used to be `capacitor.ts`, and it is here because
 * the speaker needs it. Reading an answer aloud is a sound the device makes;
 * a phone on silent should make none, and a WebView cannot see the ringer
 * mode on its own. `speak.ts` deliberately knows nothing about platforms, so
 * the voice sheet composes the two: this answers "is the phone silenced", the
 * setting answers "did the user ask for speech at all", and either one saying
 * no is enough.
 *
 * The rest of that file - the system recognizer, the availability probe, the
 * offline-model heuristics - went with the microphone. Android's recognizer
 * refuses EXTRA_PREFER_OFFLINE with no Portuguese pack installed, which is the
 * phone this was built for, and the feature was dropped rather than left to
 * fail silently. `android/.../RingerPlugin.java` is the matching remnant on the
 * other side of the bridge.
 *
 * Off Android this is false and the bridge is never asked: a browser cannot
 * read that state, so there the setting is the only control there is.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface RingerPlugin {
  isSilent: () => Promise<{ silent: boolean }>;
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
