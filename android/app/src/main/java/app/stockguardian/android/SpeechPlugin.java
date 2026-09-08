package app.stockguardian.android;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.annotation.MainThread;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Speech capture, bound straight to the recognition service.
 *
 * WHY THIS FILE WAS REWRITTEN, AND WHAT IT COST.
 *
 * It used to fire ACTION_RECOGNIZE_SPEECH and read an activity result, so that
 * the system held the microphone and this application could declare no
 * RECORD_AUDIO. That was the better design and it is gone, because on the phone
 * this application is built for it does not work. A moto g35 5G answers that
 * Intent with Google's "Voice search isn't available": the component that
 * handles it, Google Voice Search, is not available on that device. Four
 * releases were spent on the far side of that door - including an online retry
 * that knocked on the same one.
 *
 * The decisive fact came from the phone itself: THE KEYBOARD'S VOICE TYPING
 * WORKS PERFECTLY ON IT. So the device can transcribe; it will not serve the
 * request in the shape we were asking. Gboard does not fire that Intent. It
 * binds the recognition service directly, through SpeechRecognizer - the API
 * below - and that API needs RECORD_AUDIO, because this process now opens the
 * microphone itself.
 *
 * The user was asked and accepted the permission in order to have a microphone
 * that works. AndroidManifest.xml declares it and says why; the check in
 * .github/workflows/android.yml was narrowed to INTERNET and RECORD_AUDIO and
 * still fails the build on everything else.
 *
 * WHAT THE PERMISSION BUYS BACK: THE REAL ERROR CODES.
 *
 * RecognitionListener.onError delivers the constants the Intent flow could
 * never carry, including the two that name a missing offline model -
 * ERROR_LANGUAGE_UNAVAILABLE and ERROR_LANGUAGE_NOT_SUPPORTED. Every code is
 * mapped in `codeFor` below, and the mapping is exact rather than inferred.
 *
 * THE TIMING HEURISTIC IS GONE. There used to be a guess in here: a
 * RESULT_CANCELED that came back faster than a person could press back was read
 * as a refusal rather than as a cancellation, because the Intent carried no
 * error and that was the only signal there was. It existed to work around a
 * silence this API does not have. Nothing guesses in this file any more.
 *
 * OFFLINE IS STILL THE STANDARD AND THE NETWORK IS STILL THE FALLBACK. Only
 * the mechanism changed. `listen` takes `preferOffline` and does what it is
 * told; the web layer calls it twice, and THE SEQUENCE STILL LIVES IN
 * TYPESCRIPT (src/services/speech/capacitor.ts and online.ts) so it can be
 * tested without a device in the room.
 *
 * WHICH RECOGNIZER EACH ATTEMPT GETS.
 *
 *   - The offline attempt takes createOnDeviceSpeechRecognizer where the device
 *     has one (API 33 and up, and isOnDeviceRecognitionAvailable says yes).
 *     That is the same on-device service the keyboard's voice typing uses, and
 *     using it is the whole point of this rewrite: it is the path this phone is
 *     known to serve. It cannot reach a network at all, so "offline" stops
 *     being a request the recognizer may quietly ignore and becomes a property
 *     of which service was bound.
 *   - Everywhere else - below API 33, or where no on-device service exists -
 *     the offline attempt takes createSpeechRecognizer with
 *     EXTRA_PREFER_OFFLINE, which is the same request the Intent used to carry.
 *   - The network attempt always takes createSpeechRecognizer with no offline
 *     extra, which is the default recognition service and, on most phones,
 *     Google's.
 *
 * EXTRA_PREFER_OFFLINE is sent whenever the caller asked for offline, on either
 * constructor. On the on-device recognizer it is redundant and harmless; making
 * it conditional would only add a way for the two to disagree.
 *
 * THREADING, WHICH IS THE ONE THING THAT CANNOT BE GOT WRONG HERE.
 *
 * SpeechRecognizer must be created, started, cancelled and destroyed on the
 * main thread, and a Capacitor @PluginMethod does NOT run there - the bridge
 * dispatches plugin calls on its own "CapacitorPlugins" HandlerThread. Calling
 * this API from that thread fails silently, in a way indistinguishable from the
 * bug this rewrite exists to fix: a microphone that does nothing and says
 * nothing. So every touch of a recognizer goes through `main`, the handler on
 * Looper.getMainLooper(), and every RecognitionListener callback arrives back
 * on that same looper because that is where the recognizer was created.
 *
 * RELEASING IT, ON EVERY PATH. A leaked recognizer holds the microphone open.
 * `Session.finish` is the single exit: it settles once, cancels the watchdog,
 * destroys the recognizer and only then answers the call. Results, errors, the
 * explicit `cancel` method and the activity being destroyed all go through it.
 *
 * THE WATCHDOG. A recognition service that binds and then says nothing at all
 * would leave the call pending forever and the button disabled forever, which
 * is the original bug in a new costume. Two timers stand between us and that:
 * one from startListening to onReadyForSpeech, one from onEndOfSpeech to the
 * results. Either expiring reports `failed`, which the web layer retries.
 *
 * WHY THIS FILE REJECTS WITH CODES RATHER THAN SENTENCES
 *
 * It once answered every unsuccessful outcome with "cancelled", and the web
 * layer deliberately shows nothing for a cancellation - correctly, because a
 * banner after a deliberate "never mind" teaches people to ignore banners.
 * Together, those two reasonable decisions made every failure silent. The
 * reason is now a stable code and the wording lives in src/i18n/locales, which
 * are the only place that knows the user's language.
 *
 * WHAT IS NOT IN HERE. `isSilent`. Reading the ringer switch belongs to the
 * speaker and lives on RingerPlugin; this plugin is the input. An APK that can
 * speak needs nothing from this file.
 *
 * Java rather than Kotlin because this Gradle build has no Kotlin plugin. One
 * class is not a reason to add a language toolchain, a stdlib dependency and a
 * second way for the APK build to break; the build that works is worth more.
 */
