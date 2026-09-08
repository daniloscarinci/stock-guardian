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
 *   - `SpeechRecognition` is read out of `src/` rather than `dist/`, and is now
 *     permitted in no module at all. See SPEECH_ALLOWED_SOURCE below.
 *
 * One host is allowed, and it is the only one: `https://api.anthropic.com`,
 * reached from `src/services/ai/client.ts` and from nowhere else, so that the
 * AI assistant can use a key the person pasted into Settings. AI_HOST below
 * sets out how narrow that hole is and what it cannot see. Every other external
 * URL fails the build exactly as it did before.
 *
 * Structural enforcement lives in the Content-Security-Policy in index.html
 * (`default-src 'self'`, and `connect-src` naming that one host). This is the
 * second line.
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

/*
 * The one host this application may talk to, and the one module that may do it.
 *
 * The AI assistant sends a question to Anthropic with an API key the user
 * pastes into Settings. With no key stored, and with the assistant switched
 * off, nothing runs and nothing is sent - that is the shipping default, and
 * this script has nothing to say about it, because there is no request to find.
 * The hole below exists only for the case where a person has deliberately
 * opened it.
 *
 * It is cut in three places, each as small as the format allows:
 *
 *   - In `dist/` reference formats, the host passes only on a line that also
 *     says `connect-src`. A policy naming a host is a restriction on requests,
 *     not a request; an `<img src>` or an `@import` pointing at the same host
 *     is a request, and still fails.
 *   - In `dist/` code, the host passes in a fetch-shaped construct. This is
 *     where the rule has to be widest, for the same reason that forced the
 *     `SpeechRecognition` rule into `src/`: the SDK is bundled into the same
 *     chunk as everything else, so by the time this script reads `dist/` there
 *     are no modules left to tell apart. A URL inside `@anthropic-ai/sdk` and a
 *     URL in application code are the same bytes in the same file.
 *   - So "one module" is enforced where modules still exist, in `src/`. The
 *     literal host may appear in AI_ALLOWED_SOURCE and nowhere else. That rule
 *     is what catches the second call site somebody adds in good faith, which
 *     is how this would actually be lost.
 *
 * What it cannot catch, stated rather than glossed: the SDK reaches this host
 * by default without being told to, so a module that builds a client without
 * naming a URL is invisible here, as is a host assembled at runtime. This is a
 * text match, like the speech rule, and it has the same kind of limit.
 */
const AI_HOST = 'https://api.anthropic.com';
const AI_ALLOWED_SOURCE = 'src/services/ai/client.ts';

/*
 * The host exactly, not a prefix of one. `https://api.anthropic.com.example.net`
 * merely begins the same way and belongs to somebody else, so whatever follows
 * the host must be something a hostname cannot continue with - a path, a port,
 * a query, the `;` that ends a CSP directive, or the end of the string.
 */
const isAiHost = (url) =>
  url.startsWith(AI_HOST) && !/^[\w.-]/.test(url.slice(AI_HOST.length));

/** Deliberately looser than isAiHost: in `src/`, any mention of it counts. */
const AI_HOST_IN_SOURCE = /\bapi\.anthropic\.com\b/;

/** The whole line containing `index`, for judging the context of a match. */
function lineContaining(contents, index) {
  const start = contents.lastIndexOf('\n', index) + 1;
  const end = contents.indexOf('\n', index);
  return contents.slice(start, end === -1 ? contents.length : end);
}

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
 * which would make this application's central claim false.
 *
 * IT USED TO BE PERMITTED IN ONE MODULE. THAT MODULE IS GONE, AND THE RULE IS
 * NOT. `webspeech.ts` set `processLocally` before every start and was the sole
 * allowed use site; the microphone was then removed outright, because Android's
 * recognizer refuses EXTRA_PREFER_OFFLINE with no offline Portuguese pack
 * installed - the phone this was built for - and a button that silently did
 * nothing was worse than no button.
 *
 * So the allowance is now `null`, which no filename equals: the identifier is
 * permitted NOWHERE, and any reappearance of it fails the build. Deleting the
 * rule along with its subject was the other option and would have been the
 * wrong one. The hazard did not move when the file did - the browser API is
 * still there, still streams audio by default, and the way it would come back
 * is somebody adding speech input again in good faith, in a build whose only
 * check for it had been quietly retired as unused. A rule guarding nothing
 * costs one string comparison per source file; the check it replaces cannot be
 * bought back afterwards.
 *
 * `voiceAllowOnline`, the setting that let that module send audio to Google,
 * is gone with it. There is no longer any path by which this application sends
 * a microphone anywhere, and docs/OFFLINE.md says so.
 */
const SPEECH_ALLOWED_SOURCE = null;

