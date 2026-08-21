import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * The Android build, produced by `VITE_TARGET=android npm run build` and then
 * wrapped by Capacitor. It differs from the web build in exactly one way: no
 * service worker. See the plugin list below for why.
 */
const ANDROID_BUILD = process.env.VITE_TARGET === 'android';

/**
 * Deliberately NO Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy headers.
 *
 * The sqlite-wasm README suggests adding them, but that advice targets the `opfs` VFS,
 * which needs SharedArrayBuffer. We use `opfs-sahpool`, which does not. Setting those
 * headers in dev while a static host cannot set them in production would create the
 * worst possible divergence: working locally, broken for every real user.
 */
export default defineConfig({
  // Host-agnostic: override with VITE_BASE=/subpath/ for subdirectory deploys.
  // Kept absolute (not './') because a service worker's scope depends on it.
  base: process.env.VITE_BASE ?? '/',

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Keep esbuild's dependency pre-bundling away from the Emscripten glue code.
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },

  worker: {
    format: 'es',
  },

  plugins: [
    react(),

    /*
     * No service worker in the Android build. The APK already contains every
     * asset, so a worker there would be a second cache standing in front of
     * files that are local either way - no offline benefit, and one real
     * hazard: with `registerType: 'prompt'` a freshly installed APK would keep
     * rendering the previous version's cached assets until someone accepted an
     * update prompt. The APK is the offline mechanism on Android; the service
     * worker is the offline mechanism on the web. Neither needs the other.
     */
    ...(ANDROID_BUILD ? [] : [VitePWA({
      /*
       * `injectManifest`, not `generateSW`: the service worker is written out in
       * src/sw.ts and the build only injects the asset list into it.
       *
       * Partly because that file is the offline guarantee and deserves to be
       * readable, and partly out of necessity - this project's path contains an
       * apostrophe ("Dad's games"), and workbox's generated template writes
       * absolute module paths into single-quoted strings, which produces a
       * service worker that will not parse.
       */
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 'prompt', never 'autoUpdate': swapping the service worker while a write
      // transaction is open against a single-connection database invites trouble.
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Stock Guardian',
        short_name: 'Stock Guardian',
        description: 'Offline Preparedness & Resource Management',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // Stated explicitly rather than relying on defaults, so a future change
        // to those defaults cannot silently break the cold offline start. The
        // wasm binary in particular MUST be precached: without it the database
        // cannot open, and the application is not merely degraded but dead.
        globPatterns: ['**/*.{js,css,html,wasm,ico,png,svg,webmanifest,woff2}'],
        // Default is 2 MiB; the sqlite wasm binary alone is ~865 KB and the
        // application chunk is larger still.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    })]),
  ],

  build: {
    target: 'es2022',
    sourcemap: true,
  },

  test: {
    environment: 'node',
    // Isolate WASM heaps between test files.
    pool: 'forks',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    server: {
      deps: {
        inline: ['@sqlite.org/sqlite-wasm'],
      },
    },
  },
});
