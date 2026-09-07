package app.stockguardian.android;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Speech capture that asks for no permission.
 *
 * ACTION_RECOGNIZE_SPEECH hands recording to the system recognizer, which holds
 * the microphone itself. This application never opens it and therefore declares
 * no RECORD_AUDIO. The workflow at .github/workflows/android.yml fails the build
 * if any permission appears, so this property is checked rather than trusted.
 *
 * EXTRA_PREFER_OFFLINE asks the recognizer to stay on the device. What the
 * request is worth depends on the installed recognizer, which is why the
 * interface says on-device speech is a device capability rather than a
 * guarantee this application can make on the device's behalf.
 *
 * WHY THIS FILE REJECTS WITH CODES RATHER THAN SENTENCES
 *
 * It used to answer every unsuccessful outcome with "cancelled", and the web
 * layer deliberately shows nothing for a cancellation - correctly, because a
 * banner after a deliberate "never mind" teaches people to ignore banners.
 * Together, those two reasonable decisions made every failure silent: on a phone
 * with no offline Portuguese model the recognizer refuses at once, and the
 * microphone appeared to do nothing whatsoever. The reason is now read and
 * reported as a stable code, and the wording lives in the locale files, which
 * are the only place that knows the user's language.
 *
 * WHAT THE INTENT FLOW ACTUALLY TELLS YOU
 *
 * Less than the SpeechRecognizer service API does. There is no error extra in
 * the result Intent - EXTRA_RESULTS and EXTRA_CONFIDENCE_SCORES are the only
 * documented contents - so the whole of the diagnosis is the activity result
 * code. RecognizerIntent documents five of those beyond RESULT_OK and
 * RESULT_CANCELED (RESULT_NO_MATCH, RESULT_CLIENT_ERROR, RESULT_SERVER_ERROR,
 * RESULT_NETWORK_ERROR, RESULT_AUDIO_ERROR) and every one is mapped below, but a
 * recognizer is free to answer RESULT_CANCELED instead, and Google's commonly
 * does. SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE and
 * ERROR_LANGUAGE_NOT_SUPPORTED - the two constants that name a missing offline
 * model - are delivered through RecognitionListener, which belongs to the API
 * that needs RECORD_AUDIO and is therefore not the one recording here. They
 * never reach an Intent result.
 *
 * So a missing offline model is established two other ways, in this order:
 *
 *   1. Before the dialog opens, by asking checkRecognitionSupport which
 *      languages are installed on the device. That is API 33 and upwards, it
 *      records nothing and it needs no permission: it is a question about the
 *      recognizer rather than a use of the microphone. A definite "the installed
 *      list is not empty and this language is not in it" rejects before the
 *      recognizer is ever launched.
 *   2. Below API 33, or when that check cannot answer, by how quickly
 *      RESULT_CANCELED comes back. A refusal returns at once; a person deciding
 *      not to speak cannot open the dialog, read it and press back inside
 *      REFUSAL_MILLIS. This one is a heuristic, marked as such here and in
 *      docs/VOICE.md, and it is applied ONLY while the question is genuinely
 *      open - never when the pre-flight check answered - because being wrong
 *      the other way means a banner after a deliberate cancellation.
 *
 * Java rather than Kotlin because this Gradle build has no Kotlin plugin. One
 * class is not a reason to add a language toolchain, a stdlib dependency and a
 * second way for the APK build to break; the build that works is worth more.
 */
@CapacitorPlugin(name = "Speech")
public class SpeechPlugin extends Plugin {

    /** The language used when the web layer asks for none. */
    private static final String DEFAULT_LANGUAGE = "pt-BR";

    /*
     * The rejection vocabulary. Stable, machine-readable, and matched exactly by
     * speechFailureReason in src/services/speech/failure.ts. Prose belongs in
     * src/i18n/locales.
     */
    private static final String CODE_CANCELLED = "cancelled";
    private static final String CODE_NO_OFFLINE_MODEL = "no-offline-model";
    private static final String CODE_NO_RECOGNIZER = "no-recognizer";
    private static final String CODE_NETWORK = "network";
    private static final String CODE_NO_MATCH = "no-match";
    private static final String CODE_FAILED = "failed";

    /**
     * How long to wait for the on-device language list before giving up on it.
     *
     * The answer arrives in tens of milliseconds once the recognition service is
     * bound, and the first bind is the slow one. Timing out is not a failure:
     * the state becomes UNKNOWN and everything proceeds exactly as it did before
     * this check existed.
     */
    private static final long SUPPORT_TIMEOUT_MILLIS = 1500L;

