#!/usr/bin/env node
/**
 * Generates the desktop application's icons.
 *
 * The mark and the PNG encoder live in `icon-artwork.mjs`, shared with
 * `generate-icons.mjs` and `generate-android-icons.mjs` - so the window icon,
 * the installer icon and the favicon are the same drawing at different sizes
 * rather than three files that have to be kept in agreement by hand.
 *
 * WHY THIS EXISTS AT ALL. `tauri-build` refuses to build for Windows without
 * `src-tauri/icons/icon.ico`, and says so in one line at the end of a Rust
 * compile:
 *
 *     `icons/icon.ico` not found; required for generating a Windows Resource
 *     file during tauri-build
 *
 * `tauri.conf.json` names two PNGs under `bundle.icon`, which is a different
 * question - that list is what the bundler puts ON the installer, and this is
 * what the compiler embeds IN the executable. Both are needed and only one was
 * there.
 *
 * WHY NOT `tauri icon`. The official command does this and more, but it needs
 * `@tauri-apps/cli` present, and this repository deliberately does not carry
 * it - see the note at the top of `.github/workflows/windows.yml`. Generating
 * the file from the artwork already here keeps the Windows build's only
 * prerequisite inside this repository rather than in a package installed for
 * one step.
 *
 * Run with `npm run generate:desktop-icons`. The output is committed, exactly
 * as the web and Android icons are.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { png, draw } from './icon-artwork.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = resolve(ROOT, 'src-tauri', 'icons');

/**
 * The sizes Windows actually reaches for.
 *
 * 16 and 32 are the title bar and the taskbar, 48 is the desktop, 256 is the
 * one Explorer scales down for everything in between. They are all in one file
 * because an .ico is an archive: Windows picks the entry nearest the size it
 * needs, and an .ico carrying only 256 gets scaled badly in the title bar.
 */
const SIZES = [16, 32, 48, 64, 128, 256];

/**
 * A PNG-compressed .ico.
 *
 * The format is a six-byte header, one sixteen-byte directory entry per image,
 * then the images themselves. Every entry here is a whole PNG file rather than
 * the older uncompressed DIB: Windows has read that form since Vista, it is a
 * quarter of the size, and it means the PNG encoder already in this repository
 * is the only encoder involved.
 *
 * A width or height byte of 0 means 256 - the field is one byte and 256 does
 * not fit in it. That is the format's own convention, not a trick.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved, always zero
  header.writeUInt16LE(1, 2); // 1 = icon, 2 would be a cursor
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach(({ size, data }, index) => {
    const entry = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 0);
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2); // palette size; 0 for truecolour
    directory.writeUInt8(0, entry + 3); // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

mkdirSync(ICONS, { recursive: true });

const images = SIZES.map((size) => ({ size, data: png(size, draw(size, 0)) }));
const bundle = ico(images);
writeFileSync(resolve(ICONS, 'icon.ico'), bundle);
console.log(
  `generate-desktop-icons: icons/icon.ico (${SIZES.join(', ')}; ${String(bundle.length)} bytes)`,
);

// The bundler's own icon, and the one Linux and macOS builds read. Written
// here so a single command leaves src-tauri/icons/ complete rather than
// complete-for-Windows.
for (const size of [128, 512]) {
  const name = size === 128 ? 'icon.png' : '[email protected]';
  const data = png(size, draw(size, 0));
  writeFileSync(resolve(ICONS, name), data);
  console.log(`generate-desktop-icons: icons/${name} (${String(size)}x${String(size)})`);
}
