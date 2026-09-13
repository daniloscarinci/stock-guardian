package app.stockguardian.android;

import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import androidx.annotation.MainThread;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Reading a sentence aloud, through the engine the phone actually has.
 *
 * WHY THIS EXISTS, AND IT IS THE MICROPHONE'S STORY AGAIN.
 *
 * Android's WebView EXPOSES the Web Speech synthesis API and does not implement
 * it. `speechSynthesis` is present, so every guard in src/services/speech
 * passed; `getVoices()` returned an empty list, `speak()` accepted the utterance
 * and played nothing, and no error was raised anywhere. Answers appeared as text
 * and were never spoken, and the "Hear it" button in Settings did nothing at
 * all. Chrome the browser supports synthesis. The WebView component does not.
 *
 * That is exactly the shape of the bug that cost four releases on the
 * microphone: a web API that exists, passes every check and quietly does
 * nothing, while the native path underneath it works. The answer is the same
 * one - bind the platform API directly - and this is the third hand-written
 * plugin in this application rather than the first, so it follows SpeechPlugin's
 * structure deliberately: one main-thread handler, one settle-once exit, a
 * watchdog on each call that can hang, and stable codes instead of prose.
 *
 * WHEN THE SENTENCE ENDED, WHICH IS THE OTHER THING THIS FILE IS FOR.
 *
 * `speak` holds its PluginCall open for the length of the utterance and answers
 * it with `spoken` or `unknown`. It has to, because nothing in this application
 * coordinates audio focus and nothing cancels echo: TextToSpeech plays on the
 * media stream and SpeechPlugin opens the microphone, so anything that wanted
 * to listen for a reply to a spoken sentence would record the phone reading it.
 * Knowing the sentence has finished is what makes listening for a reply safe,
 * and it is the one fact neither platform would previously give up.
 *
 * The signal is an UtteranceProgressListener, matched to the call by the
 * utterance id that this file was already passing to the engine and nobody was
 * reading. The objection to waiting for it is real and old - some engines never
 * call onDone - so a second watchdog stands behind it, derived from the length
 * of the sentence. It resolves with `unknown` rather than rejecting: a slow
 * engine is not an error to put in front of anybody.
 *
 * IT ASKS THE SYSTEM FOR NOTHING. TextToSpeech needs no permission of any kind.
 * The check in .github/workflows/android.yml still allows exactly INTERNET,
 * RECORD_AUDIO and POST_NOTIFICATIONS and fails the build on everything else,
 * and this file adds nothing to that list. What it did need is one line of
 * package visibility - see the `queries` block in AndroidManifest.xml - because
 * from Android 11 an application cannot see a speech engine it has not named.
 *
 * INITIALISATION IS ASYNCHRONOUS, AND THAT IS THE FAILURE BEING FIXED.
 *
 * A TextToSpeech is useless until onInit reports success, and `speak` called
 * before that returns ERROR and plays nothing - silently, which is precisely the
 * bug this plugin exists to end. So no call here touches an engine directly.
 * Every one of them goes through `whenReady`, which either runs it now, or
 * parks it until onInit answers, or rejects it because there is no engine to
 * wait for. A call that arrives early WAITS; it never vanishes.
 *
 * AND AN ENGINE THAT NEVER ANSWERS MUST NOT HANG THE BUTTON. `onInit` is a
 * callback from a bound service, and a service that binds and then says nothing
 * would leave every parked call pending forever. INIT_TIMEOUT_MILLIS is the
 * ceiling: when it expires the engine is shut down, the parked calls are
 * rejected with `no-engine`, and the state resets so the NEXT call builds a
 * fresh one rather than queueing behind a corpse.
 *
 * WHICH VOICE SPEAKS IS DECIDED IN TYPESCRIPT, NOT HERE. `speak` honours a voice
 * named by the caller and otherwise leaves the choice to setLanguage. The
 * local-first preference - never send somebody's pantry to a synthesis server
 * when a voice on the device will do - lives in src/services/speech/voices.ts,
 * where it is shared with the browser path and can be tested without a phone in
 * the room. `voices` below is what feeds it, and it reports
 * Voice.isNetworkConnectionRequired, which is the native and far more reliable
 * form of the web API's `localService`.
 *
 * A VOICE NAME CARRIES WHAT THE WEB API NEVER DID. TextToSpeech.getVoices()
 * returns identifiers like `pt-br-x-afm#female_1-local`. That `#female` is the
 * engine saying outright what `inferVoiceGender` in speak.ts could only ever
 * guess at, and it never saw one because the web list was empty. The name is
 * passed through untouched for that reason.
 *
 * RELEASING IT. TextToSpeech holds a bound service and an audio focus handle, so
 * `handleOnDestroy` shuts it down. A leaked engine outlives the activity it
 * belonged to.
 *
 * Java rather than Kotlin because this Gradle build has no Kotlin plugin. One
 * class is not a reason to add a language toolchain.
 */
