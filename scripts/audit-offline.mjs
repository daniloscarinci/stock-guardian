#!/usr/bin/env node
/**
 * Fails the build if anything in `dist/` would reach the network at runtime -
 * and, in the one case a bundle cannot express, if anything in `src/` would.
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
 *   - `SpeechRecognition` is read out of `src/` rather than `dist/`, because it
 *     is permitted in exactly one module and a bundle has no modules left to
 *     name. See SPEECH_ALLOWED_SOURCE below.
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
const SRC = resolve(ROOT, 'src');

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

/*
 * `SpeechRecognition` in its default mode streams audio to Google's servers,
 * which would make this application's central claim false. It is permitted in
 * exactly one module, which sets `processLocally` before every start and checks
 * `availableOnDevice()` first; `webspeech.test.ts` pins both. Anywhere else, it
 * is a bug.
 *
 * That module has one documented way to set `processLocally` false: the
 * `voiceAllowOnline` setting, off by default, which a person switches on under
 * a label naming Google. This script has nothing to say about it - no fetch, no
 * URL and no second use site are involved, so there is nothing here that would
 * or should catch it. The disclosure lives in docs/OFFLINE.md, which is where a
 * decision a user makes belongs.
 */
const SPEECH_ALLOWED_SOURCE = 'src/services/speech/webspeech.ts';

/*
 * This is the one rule that reads `src/` instead of `dist/`, and the choice was
 * forced. The application bundles into a single chunk, so in the built output
 * every module is the same file and "permitted in exactly one module" cannot be
 * said at all. Attributing a match back to its module would mean decoding the
 * source map - the one artifact this audit already declines to trust, and one a
 * build setting can switch off, taking the check silently with it. A
 * source-level rule that runs is worth more than a bundle-level rule that
 * cannot.
 */
const SPEECH_SOURCE_FORMATS = new Set(['.ts', '.tsx']);

/*
 * The prefixed spelling is the same API and the same hazard, so it is matched
 * too. Longer identifiers - `SpeechRecognitionEvent` and its relatives - are
 * not: they are types, erased before anything runs.
 */
const SPEECH_API = /\b(?:webkit)?SpeechRecognition\b/;

/*
 * Tests are out of scope, decided rather than left to luck. `webspeech.test.ts`
 * stubs a fake recognizer under that name, and no file matching this is built
 * into `dist/` or ever runs in a browser. A second real use site has to live in
 * a module that ships, and every one of those is covered.
 */
const TEST_SOURCE = /\.test\.tsx?$/;

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

if (!existsSync(SRC)) {
  console.error('audit-offline: src/ does not exist. Run this from the repository root.');
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

/*
 * The source-level rule, for the reason given at SPEECH_ALLOWED_SOURCE.
 *
 * Comments are stripped first. Prose about this API - the header of the module
 * that owns it, a note in a sibling saying why it is not used there - is not a
 * use of it, and failing a build over one would teach people to ignore this
 * script, which is the failure worth avoiding above all others here.
 *
 * The offending line is reported rather than its number: stripping a block
 * comment removes its newlines too, so the numbering no longer matches the file
 * on disk, and a confidently wrong line number is worse than none.
 */
const speechOffenders = [];
let speechScanned = 0;

for (const file of walk(SRC)) {
  if (!SPEECH_SOURCE_FORMATS.has(extname(file))) continue;

  const name = relative(ROOT, file).replace(/\\/g, '/');
  if (TEST_SOURCE.test(name)) continue;

  speechScanned += 1;
  if (name === SPEECH_ALLOWED_SOURCE) continue;

  for (const line of stripComments(readFileSync(file, 'utf8')).split('\n')) {
    if (SPEECH_API.test(line)) speechOffenders.push({ file: name, text: line.trim() });
  }
}

const wasm = files.filter((file) => file.endsWith('.wasm'));
const serviceWorker = files.filter((file) => /(^|[\\/])sw\.js$/.test(file));
const hasIndex = files.some((file) => relative(DIST, file).replace(/\\/g, '/') === 'index.html');

console.log(`audit-offline: scanned ${String(scanned)} files in dist/`);
console.log(`  index.html:     ${hasIndex ? 'present' : 'MISSING'}`);
console.log(`  wasm binaries:  ${String(wasm.length)} (${wasm.map((f) => relative(DIST, f)).join(', ')})`);
console.log(`  service worker: ${serviceWorker.length > 0 ? 'present' : 'absent'}`);
console.log(`  speech api:     ${String(speechScanned)} source files checked`);

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

if (speechOffenders.length > 0) {
  console.error(
    `\naudit-offline: FAILED - SpeechRecognition outside ${SPEECH_ALLOWED_SOURCE}, ` +
      `${String(speechOffenders.length)} site(s):`,
  );
  for (const { file, text } of speechOffenders) console.error(`  ${file}: ${text}`);
  console.error(
    '\nWithout `processLocally` the browser streams the microphone to Google. Use the recognizer ' +
      `exported from ${SPEECH_ALLOWED_SOURCE}, which sets it before every start and refuses to ` +
      'start without an on-device model unless the user has opted in.',
  );
  failed = true;
}

if (failed) process.exit(1);

console.log('\naudit-offline: PASSED - nothing in the build reaches the network.');