@CapacitorPlugin(
    name = "Speech",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = SpeechPlugin.MICROPHONE)
    }
)
public class SpeechPlugin extends Plugin {

    /**
     * The alias the runtime request is made under.
     *
     * Package-private and constant because the annotation above has to read it
     * at compile time, and because `requestPermissionForAlias` and
     * `getPermissionState` must be given exactly the same string.
     */
    static final String MICROPHONE = "microphone";

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
    private static final String CODE_BUSY = "busy";
    private static final String CODE_PERMISSION_DENIED = "permission-denied";
    private static final String CODE_PERMISSION_BLOCKED = "permission-blocked";
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
     * From startListening to onReadyForSpeech.
     *
     * A service that has not opened the microphone in eight seconds is not
     * going to. Generous, because the first bind after a cold start is slow and
     * cutting a working recognizer off is worse than waiting.
     */
    private static final long READY_TIMEOUT_MILLIS = 8000L;

    /**
     * From onEndOfSpeech to onResults.
     *
     * The recognizer has the audio by now; on-device transcription of one
     * sentence is well under this, and a network one that is not has already
     * failed in some way it declined to report.
     */
    private static final long RESULT_TIMEOUT_MILLIS = 10000L;

    /**
     * The ceiling on one utterance, armed once the microphone is open.
     *
     * The recognizer normally ends a listen itself with ERROR_SPEECH_TIMEOUT.
     * This is only for the one that does not.
     */
    private static final long UTTERANCE_TIMEOUT_MILLIS = 30000L;

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

    /**
     * The main looper, and the only thread that ever touches a recognizer.
     *
     * One instance rather than a fresh Handler per post, because the watchdog
     * has to be cancelled through the same handler that scheduled it.
     */
    private final Handler main = new Handler(Looper.getMainLooper());

    /**
     * The listen in progress, or null.
     *
     * Read and written on the main thread only. One at a time is not a
     * simplification: the web layer disables the button while listening, and
     * two recognizers competing for one microphone is exactly the leak this
     * class is careful about.
     */
    private Session session = null;

    /**
     * One utterance: the call that asked for it, the recognizer serving it, and
     * the single exit both leave by.
     */
    private final class Session implements RecognitionListener {

        private final PluginCall call;
        private final SpeechRecognizer recognizer;
        private final AtomicBoolean settled = new AtomicBoolean(false);
        private final Runnable watchdog = () -> fail(CODE_FAILED);

        Session(PluginCall call, SpeechRecognizer recognizer) {
            this.call = call;
            this.recognizer = recognizer;
        }