@CapacitorPlugin(name = "Tts")
public class TtsPlugin extends Plugin {

    /** The language used when the web layer asks for none. */
    private static final String DEFAULT_LANGUAGE = "pt-BR";

    /*
     * The rejection vocabulary. Stable and machine-readable, like SpeechPlugin's.
     * Nothing here is shown to anybody: the web layer decides what a failure
     * means and src/i18n/locales owns every sentence a person reads.
     */
    private static final String CODE_NO_ENGINE = "no-engine";
    private static final String CODE_NO_LANGUAGE = "no-language";
    private static final String CODE_FAILED = "failed";

    /*
     * What became of a sentence, in the same two words src/services/speech
     * reads. `spoken` is the engine saying the utterance finished. `unknown` is
     * every other ending: an error, an interruption, or the watchdog below
     * expiring with the engine having said nothing at all.
     *
     * There is no third word here. The web layer's `silent` means a sentence
     * that was never handed to an engine, and a sentence that was never handed
     * to an engine never reaches this file.
     */
    private static final String OUTCOME_SPOKEN = "spoken";
    private static final String OUTCOME_UNKNOWN = "unknown";

    /**
     * How long to wait for onInit before giving up on an engine.
     *
     * The first bind after a cold start is the slow one and is normally well
     * under a second. Five is generous on purpose: cutting off an engine that
     * was about to work is worse than waiting, and the only thing on the far
     * side of this timer is a sentence nobody hears.
     */
    private static final long INIT_TIMEOUT_MILLIS = 5000L;

    /**
     * The floor under the wait for one sentence to finish.
     *
     * Short answers are the common case and for those this is not about the
     * sentence at all - it is about how long the engine may take to make its
     * first sound. The same order as INIT_TIMEOUT_MILLIS above, and generous
     * for the same reason: cutting off an engine that was about to work is
     * worse than waiting.
     */
    private static final long SPEAK_FLOOR_MILLIS = 6000L;

    /**
     * How much longer to wait per character of the sentence.
     *
     * ESTIMATED, NOT MEASURED. Nothing here was timed on a device. Synthesised
     * speech runs at something like 150 to 200 words a minute and the languages
     * this application speaks average around six characters to a word, which
     * puts a sentence at roughly fifteen characters a second, or 65ms each.
     * This is a little under twice that, so an engine set to half speed still
     * finishes inside the ceiling.
     *
     * src/services/speech/engine.ts carries the same two numbers for the
     * browser path. Nothing shares them across that boundary; they are written
     * out twice and named the same on both sides.
     */
    private static final long MILLIS_PER_CHARACTER = 120L;

    /** What is known about the engine, and the only reason anything here waits. */
    private enum Engine {
        /** Never started, or shut down and ready to be started again. */
        ABSENT,
        /** Constructed; onInit has not answered yet. */
        STARTING,
        /** onInit reported success. The only state in which the engine is touched. */
        READY,
        /** onInit reported failure. There is nothing on this device to speak with. */
        FAILED
    }

    /** Something to do with a working engine, once there is one. */
    private interface EngineTask {
        void run(TextToSpeech engine);
    }

    /**
     * The main looper, and the only thread that touches the engine or this
     * class's fields.
     *
     * One instance rather than a fresh Handler per post, because the init
     * watchdog has to be cancelled through the same handler that scheduled it.
     */
    private final Handler main = new Handler(Looper.getMainLooper());

    /** Calls that arrived before onInit answered. Main thread only. */
    private final List<Runnable> waiting = new ArrayList<>();

