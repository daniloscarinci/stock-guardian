/// <reference lib="webworker" />
/**
 * The service worker.
 *
 * Written out rather than generated, for two reasons.
 *
 * First, this file IS the offline guarantee. Everything else in the application
 * is local by construction; this is the piece that decides whether a cold start
 * with no network succeeds. It should be readable in one sitting.
 *
 * Second, the generated alternative could not be built here at all: the project
 * path contains an apostrophe, and workbox's template writes absolute module
 * paths into single-quoted strings, producing a syntactically invalid worker.
 * Hand-writing it removes that failure mode along with a runtime dependency.
 *
 * The build injects `self.__WB_MANIFEST` - the list of every emitted asset with
 * its revision. Precaching exactly that list is what makes the first offline
 * load work rather than merely the second.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

// Bumped by the asset revisions themselves; the name only needs to change when
// the caching strategy does.
const CACHE = 'stock-guardian-v1';

const PRECACHE_URLS = self.__WB_MANIFEST.map((entry) =>
  // The revision is already in the filename for hashed assets; for the rest it
  // is appended so a content change produces a different cache key.
  entry.revision === null ? entry.url : `${entry.url}?v=${entry.revision}`,
);

/** The request that a navigation falls back to when offline. */
const NAVIGATION_FALLBACK = new URL('index.html', self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Added one at a time: `addAll` rejects the whole batch if any single
      // request fails, which would leave the worker installed with nothing
      // cached and the application broken offline for no visible reason.
      const failures: string[] = [];
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
            await cache.put(stripVersion(url), response);
          } catch (error) {
            failures.push(`${url}: ${String(error)}`);
          }
        }),
      );
      if (failures.length > 0) {
        console.error('[sw] Some assets could not be precached:', failures);
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/**
 * Cache-first for everything.
 *
 * This application has no server component: every asset is immutable and
 * content-hashed, and there is nothing to be fresher about. Network-first would
 * add latency on every load and, worse, make behaviour depend on whether the
 * radio happened to be on.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch cross-origin requests. There should be none - the offline audit
  // fails the build if any exist - but a service worker that silently proxied
  // them would undermine the guarantee it exists to provide.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: false });
      if (cached !== undefined) return cached;

      try {
        const response = await fetch(request);
        // Runtime-cache same-origin successes so an asset added after install
        // (a lazily loaded chunk) is available offline next time.
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE);
          void cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        // Offline and not in the cache. For a navigation this is the SPA
        // fallback; for anything else there is nothing honest to return.
        if (request.mode === 'navigate') {
          const fallback = await caches.match(NAVIGATION_FALLBACK);
          if (fallback !== undefined) return fallback;
        }
        throw error;
      }
    })(),
  );
});

/** Lets the page activate a waiting update when the user chooses to. */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

function stripVersion(url: string): string {
  const index = url.indexOf('?v=');
  return index === -1 ? url : url.slice(0, index);
}
