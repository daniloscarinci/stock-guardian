import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps the built application in an Android WebView. The APK carries
 * `dist/` inside it, so the app is complete on first launch with the radio off -
 * which is the whole reason this exists rather than a Trusted Web Activity
 * pointing at the GitHub Pages URL.
 */
const config: CapacitorConfig = {
  appId: 'app.stockguardian.android',
  appName: 'Stock Guardian',
  webDir: 'dist',

  server: {
    /*
     * THE load-bearing line. The database is SQLite-WASM on the OPFS SAH-pool
     * VFS, and OPFS is only exposed in a secure context. `https` makes the
     * WebView's origin `https://localhost`, which qualifies. Under `http`, or
     * were the assets loaded from `file://`, `navigator.storage.getDirectory`
     * is undefined and the database cannot open at all - the application would
     * not be degraded, it would be dead. See src/database/worker/sqlite.worker.ts.
     *
     * This is Capacitor's default. It is written out anyway so that a future
     * change to that default cannot quietly break storage.
     */
    androidScheme: 'https',
  },

  android: {
    /*
     * Nothing is loaded over the network, so there is no mixed content to
     * permit, and remote debugging is not something a shipped build should
     * offer. Both are Capacitor's defaults; both matter enough to state.
     */
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
    // Matches --surface-base and the manifest's background_color, so the moment
    // between the splash screen and the first paint is not a white flash.
    backgroundColor: '#0b1220',
  },
};

export default config;
