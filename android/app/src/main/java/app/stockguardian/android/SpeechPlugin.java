package app.stockguardian.android;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.media.AudioManager;
import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * Speech capture that asks for no permission.
 *
 * ACTION_RECOGNIZE_SPEECH hands recording to the system recognizer, which holds
 * the microphone itself. This application never opens it and therefore declares
 * no RECORD_AUDIO. The workflow at .github/workflows/android.yml fails the build
 * if any permission appears, so this property is checked rather than trusted.
 *
 * EXTRA_PREFER_OFFLINE asks the recognizer to stay on the device. The value of
 * that request depends on the installed recognizer, which is why the interface
 * says on-device speech is a device capability rather than a guarantee this
 * application can make on the device's behalf.
 *
 * Java rather than Kotlin because this Gradle build has no Kotlin plugin. One
 * class is not a reason to add a language toolchain, a stdlib dependency and a
 * second way for the APK build to break; the build that works is worth more.
 */
@CapacitorPlugin(name = "Speech")
public class SpeechPlugin extends Plugin {

    /** The language used when the web layer asks for none. */
    private static final String DEFAULT_LANGUAGE = "pt-BR";

    @PluginMethod
    public void listen(PluginCall call) {
        String tag = call.getString("lang", DEFAULT_LANGUAGE);

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);

        startActivityForResult(call, intent, "handleResult");
    }

    @ActivityCallback
    private void handleResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("cancelled");
            return;
        }

        String spoken = null;
        Intent data = result.getData();
        if (data != null) {
            ArrayList<String> heard = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (heard != null && !heard.isEmpty()) {
                spoken = heard.get(0);
            }
        }

        if (spoken == null || spoken.trim().isEmpty()) {
            call.reject("empty");
        } else {
            call.resolve(new JSObject().put("transcript", spoken));
        }
    }

    /** Whether a recognizer exists at all, so the interface can hide the button. */
    @PluginMethod
    public void availability(PluginCall call) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        List<ResolveInfo> handlers = getContext().getPackageManager().queryIntentActivities(intent, 0);
        call.resolve(new JSObject().put("state", handlers.isEmpty() ? "unavailable" : "ready"));
    }

    /**
     * Whether the phone is on silent. Read so that spoken answers respect the
     * switch on the side of the device, which a WebView cannot see on its own.
     */
    @PluginMethod
    public void isSilent(PluginCall call) {
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        // A device with no AudioManager is not a device to start talking on.
        boolean silent = audio == null || audio.getRingerMode() != AudioManager.RINGER_MODE_NORMAL;
        call.resolve(new JSObject().put("silent", silent));
    }
}
