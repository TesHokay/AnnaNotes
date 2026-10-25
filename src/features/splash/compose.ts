import { splineResample } from '@/engine/smoothing';
import type { StrokePoint } from '@/model/types';
import { CYRILLIC, HANZI, LATIN, PHRASES, type Glyph, type Pt } from './glyphs';
import type { SplashLang } from './shuffleBag';

/**
 * A stroke ready to animate: a dense centre line (uniform arc length), the nib width and the
 * moment the pen passes each point on the global timeline (ms).
 */
export interface InkStroke {
  pts: { x: number; y: number }[];
  widths: number[];
  times: number[];
  /**
   * Index ranges filled as separate shapes. A stroke is split where it turns back on itself
   * (the hairline up and the shaded stroke down the same path) and every ~20 units, so each
   * piece is a simple outline: no self-overlap holes, no angular joins.
   */
  pieces: [number, number][];
  color: 'ink' | 'heart';
}

export interface Composition {
  strokes: InkStroke[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** ms when the heart (or the last stroke) is complete */
  end: number;
}

export interface ComposeOptions {
  /** Upper bound of the writing time without pauses (long texts are written faster). */
  maxWriteMs?: number;
  heart?: boolean;
}

const SLANT = 0.3; // copperplate slant (x shift per unit of height)
const SPACE = 0.6;
const LINE_HEIGHT = 3.9;
/** Work at a real size (x-height = 40 units) so widths and sampling behave like ink on a page. */
const UNIT = 40;
const SPACING = 0.8;

// Pointed pen: hairline and full shade in units (x-height = 40).
const HAIR = 1.05;
const SHADE = 6.6;

// Pauses (ms). Writing ~30% slower than 3.0, with natural breaks between strokes and words.
const LIFT_MS = 55;
const WORD_MS = 210;
const LINE_MS = 380;
const CHAR_MS = 120;
const START_MS = 220;
const HEART_PAUSE_MS = 340;
const HEART_MS = 720;

type Kind = 'pen' | 'brush' | 'heart';

interface RawStroke {
  pts: StrokePoint[];
  kind: Kind;
  line: number;
  word: number;
}

const sp = (x: number, y: number, pressure = 0.5): StrokePoint => ({ x, y, pressure, timestamp: 0, tiltX: 0, tiltY: 0 });

const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Three box passes ≈ Gaussian. Window shrinks at the ends so values there are not dragged. */
export function gaussian(values: readonly number[], radius: number): number[] {
  let cur = values.slice();
  if (radius < 1 || cur.length < 3) return cur;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Array<number>(cur.length);
    // prefix sums: O(n) per pass
    const pre = new Array<number>(cur.length + 1);
    pre[0] = 0;
    for (let i = 0; i < cur.length; i++) pre[i + 1] = pre[i]! + cur[i]!;
    for (let i = 0; i < cur.length; i++) {
      const r = Math.min(radius, i, cur.length - 1 - i);
      next[i] = (pre[i + r + 1]! - pre[i - r]!) / (2 * r + 1);
    }
    cur = next;
  }
  return cur;
}

function tangents(pts: readonly { x: number; y: number }[], k = 3): { x: number; y: number }[] {
  const n = pts.length;
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - k)]!;
    const b = pts[Math.min(n - 1, i + k)]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  });
}

function arcLengths(pts: readonly { x: number; y: number }[]): number[] {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  return s;
}

/**
 * Pointed-pen widths: the tines open only on downstrokes. The swell follows the direction
 * smoothly along the arc length (no blobs at turns); entry and exit taper to a hairline.
 */
function penWidths(pts: readonly { x: number; y: number }[]): number[] {
  const t = tangents(pts);
  const s = arcLengths(pts);
  const total = s[s.length - 1]!;
  const raw = t.map((d) => HAIR + (SHADE - HAIR) * Math.pow(smoothstep((d.y - 0.12) / 0.78), 1.15));
  const w = gaussian(raw, 6);
  return w.map((v, i) => {
    const head = 0.5 + 0.5 * smoothstep(s[i]! / 7);
    const tail = 0.55 + 0.45 * smoothstep((total - s[i]!) / 9);
    return Math.max(HAIR * 0.75, v * Math.min(head, tail));
  });
}

/** Brush: width from the authored pressure, softened along the stroke. */
function brushWidths(pts: readonly StrokePoint[]): number[] {
  return gaussian(
    pts.map((p) => 1.2 + 8.5 * Math.pow(p.pressure, 1.15)),
    3,
  );
}

function heartWidths(pts: readonly { x: number; y: number }[]): number[] {
  const t = tangents(pts);
  return gaussian(
    t.map((d) => 2.2 + 2.4 * smoothstep((d.y + 0.2) / 1.2)),
    8,
  );
}