        @MainThread
        void arm(long millis) {
            main.removeCallbacks(watchdog);
            main.postDelayed(watchdog, millis);
        }

        /**
         * The only way out, whichever way it went.
         *
         * Settles once - a recognizer is free to report an error after a result
         * and some do - stops the watchdog, and releases the microphone BEFORE
         * the call is answered, so the web layer's second attempt can never
         * find the first recognizer still holding it.
         */
        @MainThread
        private void finish(Runnable answer) {
            if (!settled.compareAndSet(false, true)) return;
            main.removeCallbacks(watchdog);
            if (session == this) session = null;
            try {
                recognizer.setRecognitionListener(null);
            } catch (Throwable ignored) {
                // A recognizer that never bound has nothing to detach.
            }
            try {
                recognizer.destroy();
            } catch (Throwable ignored) {
                // Destroying twice, or destroying one that never bound, is not
                // a failure worth propagating over a released microphone.
            }
            answer.run();
        }

        @MainThread
        void fail(String code) {
            finish(() -> call.reject(code));
        }

        @MainThread
        void heard(String transcript) {
            finish(() -> call.resolve(new JSObject().put("transcript", transcript)));
        }

        @Override
        public void onReadyForSpeech(Bundle params) {
            // The microphone is open. From here the recognizer is expected to
            // end the utterance itself; the ceiling is for the one that does not.
            arm(UTTERANCE_TIMEOUT_MILLIS);
        }

        @Override
        public void onEndOfSpeech() {
            arm(RESULT_TIMEOUT_MILLIS);
        }

        @Override
        public void onResults(Bundle results) {
            String spoken = firstOf(results);
            if (spoken == null) {
                // It listened and made nothing of it, which is what no-match means.
                fail(CODE_NO_MATCH);
            } else {
                heard(spoken);
            }
        }

        @Override
        public void onError(int error) {
            fail(codeFor(error));
        }

        @Override
        public void onBeginningOfSpeech() {}

        @Override
        public void onRmsChanged(float rmsdB) {}

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onPartialResults(Bundle partialResults) {}

        @Override
        public void onEvent(int eventType, Bundle params) {}
    }

    /**
     * One utterance, in one mode.
     *
     * The permission is asked for HERE, on the first press of the microphone,
     * and never at startup. Somebody who opens this application to read what is
     * in the pantry is never shown a microphone prompt.
     */
    @PluginMethod
    public void listen(PluginCall call) {
        PermissionState state = getPermissionState(MICROPHONE);

        if (state == PermissionState.GRANTED) {
            begin(call);
            return;
        }

        if (state == PermissionState.DENIED) {
            /*
             * Refused permanently. Android will not show a prompt for this
             * again, so requesting would return instantly with nothing having
             * happened - a dialog asked into a void. Say so instead; the web
             * layer offers the settings page, which is the only way back.
             */
            call.reject(CODE_PERMISSION_BLOCKED);
            return;
        }

        // PROMPT, or PROMPT_WITH_RATIONALE after a first refusal. Both are a
        // prompt the system will actually show.
        requestPermissionForAlias(MICROPHONE, call, "microphoneAnswered");
    }

    /**
     * What the person said to the system's prompt.
     *
     * A refusal is an outcome, not an error: it is reported as a code like any
     * other, and the two codes are different because the ways out are
     * different. `permission-denied` can be asked again by pressing the
     * microphone; `permission-blocked` cannot be asked again at all.
     */
    @PermissionCallback
    private void microphoneAnswered(PluginCall call) {
        PermissionState state = getPermissionState(MICROPHONE);

        if (state == PermissionState.GRANTED) {
            begin(call);
        } else if (state == PermissionState.DENIED) {
            call.reject(CODE_PERMISSION_BLOCKED);
        } else {
            call.reject(CODE_PERMISSION_DENIED);
        }
    }

    /** Everything after the permission is settled. Hops to the main thread and stays there. */
    private void begin(PluginCall call) {
        String tag = call.getString("lang", DEFAULT_LANGUAGE);
        // Absent means offline, so a caller that forgets the argument gets the
        // attempt that sends nothing anywhere. The web layer always sends it.
        boolean preferOffline = !Boolean.FALSE.equals(call.getBoolean("preferOffline", true));

        if (!hasRecognizer()) {
            call.reject(CODE_NO_RECOGNIZER);
            return;
        }

        main.post(() -> start(call, tag, preferOffline));
    }