    private TextToSpeech tts = null;
    private Engine state = Engine.ABSENT;
    private Runnable initWatchdog = null;

    /**
     * Which engine a callback belongs to.
     *
     * An engine that timed out is shut down, but its onInit may still arrive
     * afterwards. Comparing the generation is how a callback from an engine
     * nobody is waiting for any more is ignored rather than acted on.
     */
    private int generation = 0;

    /** Distinguishes one utterance from the next, and matches it to its call. */
    private int utterance = 0;

    /**
     * The sentence being read right now, or null. Main thread only.
     *
     * One at a time, and that is not a simplification: every sentence is
     * queued with QUEUE_FLUSH, so starting one is what ends the last one.
     */
    private Utterance reading = null;

    /**
     * One sentence in flight: the call waiting on it, the id the engine knows
     * it by, and the single exit every ending leaves by.
     *
     * MODELLED ON SpeechPlugin.Session, which has had this exact problem for
     * longer. Five things can end a sentence - onDone, onError, onStop, the
     * watchdog, and `flushReading` when something upstream is about to cut it
     * off - and on an interruption two of them arrive for the same utterance.
     * `settled` is what makes the second one a no-op instead of a second answer
     * to a PluginCall that has already been resolved.
     */
    private final class Utterance {

        private final PluginCall call;
        /** The engine's own id for it, so a late callback can be told apart. */
        private final String id;
        private final AtomicBoolean settled = new AtomicBoolean(false);
        private final Runnable watchdog = () -> finish(OUTCOME_UNKNOWN);

        Utterance(PluginCall call, String id) {
            this.call = call;
            this.id = id;
        }

        @MainThread
        void arm(long millis) {
            main.postDelayed(watchdog, millis);
        }

        /**
         * The only way out, whichever way it went.
         *
         * IT RESOLVES AND NEVER REJECTS, including from the watchdog. A slow
         * engine turned into an error would be a banner in front of somebody
         * whose phone was merely thinking, and the web layer already has a word
         * for this: `unknown` says the sentence was handed over and nobody can
         * say what became of it, which is exactly true.
         */
        @MainThread
        void finish(String outcome) {
            if (!settled.compareAndSet(false, true)) return;
            main.removeCallbacks(watchdog);
            if (reading == this) reading = null;
            call.resolve(new JSObject().put("outcome", outcome));
        }
    }

