package app.stockguardian.android;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * One question: is the phone on silent?
 *
 * This is what was left of SpeechPlugin when the microphone was dropped. That
 * plugin used to hand recording to the system recognizer through
 * ACTION_RECOGNIZE_SPEECH, which never worked on the phone it was built for -
 * Android answers "Voice search isn't available" there - so voice commands went
 * and reading answers ALOUD stayed, because it works and is genuinely useful
 * with your hands full.
 *
 * The microphone is back, on a different mechanism: SpeechPlugin now binds the
 * recognition service directly and holds RECORD_AUDIO. These two stayed apart
 * anyway. Recognizing speech belongs to the microphone, reading the ringer
 * switch belongs to the speaker, and an APK that can speak needs nothing from
 * the plugin that listens.
 *
 * A WebView cannot see the ringer mode, so a spoken answer would talk straight
 * over a phone its owner had deliberately silenced.
 * src/services/speech/ringer.ts is the other half; the voice sheet composes it
 * with the user's own setting, and either saying no is enough to stay quiet.
 *
 * It asks the system for nothing. AudioManager.getRingerMode needs no
 * permission, opens no socket and records nothing, which is why nothing in this
 * file appears in the permission check in .github/workflows/android.yml - a
 * check that allows INTERNET and RECORD_AUDIO and fails the build on the rest.
 *
 * Java rather than Kotlin because this Gradle build has no Kotlin plugin. One
 * class is not a reason to add a language toolchain.
 */
@CapacitorPlugin(name = "Ringer")
public class RingerPlugin extends Plugin {

    /**
     * Whether the phone is silenced. Read so that spoken answers respect the
     * switch on the side of the device.
     */
    @PluginMethod
    public void isSilent(PluginCall call) {
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        // A device with no AudioManager is not a device to start talking on.
        boolean silent = audio == null || audio.getRingerMode() != AudioManager.RINGER_MODE_NORMAL;
        call.resolve(new JSObject().put("silent", silent));
    }
}
