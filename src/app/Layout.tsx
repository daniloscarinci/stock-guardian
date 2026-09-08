/**
 * The application shell: navigation, header, and the mobile quick-action bar.
 *
 * Desktop gets a persistent sidebar. Below 60rem it becomes a slide-over drawer
 * and a fixed bar of the actions someone actually needs in a hurry appears at
 * the bottom, within thumb reach.
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './AppContext';
import { Button } from '../components/ui/primitives';
import { LANGUAGES, type Language } from '../domain/settings';
import { LOCALE_TAGS } from '../i18n/translate';
import {
  CatalogIcon,
  CategoryIcon,
  ContactsIcon,
  DashboardIcon,
  ExpiryIcon,
  InventoryIcon,
  LocationIcon,
  MenuIcon,
  ReplenishIcon,
  ReportsIcon,
  PhrasebookIcon,
  SettingsIcon,
  type IconComponent,
} from '../components/ui/icons';
import { cx } from '../components/ui/cx';
import { VoiceButton } from '../features/voice/VoiceButton';
import styles from './Layout.module.css';

interface NavEntry {
  readonly to: string;
  readonly labelKey: string;
  readonly Icon: IconComponent;
  readonly badge?: number | undefined;
}

export function Layout({ attentionCount }: { readonly attentionCount: number }) {
  const { t, settings, updateSettings } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // The drawer must not survive a navigation, or tapping a link on a phone
  // leaves it covering the page it just opened.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Keeps assistive technology and hyphenation rules in step with the chosen
  // language. The original app declared lang="pt-br" and never updated it, so a
  // screen reader pronounced the English interface with Portuguese rules.
  useEffect(() => {
    document.documentElement.lang = LOCALE_TAGS[settings.language];
  }, [settings.language]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    document.title = `${t('app.name')} — ${t('app.tagline')}`;
  }, [t]);

  const entries: NavEntry[] = [
    { to: '/', labelKey: 'nav.dashboard', Icon: DashboardIcon },
    { to: '/inventory', labelKey: 'nav.inventory', Icon: InventoryIcon },
    { to: '/expiration', labelKey: 'nav.expiration', Icon: ExpiryIcon, badge: attentionCount },
    { to: '/replenishment', labelKey: 'nav.replenishment', Icon: ReplenishIcon },
    { to: '/catalog', labelKey: 'nav.catalog', Icon: CatalogIcon },
    { to: '/locations', labelKey: 'nav.locations', Icon: LocationIcon },
    { to: '/categories', labelKey: 'nav.categories', Icon: CategoryIcon },
    { to: '/contacts', labelKey: 'nav.contacts', Icon: ContactsIcon },
    { to: '/reports', labelKey: 'nav.reports', Icon: ReportsIcon },
    { to: '/phrasebook', labelKey: 'nav.phrasebook', Icon: PhrasebookIcon },
    { to: '/settings', labelKey: 'nav.settings', Icon: SettingsIcon },
  ];

  return (
    <div className={styles.shell}>
      <a className="sr-only sr-only-focusable" href="#main-content">
        {t('a11y.skipToContent')}
      </a>

      {menuOpen && (
        <button
          type="button"
          className={styles.scrim}
          aria-label={t('nav.close')}
          onClick={() => {
            setMenuOpen(false);
          }}
        />
      )}

      <nav
        className={cx(styles.sidebar, menuOpen && styles.sidebarOpen)}
        aria-label={t('a11y.mainNavigation')}
      >
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            SG
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>{t('app.name')}</span>
            <span className={styles.brandTagline}>{t('app.tagline')}</span>
          </span>
        </div>

        <ul className={styles.nav} role="list">
          {entries.map((entry) => (
            <li key={entry.to}>
              <NavLink
                to={entry.to}
                end={entry.to === '/'}
                className={({ isActive }) =>
                  cx(styles.navLink, isActive && styles.navLinkActive)
                }
              >
                <span className={styles.navIcon}>
                  <entry.Icon />
                </span>
                {t(entry.labelKey)}
                {entry.badge !== undefined && entry.badge > 0 && (
                  <span className={styles.navCount}>{entry.badge}</span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        {/*
          States the property the application is built around, rather than
          repeating the tagline already shown above the navigation.
        */}
        <div className={styles.sidebarFooter}>
          <p className={styles.offlineNote}>{t('app.worksOffline')}</p>
        </div>
      </nav>

      <div className={styles.main}>
        <header className={styles.header}>
          <Button
            className={styles.menuButton}
            variant="ghost"
            iconOnly
            aria-label={t('nav.menu')}
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
          >
            <MenuIcon />
          </Button>

          <span className={styles.headerSpacer} />

          <div className={styles.headerActions}>
            {/*
              First among the header controls, so the fastest way into the
              application is also the first thing a keyboard reaches. Renders
              nothing at all when asking is switched off.
            */}
            <VoiceButton />

            <label className="sr-only" htmlFor="language-select">
              {t('settings.language')}
            </label>
            <select
              id="language-select"
              className={styles.languageSelect}
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
            </select>
          </div>
        </header>

        <main className={styles.content} id="main-content" tabIndex={-1}>
          <Outlet />
        </main>

        <div className={styles.quickBar}>
          <Button
            variant="primary"
            onClick={() => {
              void navigate('/inventory?new=1');
            }}
          >
            + {t('common.add')}
          </Button>
          <Button
            onClick={() => {
              void navigate('/inventory');
            }}
          >
            {t('common.search')}
          </Button>
          <Button
            onClick={() => {
              void navigate('/expiration');
            }}
          >
            {t('expiry.label')}
          </Button>
          <Button
            onClick={() => {
              void navigate('/replenishment');
            }}
          >
            {t('replenishment.title')}
          </Button>
        </div>
      </div>
    </div>
  );
}