    /**
     * Runs something on the main thread, now if that is where we already are.
     *
     * The same reasoning as SpeechPlugin: a Capacitor @PluginMethod does not run
     * on the main thread - the bridge dispatches on its own "CapacitorPlugins"
     * HandlerThread - and `handleOnDestroy` does, where deferring would release
     * the engine after the activity it belonged to has gone.
     */
    private void onMain(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
        } else {
            main.post(action);
        }
    }

    /**
     * Runs a task against a working engine, whenever there turns out to be one.
     *
     * THIS IS THE WHOLE ANSWER TO ASYNCHRONOUS INITIALISATION, and every public
     * method that needs an engine goes through it. Three outcomes and no fourth:
     * the engine is ready and the task runs now; the engine is starting and the
     * task is parked until onInit answers; there is no engine and the call is
     * rejected. A call that arrives early is never dropped and never left
     * pending forever.
     */
    @MainThread
    private void whenReady(PluginCall call, EngineTask task) {
        if (state == Engine.READY && tts != null) {
            task.run(tts);
            return;
        }
        if (state == Engine.FAILED) {
            call.reject(CODE_NO_ENGINE);
            return;
        }

        // Re-checked when it runs rather than assumed: by then onInit has
        // answered, and it may have answered no.
        waiting.add(() -> {
            if (state == Engine.READY && tts != null) {
                task.run(tts);
            } else {
                call.reject(CODE_NO_ENGINE);
            }
        });

        if (state == Engine.ABSENT) start();
    }

    /** Builds an engine and starts the clock on it. */
    @MainThread
    private void start() {
        final int mine = ++generation;
        state = Engine.STARTING;

        try {
            /*
             * Posted rather than run directly, on both paths. TextToSpeech may
             * deliver onInit before its own constructor has returned, and this
             * assignment has to have happened before anything reads `tts`.
             */
            tts = new TextToSpeech(getContext(), (status) -> main.post(() -> initialised(mine, status)));
        } catch (Throwable refused) {
            // A device with no engine at all throws here on some builds rather
            // than reporting an error through onInit.
            tts = null;
            state = Engine.FAILED;
            drain();
            return;
        }

        if (tts == null) {
            state = Engine.FAILED;
            drain();
            return;
        }

        initWatchdog = () -> gaveUp(mine);
        main.postDelayed(initWatchdog, INIT_TIMEOUT_MILLIS);
    }

    /** What the engine said about itself, if anyone is still listening. */
    @MainThread
    private void initialised(int mine, int status) {
        if (mine != generation || state != Engine.STARTING) return;

        cancelWatchdog();

        if (status == TextToSpeech.SUCCESS) {
            state = Engine.READY;
            listen();
            drain();
            return;
        }

        // An engine that answered no is not one to keep bound.
        release();
        state = Engine.FAILED;
        drain();
    }

    /**
     * The engine bound and then said nothing.
     *
     * Everything waiting is answered rather than left pending - a call that
     * hangs is the same silent nothing this plugin exists to end - and the
     * engine is released so that the NEXT call builds a fresh one. Deliberately
     * not FAILED: a timeout says this attempt did not answer in time, not that
     * the device cannot speak, and a phone that was merely busy deserves another
     * try.
     */
    @MainThread
    private void gaveUp(int mine) {
        if (mine != generation || state != Engine.STARTING) return;
        release();
        drain();
    }

    /**
     * Registers the one listener that says when a sentence has been heard.
     *
     * THE FOURTH ARGUMENT TO speak() WAS ALWAYS BEING PASSED AND NOBODY WAS
     * LISTENING. `sg-1`, `sg-2` and so on went to the engine from the first
     * version of this file, because that argument exists for exactly one
     * purpose - matching an utterance to this callback - and there was no
     * callback. The web layer resolved on handover and guessed the rest.
     *
     * Registered once per engine rather than once per sentence: TextToSpeech
     * holds a single listener, so setting one per utterance would be setting
     * the same field over and over and would leave the last one attached to a
     * sentence that had already ended.
     *
     * THESE CALLBACKS DO NOT ARRIVE ON THE MAIN THREAD. Unlike SpeechPlugin's
     * RecognitionListener, which is called back on the looper its recognizer
     * was created on, an UtteranceProgressListener is called from the synthesis
     * service's own thread. Every one of them hops through `onMain` before it
     * touches a field of this class.
     */
    @MainThread
    private void listen() {
        if (tts == null) return;
        try {
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {
                    // Nothing waits on a sentence starting. The web layer asked
                    // for it, so it already knows.
                }

                @Override
                public void onDone(String utteranceId) {
                    onMain(() -> ended(utteranceId, OUTCOME_SPOKEN));
                }

                @Override
                public void onStop(String utteranceId, boolean interrupted) {
                    // Cut off by stop() or flushed by the next sentence. Some
                    // of it was heard, possibly none of it, and nothing here
                    // can say how much - which is what `unknown` means.
                    onMain(() -> ended(utteranceId, OUTCOME_UNKNOWN));
                }

                @Override
                @SuppressWarnings("deprecation")
                public void onError(String utteranceId) {
                    // The deprecated single-argument form, because it is the
                    // abstract one and the two-argument form delegates to it.
                    // Overriding both would answer the same failure twice.
                    onMain(() -> ended(utteranceId, OUTCOME_UNKNOWN));
                }
            });
        } catch (Throwable refused) {
            // An engine that will not take a listener still speaks. Every
            // sentence it reads will end on the watchdog and be reported as
            // `unknown`, which is honest: on that engine nobody can say.
        }
    }

    /** What the engine said about one utterance, if it is still the current one. */
    @MainThread
    private void ended(String utteranceId, String outcome) {
        Utterance current = reading;
        if (current == null || utteranceId == null) return;
        if (!current.id.equals(utteranceId)) return;
        current.finish(outcome);
    }

    /**
     * Answers the sentence in flight, because something is about to end it.
     *
     * Called before the engine is told to stop and before the next sentence
     * flushes it. onStop would report the same thing a moment later, but only
     * on an engine that calls it: doing it here makes an interruption settle at
     * the moment it is caused, on every engine, which is the whole reason the
     * web layer can now be told apart from a promise that hangs.
     */
    @MainThread
    private void flushReading() {
        Utterance current = reading;
        reading = null;
        if (current != null) current.finish(OUTCOME_UNKNOWN);
    }

    /** How long this particular sentence is given before it is given up on. */
    private static long ceiling(String text) {
        return Math.max(SPEAK_FLOOR_MILLIS, (long) text.length() * MILLIS_PER_CHARACTER);
    }

    /** Answers everything that was parked. Each entry re-checks the state itself. */
    @MainThread
    private void drain() {
        List<Runnable> parked = new ArrayList<>(waiting);
        waiting.clear();
        for (Runnable answer : parked) answer.run();
    }

    @MainThread
    private void cancelWatchdog() {
        if (initWatchdog != null) {
            main.removeCallbacks(initWatchdog);
            initWatchdog = null;
        }
    }

    /**
     * Shuts the engine down and resets to ABSENT.
     *
     * The generation is bumped first, so a callback already in flight from the
     * engine being released is ignored when it lands.
     */
    @MainThread
    private void release() {
        generation += 1;
        cancelWatchdog();
        // Whatever was being read is being read no longer, and its call would
        // otherwise wait for an engine that is about to be shut down.
        flushReading();

        TextToSpeech old = tts;
        tts = null;
        state = Engine.ABSENT;

        if (old == null) return;
        try {
            old.stop();
        } catch (Throwable ignored) {
            // Stopping an engine that never bound is not a failure worth
            // propagating over a released audio focus handle.
        }
        try {
            old.shutdown();
        } catch (Throwable ignored) {
            // Nor is shutting one down twice.
        }
    }

    /**
     * Reads one sentence, interrupting anything still being read.
     *
     * QUEUE_FLUSH, which is the native form of the `speechSynthesis.cancel()`
     * the browser path calls before every utterance: an answer that arrives
     * while the last one is still playing must replace it, not queue behind it,
     * or the user hears a stale sentence about a screen they have left.
     *
     * RESOLVES WHEN THE SENTENCE HAS BEEN HEARD, with `spoken` or `unknown`,
     * and it is the UtteranceProgressListener registered in `listen` that says
     * which. It used to resolve on handover, and the reason it did was sound:
     * an engine that never reports the end would leave the call pending
     * forever. The answer to that is a watchdog rather than a guess - see
     * `ceiling` - which is the sixth guard of this shape across the two plugin
     * files and the second in this one.
     *
     * WHY THE END OF A SENTENCE IS WORTH KNOWING. Nothing in this application
     * coordinates audio focus, and there is no echo cancellation anywhere in
     * it. TextToSpeech plays on the media stream and SpeechPlugin records from
     * the microphone, so a microphone opened while this is still talking
     * transcribes the phone rather than the person.
     */
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String tag = call.getString("lang", DEFAULT_LANGUAGE);
        String voiceName = call.getString("voice", "");

        // Empty is a legitimate "nothing to say", not a failure. The web layer
        // stops the previous sentence itself and never gets here with one.
        if (text == null || text.trim().isEmpty()) {
            call.resolve();
            return;
        }

        final String sentence = text;
        final String language = tag == null ? DEFAULT_LANGUAGE : tag;
        final String named = voiceName == null ? "" : voiceName;

        onMain(() -> whenReady(call, (engine) -> say(call, engine, sentence, language, named)));
    }

    @MainThread
    private void say(PluginCall call, TextToSpeech engine, String text, String tag, String voiceName) {
        int available;
        try {
            available = engine.setLanguage(Locale.forLanguageTag(tag));
        } catch (Throwable refused) {
            call.reject(CODE_FAILED);
            return;
        }

        if (available == TextToSpeech.LANG_MISSING_DATA || available == TextToSpeech.LANG_NOT_SUPPORTED) {
            // Said plainly rather than swallowed: an engine that cannot speak
            // this language is a fact the interface can act on, and a `speak`
            // that resolved here would be the silent nothing all over again.
            call.reject(CODE_NO_LANGUAGE);
            return;
        }

        /*
         * After the language, never before: setLanguage resets the voice to the
         * default for that language, so naming a voice first would have it
         * quietly replaced.
         *
         * A named voice that is not installed any more is NOT an error. It falls
         * through to the language default, for the same reason pickVoice does in
         * the web path: a choice that has gone missing must never mean silence.
         */
        if (!voiceName.isEmpty()) choose(engine, voiceName);

        /*
         * QUEUE_FLUSH below ends the sentence in flight, so its call is
         * answered here rather than left to an onStop that a given engine may
         * or may not make.
         */
        flushReading();

        utterance += 1;
        final String id = "sg-" + utterance;

        /*
         * Recorded BEFORE the engine is given the sentence, and the order is
         * deliberate rather than incidental. An engine that answered its own
         * listener from inside speak() - on this thread, before it returned -
         * would otherwise find no utterance to match and the call would wait
         * for a watchdog that had not been armed yet. That is not behaviour
         * anybody here has seen, and it has not been tested: there is no
         * device on the machine this was written on. Registering first costs
         * two unwindings and makes the question moot.
         */
        Utterance mine = new Utterance(call, id);
        reading = mine;

        int queued;
        try {
            queued = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
        } catch (Throwable refused) {
            if (reading == mine) reading = null;
            call.reject(CODE_FAILED);
            return;
        }

        if (queued != TextToSpeech.SUCCESS) {
            // Refused at the door. Nothing is playing and nothing will, so this
            // is a rejection like the two above rather than an outcome.
            if (reading == mine) reading = null;
            call.reject(CODE_FAILED);
            return;
        }

        // Unless it has already ended, which is the case the ordering above is
        // about: `finish` has cleared the slot and answered the call, and a
        // watchdog armed now would only fire into a settled utterance.
        if (reading == mine) mine.arm(ceiling(text));
    }

    /** Selects a voice by the engine's own name for it, if it is still there. */
    @MainThread
    private static void choose(TextToSpeech engine, String voiceName) {
        try {
            Set<Voice> available = engine.getVoices();
            if (available == null) return;
            for (Voice voice : available) {
                if (voice != null && voiceName.equals(voice.getName())) {
                    engine.setVoice(voice);
                    return;
                }
            }
        } catch (Throwable ignored) {
            // Some engines throw from getVoices rather than returning null.
            // Either way the language default speaks, which is the point.
        }
    }

    /**
     * Stops whatever is being read.
     *
     * Resolves rather than rejecting when there is no engine: stopping silence
     * is not a failure, and this runs from teardown paths where refusing to
     * throw matters more than anywhere else. It deliberately does NOT start an
     * engine - building one in order to tell it to be quiet would be absurd.
     */
    @PluginMethod
    public void stop(PluginCall call) {
        onMain(() -> {
            // Before the engine is touched, so the sentence being stopped is
            // answered even on an engine that never calls onStop.
            flushReading();
            if (state == Engine.READY && tts != null) {
                try {
                    tts.stop();
                } catch (Throwable ignored) {
                    // An engine that has gone away has already stopped.
                }
            }
            call.resolve();
        });
    }

    /**
     * Whether anything is being read right now.
     *
     * The welcome asks this before it says good morning, so that it can never
     * talk over an answer somebody actually requested. Like `stop`, it starts no
     * engine: an engine that does not exist is not speaking.
     */
    @PluginMethod
    public void isSpeaking(PluginCall call) {
        onMain(() -> {
            boolean speaking = false;
            if (state == Engine.READY && tts != null) {
                try {
                    speaking = tts.isSpeaking();
                } catch (Throwable ignored) {
                    // Not knowing is reported as not speaking: the cost of
                    // guessing wrong is one sentence cut short, and the cost of
                    // refusing to answer is a welcome that never plays.
                }
            }
            call.resolve(new JSObject().put("speaking", speaking));
        });
    }

    /**
     * Whether this device can speak this language at all.
     *
     * What Settings shows next to "Speech recognition", and the answer that
     * distinguishes "the switch is off" from "there is nothing here to speak
     * with" - a distinction the browser path could never make, because the Web
     * Speech API answers every question about synthesis with silence.
     */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        String tag = call.getString("lang", DEFAULT_LANGUAGE);
        final String language = tag == null ? DEFAULT_LANGUAGE : tag;

        onMain(() -> whenReady(call, (engine) -> {
            boolean available;
            try {
                int supported = engine.isLanguageAvailable(Locale.forLanguageTag(language));
                available = supported >= TextToSpeech.LANG_AVAILABLE;
            } catch (Throwable refused) {
                available = false;
            }
            call.resolve(new JSObject().put("available", available));
        }));
    }

    /**
     * Every voice this engine has for a language.
     *
     * Filtered here by primary subtag, because an engine can list well over a
     * hundred voices and the picker only ever shows one language's worth. The
     * ordering, the labelling and the local-first preference are all decided in
     * TypeScript from these four fields.
     *
     * `networkRequired` is Voice.isNetworkConnectionRequired, and it is the
     * whole reason this method exists rather than a wrapper library's. It is the
     * native form of the web API's `localService` and a more dependable one: the
     * browser guesses, the engine knows.
     */
    @PluginMethod
    public void voices(PluginCall call) {
        String tag = call.getString("lang", DEFAULT_LANGUAGE);
        final String language = tag == null ? DEFAULT_LANGUAGE : tag;

        onMain(() -> whenReady(call, (engine) -> {
            JSObject result = new JSObject();
            result.put("voices", describe(engine, language));
            call.resolve(result);
        }));
    }

    /** The engine's voices for one language, as the web layer wants to read them. */
    @MainThread
    private static JSArray describe(TextToSpeech engine, String tag) {
        JSArray listed = new JSArray();

        Set<Voice> available;
        try {
            available = engine.getVoices();
        } catch (Throwable refused) {
            // An engine that will not enumerate is not an engine that cannot
            // speak: the picker goes empty and the language default still reads.
            return listed;
        }
        if (available == null) return listed;

        String wanted = primary(tag);
        for (Voice voice : available) {
            if (voice == null) continue;

            Locale locale;
            String name;
            try {
                locale = voice.getLocale();
                name = voice.getName();
            } catch (Throwable ignored) {
                continue;
            }
            if (locale == null || name == null) continue;

            String spoken = locale.toLanguageTag();
            if (!primary(spoken).equals(wanted)) continue;

            JSObject described = new JSObject();
            // Untouched, because it is the only thing on this device that says
            // whether the voice is a woman's or a man's - `#female` and `#male`
            // appear literally in these identifiers.
            described.put("name", name);
            described.put("lang", spoken);
            described.put("networkRequired", networkRequired(voice));
            described.put("features", features(voice));
            listed.put(described);
        }

        return listed;
    }

    private static boolean networkRequired(Voice voice) {
        try {
            return voice.isNetworkConnectionRequired();
        } catch (Throwable ignored) {
            // Assumed remote when unknown. The consequence of guessing "local"
            // wrongly is a sentence naming somebody's pantry sent to a synthesis
            // server; the consequence of guessing "remote" wrongly is a slightly
            // shorter list of preferred voices.
            return true;
        }
    }

    /**
     * The engine's own feature flags for a voice, passed through unread.
     *
     * `notInstalled` is the one that matters - a voice whose data has not been
     * downloaded cannot speak - and it is acted on in TypeScript rather than
     * here, where the rule can be tested.
     */
    private static JSArray features(Voice voice) {
        JSArray listed = new JSArray();
        try {
            Set<String> flags = voice.getFeatures();
            if (flags == null) return listed;
            for (String flag : flags) {
                if (flag != null) listed.put(flag);
            }
        } catch (Throwable ignored) {
            // A voice that will not describe itself is still a usable voice.
        }
        return listed;
    }

    /** `pt-BR`, `pt_BR` and `pt` all reduce to `pt`, exactly as voices.ts does. */
    private static String primary(String tag) {
        if (tag == null) return "";
        String normalized = tag.replace('_', '-').toLowerCase(Locale.ROOT);
        int dash = normalized.indexOf('-');
        return dash == -1 ? normalized : normalized.substring(0, dash);
    }

    /**
     * The activity is going away and the engine must not go with it.
     *
     * TextToSpeech holds a bound service and an audio focus handle; a leaked one
     * keeps both after the activity that created it has been destroyed.
     */
    @Override
    protected void handleOnDestroy() {
        onMain(() -> {
            release();
            // Anything still parked would otherwise wait for an onInit that can
            // no longer arrive.
            drain();
        });
        super.handleOnDestroy();
    }
}
