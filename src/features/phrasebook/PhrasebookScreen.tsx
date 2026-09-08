/**
 * The phrasebook: everything the ask box understands, in all three languages at
 * once.
 *
 * `docs/VOICE.md` says the same things, in a repository the person this was
 * built for will never open. This is that document in his hand, offline, on the
 * device that has to answer him.
 *
 * All three languages are shown together rather than only the interface one.
 * Somebody whose Portuguese is first often knows the English word for a thing,
 * and three ways of saying the same sentence teaches the shape of what the
 * parser accepts far better than one does.
 *
 * The screen renders `phrases.ts` and holds no phrases of its own, because
 * every phrase in that file is put through the real parser by a test. Nothing
 * can appear here that the application does not understand.
 */
import { useApp } from '../../app/AppContext';
import { Card } from '../../components/ui/primitives';
import { cx } from '../../components/ui/cx';
import { LOCALE_TAGS } from '../../i18n/translate';
import type { Language } from '../../domain/settings';
import {
  LANGUAGE_ENDONYM,
  PHRASEBOOK_CHROME,
  PHRASEBOOK_ENTRIES,
  PHRASEBOOK_NOTES,
  phrasebookLanguages,
  type PhrasebookEntry,
} from './phrases';
import screens from '../screens.module.css';
import styles from './Phrasebook.module.css';

/**
 * One row: what it is for, then the same thing said in three languages.
 *
 * The label is in the reader's language and the phrases are in all of them.
 * Each column names its own language, so the stack a narrow screen turns this
 * into stays readable - see the comment on `.columns`.
 */
function Entries({
  entries,
  primary,
}: {
  readonly entries: readonly PhrasebookEntry[];
  readonly primary: Language;
}) {
  const languages = phrasebookLanguages(primary);

  return (
    <ul className={styles.entries} role="list">
      {entries.map((entry) => (
        <li key={entry.id} className={styles.entry}>
          <h3 className={styles.entryLabel}>{entry.label[primary]}</h3>
          <div className={styles.columns}>
            {languages.map((language) => (
              <div
                key={language}
                className={cx(styles.column, language === primary && styles.primary)}
                lang={LOCALE_TAGS[language]}
              >
                <span className={styles.tag}>{LANGUAGE_ENDONYM[language]}</span>
                <ul className={styles.phrases} role="list">
                  {entry.phrases[language].map((phrase) => (
                    <li key={phrase.text} className={styles.phrase}>
                      {phrase.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PhrasebookScreen() {
  const { settings } = useApp();
  const primary = settings.language;
  const languages = phrasebookLanguages(primary);

  const asking = PHRASEBOOK_ENTRIES.filter((entry) => entry.section === 'asking');
  const changing = PHRASEBOOK_ENTRIES.filter((entry) => entry.section === 'changing');

  return (
    <div className={screens.page}>
      <header className={screens.pageHeader}>
        <div>
          <h1 className={screens.pageTitle}>{PHRASEBOOK_CHROME.title[primary]}</h1>
          <p className={screens.pageSubtitle}>{PHRASEBOOK_CHROME.subtitle[primary]}</p>
        </div>
      </header>

      <Card
        title={PHRASEBOOK_CHROME.asking[primary]}
        hint={PHRASEBOOK_CHROME.askingHint[primary]}
        className={styles.asking}
      >
        <Entries entries={asking} primary={primary} />
      </Card>

      <Card
        title={PHRASEBOOK_CHROME.changing[primary]}
        hint={PHRASEBOOK_CHROME.changingHint[primary]}
        className={styles.changing}
      >
        <Entries entries={changing} primary={primary} />
      </Card>

      {/* Not phrases, so not rows: how a number and how a date may be said. */}
      <div className={screens.columns}>
        {PHRASEBOOK_NOTES.map((note) => (
          <Card key={note.id} title={note.title[primary]} hint={note.body[primary]}>
            <div className={styles.noteLanguages}>
              {languages.map((language) => (
                <div
                  key={language}
                  className={cx(styles.column, language === primary && styles.primary)}
                  lang={LOCALE_TAGS[language]}
                >
                  <span className={styles.tag}>{LANGUAGE_ENDONYM[language]}</span>
                  <ul className={styles.examples} role="list">
                    {note.examples[language].map((example) => (
                      <li key={example} className={styles.example}>
                        {example}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
