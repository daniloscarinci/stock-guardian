/**
 * Application context: the database, the repositories, settings, and the
 * translation function.
 *
 * One context rather than several, because these values change together and are
 * needed together. The database is the source of truth; nothing here caches a
 * domain value that also lives in a table.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AppContext as StartupContext } from './bootstrap';
import type { Settings } from '../domain/settings';
import { LOCALE_TAGS, translate, type TranslateFn } from '../i18n/translate';
import { todayLocal } from '../domain/dates';
import type { ItemContext } from '../repositories/items.repository';

export interface AppValue extends Omit<StartupContext, 'settings'> {
  readonly settings: Settings;
  readonly t: TranslateFn;
  /** Persists a settings change and updates the interface immediately. */
  readonly updateSettings: (patch: Partial<Settings>) => Promise<void>;
  /** Today, the low-stock threshold and the expiry windows, as the queries need them. */
  readonly itemContext: ItemContext;
  /** Bumped after a write so views re-read from the database. */
  readonly revision: number;
  readonly invalidate: () => void;
}

const Context = createContext<AppValue | null>(null);

export function AppProvider({
  startup,
  children,
}: {
  startup: StartupContext;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<Settings>(startup.settings);
  const [revision, setRevision] = useState(0);

  const invalidate = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      await startup.repositories.settings.save(patch);
      setSettings((current) => ({ ...current, ...patch }));
      setRevision((value) => value + 1);
    },
    [startup.repositories.settings],
  );

  const t = useCallback<TranslateFn>(
    (key, values) => translate(settings.language, key, values),
    [settings.language],
  );

  const itemContext = useMemo<ItemContext>(
    () => ({
      today: todayLocal(),
      defaultThreshold: settings.defaultLowStockThreshold,
      expiryWindows: settings.expiryWarningDays,
    }),
    [settings.defaultLowStockThreshold, settings.expiryWarningDays],
  );

  const value = useMemo<AppValue>(
    () => ({
      ...startup,
      settings,
      t,
      updateSettings,
      itemContext,
      revision,
      invalidate,
    }),
    [startup, settings, t, updateSettings, itemContext, revision, invalidate],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp(): AppValue {
  const value = useContext(Context);
  if (value === null) {
    throw new Error('useApp was called outside AppProvider.');
  }
  return value;
}

/** Convenience for the many components that only need translation. */
export function useTranslate(): TranslateFn {
  return useApp().t;
}

export function useLocaleTag(): string {
  return LOCALE_TAGS[useApp().settings.language];
}