/*
 * These are the two rules that read `src/` instead of `dist/`, and the choice
 * was forced both times. The application bundles into a single chunk, so in the
 * built output every module is the same file and "permitted in exactly one
 * module" cannot be said at all. Attributing a match back to its module would
 * mean decoding the source map - the one artifact this audit already declines
 * to trust, and one a build setting can switch off, taking the check silently
 * with it. A source-level rule that runs is worth more than a bundle-level rule
 * that cannot.
 *
 * `SpeechRecognition` came first; the AI host follows it for the same reason,
 * only more sharply, because the Anthropic SDK ships inside that same chunk -
 * and that chunk now carries the SDK's own documentation links and error text,
 * `docs.anthropic.com` and `github.com/anthropics/...` among them. None is in a
 * fetch-shaped construct, so none is flagged, which is exactly the precision
 * FETCH_PATTERNS exists for: a URL in a sentence is not a request.
 */
const SOURCE_FORMATS = new Set(['.ts', '.tsx']);

/*
 * The prefixed spelling is the same API and the same hazard, so it is matched
 * too. Longer identifiers - `SpeechRecognitionEvent` and its relatives - are
 * not: they are types, erased before anything runs.
 */
const SPEECH_API = /\b(?:webkit)?SpeechRecognition\b/;

/*
 * Tests are out of scope, decided rather than left to luck: a test of the AI
 * client has to be able to name the host it asserts about. No file matching
 * this is built into `dist/` or ever runs in a browser. A second real use site
 * has to live in a module that ships, and every one of those is covered.
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
      const url = match[0];
      if (isAllowed(url)) continue;
      // The Content-Security-Policy has to name the host it permits. That is
      // the line restricting requests, not one making any.
      if (isAiHost(url) && lineContaining(contents, match.index).includes('connect-src')) continue;
      offenders.push({ file: name, url, why: 'reference' });
    }
    continue;
  }

  if (CODE_FORMATS.has(extension)) {
    scanned += 1;
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const { name: why, pattern } of FETCH_PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        const url = match[1];
        if (url === undefined || isAllowed(url) || isAiHost(url)) continue;
        offenders.push({ file: name, url, why });
      }
    }
  }
}

/*
 * The two source-level rules, for the reason given at SOURCE_FORMATS. One walk,
 * because they ask the same question of the same files: is this identifier, or
 * this host, named outside the single module allowed to name it?
 *
 * Comments are stripped first. Prose about either - the header of the module
 * that owns it, a note in a sibling saying why it is not used there, this
 * script's own paragraphs quoted back - is not a use of it, and failing a build
 * over one would teach people to ignore this script, which is the failure worth
 * avoiding above all others here.
 *
 * The offending line is reported rather than its number: stripping a block
 * comment removes its newlines too, so the numbering no longer matches the file
 * on disk, and a confidently wrong line number is worse than none.
 */
const speechOffenders = [];
const aiHostOffenders = [];
let sourceScanned = 0;

for (const file of walk(SRC)) {
  if (!SOURCE_FORMATS.has(extname(file))) continue;

  const name = relative(ROOT, file).replace(/\\/g, '/');
  if (TEST_SOURCE.test(name)) continue;

  sourceScanned += 1;
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');

  if (name !== SPEECH_ALLOWED_SOURCE) {
    for (const line of lines) {
      if (SPEECH_API.test(line)) speechOffenders.push({ file: name, text: line.trim() });
    }
  }

  if (name !== AI_ALLOWED_SOURCE) {
    for (const line of lines) {
      if (AI_HOST_IN_SOURCE.test(line)) aiHostOffenders.push({ file: name, text: line.trim() });
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
console.log(
  `  source rules:   ${String(sourceScanned)} files checked ` +
    `(speech api: permitted nowhere; ${AI_HOST}: ${AI_ALLOWED_SOURCE} only)`,
);

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
    `\nThis application reaches ${AI_HOST} and nothing else, and only from ` +
      `${AI_ALLOWED_SOURCE}. Bundle the asset locally, or add the host to ALLOWED_PREFIXES ` +
      'if it is genuinely not a request.',
  );
  failed = true;
}

if (aiHostOffenders.length > 0) {
  console.error(
    `\naudit-offline: FAILED - ${AI_HOST} outside ${AI_ALLOWED_SOURCE}, ` +
      `${String(aiHostOffenders.length)} site(s):`,
  );
  for (const { file, text } of aiHostOffenders) console.error(`  ${file}: ${text}`);
  console.error(
    '\nExactly one module talks to the network, so that there is one place to read when ' +
      `somebody asks what this application sends. Call it through ${AI_ALLOWED_SOURCE}.`,
  );
  failed = true;
}

if (speechOffenders.length > 0) {
  console.error(
    `\naudit-offline: FAILED - SpeechRecognition is permitted in no module, ` +
      `${String(speechOffenders.length)} site(s):`,
  );
  for (const { file, text } of speechOffenders) console.error(`  ${file}: ${text}`);
  console.error(
    '\nWithout `processLocally` the browser streams the microphone to Google, which this ' +
      'application promises not to do. Speech input was removed, and no module is allowed to ' +
      'name this API. Bringing it back is a decision to make on purpose, in docs/OFFLINE.md ' +
      'first and in this rule second.',
  );
  failed = true;
}

if (failed) process.exit(1);

console.log(
  `\naudit-offline: PASSED - nothing in the build reaches the network but ${AI_HOST}, ` +
    `and only from ${AI_ALLOWED_SOURCE}.`,
);
