#!/usr/bin/env node
/**
 * Writes public/THIRD-PARTY-NOTICES.txt: the licence text and attribution for the
 * open-source software Stock Guardian ships.
 *
 * Almost every open-source licence says that when you pass the software on, its
 * licence text goes with it. The application bundles React, SQLite and others,
 * so this file is how that is honoured. It lives in `public/`, which means the
 * web build, the Android app and the Windows installer all carry it.
 *
 * What it lists: every package reachable from package.json `dependencies`
 * through package-lock.json - the direct dependencies and theirs. That is wider
 * than "what ended up in the bundle", on purpose: a build with source maps showed
 * every bundled package is inside this set (12 of the 20), and listing a package
 * that was tree-shaken away costs a paragraph, while omitting one that shipped
 * is the actual failure. Service-worker code is hand-written (no Workbox), and
 * dev-only tooling never ships, so neither adds anything.
 *
 * Where the text comes from: the licence file inside each installed package.
 * Two packages publish none (`@sqlite.org/sqlite-wasm`, `standardwebhooks`);
 * their upstream text is kept in scripts/license-texts/ and named in FALLBACKS.
 * A package with no licence text at all makes this script stop rather than
 * print a name with nothing under it.
 *
 * What it cannot list, and says so in the file: the Android libraries (AndroidX
 * and friends, read from the 2.8.2 APK) and the Rust crates inside the Windows
 * build. Those need the Gradle and Cargo builds, which do not run on this
 * machine. They are described in PART 2 and PART 3 below, as plainly as they are
 * known.
 *
 *   node scripts/generate-third-party-notices.mjs          write the file
 *   node scripts/generate-third-party-notices.mjs --check  exit 1 if it is stale
 *
 * Output is deterministic (sorted, no dates, no version of this application), so
 * the file only changes when a dependency does.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the generated file lives, relative to the project root. */
export const OUTPUT = 'public/THIRD-PARTY-NOTICES.txt';

/**
 * Packages that ship no licence file. Keyed by package name; `file` is the text
 * kept in the repository, `note` is printed under the package's heading so the
 * reader sees where the text came from.
 */
const FALLBACKS = {
  '@sqlite.org/sqlite-wasm': {
    file: 'scripts/license-texts/sqlite-wasm.LICENSE.md',
    note: 'The package ships no licence file. This is LICENSE.md from its upstream repository, https://github.com/sqlite/sqlite-wasm.',
  },
  standardwebhooks: {
    file: 'scripts/license-texts/standardwebhooks.LICENSE.txt',
    note:
      'The package declares MIT in its metadata but ships no licence file; its upstream repository, ' +
      'https://github.com/standard-webhooks/standard-webhooks, publishes the Apache License 2.0 at its root, ' +
      'reproduced here. Both are permissive licences that ask for the licence text to travel with copies.',
  },
};

const RULE = '-'.repeat(78);
const DOUBLE_RULE = '='.repeat(78);

/** Text as it should be printed: LF line endings, no blank lines around it. */
function clean(text) {
  return text.replace(/\r\n?/g, '\n').replace(/^\n+/, '').trimEnd();
}

/** Resolve `dep` as npm would from the package at lockfile key `from`: nearest node_modules first. */
function resolveKey(packages, from, dep) {
  let base = from;
  for (;;) {
    const key = (base ? base + '/' : '') + 'node_modules/' + dep;
    if (packages[key]) return key;
    if (!base) return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut === -1 ? '' : base.slice(0, cut);
  }
}

