// Generates the app icons (original artwork) as PNG without external dependencies.
// Usage: node scripts/generate-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Signed distance helpers in unit coordinates (0..1).
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdSegment = (x, y, ax, ay, bx, by) => {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t);
};

/** Colour of a point: rounded-square background, a written wave and a pencil. */
function shade(x, y, { maskable }) {
  const bgR = maskable ? 0.5 : 0.225;
  const inside = maskable ? -1 : sdRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, bgR);
  if (inside > 0) return null;
  // vertical blue gradient
  const t = y;
  let c = [248 - 16 * t, 170 - 52 * t, 200 - 34 * t];
  const s = maskable ? 0.72 : 1; // keep artwork inside the maskable safe zone
  const u = (x - 0.5) / s + 0.5;
  const v = (y - 0.5) / s + 0.5;
  // handwriting wave
  let wave = Infinity;
  for (let i = 0; i < 40; i++) {
    const a0 = 0.2 + (i / 40) * 0.42, a1 = 0.2 + ((i + 1) / 40) * 0.42;
    const f = (a) => 0.66 + Math.sin((a - 0.2) * 22) * 0.045;
    wave = Math.min(wave, sdSegment(u, v, a0, f(a0), a1, f(a1)));
  }
  if (wave < 0.022) c = [255, 255, 255];
  // pencil body (diagonal), tip and eraser
  const ax = 0.36, ay = 0.64, bx = 0.76, by = 0.24;
  const body = sdSegment(u, v, ax + 0.06, ay - 0.06, bx, by);
  if (body < 0.075) {
    const along = ((u - ax) * (bx - ax) + (v - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2);
    c = along > 0.86 ? [255, 214, 228] : [255, 255, 255];
  }
  // conical tip
  const tipLen = Math.hypot(0.06, 0.06);
  const dTip = sdSegment(u, v, ax, ay, ax + 0.06, ay - 0.06);
  const along = ((u - ax) * 0.06 + (v - ay) * -0.06) / (tipLen * tipLen);
  if (along >= 0 && along <= 1 && dTip < 0.075 * along) c = along < 0.45 ? [28, 28, 30] : [255, 224, 178];
  return c;
}

function render(size, opts) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, opts);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const i = (py * size + px) * 4;
      const n = ss * ss;
      buf[i] = a ? r / a : 0;
      buf[i + 1] = a ? g / a : 0;
      buf[i + 2] = a ? b / a : 0;
      buf[i + 3] = (a / n) * 255;
    }
  }
  return png(size, buf);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', render(192, { maskable: false }));
writeFileSync('public/icons/icon-512.png', render(512, { maskable: false }));
writeFileSync('public/icons/icon-maskable-512.png', render(512, { maskable: true }));
// iOS applies its own rounded mask and ignores transparency: use the full-bleed variant.
writeFileSync('public/apple-touch-icon.png', render(180, { maskable: true }));
writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8aac8"/><stop offset="1" stop-color="#e8769f"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><path d="M13 42c3-5 5-5 7 0s4 5 7 0 5-5 7 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M27 41l22-22 5 5-22 22-7 2z" fill="#fff"/><path d="M45 23l5 5 4-4-5-5z" fill="#ffd1e1"/></svg>\n`,
);
console.log('icons written');
