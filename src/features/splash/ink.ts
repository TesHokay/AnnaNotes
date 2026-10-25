import { outlinePolygon, tracePolygon } from '@/engine/outline';
import type { Composition, InkStroke } from './compose';

export interface InkColors {
  ink: string;
  heart: string;
}

export interface InkFit {
  /** Max size of the composition in CSS px. */
  maxWidth: number;
  maxHeight: number;
  /** Upper bound for the scale (px per composition unit), so short phrases are not huge. */
  maxScale: number;
  /** Centre of the composition in CSS px. */
  cx: number;
  cy: number;
}

/** Index of the last point the pen has passed at time `t` (binary search). */
function passed(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (t >= times[hi]!) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function piecePath(s: InkStroke, a: number, b: number, tip?: { x: number; y: number; w: number }): Path2D {
  const pts = s.pts.slice(a, b + 1);
  const widths = s.widths.slice(a, b + 1);
  if (tip) {
    pts.push(tip);
    widths.push(tip.w);
  }
  const path = new Path2D();
  tracePolygon(path, outlinePolygon(pts, widths));
  return path;
}

/**
 * Plays a composition as real writing: the nib moves along each stroke's centre line and the
 * ink outline grows behind it, with smooth sub-sample motion of the tip. Finished pieces are
 * filled once onto the `base` canvas; only the piece under the pen is redrawn each frame on
 * `live`, so a frame costs one small outline regardless of the text length.
 */
export class InkPlayer {
  private readonly committed: boolean[][];
  private k = 1;
  private ox = 0;
  private oy = 0;
  private liveDirty = false;

  constructor(
    private readonly base: HTMLCanvasElement,
    private readonly live: HTMLCanvasElement,
    private readonly comp: Composition,
    private colors: InkColors,
  ) {
    this.committed = comp.strokes.map((s) => s.pieces.map(() => false));
  }

  /** Sizes both canvases (device pixels) and fits the composition. Clears what was drawn. */
  layout(width: number, height: number, dpr: number, fit: InkFit): void {
    const { bbox } = this.comp;
    const bw = bbox.maxX - bbox.minX;
    const bh = bbox.maxY - bbox.minY;
    this.k = Math.min(fit.maxWidth / bw, fit.maxHeight / bh, fit.maxScale);
    this.ox = fit.cx - ((bbox.minX + bbox.maxX) / 2) * this.k;
    this.oy = fit.cy - ((bbox.minY + bbox.maxY) / 2) * this.k;
    for (const c of [this.base, this.live]) {
      c.width = Math.max(1, Math.round(width * dpr));
      c.height = Math.max(1, Math.round(height * dpr));
      const ctx = c.getContext('2d');
      ctx?.setTransform(dpr * this.k, 0, 0, dpr * this.k, dpr * this.ox, dpr * this.oy);
    }
    for (const row of this.committed) row.fill(false);
    this.liveDirty = false;
  }

  setColors(colors: InkColors): void {
    this.colors = colors;
  }

  private fill(ctx: CanvasRenderingContext2D, s: InkStroke, path: Path2D): void {
    ctx.fillStyle = s.color === 'heart' ? this.colors.heart : this.colors.ink;
    ctx.fill(path);
  }

  /** Draws the state at time `t` (ms). Returns true once everything is written. */
  frame(t: number): boolean {
    const bctx = this.base.getContext('2d');
    const lctx = this.live.getContext('2d');
    if (!bctx || !lctx) return true;
    if (this.liveDirty) {
      lctx.save();
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, this.live.width, this.live.height);
      lctx.restore();
      this.liveDirty = false;
    }
    this.comp.strokes.forEach((s, si) => {
      if (t < s.times[0]!) return;
      const row = this.committed[si]!;
      s.pieces.forEach(([a, b], pi) => {
        if (row[pi]) return;
        if (t >= s.times[b]!) {
          this.fill(bctx, s, piecePath(s, a, b));
          row[pi] = true;
          return;
        }
        if (t < s.times[a]!) return;
        // The piece under the pen: up to the last passed sample plus the exact tip position.
        const i = passed(s.times, t);
        const j = Math.min(b, i + 1);
        const span = s.times[j]! - s.times[i]!;
        const u = span > 0 ? (t - s.times[i]!) / span : 0;
        const p = s.pts[i]!;
        const q = s.pts[j]!;
        const tip = { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u, w: s.widths[i]! + (s.widths[j]! - s.widths[i]!) * u };
        this.fill(lctx, s, piecePath(s, a, i, tip));
        this.liveDirty = true;
      });
    });
    return t >= this.comp.end;
  }

  /** Everything at once (reduced motion, or after a resize at the end). */
  drawAll(): void {
    this.frame(Number.POSITIVE_INFINITY);
  }
}

export function inkColors(): InkColors {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim();
  const dark = document.documentElement.classList.contains('dark');
  return { ink: v ? `hsl(${v})` : '#2a2226', heart: dark ? '#e8778f' : '#b8304e' };
}
