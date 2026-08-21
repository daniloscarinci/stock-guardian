#!/usr/bin/env node
/**
 * Generates the Android launcher icons and splash resources.
 *
 * Capacitor's `cap add android` writes the stock Android Studio template
 * artwork - a green robot on white. This replaces it with the application's own
 * mark, drawn from the same geometry as the favicon and the PWA icons (see
 * `icon-artwork.mjs`), and deletes the template files it supersedes.
 *
 * Deletion matters: `android/` is committed, but if it is ever removed and
 * re-added, `cap add android` restores the template artwork. Running
 * `npm run generate:android-icons` afterwards must be enough to put the
 * branding back, with nothing left over to conflict.
 *
 * Run with `npm run generate:android-icons`; the output is committed.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { png, draw, markGeometry, MARK, TRANSPARENT } from './icon-artwork.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RES = resolve(ROOT, 'android/app/src/main/res');

/**
 * Android's density buckets. The first number is the legacy square launcher
 * icon (48dp); the second is the adaptive icon layer, which is 108dp because
 * the outer ring exists to be cropped and parallaxed by the launcher.
 */
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

/**
 * Of the adaptive icon's 108dp, only the central 72dp is guaranteed to survive
 * whatever mask the launcher applies. Mapping the artwork's 100-unit box onto
 * exactly that square makes the launcher icon occupy the same proportion of its
 * visible area as the web icon does of its square - so the two look like the
 * same icon rather than two sizes of it.
 */
const SAFE_ZONE = 72 / 108;

/** The mark alone, on transparency. The adaptive background layer is the surface. */
function drawForeground(size) {
  const artwork = size * SAFE_ZONE;
  const origin = (size - artwork) / 2;
  const scale = artwork / 100;
  const { inShield, inBar } = markGeometry(0);

  return (px, py) => {
    const x = (px - origin) / scale;
    const y = (py - origin) / scale;
    if (!inShield(x, y)) return TRANSPARENT;
    if (inBar(x, y)) return TRANSPARENT;
    return MARK;
  };
}

/**
 * The legacy round icon, for launchers that ask for one on API < 26. The mark
 * already sits inside the inscribed circle, so this only clears the corners.
 */
function drawRound(size) {
  const square = draw(size, 0);
  const centre = size / 2;
  const radius = size / 2;

  return (px, py) => {
    const dx = px + 0.5 - centre;
    const dy = py + 0.5 - centre;
    if (dx * dx + dy * dy > radius * radius) return TRANSPARENT;
    return square(px, py);
  };
}

function write(relativePath, contents) {
  const path = resolve(RES, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  const size = typeof contents === 'string' ? Buffer.byteLength(contents) : contents.length;
  console.log(`generate-android-icons: ${relativePath} (${String(size)} bytes)`);
}

/* ---------- Launcher icons ---------- */

for (const [density, legacySize, adaptiveSize] of DENSITIES) {
  write(`mipmap-${density}/ic_launcher.png`, png(legacySize, draw(legacySize, 0)));
  write(`mipmap-${density}/ic_launcher_round.png`, png(legacySize, drawRound(legacySize)));
  write(`mipmap-${density}/ic_launcher_foreground.png`, png(adaptiveSize, drawForeground(adaptiveSize)));
}

/* ---------- Colours ---------- */

write(
  'values/colors.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- --surface-base in src/styles/tokens.css. The one colour the native
         shell and the web application both have to agree on. -->
    <color name="surface_base">#0b1220</color>
</resources>
`,
);

write(
  'values/ic_launcher_background.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Referenced by mipmap-anydpi-v26/ic_launcher.xml as the adaptive icon's
         background layer. Kept as an alias rather than a second literal so the
         launcher icon cannot drift from the splash screen. -->
    <color name="ic_launcher_background">@color/surface_base</color>
</resources>
`,
);

/* ---------- Splash ---------- */

// The same mark as a vector, so the splash stays crisp at any density without
// five more PNGs. Path data is the favicon's, in Android's stricter dialect.
write(
  'drawable/ic_splash_mark.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="100dp"
    android:height="100dp"
    android:viewportWidth="100"
    android:viewportHeight="100">
    <path
        android:fillColor="#6b83ff"
        android:pathData="M26,20h48v38L50,82L26,58Z" />
    <path
        android:fillColor="#0b1220"
        android:pathData="M32,32h30v5h-30z" />
    <path
        android:fillColor="#0b1220"
        android:pathData="M32,42h22v5h-22z" />
    <path
        android:fillColor="#0b1220"
        android:pathData="M32,52h14v5h-14z" />
</vector>
`,
);

write(
  'drawable/splash.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<!--
    Referenced by AppTheme.NoActionBarLaunch in values/styles.xml. Replaces the
    ten density-and-orientation splash PNGs Capacitor's template ships: a solid
    colour and a vector do the same job at any size, in either orientation.
-->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/surface_base" />
    <item
        android:width="128dp"
        android:height="128dp"
        android:gravity="center"
        android:drawable="@drawable/ic_splash_mark" />
</layer-list>
`,
);

/* ---------- Template leftovers ---------- */

/**
 * Every one of these is stock template artwork that the files above replace.
 * The splash PNGs would additionally be a hard build error: a `splash.png` and
 * a `splash.xml` in the same drawable folder are one resource declared twice.
 */
const SUPERSEDED = [
  'drawable/splash.png',
  'drawable/ic_launcher_background.xml',
  'drawable-v24/ic_launcher_foreground.xml',
  ...['port', 'land'].flatMap((orientation) =>
    ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].map(
      (density) => `drawable-${orientation}-${density}/splash.png`,
    ),
  ),
];

for (const relativePath of SUPERSEDED) {
  rmSync(resolve(RES, relativePath), { force: true });
}
console.log(`generate-android-icons: removed ${String(SUPERSEDED.length)} superseded template files`);
