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
 * This is what is left of SpeechPlugin, which used to hand recording to the
 * system recognizer through ACTION_RECOGNIZE_SPEECH. That never worked on the
 * phone it was built for - Android's recognizer refuses EXTRA_PREFER_OFFLINE
 * when no offline Portuguese pack is installed, and answers "Voice search
 * isn't available" - so voice commands were dropped. Reading answers ALOUD was
 * not: it works, and it is genuinely useful with your hands full.
 *
 * Which leaves this. A WebView cannot see the ringer mode, so a spoken answer
 * would talk straight over a phone its owner had deliberately silenced.
 * src/services/speech/ringer.ts is the other half; the voice sheet composes it
 * with the user's own setting, and either saying no is enough to stay quiet.
 *
 * It asks the system for nothing. AudioManager.getRingerMode needs no
 * permission, opens no socket and records nothing, which is why the check in
 * .github/workflows/android.yml still passes with INTERNET as the only entry.
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