    /**
     * Under this, a RESULT_CANCELED did not come from a person.
     *
     * The recognizer's screen takes a moment to appear and prime the microphone,
     * and a deliberate back press lands well beyond a second. See the heuristic
     * note in the class comment.
     */
    private static final long REFUSAL_MILLIS = 1000L;

    /** What is known about an on-device model for one language. */
    private enum OnDevice {
        INSTALLED,
        MISSING,
        UNKNOWN;

        String wire() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    private interface OnDeviceCallback {
        void accept(OnDevice state);
    }

    /*
     * The context of the dialog currently open. Fields rather than call data
     * because only one recognizer screen can be open at a time: the web layer
     * disables the button while listening, and Android would not stack two of
     * these anyway.
     */
    private volatile long startedAt = 0L;
    private volatile OnDevice onDeviceAtStart = OnDevice.UNKNOWN;

    @PluginMethod
    public void listen(PluginCall call) {
        String tag = call.getString("lang", DEFAULT_LANGUAGE);

        if (!hasRecognizer()) {
            call.reject(CODE_NO_RECOGNIZER);
            return;
        }

        onDeviceState(tag, (state) -> {
            if (state == OnDevice.MISSING) {
                // Answered without opening the recognizer, so the user reads what
                // is wrong instead of watching a screen flash past.
                call.reject(CODE_NO_OFFLINE_MODEL);
                return;
            }
            start(call, tag, state);
        });
    }

    private void start(PluginCall call, String tag, OnDevice state) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);

        onDeviceAtStart = state;
        startedAt = SystemClock.elapsedRealtime();

