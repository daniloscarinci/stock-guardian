/**
 * "The first one" - a spoken answer to "Which one?", and nothing else.
 *
 * WHY THIS IS NOT A GRAMMAR RULE, which is the first question anybody sensible
 * asks. Two reasons, and both of them are about where a rule can be reached
 * from:
 *
 *   `parse` walks the rules in order and takes the first that matches, and that
 *   order is load-bearing - `parse.test.ts` pins it. A rule matching "the first
 *   one" would sit somewhere in that list and would be tried against every
 *   sentence anybody ever says, including the ones nobody meant it for.
 *
 *   A grammar intent is reachable from the typed box and appears in HELP's
 *   example list. "Say: the first one" is a nonsense instruction with no
 *   question standing, and an intent that answers a question nobody asked would
 *   have to decide what to do about it.
 *
 * So this is a separate closed vocabulary with one caller in the application:
 * `useVoice`, in exactly one state, having just read a list of names out loud
 * and listening for which of them was meant. Nothing else imports it, and there
 * is no path to it from the typed box.
 *
 * WHOLE UTTERANCE, NEVER A SUBSTRING. "first thing tomorrow" contains "first"
 * and means nothing of the kind, and a substring match would turn a sentence
 * about the morning into a silent pick from a list. The whole utterance is
 * folded, stripped of the punctuation a recognizer adds, and compared for
 * equality against a fixed table. Anything that is not in the table is not an
 * answer, and the caller stops rather than guessing.
 *
 * THE NAMES ANSWER TOO, and they are the more natural answer. The question that
 * was just read out was "Which one? Arroz Branco, Arroz Integral", so "arroz
 * branco" is what a person says back - saying "the first one" requires having
 * counted. A name matches on the same terms as an ordinal: the whole utterance,
 * folded, equal to the whole name, and only against the items that were named
 * aloud. Where two of the offered items fold to the same string the answer is
 * ambiguous and is refused, because picking one of two rows with the same name
 * is the guess this whole "Which one?" arrangement exists to avoid.
 *
 * THREE, BECAUSE THREE IS WHAT WAS SAID. `answer.ts` names at most three items
 * and counts the rest - forty names read aloud is noise - so the table below
 * stops at "third". A fourth ordinal has no referent: nobody heard a fourth
 * name, so "the fourth one" is somebody counting a list they cannot hear. The
 * caller passes only the items its question actually named, so the length of
 * that array is the second half of the same cap.
 */
import { foldText } from '../domain/normalize';
import type { Language } from '../domain/settings';
import { stripPunctuation } from './parse';

/**
 * Whole utterances that name a position, to the 1-based position they name.
 *
 * Written out in full rather than assembled from a stem and a list of articles,
 * because a closed list is only closed if you can read it. Every entry is a
 * complete thing somebody says on its own after hearing two or three names.
 *
 * Both genders in Spanish and Portuguese, because the article and the ending
 * agree with a noun that was never spoken: a speaker looking at "Arroz Branco"
 * says "o primeiro" and one thinking of "a marca" says "a primeira", and
 * neither of them is wrong about a list this module cannot see the gender of.
 *
 * A BARE NUMBER IS NOT IN HERE. "one", "dois", "3" are quantities in every
 * other sentence this application listens to, and a person who says "two"
 * after hearing two names may as easily be answering a different question or
 * correcting the sentence before. The counted forms - "number two", "el numero
 * dos", "o numero dois" - name a position and nothing else, so all three
 * languages list theirs; the bare numeral is refused, and refusing leaves the
 * list on the screen with its buttons still on it, which is the safe way to be
 * wrong.
 */
const ORDINALS: Readonly<Record<Language, Readonly<Record<string, number>>>> = {
  en: {
    first: 1,
    'the first': 1,
    'first one': 1,
    'the first one': 1,
    'number one': 1,
    'the number one': 1,
    second: 2,
    'the second': 2,
    'second one': 2,
    'the second one': 2,
    'number two': 2,
    third: 3,
    'the third': 3,
    'third one': 3,
    'the third one': 3,
    'number three': 3,
  },
  es: {
    primero: 1,
    primera: 1,
    'el primero': 1,
    'la primera': 1,
    'el primer': 1,
    'numero uno': 1,
    'el numero uno': 1,
    segundo: 2,
    segunda: 2,
    'el segundo': 2,
    'la segunda': 2,
    'numero dos': 2,
    'el numero dos': 2,
    tercero: 3,
    tercera: 3,
    'el tercero': 3,
    'la tercera': 3,
    'el tercer': 3,
    'numero tres': 3,
    'el numero tres': 3,
  },
  'pt-BR': {
    primeiro: 1,
    primeira: 1,
    'o primeiro': 1,
    'a primeira': 1,
    'numero um': 1,
    'o numero um': 1,
    segundo: 2,
    segunda: 2,
    'o segundo': 2,
    'a segunda': 2,
    'numero dois': 2,
    'o numero dois': 2,
    terceiro: 3,
    terceira: 3,
    'o terceiro': 3,
    'a terceira': 3,
    'numero tres': 3,
    'o numero tres': 3,
  },
};

/**
 * Which of the offered names was answered, as an index into `names`, or null.
 *
 * `names` is the list the question actually read out, in the order it read
 * them, and it is the only thing an answer may resolve to. A position past the
 * end of it is refused rather than clamped: "the third one" after a question
 * that named two is somebody who misheard, and picking the second would be
 * answering a question they did not ask.
 *
 * An ordinal beats a name, in the one case where an item is called "Primeiro"
 * and is also one of the choices. Either reading picks a row that was just read
 * aloud and neither writes anything, so the tie is broken by the reading the
 * question invited: the sentence the user had just heard was a numbered list.
 */
export function matchChoice(
  language: Language,
  said: string,
  names: readonly string[],
): number | null {
  const heard = stripPunctuation(foldText(said));
  if (heard === '') return null;

  const place = ORDINALS[language][heard];
  if (place !== undefined) return place <= names.length ? place - 1 : null;

  // The same normalization on both sides, so "Arroz, Integral" and "arroz
  // integral" are the same answer. An empty name matches nothing: a row with a
  // blank name is not something anybody can have said.
  const matches: number[] = [];
  names.forEach((name, index) => {
    const folded = stripPunctuation(foldText(name));
    if (folded !== '' && folded === heard) matches.push(index);
  });

  return matches.length === 1 ? (matches[0] ?? null) : null;
}
