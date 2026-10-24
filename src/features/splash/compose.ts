import { computeWidths, widthProfile } from '@/engine/outline';
import { splineResample } from '@/engine/smoothing';
import type { StrokePoint } from '@/model/types';
import { CYRILLIC, HANZI, LATIN, PHRASES, type Glyph, type Pt } from './glyphs';
import type { SplashLang } from './shuffleBag';

/** A stroke ready to animate: dense centre line, widths, and a normalised time for each point. */
export interface InkStroke {
  pts: { x: number; y: number }[];
  widths: number[];
  /** cumulative time 0..1 within the stroke for each point */
  times: number[];
  /** start and duration in ms on the global timeline */
  start: number;
  duration: number;
  color: 'ink' | 'heart';
}

export interface Composition {
  strokes: InkStroke[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** ms when the heart is complete */
  end: number;
}

const SLANT = 0.3; // copperplate slant (x shift per unit of height)
const SPACE = 0.6;
const UNIT = 40;

function toStrokePoints(pts: readonly Pt[], pressure = 0.5): StrokePoint[] {
  return pts.map(([x, y]) => ({ x, y, pressure, timestamp: 0, tiltX: 0, tiltY: 0 }));
}

/** Box blur of widths along the stroke: shades swell and fade gradually, no blobs at turns. */
function blur(w: number[], radius: number): number[] {
  let cur = w;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Array<number>(cur.length);
    for (let i = 0; i < cur.length; i++) {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(0, i - radius); k <= Math.min(cur.length - 1, i + radius); k++) {
        sum += cur[k]!;
        n++;
      }
      next[i] = sum / n;
    }
    cur = next;
  }
  return cur;
}

/** Writing speed varies like a hand: slower through tight curves, faster on straight joins. */
function timeline(pts: readonly { x: number; y: number }[]): { times: number[]; weight: number } {
  const n = pts.length;
  const raw = [0];
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const a = pts[Math.max(0, i - 2)]!;
    const b = pts[i - 1]!;
    const c = pts[i]!;
    const ds = Math.hypot(c.x - b.x, c.y - b.y);
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const curvature = ds > 1e-6 ? turn / ds : 0;
    acc += ds * (1 + Math.min(6, curvature * 0.12));
    raw.push(acc);
  }
  return { times: raw.map((v) => (acc > 0 ? v / acc : 1)), weight: acc };
}

interface RawStroke {
  pts: StrokePoint[];
  kind: 'pen' | 'brush' | 'heart';
  width: number;
}

