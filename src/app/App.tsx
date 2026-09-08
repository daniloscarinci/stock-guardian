/**
 * Application root: start-up, routing, and the shell.
 *
 * Routing uses a hash router deliberately. The build has to work when dropped on
 * any static host - GitHub Pages, a plain nginx, a folder served over the local
 * network - and a hash route needs no server rewrite rule to survive a reload or
 * a shared link. It also behaves identically inside a desktop webview.
 */
import { useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { startApplication, type StartupResult } from './bootstrap';
import { AppProvider, useApp } from './AppContext';
import { Layout } from './Layout';
import { StartupFailureScreen, StartupLoading } from './StartupScreen';
import { ErrorBoundary } from './ErrorBoundary';
import { useAsyncData } from '../hooks/useAsyncData';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { InventoryScreen } from '../features/inventory/InventoryScreen';
import { ExpirationScreen } from '../features/expiration/ExpirationScreen';
import { ReplenishmentScreen } from '../features/replenishment/ReplenishmentScreen';
import { CatalogScreen } from '../features/catalog/CatalogScreen';
import { LocationsScreen } from '../features/locations/LocationsScreen';
import { CategoriesScreen } from '../features/categories/CategoriesScreen';
import { ContactsScreen } from '../features/contacts/ContactsScreen';
import { ReportsScreen } from '../features/reports/ReportsScreen';
import { PhrasebookScreen } from '../features/phrasebook/PhrasebookScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';

/** Wraps the routes so the navigation badge can read live counts. */
function Shell() {
  const { repositories, itemContext, revision } = useApp();

  const stats = useAsyncData(
    () => repositories.items.dashboardStats(itemContext),
    [repositories.items, itemContext, revision],
  );

  const attention = (stats.data?.expired ?? 0) + (stats.data?.expiringToday ?? 0);

  return (
    <Routes>
      <Route element={<Layout attentionCount={attention} />}>
        <Route index element={<DashboardScreen />} />
        <Route path="inventory" element={<InventoryScreen />} />
        <Route path="expiration" element={<ExpirationScreen />} />
        <Route path="replenishment" element={<ReplenishmentScreen />} />
        <Route path="catalog" element={<CatalogScreen />} />
        <Route path="locations" element={<LocationsScreen />} />
        <Route path="categories" element={<CategoriesScreen />} />
        <Route path="contacts" element={<ContactsScreen />} />
        <Route path="reports" element={<ReportsScreen />} />
        <Route path="phrasebook" element={<PhrasebookScreen />} />
        <Route path="settings" element={<SettingsScreen />} />
        {/* Any unknown route lands on the dashboard rather than a dead end. */}
        <Route path="*" element={<DashboardScreen />} />
      </Route>
    </Routes>
  );
}

export function App() {
  const [result, setResult] = useState<StartupResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void startApplication().then((outcome) => {
      if (!cancelled) setResult(outcome);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (result === null) return <StartupLoading />;
  if (result.status === 'failed') return <StartupFailureScreen failure={result.failure} />;

  return (
    <ErrorBoundary language={result.context.settings.language}>
      <AppProvider startup={result.context}>
        <HashRouter>
          <Shell />
        </HashRouter>
      </AppProvider>
    </ErrorBoundary>
  );
}
