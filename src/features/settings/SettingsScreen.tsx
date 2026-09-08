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
  const [apiKey, setApiKey] = useState(settings.anthropicApiKey);
  const [model, setModel] = useState(settings.aiModel);
  const [error, setError] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

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
          checked={settings.askEnabled}
          onChange={(on) => {
            void updateSettings({ askEnabled: on });
          }}
        />
        {/*
          What is left of voice, and the half that worked. The microphone was
          removed - Android's recognizer refuses to transcribe offline with no
          Portuguese pack installed - and reading an answer aloud was not, so
          this setting stays and means exactly what it says.
        */}
        <SwitchRow
          label={t('voice.settingSpeak')}
          help={t('voice.settingSpeakHelp')}
          checked={settings.voiceSpeakAnswers}
          onChange={(on) => {
            void updateSettings({ voiceSpeakAnswers: on });
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
