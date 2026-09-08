/**
 * Reading an answer aloud, and choosing the voice that reads it.
 *
 * `speechSynthesis` is a system service, not a network request: the audit
 * scans for constructs that fetch, and this is not one.
 *
 * `enabled` is a function rather than a boolean so a settings change takes
 * effect on the next sentence without rebuilding the speaker. Android's ringer
 * switch is NOT consulted here - this module has no platform knowledge. The
 * voice sheet composes the two, which keeps this testable without a Capacitor
 * bridge. `chosenVoiceUri` is a function for the same reason.
 *
 * WHAT THE WEB SPEECH API DOES NOT TELL US. `SpeechSynthesisVoice` exposes
 * `name`, `lang`, `localService`, `voiceURI` and `default`. There is no gender
 * field, no age, no quality, and no way to ask for one. A person asking to be
 * read to by a woman's voice is asking for something the standard has no word
 * for, so everything below is inference from the one free-text field there is,
 * and `inferVoiceGender` returns null far more often than it returns an answer.
 * docs/VOICE.md says the same thing to the person using the application.
 */

/** As much as a voice's name is willing to say, which is usually nothing. */
export type InferredGender = 'female' | 'male';

/** One voice the platform offers, flattened so a component need not hold a live object. */
export interface VoiceChoice {
  readonly voiceURI: string;
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
  /** Guessed from `name`. Null means the name said nothing, not that it is neither. */
  readonly gender: InferredGender | null;
}

export interface Speaker {
  readonly say: (text: string, tag: string) => Promise<void>;
  readonly stop: () => void;
}

