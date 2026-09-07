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
import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { Alert, Button, Card, Loading } from '../../components/ui/primitives';
import { OptionChip, SelectField, SwitchRow, TextField } from '../../components/ui/Field';
import { selectRecognizer } from '../../services/speech/recognizer';
import { LOCALE_TAGS } from '../../i18n/translate';
import { BackupPanel } from './BackupPanel';
import { requestPersistentStorage, storageEstimate } from '../../app/bootstrap';
import { DATE_FORMATS, LANGUAGES, type DateFormat, type Language } from '../../domain/settings';
import { LATEST_SCHEMA_VERSION } from '../../database/migrations';
import screens from '../screens.module.css';

export function SettingsScreen() {
  const { t, settings, updateSettings, repositories, diagnostics, refreshDiagnostics, db, revision } =
    useApp();

  const [threshold, setThreshold] = useState(String(settings.defaultLowStockThreshold));
  const [windows, setWindows] = useState(settings.expiryWarningDays.join(', '));
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
    // The opt-in changes the honest answer: a device with no local model for
    // this language can transcribe after all, once its owner has allowed the
    // audio to leave. Asked again when the switch moves, for that reason.
    const options = { allowOnline: settings.voiceAllowOnline };
    const recognizer = await selectRecognizer(tag, options);
    return { recognizer, tag, availability: await recognizer.availability(tag, options) };
  }, [settings.language, settings.voiceAllowOnline]);

  const info = live.data ?? diagnostics;

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
          checked={settings.voiceEnabled}
          onChange={(on) => {
            void updateSettings({ voiceEnabled: on });
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
              a button that cannot work. This is the same wording the voice
              sheet shows after a listen that found no model.
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
          The only control in this application that can send anything off the
          device, so it says what leaves and to whom rather than saying
          "online". It is last on purpose: a person reads what this device can
          do, then how to make it do it locally, and only then the option that
          gives something up. Nothing switches it on but this.
        */}
        <SwitchRow
          label={t('voice.settingAllowOnline')}
          help={t('voice.settingAllowOnlineHelp')}
          checked={settings.voiceAllowOnline}
          onChange={(on) => {
            void updateSettings({ voiceAllowOnline: on });
          }}
        />
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