/** Split points: where the path reverses (cusp) and at a maximum piece length. */
export function splitPieces(pts: readonly { x: number; y: number }[], maxLen = 26): [number, number][] {
  const n = pts.length;
  if (n < 2) return [[0, Math.max(0, n - 1)]];
  const out: [number, number][] = [];
  let start = 0;
  const k = 2;
  for (let i = k; i < n - k; i++) {
    const a = pts[i - k]!;
    const b = pts[i]!;
    const c = pts[i + k]!;
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const cos = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) || 1) * (Math.hypot(vx, vy) || 1));
    if ((cos < -0.2 && i - start > 3) || i - start >= maxLen) {
      out.push([start, i]);
      start = i;
    }
  }
  out.push([start, n - 1]);
  return out;
}

/**
 * Writing tempo of a real hand, in raw time units (≈ length at full speed): the pen slows down
 * through tight curves and turns, flows on long straight joins, accelerates out of the start
 * and settles into the end. Long flourishes are a little faster overall.
 */
function rawTimes(pts: readonly { x: number; y: number }[]): number[] {
  const n = pts.length;
  const s = arcLengths(pts);
  const total = s[n - 1]!;
  const t = tangents(pts, 2);
  const curv = t.map((d, i) => {
    const prev = t[Math.max(0, i - 2)]!;
    const next = t[Math.min(n - 1, i + 2)]!;
    const dot = Math.max(-1, Math.min(1, prev.x * next.x + prev.y * next.y));
    void d;
    return Math.acos(dot) / (4 * SPACING);
  });
  const slow = gaussian(
    curv.map((k) => 1 / (1 + 7 * k)),
    7,
  );
  const boost = 1 + 0.3 * smoothstep(total / 420);
  const times = [0];
  for (let i = 1; i < n; i++) {
    const ease = Math.min(0.4 + 0.6 * smoothstep(s[i]! / 14), 0.45 + 0.55 * smoothstep((total - s[i]!) / 14));
    const v = Math.max(0.28, slow[i]!) * ease * boost;
    times.push(times[i - 1]! + (s[i]! - s[i - 1]!) / v);
  }
  return times;
}

function composeLatin(text: string, line: number, wordBase: number): { strokes: RawStroke[]; words: number } {
  const out: RawStroke[] = [];
  let x = 0;
  let word = wordBase;
  let open: Pt[] | null = null;
  let deferred: Pt[][] = [];
  let prevGlyph: Glyph | null = null;
  const push = (pts: Pt[]) => out.push({ pts: pts.map(([px, py]) => sp(px, py)), kind: 'pen', line, word });
  const endWord = () => {
    if (open) push(open);
    // i-dots and t-bars are added after the word, as a calligrapher does
    for (const d of deferred) push(d);
    open = null;
    deferred = [];
    if (prevGlyph) word++;
    prevGlyph = null;
  };
  for (const ch of text) {
    if (ch === ' ') {
      endWord();
      x += SPACE;
      continue;
    }
    const g = LATIN[ch] ?? CYRILLIC[ch];
    if (!g) continue;
    const shifted = g.strokes.map((s) => s.map(([px, py]) => [px + x, py] as Pt));
    const [main, ...rest] = shifted;
    // After a letter that ends at the x-height, the next one is joined at the top — unless that
    // would cut off a real part of it (the shaded entry of «л»): then the pen lifts instead.
    const topEntry = main ? main.findIndex(([, py]) => py <= -0.55) : -1;
    const join = open && prevGlyph && !prevGlyph.isolated && !prevGlyph.breakAfter && !g.isolated && !g.breakBefore && !(prevGlyph.exitTop && topEntry > 2);
    if (join && main) {
      let pts = main;
      // After letters that finish at the x-height, skip the baseline entry stroke.
      if (prevGlyph!.exitTop) {
        const k = pts.findIndex(([, py]) => py <= -0.55);
        if (k > 0) pts = pts.slice(k);
      } else if (pts.length > 2 && pts[0]![1] > -0.1) {
        // The previous letter already rises from the baseline: drop this letter's baseline entry
        // point, otherwise the join dips down and back up.
        pts = pts.slice(1);
      }
      open!.push(...pts);
    } else {
      if (open) push(open);
      open = main ? [...main] : null;
    }
    if (g.isolated) {
      // Capital swashes and punctuation: written as separate strokes.
      if (open) push(open);
      for (const s of rest) push(s);
      open = null;
    } else {
      deferred.push(...rest);
    }
    prevGlyph = g;
    x += g.adv;
  }
  endWord();
  // Copperplate slant
  for (const s of out) for (const p of s.pts) p.x -= p.y * SLANT;
  return { strokes: out, words: word - wordBase };
}

function composeHanzi(text: string): RawStroke[] {
  const size = 2.6;
  const gap = 0.35;
  const out: RawStroke[] = [];
  let x = 0;
  let word = 0;
  for (const ch of text) {
    const strokes = HANZI[ch];
    if (!strokes) continue;
    for (const s of strokes) out.push({ kind: 'brush', line: 0, word, pts: s.map(([px, py, pr]) => sp(x + px * size, (py - 1) * size + 0.3, pr)) });
    x += size + gap;
    word++;
  }
  return out;
}

