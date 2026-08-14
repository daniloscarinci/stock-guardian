import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

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
    VitePWA({
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
      workbox: {
        // `wasm` is in workbox's default patterns, but we state it explicitly so a
        // future default change cannot silently break the cold offline start.
        globPatterns: ['**/*.{js,css,html,wasm,ico,png,svg,webmanifest,woff2}'],
        // Default is 2 MiB. The sqlite wasm binary alone is ~865 KB and the glue
        // is ~578 KB; raising this is cheap insurance against a silent precache miss.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Without this, a .wasm request can be answered with index.html, producing
        // a baffling "magic word not found" WebAssembly error.
        navigateFallbackDenylist: [/\.wasm$/],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
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