    /**
     * Creates the recognizer and starts it, on the main thread and nowhere else.
     *
     * Every failure before the listener is attached answers the call here,
     * because there is no Session yet to answer it.
     */
    @MainThread
    private void start(PluginCall call, String tag, boolean preferOffline) {
        if (session != null) {
            // Another listen is still running. Two recognizers cannot share one
            // microphone, and this is what ERROR_RECOGNIZER_BUSY means anyway.
            call.reject(CODE_BUSY);
            return;
        }

        Context context = getContext();
        boolean onDevice = preferOffline && hasOnDeviceRecognizer();

        SpeechRecognizer recognizer;
        try {
            recognizer = onDevice
                ? createOnDevice(context)
                : SpeechRecognizer.createSpeechRecognizer(context);
        } catch (Throwable refused) {
            call.reject(CODE_FAILED);
            return;
        }
        if (recognizer == null) {
            call.reject(CODE_NO_RECOGNIZER);
            return;
        }

        Session started = new Session(call, recognizer);
        session = started;
        recognizer.setRecognitionListener(started);

        try {
            recognizer.startListening(request(context, tag, preferOffline));
        } catch (Throwable refused) {
            // Releases the recognizer as well as answering, which a bare
            // call.reject here would not.
            started.fail(CODE_FAILED);
            return;
        }

        started.arm(READY_TIMEOUT_MILLIS);
    }

    @RequiresApi(api = Build.VERSION_CODES.TIRAMISU)
    private static SpeechRecognizer createOnDevice(Context context) {
        return SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
    }

