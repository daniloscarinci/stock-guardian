#!/usr/bin/env node
/**
 * Generates the web and PWA icons.
 *
 * The mark and the PNG encoder live in `icon-artwork.mjs`, shared with
 * `generate-android-icons.mjs`. Run with `npm run generate:icons`; the output
 * is committed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { png, draw, FAVICON_SVG } from './icon-artwork.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = resolve(ROOT, 'public');

mkdirSync(resolve(PUBLIC, 'icons'), { recursive: true });

const outputs = [
  ['icons/icon-192.png', 192, 0],
  ['icons/icon-512.png', 512, 0],
  // Maskable icons need their content inside a safe zone, because the platform
  // may crop the outer edge to a circle, a squircle or a rounded square.
  ['icons/icon-maskable-512.png', 512, 0.1],
];

for (const [name, size, inset] of outputs) {
  const buffer = png(size, draw(size, inset));
  writeFileSync(resolve(PUBLIC, name), buffer);
  console.log(`generate-icons: ${name} (${String(size)}x${String(size)}, ${String(buffer.length)} bytes)`);
}

writeFileSync(resolve(PUBLIC, 'favicon.svg'), FAVICON_SVG, 'utf8');
console.log('generate-icons: favicon.svg');
