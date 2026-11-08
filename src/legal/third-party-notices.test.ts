/**
 * The open-source notices the application ships.
 *
 * Almost every open-source licence says the same thing: if you pass the software
 * on, the licence text and the copyright notice go with it. The application
 * bundles React, SQLite and others, so `public/THIRD-PARTY-NOTICES.txt` is how
 * that promise is kept - it is copied into the web build, the Android app and
 * the Windows installer.
 *
 * What these tests guard is the way such a file goes wrong: not a missing file,
 * but a stale one. Someone adds a dependency, the file is not regenerated, and
 * the application ships software whose licence it does not reproduce. So the
 * file is compared with what the generator would write today, package by
 * package, straight from package-lock.json.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OUTPUT,
  noticeSections,
  renderNotices,
  runtimePackages,
} from '../../scripts/generate-third-party-notices.mjs';

const ROOT = process.cwd();
// A Windows checkout may turn line endings into CRLF; the content is what matters.
const shipped = readFileSync(resolve(ROOT, OUTPUT), 'utf8').replace(/\r\n/g, '\n');

describe('THIRD-PARTY-NOTICES.txt', () => {
  it('covers every package the application depends on at run time, at the locked version', () => {
    const packages = runtimePackages(ROOT);

    // The application's own direct dependencies are the floor; the count guards
    // against the closure quietly collapsing to nothing.
    expect(packages.length).toBeGreaterThanOrEqual(9);
    for (const name of ['react', 'react-dom', '@sqlite.org/sqlite-wasm', 'zod', '@capacitor/core']) {
      expect(packages.map((p) => p.name)).toContain(name);
    }

    const missing = packages
      .filter((p) => !shipped.includes(`${p.name} ${p.version}`))
      .map((p) => `${p.name} ${p.version}`);
    expect(missing).toEqual([]);
  });

  it("prints each package's own licence text under its own heading, not just its name", () => {
    for (const section of noticeSections(ROOT)) {
      expect(section.text.length, `${section.name} has no licence text`).toBeGreaterThan(100);

      // React and react-dom share word-for-word the same licence, so "somewhere in
      // the file" would let one blank section hide behind another. Look only
      // between this package's heading and the next rule line.
      const start = shipped.indexOf(`\n${section.name} ${section.version}\nLicence:`);
      expect(start, `${section.name} has no heading`).toBeGreaterThan(-1);
      const rest = shipped.slice(start + 1);
      const end = rest.search(/\n(?:-{78}|={78})\n/);
      expect(end, `${section.name}'s section never ends`).toBeGreaterThan(-1);
      expect(rest.slice(0, end), `${section.name}'s own section lacks its licence text`).toContain(section.text);
    }
  });

  it('is exactly what the generator writes today, so a changed dependency cannot go unnoticed', () => {
    expect(shipped).toBe(renderNotices(ROOT).replace(/\r\n/g, '\n'));
  });

  it('says what it does not cover: the Android libraries and the Windows build', () => {
    expect(shipped).toContain('AndroidX');
    expect(shipped).toContain('Tauri');
    // The sentence wraps across lines in the file, so match any whitespace.
    expect(shipped).toMatch(/not\s+yet\s+reproduced/i);
  });
});