function getSynth(): SpeechSynthesis | undefined {
  return (globalThis as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
}

/** Accents removed and lowercased, so `Monica` and `MASCULINO` match the tables below. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * The explicit marker, and the only pattern here that is not a guess.
 *
 * Newer Google TTS voice identifiers carry it literally:
 * `en-us-x-tpf#female_1-local`, `pt-br-x-afm#male_2-network`. When it is there
 * the engine has said what it is, and nothing else in this file is needed.
 */
const EXPLICIT_MARKER = /#(female|male)/;

/**
 * The word, spelled out, in the three interface languages and in English.
 *
 * Engines that are not Google's often name the voice in prose:
 * `Portugues (Brasil) - Feminino`, `Spanish (Spain) Male`. Whole words only,
 * and female is tested first, so `woman` is never reduced to `man`.
 */
const FEMALE_WORD =
  /\b(female|feminine|feminino|feminina|femenino|femenina|mulher|mujer|woman|women)\b/;
const MALE_WORD = /\b(male|masculine|masculino|masculina|homem|hombre|man|men)\b/;

/**
 * The given name, which is the weakest signal here and is treated as such.
 *
 * Apple, Microsoft and a few Android engines name voices after people, and a
 * person reading `Luciana` in a list knows what they are choosing far better
 * than one reading `pt-br-x-afm-local`. The lists are deliberately short: only
 * voices that actually ship for English, Portuguese and Spanish, only names
 * whose gender is not in dispute, and nothing ambiguous. Apple's `Eddy`, `Flo`,
 * `Reed`, `Rocko`, `Sandy`, `Shelley` and `Grandma`/`Grandpa` now ship in male
 * and female variants under the same name, so they are in neither list and
 * infer nothing - which is the correct answer for them.
 */
const FEMALE_NAMES = new Set([
  'alice', 'allison', 'ana', 'angelica', 'aria', 'ava', 'camila', 'carmen', 'catarina',
  'elena', 'elsa', 'emma', 'esperanza', 'eva', 'fiona', 'francisca', 'hazel', 'helena',
  'ines', 'isabela', 'isabella', 'jenny', 'joana', 'julia', 'karen', 'kate', 'laura',
  'linda', 'lucia', 'luciana', 'maria', 'marisol', 'michelle', 'monica', 'nora', 'olivia',
  'paulina', 'penelope', 'rosa', 'sabina', 'samantha', 'sara', 'sarah', 'sofia', 'sonia',
  'susan', 'tessa', 'victoria', 'vitoria', 'zira', 'zoe',
]);

const MALE_NAMES = new Set([
  'aaron', 'alex', 'alonso', 'andrew', 'antonio', 'arthur', 'brian', 'bruce', 'carlos',
  'christopher', 'daniel', 'david', 'diego', 'duarte', 'eduardo', 'enrique', 'eric',
  'fabio', 'felipe', 'fernando', 'fred', 'george', 'guillermo', 'gustavo', 'guy', 'james',
  'joaquin', 'jorge', 'juan', 'liam', 'lucas', 'marcos', 'mark', 'miguel', 'nathan',
  'oliver', 'pablo', 'paulo', 'pedro', 'rafael', 'raul', 'ricardo', 'roberto', 'rui',
  'ryan', 'sergio', 'thiago', 'thomas', 'tiago', 'tom', 'william',
]);

/**
 * Guesses whether a voice is female or male from its name. A GUESS.
 *
 * Three patterns, in descending order of what they are worth:
 *
 *   1. `#female` / `#male` in the identifier. The engine said so outright.
 *   2. The word itself - `Feminino`, `Male`, `Masculino`. Also said so, in prose.
 *   3. A given name from the short tables above. An inference about a name, and
 *      the first of these three that can be wrong.
 *
 * WHAT IS DELIBERATELY NOT DECODED: Google TTS's three-letter private-use code,
 * as in `pt-br-x-afm-local` or `pt-br-x-pte-network`. It is tempting to read the
 * last letter of `afm` as a gender, and that rule does not survive contact with
 * the rest of the set - `en-gb-x-gba`, `gbb`, `gbc` and `gbd` are four voices of
 * mixed gender lettered in sequence, and `es-es-x-eea` and `eef` are the same
 * story. Any rule that produces an answer for `afm` produces a wrong one for
 * those, and a coin flip presented to somebody as a fact is worse than saying
 * nothing. So these infer nothing, and the picker shows the platform's own name
 * for the voice instead - which is the honest label for a voice nobody, this
 * code included, can describe any better.
 */
export function inferVoiceGender(name: string): InferredGender | null {
  const folded = fold(name);

  const explicit = EXPLICIT_MARKER.exec(folded);
  if (explicit !== null) return explicit[1] === 'female' ? 'female' : 'male';

  if (FEMALE_WORD.test(folded)) return 'female';
  if (MALE_WORD.test(folded)) return 'male';

  for (const token of folded.split(/[^a-z]+/)) {
    if (FEMALE_NAMES.has(token)) return 'female';
    if (MALE_NAMES.has(token)) return 'male';
  }

  return null;
}

/** `pt-BR`, `pt_BR` and `pt` all reduce to `pt`. */
function primaryLanguage(tag: string): string {
  const [primary = ''] = tag.toLowerCase().replace(/_/g, '-').split('-');
  return primary;
}

/**
 * Whether a voice belongs to the language being spoken, by primary subtag.
 *
 * Looser than the automatic selection below, and on purpose. The interface tags
 * are `en`, `pt-BR` and `es`, while voices are named `en-GB`, `pt-PT`, `es-419`
 * and so on: a picker that demanded an exact match would be empty for two of the
 * three languages, which is not a picker. The list shows a voice's own tag when
 * it differs, so nobody is offered European Portuguese without being told that
 * is what it is.
 */
function sameLanguage(voiceLang: string, tag: string): boolean {
  return primaryLanguage(voiceLang) === primaryLanguage(tag);
}

/**
 * The voices this device offers for a language, best first.
 *
 * MAY LEGITIMATELY BE EMPTY, and empty does not mean the device has no voices.
 * `getVoices()` returns what has been loaded so far, and on Chrome the first
 * call after a page load returns nothing at all; the list arrives later and the
 * platform fires `voiceschanged`. A caller drawing a control from this has to
 * pair it with `onVoicesChanged` - see the picker in SettingsScreen, which does,
 * and which says it is still looking rather than drawing an empty menu.
 */
export function listVoices(tag: string): VoiceChoice[] {
  const synth = getSynth();
  if (synth === undefined || typeof synth.getVoices !== 'function') return [];

  return synth
    .getVoices()
    .filter((voice) => sameLanguage(voice.lang, tag))
    .map((voice) => ({
      voiceURI: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      localService: voice.localService,
      gender: inferVoiceGender(voice.name),
    }))
    .sort((a, b) => {
      // The region actually asked for first, so a Brazilian is offered a
      // Brazilian voice above a Portuguese one. Then on-device above
      // server-synthesised, for the reason the whole application exists. Then by
      // name, so the order does not shuffle between renders.
      const exact = Number(b.lang === tag) - Number(a.lang === tag);
      if (exact !== 0) return exact;
      const local = Number(b.localService) - Number(a.localService);
      if (local !== 0) return local;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Calls back when the platform finishes loading its voices.
 *
 * Returns an unsubscribe, and a harmless one where there is no
 * `speechSynthesis` at all or where it predates `addEventListener` - a device
 * that cannot tell us is a device whose first list is the only list there will
 * ever be.
 */
export function onVoicesChanged(listener: () => void): () => void {
  const synth = getSynth();
  if (synth === undefined || typeof synth.addEventListener !== 'function') {
    return () => {
      // Nothing was subscribed, so there is nothing to undo.
    };
  }
  synth.addEventListener('voiceschanged', listener);
  return () => {
    synth.removeEventListener('voiceschanged', listener);
  };
}

/**
 * The voice for one utterance: the stored choice, or the local-first fallback.
 *
 * THE FALLBACK IS UNCHANGED, and the comment it was written with still holds.
 *
 * `speechSynthesis` offers server-synthesised voices alongside on-device ones,
 * and on a desktop browser the remote voice is often both first in the list and
 * the better-sounding one. Picking it would send the answer - which names what
 * is in someone's pantry - to a synthesis service, in an application whose whole
 * claim is that it makes no network request of its own. `localService` is how
 * the platform distinguishes them.
 *
 * When no local voice matches, no voice is named and `lang` alone is left to the
 * platform. That can still resolve to a remote voice, which is why
 * docs/OFFLINE.md states this as a best effort rather than a guarantee - the API
 * offers no way to refuse.
 *
 * WHAT THE STORED CHOICE CHANGES, AND WHAT IT DOES NOT. A named voice wins,
 * including a remote one: that is the user's decision, taken in Settings beside
 * a label saying the voice is synthesised over the internet, and overriding it
 * would be deciding for them. What it does not change is this fallback. A stored
 * voice that is not on the device any more - a language pack uninstalled, the
 * interface language switched to one the voice does not speak, a phone restored
 * from another phone's backup - falls through to exactly the selection that ran
 * before there was a setting, local-first and all. A choice that has gone
 * missing must never mean silence.
 */
function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  tag: string,
  chosen: string,
): SpeechSynthesisVoice | undefined {
  if (chosen !== '') {
    // `voiceURI` is the identifier and `name` is the label, so `voiceURI` is
    // what is stored - but Chrome sets the two to the same string, and an engine
    // that changes one between releases has usually kept the other. Matching
    // either costs nothing and rescues a choice that would otherwise silently
    // revert. The language still has to agree: a Portuguese voice reading
    // English is not the choice anybody made.
    const named = voices.find(
      (candidate) =>
        sameLanguage(candidate.lang, tag) &&
        (candidate.voiceURI === chosen || candidate.name === chosen),
    );
    if (named !== undefined) return named;
  }

  /*
   * The automatic choice, when nothing was picked.
   *
   * This compared `candidate.lang === tag` until now, and for two languages out
   * of three that could never match anything: `LOCALE_TAGS` says `en` and `es`
   * while real voices report `en-US`, `en-GB`, `es-ES`, `es-MX`. So the
   * local-first preference - the whole reason this function prefers
   * `localService`, since a remote voice sends the sentence to a synthesis
   * service - silently did nothing outside Portuguese.
   *
   * An exact region match is still preferred where one exists, because
   * `pt-BR` should not settle for `pt-PT` while the right voice is installed.
   */
  const local = voices.filter((candidate) => candidate.localService);
  return (
    local.find((candidate) => candidate.lang === tag) ??
    local.find((candidate) => sameLanguage(candidate.lang, tag))
  );
}

export function createSpeaker(
  enabled: () => boolean,
  chosenVoiceUri: () => string = () => '',
): Speaker {
  return {
    async say(text, tag) {
      if (!enabled()) return;
      const synth = getSynth();
      const Utterance = (globalThis as unknown as {
        SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance;
      }).SpeechSynthesisUtterance;
      if (synth === undefined || Utterance === undefined) return;

      // An answer that arrives while the last one is still being read would
      // otherwise queue, and the user would hear a stale sentence first.
      synth.cancel();

      // Empty text is a legitimate answer meaning "nothing to say now", so the
      // check sits AFTER the cancel, not in the guard above. Returning early on
      // it used to skip the cancel entirely, which left the previous sentence
      // reading on over a screen that had already moved on - precisely the stale
      // answer the cancel exists to stop.
      if (text === '') return;

      const utterance = new Utterance(text);
      utterance.lang = tag;

      // Read fresh on every sentence rather than captured when the speaker was
      // built: this is the same call that is empty on first use, so a voice that
      // arrives a moment later is used by the next answer with nothing rebuilt.
      const voice = pickVoice(synth.getVoices(), tag, chosenVoiceUri());
      if (voice !== undefined) utterance.voice = voice;

      synth.speak(utterance);
    },

    stop() {
      getSynth()?.cancel();
    },
  };
}
