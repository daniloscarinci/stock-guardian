/**
 * Everything about a voice that is true on both platforms.
 *
 * The shape of one, the guess at whether it is a woman's or a man's, the order
 * they are offered in, and which one reads a sentence when nobody has chosen.
 * No platform is named here and nothing in this file can speak: it is the half
 * of the speaker that `speechSynthesis` and `android.speech.tts.TextToSpeech`
 * agree about, so the policy exists once and is tested once.
 *
 * It sits beside `speak.ts` for the reason `failure.ts` sits beside the two
 * recognizers - a rule that both implementations obey belongs in neither of
 * them.
 *
 * WHAT THE WEB SPEECH API DOES NOT TELL US, AND WHAT ANDROID DOES.
 * `SpeechSynthesisVoice` exposes `name`, `lang`, `localService`, `voiceURI` and
 * `default`. There is no gender field, no age, no quality, and no way to ask for
 * one - so a person asking to be read to by a woman's voice is asking for
 * something the standard has no word for, and `inferVoiceGender` returns null
 * far more often than it returns an answer.
 *
 * Android's `Voice.getName()` returns identifiers like
 * `pt-br-x-afm#female_1-local`, in which the engine has said outright what the
 * browser had no field for. The rule that reads it was written first and had
 * nothing to read: the WebView's `getVoices()` is empty, so the highest-
 * confidence pattern in this file never once matched on the phone this
 * application is built for. It does now.
 */

/** As much as a voice's name is willing to say, which is usually nothing. */
export type InferredGender = 'female' | 'male';

/** One voice the platform offers, flattened so a component need not hold a live object. */
export interface VoiceChoice {
  readonly voiceURI: string;
  readonly name: string;
  readonly lang: string;
  /**
   * Synthesised on this device rather than on a server.
   *
   * `localService` on the web, `!isNetworkConnectionRequired()` on Android -
   * where it is the engine stating a fact rather than the browser summarising
   * one. It is the field the whole selection below turns on, because a remote
   * voice means the sentence, which names what is in somebody's pantry, is sent
   * away to be spoken.
   */
  readonly localService: boolean;
  /** Guessed from `name`. Null means the name said nothing, not that it is neither. */
  readonly gender: InferredGender | null;
}

/**
 * A device's answer about its voices, and whether it has finished answering.
 *
 * The second half is not decoration. `speechSynthesis.getVoices()` returns what
 * has loaded so far, and on Chrome the first call after a page load returns
 * nothing at all - the real list arrives later with a `voiceschanged` event. The
 * native engine has no such problem: it is asked only once initialisation has
 * succeeded, so its first answer is its final one.
 *
 * A picker cannot tell those two empties apart on its own, and the difference is
 * the whole difference between "still asking" and "this device has none".
 */
export interface VoiceListing {
  readonly voices: readonly VoiceChoice[];
  /** True when nothing more is coming and an empty list means empty. */
  readonly settled: boolean;
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
 *
 * On Android this is now the pattern that usually answers, because
 * `TextToSpeech.getVoices()` returns exactly those identifiers. In a browser it
 * still almost never fires, because `speechSynthesis` renames the same voices to
 * prose like `Portuguese (Brazil)`.
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
export function sameLanguage(voiceLang: string, tag: string): boolean {
  return primaryLanguage(voiceLang) === primaryLanguage(tag);
}

/**
 * The least a voice has to have for anything below to be able to judge it.
 *
 * `SpeechSynthesisVoice` satisfies this structurally, which is what lets the
 * browser path hand its live objects straight to `pickVoice` and get one back -
 * no mapping, no lookup by identifier, no way for the two to disagree about
 * which voice was chosen.
 */
export interface VoiceLike {
  readonly voiceURI: string;
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
}

/**
 * The order voices are offered in, best first.
 *
 * The region actually asked for comes first, so a Brazilian is offered a
 * Brazilian voice above a Portuguese one. Then on-device above
 * server-synthesised, for the reason the whole application exists. Then by name,
 * so the order does not shuffle between renders.
 */
export function sortVoices<T extends VoiceLike>(voices: readonly T[], tag: string): T[] {
  return [...voices].sort((a, b) => {
    const exact = Number(b.lang === tag) - Number(a.lang === tag);
    if (exact !== 0) return exact;
    const local = Number(b.localService) - Number(a.localService);
    if (local !== 0) return local;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The voice for one utterance: the stored choice, or the local-first fallback.
 *
 * THE FALLBACK IS UNCHANGED, and the comment it was written with still holds.
 *
 * Both platforms offer server-synthesised voices alongside on-device ones, and
 * the remote voice is often both first in the list and the better-sounding one.
 * Picking it would send the answer - which names what is in someone's pantry -
 * to a synthesis service, in an application whose whole claim is that it makes
 * no network request of its own.
 *
 * ON ANDROID THIS GOT STRONGER RATHER THAN BEING LOST. The browser's
 * `localService` is a summary; `Voice.isNetworkConnectionRequired()` is the
 * engine stating a requirement. Same field, better source.
 *
 * When no local voice matches, no voice is named and `lang` alone is left to the
 * platform. That can still resolve to a remote voice, which is why
 * docs/OFFLINE.md states this as a best effort rather than a guarantee - neither
 * API offers a way to refuse.
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
export function pickVoice<T extends VoiceLike>(
  voices: readonly T[],
  tag: string,
  chosen: string,
): T | undefined {
  if (chosen !== '') {
    // `voiceURI` is the identifier and `name` is the label, so `voiceURI` is
    // what is stored - but Chrome sets the two to the same string, Android has
    // only one string to give, and an engine that changes one between releases
    // has usually kept the other. Matching either costs nothing and rescues a
    // choice that would otherwise silently revert. The language still has to
    // agree: a Portuguese voice reading English is not the choice anybody made.
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
   * This compared `candidate.lang === tag` once, and for two languages out of
   * three that could never match anything: `LOCALE_TAGS` says `en` and `es`
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