/** The classic heart curve as one continuous stroke, started and finished at the bottom tip. */
function heartStroke(cx: number, cy: number, size: number, line: number): RawStroke {
  const pts: StrokePoint[] = [];
  const n = 120;
  for (let i = 0; i <= n; i++) {
    const t = Math.PI + (i / n) * Math.PI * 2;
    const hx = 16 * Math.pow(Math.sin(t), 3);
    const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push(sp(cx + (hx / 34) * size, cy + (hy / 34) * size));
  }
  return { pts, kind: 'heart', line, word: -1 };
}

function bboxOf(strokes: readonly { pts: readonly { x: number; y: number }[] }[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes)
    for (const p of s.pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  return { minX, minY, maxX, maxY };
}

/** Latin/Cyrillic text in one or more centred lines (Chinese when `hanzi`). */
export function composeLines(lines: readonly string[], opts: ComposeOptions & { hanzi?: boolean } = {}): Composition {
  const raw: RawStroke[] = [];
  if (opts.hanzi) raw.push(...composeHanzi(lines.join('')));
  else {
    let word = 0;
    const perLine = lines.map((text, li) => {
      const r = composeLatin(text, li, word);
      word += r.words + 1;
      return r.strokes;
    });
    const widths = perLine.map((s) => {
      const b = bboxOf(s);
      return { minX: b.minX, w: b.maxX - b.minX };
    });
    const widest = Math.max(...widths.map((w) => w.w));
    perLine.forEach((strokes, li) => {
      const dx = (widest - widths[li]!.w) / 2 - widths[li]!.minX;
      for (const s of strokes) for (const p of s.pts) {
        p.x += dx;
        p.y += li * LINE_HEIGHT;
      }
      raw.push(...strokes);
    });
  }
  if (opts.heart !== false && raw.length) {
    const lastLine = raw[raw.length - 1]!.line;
    const lineBox = bboxOf(raw.filter((s) => s.line === lastLine));
    const hs = opts.hanzi ? 1.6 : 1.25;
    raw.push(heartStroke(lineBox.maxX + hs * 0.8, (opts.hanzi ? -1.0 : -0.9) + lastLine * LINE_HEIGHT, hs, lastLine));
  }

  const prepared = raw.map((s) => {
    let scaled = s.pts.map((p) => ({ ...p, x: p.x * UNIT, y: p.y * UNIT }));
    // Two-point strokes (dots, short brush strokes) get a midpoint so they are sampled like the rest.
    if (scaled.length === 2) {
      const [a, b] = scaled as [StrokePoint, StrokePoint];
      scaled = [a, { ...a, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, pressure: (a.pressure + b.pressure) / 2 }, b];
    }
    const dense = splineResample(scaled, SPACING);
    const widths = s.kind === 'brush' ? brushWidths(dense) : s.kind === 'heart' ? heartWidths(dense) : penWidths(dense);
    const pts = dense.map((p) => ({ x: p.x, y: p.y }));
    return { s, pts, widths, raw: rawTimes(pts) };
  });

  // Global tempo: the text is written in ~1.6–2.5 s plus pauses depending on its length (≈30% slower than 3.0).
  const ink = prepared.filter((p) => p.s.kind !== 'heart');
  const inkLen = ink.reduce((a, p) => a + arcLengths(p.pts).at(-1)!, 0);
  const rawTotal = ink.reduce((a, p) => a + p.raw.at(-1)!, 0);
  const writeMs = Math.min(opts.maxWriteMs ?? 2500, Math.max(1600, 900 + (inkLen / UNIT) * 28));
  const k = writeMs / Math.max(1e-6, rawTotal);

  let t = START_MS;
  const strokes: InkStroke[] = [];
  let prev: RawStroke | null = null;
  for (const p of prepared) {
    if (p.s.kind === 'heart') {
      t += HEART_PAUSE_MS;
      const hk = HEART_MS / p.raw.at(-1)!;
      strokes.push({ pts: p.pts, widths: p.widths, times: p.raw.map((v) => t + v * hk), pieces: splitPieces(p.pts, 40), color: 'heart' });
      t += HEART_MS;
      prev = p.s;
      continue;
    }
    if (prev) t += prev.line !== p.s.line ? LINE_MS : prev.word !== p.s.word ? (p.s.kind === 'brush' ? CHAR_MS : WORD_MS) : LIFT_MS;
    const start = t;
    strokes.push({ pts: p.pts, widths: p.widths, times: p.raw.map((v) => start + v * k), pieces: splitPieces(p.pts), color: 'ink' });
    t = start + p.raw.at(-1)! * k;
    prev = p.s;
  }
  // Include the stroke widths so the composition never touches the edges.
  const b = bboxOf(strokes);
  const pad = SHADE;
  return { strokes, bbox: { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }, end: t };
}

export function composePhrase(lang: SplashLang): Composition {
  return composeLines([PHRASES[lang]], { hanzi: lang === 'zh' });
}