function composeLatin(text: string): RawStroke[] {
  const out: RawStroke[] = [];
  let x = 0;
  let open: Pt[] | null = null;
  let deferred: Pt[][] = [];
  let prevGlyph: Glyph | null = null;
  const endWord = () => {
    if (open) out.push({ pts: toStrokePoints(open), kind: 'pen', width: 0.15 });
    // i-dots and t-bars are added after the word, as a calligrapher does
    for (const d of deferred) out.push({ pts: toStrokePoints(d), kind: 'pen', width: 0.15 });
    open = null;
    deferred = [];
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
    const join = open && prevGlyph && !prevGlyph.isolated && !prevGlyph.breakAfter && !g.isolated && !g.breakBefore;
    if (join && main) {
      let pts = main;
      // After letters that finish at the x-height, skip the baseline entry stroke.
      if (prevGlyph!.exitTop) {
        const k = pts.findIndex(([, py]) => py <= -0.55);
        if (k > 0) pts = pts.slice(k);
      } else if (pts.length > 2 && pts[0]![1] > -0.1) {
        // The previous letter already rises from the baseline: drop this letter's baseline entry
        // point, otherwise the join dips down and back up and the dip gets shaded into a dot.
        pts = pts.slice(1);
      }
      open!.push(...pts);
    } else {
      if (open) out.push({ pts: toStrokePoints(open), kind: 'pen', width: 0.15 });
      open = main ? [...main] : null;
    }
    if (g.isolated) {
      // Capital swashes: first stroke is the swash, the rest written right after.
      if (open) out.push({ pts: toStrokePoints(open), kind: 'pen', width: 0.15 });
      for (const s of rest) out.push({ pts: toStrokePoints(s), kind: 'pen', width: 0.15 });
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
  return out;
}

function composeHanzi(text: string): RawStroke[] {
  const size = 2.6;
  const gap = 0.35;
  const out: RawStroke[] = [];
  let x = 0;
  for (const ch of text) {
    const strokes = HANZI[ch];
    if (!strokes) continue;
    for (const s of strokes) {
      out.push({
        kind: 'brush',
        width: 0.3,
        pts: s.map(([px, py, pr]) => ({ x: x + px * size, y: (py - 1) * size + 0.3, pressure: pr, timestamp: 0, tiltX: 0, tiltY: 0 })),
      });
    }
    x += size + gap;
  }
  return out;
}

/** One continuous stroke: the classic heart curve, started at the bottom tip. */
function heartStroke(cx: number, cy: number, size: number): RawStroke {
  const pts: StrokePoint[] = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const t = Math.PI + (i / n) * Math.PI * 2;
    const hx = 16 * Math.pow(Math.sin(t), 3);
    const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push({ x: cx + (hx / 34) * size, y: cy + (hy / 34) * size, pressure: 0.5, timestamp: 0, tiltX: 0, tiltY: 0 });
  }
  // A small finishing flourish past the tip
  const tip = pts[pts.length - 1]!;
  pts.push({ ...tip, x: tip.x + size * 0.12, y: tip.y + size * 0.06 });
  return { pts, kind: 'heart', width: 0.12 };
}

export function composePhrase(lang: SplashLang): Composition {
  const text = PHRASES[lang];
  const raw = lang === 'zh' ? composeHanzi(text) : composeLatin(text);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of raw)
    for (const p of s.pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  const hs = lang === 'zh' ? 1.6 : 1.25;
  raw.push(heartStroke(maxX + hs * 0.75, lang === 'zh' ? -1.0 : -0.9, hs));

  const pen = widthProfile('pen', 'calligraphy');
  const brush = widthProfile('pen', 'brush');
  // Work at a real size (x-height = 40 units) so the engine's width model and minimum hairline
  // behave as on a page; the renderer scales the result to the screen.
  const prepared = raw.map((s) => {
    const scaled = s.pts.map((p) => ({ ...p, x: p.x * UNIT, y: p.y * UNIT }));
    const dense = splineResample(scaled, 0.8);
    const widths = blur(s.kind === 'brush' ? computeWidths(dense, s.width * UNIT, brush, false) : computeWidths(dense, s.width * UNIT, pen, true), s.kind === 'brush' ? 2 : 7);
    const tl = timeline(dense);
    return { s, dense, widths, ...tl };
  });

  // Global timeline: text is written in ~1.6–2.6 s depending on its length; the heart follows.
  const inkWeight = prepared.filter((p) => p.s.kind !== 'heart').reduce((a, p) => a + p.weight, 0);
  const writeMs = Math.min(2300, Math.max(1400, 850 + (inkWeight / UNIT) * 26));
  const lift = 45; // pen lift between strokes
  const inkStrokes = prepared.filter((p) => p.s.kind !== 'heart');
  const liftTotal = lift * Math.max(0, inkStrokes.length - 1);
  const perWeight = (writeMs - liftTotal) / Math.max(1e-6, inkWeight);
  let t = 200;
  const strokes: InkStroke[] = [];
  for (const p of prepared) {
    if (p.s.kind === 'heart') {
      t += 140; // short natural pause before the heart
      strokes.push({ pts: p.dense, widths: p.widths, times: p.times, start: t, duration: 400, color: 'heart' });
      t += 400;
      continue;
    }
    const duration = Math.max(60, p.weight * perWeight);
    strokes.push({ pts: p.dense, widths: p.widths, times: p.times, start: t, duration, color: 'ink' });
    t += duration + lift;
  }
  minX = minY = Infinity;
  maxX = maxY = -Infinity;
  for (const s of strokes)
    for (const p of s.pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  return { strokes, bbox: { minX, minY, maxX, maxY }, end: t };
}
