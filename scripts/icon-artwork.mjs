/**
 * The application mark, and just enough of a PNG encoder to draw it.
 *
 * Written by hand rather than pulled from an image library: the icons are flat
 * geometry, and adding a dependency (plus its transitive tree) to draw four
 * rectangles would be a poor trade for an application whose whole premise is
 * that it carries no baggage.
 *
 * PNG is a chunked container around zlib-compressed scanlines, both of which
 * Node has built in.
 *
 * Two entry points consume this: `generate-icons.mjs` (the web and PWA icons)
 * and `generate-android-icons.mjs` (the launcher and splash resources). They
 * share this file so the mark cannot drift between platforms - an Android
 * launcher icon that no longer matches the favicon is the kind of thing nobody
 * notices until it is embarrassing.
 */
import { deflateSync } from 'node:zlib';

export const BACKGROUND = [11, 18, 32]; // #0b1220, the application's dark surface
export const MARK = [107, 131, 255]; // #6b83ff, the accent

/** Fully transparent. Only the pixel outside a shape should ever be this. */
export const TRANSPARENT = [0, 0, 0, 0];

function crc32(buffer) {
  let table = crc32.table;
  if (table === undefined) {
    table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    crc32.table = table;
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * `pixel(x, y)` returns `[r, g, b]` or `[r, g, b, a]`; alpha defaults to opaque,
 * which keeps every caller that predates the Android icons unchanged.
 */
export function png(size, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Each scanline is prefixed with its filter type; 0 means "none".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a = 255] = pixel(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The mark itself, in a 100x100 coordinate space: a shield outline with three
 * stacked bars - preparedness, and stock levels.
 *
 * Returns `inShield(x, y)` and `inBar(x, y)` rather than colours, so a caller
 * can decide what "not the mark" means. On the web icons it means the dark
 * surface; on an Android adaptive foreground it means transparent, because the
 * adaptive background layer supplies the surface underneath.
 */
export function markGeometry(inset) {
  const pad = inset * 100;

  const left = 26 + pad;
  const right = 74 - pad;
  const top = 20 + pad;
  const shoulder = 58 - pad * 0.5;
  const tip = 82 - pad;

  // Three bars of decreasing length, knocked out of the shield.
  const bars = [
    { y: 32 + pad * 0.5, length: 30 },
    { y: 42 + pad * 0.5, length: 22 },
    { y: 52 + pad * 0.5, length: 14 },
  ];

  return {
    /** Shield: a rectangle whose lower half tapers to a point. */
    inShield(x, y) {
      if (x >= left && x <= right && y >= top && y <= shoulder) return true;
      if (y > shoulder && y <= tip) {
        const progress = (y - shoulder) / (tip - shoulder);
        const halfWidth = ((right - left) / 2) * (1 - progress);
        const centre = (left + right) / 2;
        return x >= centre - halfWidth && x <= centre + halfWidth;
      }
      return false;
    },

    inBar(x, y) {
      const barLeft = left + 6;
      for (const bar of bars) {
        if (y >= bar.y && y <= bar.y + 5 && x >= barLeft && x <= barLeft + bar.length) {
          return true;
        }
      }
      return false;
    },
  };
}

/**
 * The opaque square icon: the mark on the dark surface.
 *
 * `inset` shrinks the mark for the maskable variant, whose outer 10% may be
 * cropped to whatever shape the platform prefers.
 */
export function draw(size, inset) {
  const scale = size / 100;
  const { inShield, inBar } = markGeometry(inset);

  return (px, py) => {
    const x = px / scale;
    const y = py / scale;
    if (!inShield(x, y)) return BACKGROUND;
    if (inBar(x, y)) return BACKGROUND;
    return MARK;
  };
}

/** The favicon is vector: it scales to any tab size and costs a few hundred bytes. */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="18" fill="#0b1220"/>
  <path d="M26 20h48v38L50 82 26 58Z" fill="#6b83ff"/>
  <rect x="32" y="32" width="30" height="5" fill="#0b1220"/>
  <rect x="32" y="42" width="22" height="5" fill="#0b1220"/>
  <rect x="32" y="52" width="14" height="5" fill="#0b1220"/>
</svg>
`;