        startActivityForResult(call, intent, "handleResult");
    }

    @ActivityCallback
    private void handleResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        long elapsed = SystemClock.elapsedRealtime() - startedAt;

        if (result.getResultCode() == Activity.RESULT_OK) {
            String spoken = transcriptOf(result.getData());
            if (spoken == null) {
                // RESULT_OK carrying nothing. The recognizer listened and made
                // nothing of it, which is what no-match means.
                call.reject(CODE_NO_MATCH);
            } else {
                call.resolve(new JSObject().put("transcript", spoken));
            }
            return;
        }

        call.reject(reasonFor(result.getResultCode(), elapsed));
    }

    /** The whole of the diagnosis the Intent flow affords. See the class comment. */
    private String reasonFor(int resultCode, long elapsedMillis) {
        switch (resultCode) {
            case RecognizerIntent.RESULT_NO_MATCH:
                return CODE_NO_MATCH;
            case RecognizerIntent.RESULT_NETWORK_ERROR:
            case RecognizerIntent.RESULT_SERVER_ERROR:
                return CODE_NETWORK;
            case RecognizerIntent.RESULT_CLIENT_ERROR:
            case RecognizerIntent.RESULT_AUDIO_ERROR:
                return CODE_FAILED;
            default:
                break;
        }

        if (resultCode != Activity.RESULT_CANCELED) {
            return CODE_FAILED;
        }

        /*
         * The heuristic, and the only guess in this file. Nothing could
         * establish whether the language is on the phone, and the screen came
         * back faster than a person could dismiss it - which is a recognizer
         * refusing, not somebody changing their mind.
         */
        boolean refusedInstantly =
            onDeviceAtStart == OnDevice.UNKNOWN && elapsedMillis < REFUSAL_MILLIS;
        return refusedInstantly ? CODE_NO_OFFLINE_MODEL : CODE_CANCELLED;
    }

    private static String transcriptOf(Intent data) {
        if (data == null) {
            return null;
        }
        ArrayList<String> heard = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (heard == null || heard.isEmpty()) {
            return null;
        }
        String first = heard.get(0);
        return first == null || first.trim().isEmpty() ? null : first;
    }

    /**
     * Whether the microphone can be offered, and whether the language is on the phone.
     *
     * `state` is what the interface acts on. `onDevice` is what was actually
     * established - installed, missing, or unknown - so that nothing above has to
     * mistake "this phone cannot answer that question" for "the model is there".
     */
    @PluginMethod
    public void availability(PluginCall call) {
        String tag = call.getString("lang", DEFAULT_LANGUAGE);

        if (!hasRecognizer()) {
            call.resolve(
                new JSObject().put("state", "unavailable").put("onDevice", OnDevice.UNKNOWN.wire())
            );
            return;
        }

        onDeviceState(tag, (state) -> {
            // MISSING means the recognizer is here and this language is not.
            // Android installs speech packs through its own settings rather than
            // through an API, so the interface offers the path, not a button.
            String value = state == OnDevice.MISSING ? "installable" : "ready";
            call.resolve(new JSObject().put("state", value).put("onDevice", state.wire()));
        });
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

    /** Whether anything on this phone answers ACTION_RECOGNIZE_SPEECH. */
    private boolean hasRecognizer() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        List<ResolveInfo> handlers = getContext().getPackageManager().queryIntentActivities(intent, 0);
        return !handlers.isEmpty();
    }

    /**
     * Asks the system which languages it can transcribe without a network.
     *
     * Fails soft in every direction: below API 33, with no activity, on any
     * throw, on any callback error and on the timeout, the answer is UNKNOWN and
     * the caller behaves exactly as it did before this existed. A check that can
     * only add information is a check that cannot break the feature.
     */
    private void onDeviceState(String tag, OnDeviceCallback done) {
        Activity activity = getActivity();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || activity == null) {
            done.accept(OnDevice.UNKNOWN);
            return;
        }
        // SpeechRecognizer must be created, used and destroyed on the main thread.
        activity.runOnUiThread(() -> checkSupport(activity, tag, done));
    }

    @RequiresApi(api = Build.VERSION_CODES.TIRAMISU)
    private void checkSupport(Activity activity, String tag, OnDeviceCallback done) {
        final SpeechRecognizer recognizer;
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(activity);
        } catch (Throwable refused) {
            done.accept(OnDevice.UNKNOWN);
            return;
        }
        if (recognizer == null) {
            done.accept(OnDevice.UNKNOWN);
            return;
        }

        final AtomicBoolean settled = new AtomicBoolean(false);
        final Handler handler = new Handler(Looper.getMainLooper());
        final Runnable[] timeout = new Runnable[1];

        // One answer, whichever arrives first, and the recognizer always released.
        OnDeviceCallback once = (state) -> {
            if (!settled.compareAndSet(false, true)) {
                return;
            }
            handler.removeCallbacks(timeout[0]);
            try {
                recognizer.destroy();
            } catch (Throwable ignored) {
                // Destroying a recognizer that never bound is not a failure.
            }
            done.accept(state);
        };

        timeout[0] = () -> once.accept(OnDevice.UNKNOWN);
        handler.postDelayed(timeout[0], SUPPORT_TIMEOUT_MILLIS);

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag);

        Executor onMainThread = activity::runOnUiThread;

        try {
            recognizer.checkRecognitionSupport(
                intent,
                onMainThread,
                new RecognitionSupportCallback() {
                    @Override
                    public void onSupportResult(@NonNull RecognitionSupport support) {
                        once.accept(readSupport(support, tag));
                    }

                    @Override
                    public void onError(int error) {
                        once.accept(OnDevice.UNKNOWN);
                    }
                }
            );
        } catch (Throwable refused) {
            once.accept(OnDevice.UNKNOWN);
        }
    }

    /**
     * Reads the language lists, conservatively.
     *
     * MISSING is only ever concluded from a list with something in it. A
     * recognizer that reports nothing installed is a recognizer that has not
     * answered the question, and treating that as "no model" would take the
     * microphone away from phones where offline speech works perfectly well. A
     * language still downloading counts as unknown for the same reason.
     */
    @RequiresApi(api = Build.VERSION_CODES.TIRAMISU)
    private static OnDevice readSupport(RecognitionSupport support, String tag) {
        List<String> installed = support.getInstalledOnDeviceLanguages();
        if (installed == null || installed.isEmpty()) {
            return OnDevice.UNKNOWN;
        }
        if (matches(installed, tag)) {
            return OnDevice.INSTALLED;
        }
        if (matches(support.getPendingOnDeviceLanguages(), tag)) {
            return OnDevice.UNKNOWN;
        }
        return OnDevice.MISSING;
    }

    /**
     * Whether a language list covers a tag.
     *
     * Separators differ between implementations - `pt_BR` and `pt-BR` both
     * appear - and a bare `pt` is a Portuguese model. Matching the primary
     * subtag is deliberately generous: calling pt-PT a match costs a worse
     * transcription, and calling it a miss costs a microphone that will not open.
     */
    private static boolean matches(List<String> languages, String tag) {
        if (languages == null || tag == null) {
            return false;
        }
        String wanted = normalize(tag);
        String primary = wanted.split("-")[0];
        for (String language : languages) {
            if (language == null) {
                continue;
            }
            String have = normalize(language);
            if (have.equals(wanted) || have.split("-")[0].equals(primary)) {
                return true;
            }
        }
        return false;
    }

    private static String normalize(String tag) {
        return tag.replace('_', '-').toLowerCase(Locale.ROOT);
    }
}