/** Every package reachable from package.json `dependencies`, sorted by name. */
export function runtimePackages(root = ROOT) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const seen = new Set();

  const visit = (key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    const entry = lock.packages[key];
    const deps = { ...(entry.dependencies ?? {}), ...(entry.optionalDependencies ?? {}) };
    for (const dep of Object.keys(deps)) visit(resolveKey(lock.packages, key, dep));
  };
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    const key = resolveKey(lock.packages, '', dep);
    if (!key) throw new Error(`${dep} is in package.json but not in package-lock.json`);
    visit(key);
  }

  return [...seen]
    .map((key) => ({
      key,
      name: key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: lock.packages[key].version,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function declaredLicense(pj) {
  if (typeof pj.license === 'string') return pj.license;
  if (pj.license && typeof pj.license === 'object') return pj.license.type ?? 'unknown';
  if (Array.isArray(pj.licenses)) return pj.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'unknown';
}

function sourceUrl(pj) {
  let repo = typeof pj.repository === 'string' ? pj.repository : pj.repository?.url;
  if (!repo) return pj.homepage ?? '';
  repo = repo.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://');
  repo = repo.replace(/\.git$/, '');
  if (repo.startsWith('github:')) repo = 'https://github.com/' + repo.slice('github:'.length);
  return repo;
}

/** The licence file(s) and NOTICE file inside an installed package directory. */
function licenceMaterial(dir) {
  const names = readdirSync(dir);
  const licences = names.filter((n) => /^(licen[cs]e|copying)([-._].*)?$/i.test(n)).sort();
  const notices = names.filter((n) => /^notice([-._].*)?$/i.test(n)).sort();
  const parts = [];
  for (const file of licences) {
    const body = clean(readFileSync(join(dir, file), 'utf8'));
    if (body) parts.push(licences.length > 1 ? `[${file}]\n${body}` : body);
  }
  for (const file of notices) {
    const body = clean(readFileSync(join(dir, file), 'utf8'));
    if (body) parts.push(`[${file}]\n${body}`);
  }
  return parts.join('\n\n');
}

/** One section per runtime package, with its licence text. Throws if a text is missing. */
export function noticeSections(root = ROOT) {
  return runtimePackages(root).map((p) => {
    const dir = join(root, p.key);
    const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    let text = licenceMaterial(dir);
    let note = '';
    if (!text) {
      const fallback = FALLBACKS[p.name];
      if (!fallback || !existsSync(join(root, fallback.file))) {
        throw new Error(
          `${p.name} ${p.version} ships no licence file and has no fallback. ` +
            'Find its licence text, save it in scripts/license-texts/ and add it to FALLBACKS.',
        );
      }
      text = clean(readFileSync(join(root, fallback.file), 'utf8'));
      note = fallback.note;
    }
    return { ...p, license: declaredLicense(pj), source: sourceUrl(pj), note, text };
  });
}

const HEADER = `STOCK GUARDIAN - OPEN-SOURCE NOTICES
${DOUBLE_RULE}

Stock Guardian includes open-source software. Each component stays under its own
licence, and the licence text and copyright notices those licences ask for are
reproduced in this file. Nothing here changes those licences. Stock Guardian's own
licence is a separate document.

This file is generated by scripts/generate-third-party-notices.mjs from
package-lock.json and the licence files inside each package. Do not edit it by
hand; run "npm run notices" instead.

CONTENTS

  Part 1. JavaScript packages (in every version: web, Android and Windows)
  Part 2. The Android app: native libraries
  Part 3. SQLite and the Windows app
`;

const PART_2 = `PART 2. THE ANDROID APP: NATIVE LIBRARIES

The Android app (the APK) also contains the libraries below. They are not npm
packages. All are licensed under the Apache License, Version 2.0, whose full text is
printed in Part 1 under "@sqlite.org/sqlite-wasm".

  - AndroidX libraries: activity, annotation-experimental, appcompat and
    appcompat-resources, arch.core (core-runtime), coordinatorlayout, core, core-ktx,
    core-splashscreen and core-viewtree, cursoradapter, customview, drawerlayout,
    emoji2 and emoji2-views-helper, fragment, interpolator, lifecycle (livedata,
    livedata-core, process, runtime, viewmodel, viewmodel-savedstate), loader,
    profileinstaller, savedstate, startup-runtime, tracing, vectordrawable and
    vectordrawable-animated, versionedparcelable, viewpager, webkit.
    Copyright The Android Open Source Project.
  - kotlinx.coroutines (core and android).
    Copyright JetBrains s.r.o. and Kotlin Programming Language contributors.
  - Apache Cordova Android framework (org.apache.cordova:framework), which the
    Capacitor Android project declares.
    Copyright The Apache Software Foundation.

Capacitor's own Android code is the npm package @capacitor/android in Part 1 (MIT).

This list was read from the library version files inside the 2.8.2 APK and from the
Android project's Gradle files. A library that leaves no such file could be missing
from it.`;

const PART_3 = `PART 3. SQLITE AND THE WINDOWS APP

SQLite is in the public domain: https://www.sqlite.org/copyright.html
It is inside the WebAssembly module used in every version (part of
@sqlite.org/sqlite-wasm in Part 1), and it is compiled into the Windows app through
rusqlite.

The Windows app is a Tauri 2 application written in Rust. Its direct dependencies are:

  - Tauri (https://github.com/tauri-apps/tauri): Apache License 2.0 or MIT licence,
    at your option. Copyright held by the Tauri Apps contributors.
  - rusqlite (https://github.com/rusqlite/rusqlite): MIT licence, with SQLite
    compiled in.
  - serde and serde_json (https://github.com/serde-rs): MIT licence or Apache
    License 2.0, at your option.

The Windows app also compiles in the many other Rust crates that Tauri depends on.
Their complete list and licence texts come from the Windows build and are not yet
reproduced in this file.

The app draws its screens with the Microsoft Edge WebView2 Runtime. That is
Microsoft software, installed separately under Microsoft's own terms, and it is not
part of this list.`;

/** The whole THIRD-PARTY-NOTICES.txt, exactly as it is written to disk. */
export function renderNotices(root = ROOT) {
  const sections = noticeSections(root);

  const part1 = [
    `PART 1. JAVASCRIPT PACKAGES\n\nThese ${sections.length} packages are everything the application depends on when it runs:\n` +
      'its direct dependencies and theirs. Some contribute only a little code to the\n' +
      'final bundle; all are listed.',
    ...sections.map((s) => {
      const lines = [`${s.name} ${s.version}`, `Licence: ${s.license}`];
      if (s.source) lines.push(`Source: ${s.source}`);
      if (s.note) lines.push(`Note: ${s.note}`);
      lines.push('', s.text);
      return lines.join('\n');
    }),
  ].join(`\n\n${RULE}\n\n`);

  return [HEADER, part1, PART_2, PART_3].join(`\n\n${DOUBLE_RULE}\n\n`) + '\n';
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const target = join(ROOT, OUTPUT);
  const fresh = renderNotices();
  if (process.argv.includes('--check')) {
    const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== fresh) {
      console.error(`${OUTPUT} is stale. Run "npm run notices" and commit the result.`);
      process.exit(1);
    }
    console.log(`${OUTPUT} is up to date (${runtimePackages().length} packages).`);
  } else {
    writeFileSync(target, fresh);
    console.log(`Wrote ${OUTPUT}: ${runtimePackages().length} packages, ${fresh.length} characters.`);
  }
}
