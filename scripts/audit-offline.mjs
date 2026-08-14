#!/usr/bin/env node
/**
 * Fails the build if anything in `dist/` would reach the network at runtime.
 *
 * The offline guarantee is the whole point of this application, and it is
 * exactly the kind of promise that erodes by accident - one `@import` of a
 * webfont, one analytics snippet, one CDN fallback added while debugging. A
 * check that runs on every build is the only version of this promise worth
 * making.
 *
 * The check has to be precise to be useful. Bundled libraries are full of URLs
 * in licence headers, documentation links and error messages; flagging those
 * would produce a wall of noise that everyone learns to ignore, which is worse
 * than no check at all. So:
 *
 *   - HTML, CSS, SVG and the web manifest are reference formats: any external
 *     URL in them is a real request, and is flagged.
 *   - JavaScript is scanned with comments and string-free regions removed, then
 *     checked for URLs in positions that actually cause a fetch.
 *   - Source maps are skipped: they are debugging artifacts, requested only by
 *     devtools, never by the application.
 *
 * Structural enforcement lives in the Content-Security-Policy in index.html
 * (`default-src 'self'`). This is the second line.
 *
 * Run automatically by `npm run build`, after `vite build`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

/** Formats where any external URL is a genuine reference. */
const REFERENCE_FORMATS = new Set(['.html', '.css', '.svg', '.webmanifest', '.json']);

/** Scanned for fetch-shaped constructs rather than bare URLs. */
const CODE_FORMATS = new Set(['.js', '.mjs']);

/**
 * Not requests despite matching a URL shape. XML namespaces are identifiers -
 * nothing fetches them - and localhost is development-only.
 */
const ALLOWED_PREFIXES = [
  'http://www.w3.org/',
  'https://www.w3.org/',
  'http://localhost',
  'https://localhost',
  'http://127.0.0.1',
];

const EXTERNAL_URL = /\bhttps?:\/\/[^\s'"`)>\]}\\]+/g;

/**
 * Constructs that cause a network request with a literal external URL.
 *
 * Deliberately narrow. A URL sitting in a string that is never passed to any of
 * these is not a request - the sqlite-wasm build embeds several in its error
 * messages and licence text.
 */
const FETCH_PATTERNS = [
  { name: 'fetch()', pattern: /\bfetch\s*\(\s*['"`](https?:\/\/[^'"`]+)/g },
  { name: 'importScripts()', pattern: /\bimportScripts\s*\(\s*['"`](https?:\/\/[^'"`]+)/g },
  { name: 'XMLHttpRequest.open()', pattern: /\.open\s*\(\s*['"`]\w+['"`]\s*,\s*['"`](https?:\/\/[^'"`]+)/g },
  { name: 'import()', pattern: /\bimport\s*\(\s*['"`](https?:\/\/[^'"`]+)/g },
  { name: 'new Worker()', pattern: /new\s+(?:Shared)?Worker\s*\(\s*['"`](https?:\/\/[^'"`]+)/g },
  { name: 'new EventSource()', pattern: /new\s+EventSource\s*\(\s*['"`](https?:\/\/[^'"`]+)/g },
  { name: 'new WebSocket()', pattern: /new\s+WebSocket\s*\(\s*['"`](wss?:\/\/[^'"`]+)/g },
  { name: 'script.src', pattern: /\.src\s*=\s*['"`](https?:\/\/[^'"`]+)/g },
  { name: 'navigator.sendBeacon()', pattern: /\bsendBeacon\s*\(\s*['"`](https?:\/\/[^'"`]+)/g },
];

/**
 * Removes `//` and block comments.
 *
 * Not a full parser, and it does not need to be: it tracks string and template
 * literals so a `//` inside one is preserved, which is the case that would
 * otherwise hide a real request.
 */
function stripComments(source) {
  let out = '';
  let index = 0;
  let state = 'code';
  let quote = '';

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line-comment';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block-comment';
        index += 2;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        state = 'string';
        quote = char;
        out += char;
        index += 1;
        continue;
      }
      out += char;
      index += 1;
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code';
        out += char;
      }
      index += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    // state === 'string'
    if (char === '\\') {
      out += char + (next ?? '');
      index += 2;
      continue;
    }
    if (char === quote) {
      state = 'code';
      quote = '';
    }
    out += char;
    index += 1;
  }

  return out;
}

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

const isAllowed = (url) => ALLOWED_PREFIXES.some((prefix) => url.startsWith(prefix));

if (!existsSync(DIST)) {
  console.error('audit-offline: dist/ does not exist. Run `vite build` first.');
  process.exit(1);
}

const files = walk(DIST);
const offenders = [];
let scanned = 0;

for (const file of files) {
  const extension = extname(file);
  const name = relative(DIST, file).replace(/\\/g, '/');

  // Debugging artifacts, fetched only by devtools.
  if (name.endsWith('.map')) continue;

  if (REFERENCE_FORMATS.has(extension)) {
    scanned += 1;
    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(EXTERNAL_URL)) {
      if (!isAllowed(match[0])) offenders.push({ file: name, url: match[0], why: 'reference' });
    }
    continue;
  }

  if (CODE_FORMATS.has(extension)) {
    scanned += 1;
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const { name: why, pattern } of FETCH_PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        const url = match[1];
        if (url !== undefined && !isAllowed(url)) offenders.push({ file: name, url, why });
      }
    }
  }
}

const wasm = files.filter((file) => file.endsWith('.wasm'));
const serviceWorker = files.filter((file) => /(^|[\\/])sw\.js$/.test(file));
const hasIndex = files.some((file) => relative(DIST, file).replace(/\\/g, '/') === 'index.html');

console.log(`audit-offline: scanned ${String(scanned)} files in dist/`);
console.log(`  index.html:     ${hasIndex ? 'present' : 'MISSING'}`);
console.log(`  wasm binaries:  ${String(wasm.length)} (${wasm.map((f) => relative(DIST, f)).join(', ')})`);
console.log(`  service worker: ${serviceWorker.length > 0 ? 'present' : 'absent'}`);

let failed = false;

if (!hasIndex) {
  console.error('\naudit-offline: FAILED - dist/index.html is missing.');
  failed = true;
}

if (wasm.length === 0) {
  console.error(
    '\naudit-offline: FAILED - no .wasm in dist/. The SQLite binary must be emitted as a ' +
      'local asset, or the application will try to fetch it at runtime.',
  );
  failed = true;
}

if (offenders.length > 0) {
  console.error(`\naudit-offline: FAILED - ${String(offenders.length)} external reference(s):`);
  for (const { file, url, why } of offenders) console.error(`  [${why}] ${file}: ${url}`);
  console.error(
    '\nThis application must run with no network. Bundle the asset locally, or add the host ' +
      'to ALLOWED_PREFIXES if it is genuinely not a request.',
  );
  failed = true;
}

if (failed) process.exit(1);

console.log('\naudit-offline: PASSED - nothing in the build reaches the network.');
