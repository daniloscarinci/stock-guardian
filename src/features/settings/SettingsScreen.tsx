/**
 * Settings.
 *
 * Everything the application's behaviour depends on, in one place, with the
 * consequences stated next to the control rather than left to be discovered.
 *
 * The diagnostics section is deliberate: an offline application that owns the
 * only copy of someone's data should be able to answer "is my data safe" -
 * where it is stored, whether the browser has promised to keep it, and whether
 * the file is intact.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Alert, Button, Card, Loading } from '../../components/ui/primitives';
import { OptionChip, SelectField, SwitchRow, TextField } from '../../components/ui/Field';
import { selectRecognizer } from '../../services/speech/recognizer';
import {
  createSpeaker,
  listVoices,
  onVoicesChanged,
  speechAvailable,
  type VoiceChoice,
} from '../../services/speech/speak';
import { androidIsSilent } from '../../services/speech/ringer';
import { LOCALE_TAGS } from '../../i18n/translate';
import { BackupPanel } from './BackupPanel';
import { NotificationsPanel } from './NotificationsPanel';
import { requestPersistentStorage, storageEstimate } from '../../app/bootstrap';
import { DATE_FORMATS, LANGUAGES, type DateFormat, type Language } from '../../domain/settings';
import { LATEST_SCHEMA_VERSION } from '../../database/migrations';
import screens from '../screens.module.css';

export function SettingsScreen() {
  const { t, settings, updateSettings, repositories, diagnostics, refreshDiagnostics, db, revision } =
    useApp();

  const [threshold, setThreshold] = useState(String(settings.defaultLowStockThreshold));
  const [windows, setWindows] = useState(settings.expiryWarningDays.join(', '));
  const [apiKey, setApiKey] = useState(settings.anthropicApiKey);
  const [model, setModel] = useState(settings.aiModel);
  const [error, setError] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

  const storage = useAsyncData(() => storageEstimate(), []);
  const persisted = useAsyncData(
    () => (navigator.storage?.persisted?.() ?? Promise.resolve(false)),
    [revision],
  );
  const locations = useAsyncData(
    () => repositories.locations.list(),
    [repositories.locations, revision],
  );
  const categories = useAsyncData(
    () => repositories.categories.list(),
    [repositories.categories, revision],
  );
  const live = useAsyncData(() => refreshDiagnostics(), [refreshDiagnostics, revision]);

  /*
   * What this device can actually do, asked of the device rather than assumed.
   * Per-language on purpose: a phone with an English model and no Portuguese
   * one is ready for one and unavailable for the other, so switching the
   * interface language asks again.
   */
  const speech = useAsyncData(async () => {
    const tag = LOCALE_TAGS[settings.language];
    // The refusal changes the honest answer: a device with no local model for
    // this language can still transcribe over the network, unless its owner has
    // forbidden that. Asked again when the switch moves, for that reason.
    const options = { offlineOnly: settings.voiceOfflineOnly };
    const recognizer = await selectRecognizer(tag, options);
    return { recognizer, tag, availability: await recognizer.availability(tag, options) };
  }, [settings.language, settings.voiceOfflineOnly]);

  const info = live.data ?? diagnostics;

  /*
   * The voices this device has, and the wait for them.
   *
   * THIS LIST WAS ALWAYS EMPTY ON THE PHONE, AND THE PICKER THEREFORE NEVER
   * APPEARED. It read `speechSynthesis.getVoices()`, which inside Android's
   * WebView returns nothing at all - the API is exposed and not implemented. It
   * now goes through the seam, which asks the phone's own TextToSpeech engine
   * and gets back what the engine really has, `#female` markers and all.
   *
   * The wait is still here because the browser still needs it.
   * `speechSynthesis.getVoices()` returns what has loaded so far, and on Chrome
   * the first call after a page load returns nothing; the real list arrives with
   * a `voiceschanged` event a few milliseconds later. `speak.ts` can shrug that
   * off by naming no voice; a picker cannot. An empty menu is a broken control,
   * and one that fills in underneath somebody's finger is worse.
   *
   * So `settled` decides what an empty list is allowed to mean: "still asking"
   * before it, "this device has none" after. The seam reports it, because only
   * the seam knows which platform answered - the native engine is asked after it
   * has initialised and its first answer is final, so nothing there ever says
   * "still asking". The timer is the third case and the reason it is here: a
   * browser with no voices that also never fires the event would say "still
   * asking" forever, which is the broken control wearing a hat.
   *
   * Keyed on the interface language, because that is what is being spoken: the
   * whole list is different, and any voice chosen for the old one is not
   * offered for the new.
   */
  const voiceTag = LOCALE_TAGS[settings.language];
  const [voices, setVoices] = useState<VoiceChoice[]>([]);
  const [voicesSettled, setVoicesSettled] = useState(false);
  const [previewNote, setPreviewNote] = useState<string | null>(null);

  useEffect(() => {
    let dropped = false;

    // `final` is the caller's own claim, and only the `voiceschanged` handler
    // makes it: the platform has said its list is loaded, so an empty one from
    // here on is a device with no voice for this language rather than a device
    // still thinking about it.
    const read = (final: boolean) => {
      void listVoices(voiceTag).then((listing) => {
        if (dropped) return;
        setVoices([...listing.voices]);
        if (final || listing.settled) setVoicesSettled(true);
      });
    };

    read(false);
    const unsubscribe = onVoicesChanged(() => {
      read(true);
    });
    const giveUp = setTimeout(() => {
      if (!dropped) setVoicesSettled(true);
    }, 1500);

    return () => {
      dropped = true;
      unsubscribe();
      clearTimeout(giveUp);
    };
  }, [voiceTag]);

  /*
   * The stored choice, found in the list the way `speak.ts` finds it - by
   * `voiceURI` or by `name`, because an engine that renames one usually keeps
   * the other. `undefined` once the list has settled means the voice is gone,
   * which is a thing to say out loud rather than a value to quietly drop.
   */
  const chosenVoice = voices.find(
    (voice) =>
      voice.voiceURI === settings.speakingVoiceUri || voice.name === settings.speakingVoiceUri,
  );
  const voiceMissing =
    settings.speakingVoiceUri !== '' && voicesSettled && chosenVoice === undefined;

  /*
   * A voice's label: the guess where there is one, and the platform's own name
   * either way.
   *
   * Both, never only the guess. `Female` on its own would be this code's word
   * for something the browser never said, and somebody with four voices needs
   * to tell them apart. The region is shown when it is not the one asked for -
   * a Brazilian offered `pt-PT` should see that before pressing anything - and
   * a server-synthesised voice is marked, because choosing it sends the
   * sentences away.
   */
  const voiceLabel = (voice: VoiceChoice) => {
    const gender =
      voice.gender === null
        ? null
        : t(voice.gender === 'female' ? 'voice.voiceFemale' : 'voice.voiceMale');
    const named = gender === null ? voice.name : `${gender} — ${voice.name}`;
    const region = voice.lang === voiceTag ? named : `${named} [${voice.lang}]`;
    return voice.localService ? region : `${region} (${t('voice.voiceOnline')})`;
  };

  /*
   * A real sentence, in the language the answers come in, and not "test test":
   * the point is to hear the voice saying the kind of thing it will say.
   *
   * IT USED TO DO NOTHING ON THE PHONE, which is what put this whole release in
   * motion. It called `speechSynthesis`, which Android's WebView exposes without
   * implementing, so the press was accepted and no sound was ever made. It now
   * goes through the seam and reaches the phone's own engine.
   *
   * It speaks even when "read answers aloud" is off. The press IS the consent -
   * somebody choosing a voice is on their way to switching that on, and a button
   * that silently does nothing is the failure this whole screen is written
   * against. Both remaining ways for it to stay quiet now SAY SO: the phone's
   * silent switch, which still wins, and a device with no engine for this
   * language, which is the one thing the browser could never tell us and the
   * plugin can.
   */
  const previewVoice = async () => {
    setPreviewNote(null);
    if (await androidIsSilent()) {
      setPreviewNote(t('voice.previewSilent'));
      return;
    }
    if (!(await speechAvailable(voiceTag))) {
      setPreviewNote(t('voice.previewUnavailable'));
      return;
    }
    await createSpeaker(
      () => true,
      () => settings.speakingVoiceUri,
    ).say(t('voice.previewSentence'), voiceTag);
  };

  const saveThreshold = () => {
    const value = Number(threshold);
    // Zero is a legitimate threshold. The original app could not express it:
    // `parseFloat(stored) || 5` turned it back into five on every render.
    if (!Number.isFinite(value) || value < 0) {
      setError(t('errors.validationNegative', { field: t('settings.lowStockThreshold') }));
      return;
    }
    setError(null);
    void updateSettings({ defaultLowStockThreshold: value });
  };

  const saveWindows = () => {
    const parsed = windows
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 3650)
      .sort((a, b) => a - b);

    if (parsed.length === 0) {
      setError(t('errors.validationNumber', { field: t('expiry.windows') }));
      return;
    }
    setError(null);
    void updateSettings({ expiryWarningDays: parsed.slice(0, 6) });
  };

  /**
   * The model, saved as typed - but never saved empty.
   *
   * A blank field would send a request naming no model and be refused by the
   * API with a message about the request rather than about the field, so an
   * empty value puts the stored one back instead.
   */
  const saveModel = () => {
    const value = model.trim();
    if (value === '') {
      setModel(settings.aiModel);
      return;
    }
    void updateSettings({ aiModel: value });
  };

  const runIntegrityCheck = async () => {
    setChecking(true);
    setIntegrity(null);
    try {
      const value = await db.selectValue<string>('PRAGMA integrity_check');
      setIntegrity(String(value ?? 'unknown'));
    } catch (cause) {
      setIntegrity(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChecking(false);
    }
  };

  /**
   * The language pack, downloaded at the user's request.
   *
   * The one place in this feature where a byte crosses the network, and it is
   * the browser fetching on an explicit press rather than the page fetching on
   * its own - which is why the offline audit is right to ignore it, and why
   * this must never happen automatically or without a label saying so.
   */
  const installSpeech = async () => {
    const state = speech.data;
    if (state === undefined || state.recognizer.install === undefined) return;
    setInstalling(true);
    try {
      await state.recognizer.install(state.tag);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(false);
      speech.reload();
    }
  };

  const speechStatus = () => {
    switch (speech.data?.availability) {
      case 'ready':
        return t('voice.ready');
      case 'installable':
        return t('voice.installable');
      case 'unavailable':
        return t('voice.unavailable');
      default:
        return t('common.loading');
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${String(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className={screens.page}>
      <header className={screens.pageHeader}>
        <div>
          <h1 className={screens.pageTitle}>{t('settings.title')}</h1>
        </div>
      </header>

      {error !== null && (
        <Alert tone="critical" role="alert">
          {error}
        </Alert>
      )}

      <Card title={t('settings.general')}>
        <div className={screens.formGrid}>
          <SelectField
            label={t('settings.language')}
            value={settings.language}
            onChange={(event) => {
              void updateSettings({ language: event.target.value as Language });
            }}
          >
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t(`languages.${language}`)}
              </option>
            ))}
          </SelectField>

          <SelectField
            label={t('settings.theme')}
            value={settings.theme}
            onChange={(event) => {
              void updateSettings({ theme: event.target.value as 'dark' | 'light' | 'system' });
            }}
          >
            <option value="dark">{t('settings.themeDark')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="system">{t('settings.themeSystem')}</option>
          </SelectField>

          <SelectField
            label={t('settings.dateFormat')}
            value={settings.dateFormat}
            onChange={(event) => {
              void updateSettings({ dateFormat: event.target.value as DateFormat });
            }}
          >
            {DATE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </SelectField>

          <SelectField
            label={t('settings.measurementSystem')}
            value={settings.measurementSystem}
            onChange={(event) => {
              void updateSettings({
                measurementSystem: event.target.value as 'metric' | 'imperial',
              });
            }}
          >
            <option value="metric">{t('settings.metric')}</option>
            <option value="imperial">{t('settings.imperial')}</option>
          </SelectField>
        </div>
      </Card>

      <Card title={t('settings.inventoryDefaults')}>
        <div className={screens.formGrid}>
          <div>
            <TextField
              label={t('settings.lowStockThreshold')}
              help={t('settings.lowStockHelp')}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={threshold}
              onChange={(event) => {
                setThreshold(event.target.value);
              }}
              onBlur={saveThreshold}
            />
          </div>

          <div>
            <TextField
              label={t('expiry.windows')}
              help={t('expiry.windowsHelp')}
              value={windows}
              onChange={(event) => {
                setWindows(event.target.value);
              }}
              onBlur={saveWindows}
            />
          </div>

          <SelectField
            label={t('settings.defaultLocation')}
            value={settings.defaultLocationId ?? ''}
            onChange={(event) => {
              void updateSettings({
                defaultLocationId: event.target.value === '' ? null : event.target.value,
              });
            }}
          >
            <option value="">{t('common.none')}</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </SelectField>
        </div>
      </Card>

      {/*
        Directly under the warning windows, because it is the same number seen
        from the other side: those decide when a list turns amber, this decides
        whether the phone says so out loud while the application is shut.
      */}
      <NotificationsPanel />

      <Card title={t('preparedness.trackedCategories')} hint={t('preparedness.trackedCategoriesHelp')}>
        <div className={screens.toolbar}>
          {(categories.data ?? []).map((category) => (
            <OptionChip
              key={category.id}
              checked={settings.preparednessCategoryIds.includes(category.id)}
              onChange={(on) => {
                void updateSettings({
                  preparednessCategoryIds: on
                    ? [...settings.preparednessCategoryIds, category.id]
                    : settings.preparednessCategoryIds.filter((id) => id !== category.id),
                });
              }}
            >
              {category.names[settings.language] ?? category.names.en ?? category.id}
            </OptionChip>
          ))}
        </div>
      </Card>

      <Card title={t('voice.title')}>
        <SwitchRow
          label={t('voice.settingEnabled')}
          help={t('voice.settingEnabledHelp')}
          checked={settings.askEnabled}
          onChange={(on) => {
            void updateSettings({ askEnabled: on });
          }}
        />
        <SwitchRow
          label={t('voice.settingSpeak')}
          help={t('voice.settingSpeakHelp')}
          checked={settings.voiceSpeakAnswers}
          onChange={(on) => {
            void updateSettings({ voiceSpeakAnswers: on });
          }}
        />

        {/*
          WHICH voice, and not a female/male toggle.

          What was asked for was a choice between a woman's voice and a man's.
          What the Web Speech API has is a list of names: no gender field, no
          way to ask for one, and on a stock Android phone two Portuguese voices
          called `pt-br-x-afm-local` and `pt-br-x-pte-network`. A two-way toggle
          over that would be this application deciding which of them is the
          woman and being wrong half the time, on the phones that have two - and
          doing nothing at all on the many that ship one.

          So the real voices are the control, `Female` and `Male` are labels
          `inferVoiceGender` puts on the ones whose names admit it, and the note
          under the list says that they are guesses. Where a device has one
          voice, or none, there is no menu: a sentence saying so is the honest
          version of a control with nothing in it.
        */}
        {(voices.length > 1 || settings.speakingVoiceUri !== '') && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <SelectField
              label={t('voice.settingVoice')}
              help={t('voice.settingVoiceHelp')}
              value={chosenVoice?.voiceURI ?? settings.speakingVoiceUri}
              onChange={(event) => {
                void updateSettings({ speakingVoiceUri: event.target.value });
              }}
            >
              <option value="">{t('voice.voiceAutomatic')}</option>
              {voices.map((voice) => (
                <option key={`${voice.voiceURI}|${voice.name}`} value={voice.voiceURI}>
                  {voiceLabel(voice)}
                </option>
              ))}
              {/*
                A stored voice that is no longer installed still has to be the
                selected option, or the menu would show the first voice in the
                list while the setting says something else entirely.
              */}
              {voiceMissing && (
                <option value={settings.speakingVoiceUri}>{t('voice.voiceMissing')}</option>
              )}
            </SelectField>
            <p className={screens.pageSubtitle}>{t('voice.voiceGuessed')}</p>
          </div>
        )}

        {voices.length === 0 && (
          <p className={screens.pageSubtitle} style={{ marginTop: 'var(--space-3)' }}>
            {voicesSettled ? t('voice.voiceNone') : t('voice.voiceLooking')}
          </p>
        )}

        {voices.length === 1 && voices[0] !== undefined && (
          <p className={screens.pageSubtitle} style={{ marginTop: 'var(--space-3)' }}>
            {t('voice.voiceOnlyOne', { name: voiceLabel(voices[0]) })}
          </p>
        )}

        {voiceMissing && (
          <Alert tone="warning" title={t('voice.voiceMissing')}>
            {t('voice.voiceMissingHelp')}
          </Alert>
        )}

        {/*
          A chosen voice that is synthesised on a server is the user's decision
          and is honoured - but the sentences read aloud name what is in
          somebody's pantry, and this application's claim is that it makes no
          request of its own. So the decision is taken in front of the
          consequence rather than behind it.
        */}
        {chosenVoice !== undefined && !chosenVoice.localService && (
          <Alert tone="warning">{t('voice.voiceOnlineChosen')}</Alert>
        )}

        <div className={screens.pageActions} style={{ marginTop: 'var(--space-4)' }}>
          <Button
            onClick={() => {
              void previewVoice();
            }}
          >
            {t('voice.preview')}
          </Button>
          {previewNote !== null && <span className={screens.pageSubtitle}>{previewNote}</span>}
        </div>

        {/*
          Settings already tells the truth about where the data is stored and
          whether the browser has promised to keep it. Speech gets the same
          treatment: what this device can do, said plainly, rather than a
          microphone that silently does nothing.
        */}
        <dl className={screens.definitionList}>
          <dt>{t('voice.availability')}</dt>
          <dd>{speechStatus()}</dd>
        </dl>

        {speech.data?.availability === 'installable' &&
          (speech.data.recognizer.install === undefined ? (
            /*
              Android installs speech packs through its own settings and offers
              no API for it, so the honest thing to show is the path rather than
              a button that cannot work. This is the same wording the ask sheet
              shows after a listen that found no model.
            */
            <Alert tone="warning" title={t('voice.installHow')}>
              {t('voice.installSteps')}
            </Alert>
          ) : (
            <div className={screens.pageActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button
                variant="primary"
                disabled={installing}
                onClick={() => {
                  void installSpeech();
                }}
              >
                {installing ? t('common.loading') : t('voice.install')}
              </Button>
              <span className={screens.pageSubtitle}>{t('voice.installDownloads')}</span>
            </div>
          ))}

        {/*
          The one control over whether recorded speech can ever leave, and it is
          worded as the restriction it is rather than as a permission. Off, the
          phone still transcribes on its own first and usually finishes there;
          what it permits is the second attempt, over the internet, on the
          presses the device could not manage - and the sheet marks those, so
          nothing happens invisibly.

          It is last on purpose: a person reads what this device can do, then
          how to make it do more of it locally, and only then the switch that
          trades a working microphone for an absolute promise.

          The same switch, in the same words, is on the panel that appears when
          a listen fails for want of a local model - which is where somebody
          actually is when the question comes up. Neither place ever writes it
          without a press.
        */}
        <SwitchRow
          label={t('voice.settingOfflineOnly')}
          help={t('voice.settingOfflineOnlyHelp')}
          checked={settings.voiceOfflineOnly}
          onChange={(on) => {
            void updateSettings({ voiceOfflineOnly: on });
          }}
        />
      </Card>

      {/*
        The assistant, and the two unwelcome facts about it.

        Both are stated here rather than in the documentation, because the
        person who pastes the key is the person who pays the bill and the person
        whose phone holds it. The order is deliberate: what it is, then what it
        costs, then what it takes from you, and the switch is first because
        nothing below it does anything while it is off.
      */}
      <Card title={t('ai.title')} hint={t('ai.subtitle')}>
        <SwitchRow
          label={t('ai.settingEnabled')}
          help={t('ai.settingEnabledHelp')}
          checked={settings.aiEnabled}
          onChange={(on) => {
            void updateSettings({ aiEnabled: on });
          }}
        />

        <div className={screens.formGrid} style={{ marginTop: 'var(--space-4)' }}>
          <div>
            {/*
              `type="password"` so a key is not readable over a shoulder. It is
              not encryption and is not offered as any: the value sits in the
              settings table in plain text, which the help text says outright.
            */}
            <TextField
              label={t('ai.apiKey')}
              help={t('ai.apiKeyHelp')}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('ai.apiKeyPlaceholder')}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
              }}
              onBlur={() => {
                void updateSettings({ anthropicApiKey: apiKey.trim() });
              }}
            />
          </div>

          <div>
            <TextField
              label={t('ai.model')}
              help={t('ai.cost')}
              value={model}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setModel(event.target.value);
              }}
              onBlur={saveModel}
            />
          </div>
        </div>

        {/*
          A debug build is `debuggable`, so the key is readable over a cable by
          anyone holding the phone. Said as a warning rather than a footnote,
          because it is the cost of storing a credential in a database on a
          device somebody carries around.
        */}
        <Alert tone="warning">{t('ai.keyAtRest')}</Alert>

        <p className={screens.pageSubtitle} style={{ marginTop: 'var(--space-3)' }}>
          {t('ai.whatIsSent')}
        </p>

        {/*
          Where a key comes from. A link the person follows on purpose, not a
          request this page makes: nothing is fetched from that host, and the
          offline audit still finds no external reference in the build.
        */}
        <p className={screens.pageSubtitle}>
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            {t('ai.getKey')}
          </a>
        </p>
      </Card>

      <section>
        <h2 className={screens.pageTitle} style={{ fontSize: 'var(--text-xl)' }}>
          {t('backup.title')}
        </h2>
        <div style={{ marginTop: 'var(--space-4)' }}>
          <BackupPanel />
        </div>
      </section>

      <Card title={t('settings.diagnostics')} hint={t('settings.dataSubtitle')}>
        {live.loading && live.data === undefined ? (
          <Loading label={t('common.loading')} />
        ) : (
          <dl className={screens.definitionList}>
            <dt>{t('settings.storageEngine')}</dt>
            <dd>{info.vfsName}</dd>

            <dt>{t('settings.sqliteVersion')}</dt>
            <dd>{info.sqliteVersion}</dd>

            <dt>{t('settings.databaseVersion')}</dt>
            <dd>
              v{LATEST_SCHEMA_VERSION}
            </dd>

            <dt>{t('settings.journalMode')}</dt>
            <dd>{info.journalMode}</dd>

            <dt>{t('settings.databaseSize')}</dt>
            <dd>{formatBytes(info.pageCount * info.pageSize)}</dd>

            <dt>{t('settings.integrity')}</dt>
            <dd>{integrity ?? info.integrity}</dd>

            {storage.data !== null && storage.data !== undefined && (
              <>
                <dt>{t('settings.storage')}</dt>
                <dd>
                  {formatBytes(storage.data.usage)} / {formatBytes(storage.data.quota)}
                </dd>
              </>
            )}

            <dt>{t('settings.storagePersistent')}</dt>
            <dd>{persisted.data === true ? t('common.yes') : t('common.no')}</dd>
          </dl>
        )}

        {persisted.data !== true && (
          <Alert tone="warning" title={t('settings.storagePersistentNo')}>
            {t('settings.storagePersistentHelp')}
          </Alert>
        )}

        <div className={screens.pageActions} style={{ marginTop: 'var(--space-4)' }}>
          <Button onClick={() => void runIntegrityCheck()} disabled={checking}>
            {checking ? t('common.loading') : t('settings.runIntegrityCheck')}
          </Button>
          {persisted.data !== true && (
            <Button
              onClick={() => {
                void requestPersistentStorage().then(() => {
                  persisted.reload();
                });
              }}
            >
              {t('settings.requestPersistence')}
            </Button>
          )}
        </div>

        {integrity !== null && (
          <Alert tone={integrity === 'ok' ? 'ok' : 'critical'} role="status">
            {integrity === 'ok'
              ? t('settings.integrityOk')
              : t('settings.integrityFailed', { detail: integrity })}
          </Alert>
        )}
      </Card>
    </div>
  );
}