    /**
     * Stops a listen in progress, releases the microphone, and reports it as
     * the deliberate cancellation it was.
     *
     * The Intent flow got this for free: the system's dialog had a back button.
     * A bound recognizer has no screen of its own, so without this there is no
     * way to take a press back and `cancelled` - the one code the interface
     * answers with silence, and the one the retry never fires after - could
     * never occur at all.
     *
     * Resolving rather than rejecting: cancelling nothing is not an error, and
     * the caller only wants to know the microphone is closed.
     */
    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            Session running = session;
            if (running != null) running.fail(CODE_CANCELLED);
            call.resolve();
        });
    }

    /**
     * Opens this application's own page in Android's settings.
     *
     * The one way back from a permanently refused microphone. Android has no
     * API to re-ask, and an application that quietly kept prompting into a void
     * would be worse than one that says plainly where the switch is.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject(CODE_FAILED);
            return;
        }

        Intent intent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null)
        );
        try {
            activity.startActivity(intent);
            call.resolve();
        } catch (Throwable refused) {
            call.reject(CODE_FAILED);
        }
    }

    /**
     * The activity is going away and the microphone must not go with it.
     *
     * Reported as a cancellation because that is what it is from the user's
     * side, and because a banner cannot be shown to somebody who has left.
     */
    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            Session running = session;
            if (running != null) running.fail(CODE_CANCELLED);
        });
        super.handleOnDestroy();
    }

    /**
     * The request the recognizer is given.
     *
     * EXTRA_PREFER_OFFLINE is sent whenever the caller asked for offline, on
     * either constructor. EXTRA_CALLING_PACKAGE is not decoration: some
     * recognition services refuse a request that does not name its caller.
     */
    private static Intent request(Context context, String tag, boolean preferOffline) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.getPackageName());
        if (preferOffline) {
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        }
        return intent;
    }

    /**
     * Every constant RecognitionListener can deliver, named.
     *
     * This is what the permission bought. The Intent flow had one activity
     * result code and a guess; this is the recognizer saying what happened,
     * including the two constants that name a missing offline model and never
     * reached an Intent result at all.
     *
     * The constants above 9 arrived in API 33 and 34. They are compile-time
     * ints, inlined by javac, so naming them here costs nothing on an older
     * phone - which simply never sends them.
     *
     * ERROR_CLIENT and ERROR_AUDIO become `failed` rather than something more
     * specific, and so does anything unknown. That is deliberate: `failed` is
     * the code the web layer retries over the network, and an on-device
     * recognizer that cannot bind reports ERROR_CLIENT. Retrying that is how
     * this phone still gets a transcript.
     */
    private static String codeFor(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
                // The model for this language is not on the device. The reason
                // this rewrite happened, and the reason the retry exists.
                return CODE_NO_OFFLINE_MODEL;
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
            case SpeechRecognizer.ERROR_SERVER_DISCONNECTED:
                return CODE_NETWORK;
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                // Both mean the same thing to the person holding the phone:
                // nothing usable was said. Neither is retried, because a retry
                // is a second recording and they would have to speak again.
                return CODE_NO_MATCH;
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return CODE_BUSY;
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                // Should be unreachable - the permission is settled before a
                // recognizer is built - but a service may disagree with the
                // system, and this is the honest thing to say if it does.
                return CODE_PERMISSION_DENIED;
            case SpeechRecognizer.ERROR_CLIENT:
            case SpeechRecognizer.ERROR_AUDIO:
            default:
                return CODE_FAILED;
        }
    }

    /** The best transcript in a results bundle, or null if there is nothing usable in it. */
    private static String firstOf(Bundle results) {
        if (results == null) {
            return null;
        }
        ArrayList<String> heard = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (heard == null || heard.isEmpty()) {
            return null;
        }
        String first = heard.get(0);
        return first == null || first.trim().isEmpty() ? null : first;
    }

    /**
     * Whether the microphone can be offered, and whether the language is on the phone.
     *
     * Asks for no permission and opens nothing: it is a question about the
     * recognizer rather than a use of the microphone, which is why the web
     * layer may call it on every render without a prompt appearing.
     *
     * `state` is what the interface acts on. `onDevice` is what was actually
     * established - installed, missing, or unknown - so that nothing above has
     * to mistake "this phone cannot answer that question" for "the model is
     * there".
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
     * Whether anything on this phone transcribes speech.
     *
     * This asks about the RecognitionService, which is what is actually bound
     * below - and NOT about an activity handling ACTION_RECOGNIZE_SPEECH, which
     * is what the previous version asked and is precisely the thing missing on
     * the phone this rewrite is for. A device whose Voice Search is unavailable
     * would have reported no microphone at all under the old question.
     *
     * The on-device service is asked about separately because it is a system
     * component rather than an installed recognition service, so the first
     * question can say no while the second says yes.
     */
    private boolean hasRecognizer() {
        Context context = getContext();
        try {
            if (SpeechRecognizer.isRecognitionAvailable(context)) {
                return true;
            }
        } catch (Throwable ignored) {
            // A packaging accident should not remove the microphone silently.
        }
        return hasOnDeviceRecognizer();
    }

    /** Whether this device has the on-device recognition service the keyboard uses. */
    private boolean hasOnDeviceRecognizer() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return false;
        }
        try {
            return SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
        } catch (Throwable ignored) {
            return false;
        }
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
        main.post(() -> checkSupport(activity, tag, done));
    }

    @RequiresApi(api = Build.VERSION_CODES.TIRAMISU)
    @MainThread
    private void checkSupport(Activity activity, String tag, OnDeviceCallback done) {
        /*
         * Asked of the same recognizer the offline attempt would use, so the
         * answer describes the service that will actually be bound rather than
         * some other one on the same phone.
         */
        final SpeechRecognizer recognizer;
        try {
            recognizer = hasOnDeviceRecognizer()
                ? createOnDevice(activity)
                : SpeechRecognizer.createSpeechRecognizer(activity);
        } catch (Throwable refused) {
            done.accept(OnDevice.UNKNOWN);
            return;
        }
        if (recognizer == null) {
            done.accept(OnDevice.UNKNOWN);
            return;
        }

        final AtomicBoolean settled = new AtomicBoolean(false);
        final Runnable[] timeout = new Runnable[1];

        // One answer, whichever arrives first, and the recognizer always released.
        OnDeviceCallback once = (state) -> {
            if (!settled.compareAndSet(false, true)) {
                return;
            }
            main.removeCallbacks(timeout[0]);
            try {
                recognizer.destroy();
            } catch (Throwable ignored) {
                // Destroying a recognizer that never bound is not a failure.
            }
            done.accept(state);
        };

        timeout[0] = () -> once.accept(OnDevice.UNKNOWN);
        main.postDelayed(timeout[0], SUPPORT_TIMEOUT_MILLIS);

        Intent intent = request(activity, tag, true);
        Executor onMainThread = main::post;

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
