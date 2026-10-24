import type { StrokePoint } from '@/model/types';

/**
 * Handwriting stabilisation pipeline (applied live, while the pen moves):
 *
 *   raw samples → outlier rejection → One Euro filter (position + pressure) → stored points
 *   stored points → centripetal Catmull-Rom + arc-length resampling → outline (render/export)
 *
 * The filter removes high-frequency hand tremor; the spline removes the polygonal look of
 * sparse samples during fast writing. Both run on every frame of the live stroke, so what the
 * user sees while writing is exactly what is committed.
 */

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * One Euro filter (Casiez et al.): the cut-off frequency rises with speed, so slow movement is
 * smoothed strongly (tremor) and fast movement is barely delayed (no lag on quick strokes).
 */
export class AdaptiveSmoother {
  private prev: StrokePoint | null = null;
  private dxFiltered = 0;
  private dyFiltered = 0;
  private readonly minCutoff: number;
  private readonly beta: number;

  constructor(
    /** stabilisation 0..1 (0 = raw input) */
    private readonly strength = 0.5,
    /** document units per screen pixel, so behaviour is zoom independent */
    private readonly unitsPerPixel = 1,
  ) {
    const s = Math.min(1, Math.max(0, strength));
    // 0 → effectively off (12 Hz), 1 → very strong (0.6 Hz at rest).
    this.minCutoff = lerp(12, 0.6, Math.pow(s, 0.8));
    this.beta = lerp(0.04, 0.0035, s);
  }

  private static alpha(cutoff: number, dtMs: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    const te = Math.max(dtMs, 1) / 1000;
    return 1 / (1 + tau / te);
  }

  push(p: StrokePoint): StrokePoint {
    const prev = this.prev;
    if (!prev || this.strength <= 0.001) {
      this.prev = p;
      return p;
    }
    const dt = Math.max(1, p.timestamp - prev.timestamp);
    // speed in screen px / s
    const rawDx = ((p.x - prev.x) / this.unitsPerPixel) * (1000 / dt);
    const rawDy = ((p.y - prev.y) / this.unitsPerPixel) * (1000 / dt);
    const aD = AdaptiveSmoother.alpha(1, dt);
    this.dxFiltered += (rawDx - this.dxFiltered) * aD;
    this.dyFiltered += (rawDy - this.dyFiltered) * aD;
    const speed = Math.hypot(this.dxFiltered, this.dyFiltered);
    const cutoff = this.minCutoff + this.beta * speed;
    const a = AdaptiveSmoother.alpha(cutoff, dt);
    const out: StrokePoint = {
      ...p,
      x: prev.x + (p.x - prev.x) * a,
      y: prev.y + (p.y - prev.y) * a,
      // Pressure gets its own, slightly stronger smoothing: sensor noise shows up as width ripples.
      pressure: prev.pressure + (p.pressure - prev.pressure) * Math.min(1, a * 1.2),
    };
    this.prev = out;
    return out;
  }

  /**
   * The filtered position trails the pen slightly. On pen-up we catch up to the real end so the
   * line is not short — unless the last raw sample points backwards (pen slipping as it lifts),
   * which is what produces the typical "hook" at the end of a word.
   */
  finish(last: StrokePoint, before?: StrokePoint): StrokePoint[] {
    const prev = this.prev;
    if (!prev) return [];
    const gap = Math.hypot(last.x - prev.x, last.y - prev.y);
    if (gap < 0.05) return [];
    if (before) {
      const dx = prev.x - before.x;
      const dy = prev.y - before.y;
      const len = Math.hypot(dx, dy);
      if (len > 0 && ((last.x - prev.x) * dx + (last.y - prev.y) * dy) / (len * gap) < 0) return [];
    }
    const steps = Math.min(4, Math.max(1, Math.round(gap / 1.5)));
    const out: StrokePoint[] = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      out.push({ ...last, x: lerp(prev.x, last.x, t), y: lerp(prev.y, last.y, t), pressure: prev.pressure, timestamp: lerp(prev.timestamp, last.timestamp, t) });
    }
    return out;
  }
}

/**
 * Rejects sensor glitches: a sample that jumps much farther than the pen could plausibly move
 * in the elapsed time (seen occasionally on palm contact or Bluetooth hiccups).
 */
export function isOutlier(prev: { x: number; y: number; t: number } | null, next: { x: number; y: number; t: number }, unitsPerPixel: number): boolean {
  if (!prev) return false;
  const dt = Math.max(1, next.t - prev.t);
  const distPx = Math.hypot(next.x - prev.x, next.y - prev.y) / unitsPerPixel;
  // ~15 px/ms is far beyond real handwriting speed (≈ 3–5 px/ms for fast flicks).
  return distPx > 60 && distPx / dt > 15;
}

/** Drop points that are closer than `minDist` to the previously kept point (keeps the last). */
export function simplifyByDistance(points: StrokePoint[], minDist: number): StrokePoint[] {
  if (points.length <= 2) return points.slice();
  const out: StrokePoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  out.push(points[points.length - 1]!);
  return out;
}

/**
 * Centripetal Catmull-Rom spline through the points, resampled at (approximately) uniform arc
 * length `spacing`. Centripetal parametrisation never forms cusps or loops on sharp turns, so
 * corners of letters stay crisp while curves become smooth. Pressure, tilt and time are
 * interpolated along the curve.
 */
export function splineResample(points: readonly StrokePoint[], spacing: number): StrokePoint[] {
  const n = points.length;
  if (n < 3) return points.slice();
  const out: StrokePoint[] = [points[0]!];
  const get = (i: number) => points[Math.max(0, Math.min(n - 1, i))]!;
  for (let i = 0; i < n - 1; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (segLen < 1e-6) continue;
    const steps = Math.max(1, Math.ceil(segLen / spacing));
    // Knot intervals (alpha = 0.5); guard against coincident points.
    const d01 = Math.max(1e-4, Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)));
    const d12 = Math.max(1e-4, Math.sqrt(segLen));
    const d23 = Math.max(1e-4, Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y)));
    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      // Barry–Goldman pyramid with knots t0=0, t1=d01, t2=d01+d12, t3=d01+d12+d23
      const t0 = 0;
      const t1 = d01;
      const t2 = t1 + d12;
      const t3 = t2 + d23;
      const t = t1 + u * d12;
      const interp = (a: number, b: number, c: number, d: number) => {
        const a1 = ((t1 - t) / (t1 - t0)) * a + ((t - t0) / (t1 - t0)) * b;
        const a2 = ((t2 - t) / (t2 - t1)) * b + ((t - t1) / (t2 - t1)) * c;
        const a3 = ((t3 - t) / (t3 - t2)) * c + ((t - t2) / (t3 - t2)) * d;
        const b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2;
        const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
        return ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
      };
      out.push({
        x: interp(p0.x, p1.x, p2.x, p3.x),
        y: interp(p0.y, p1.y, p2.y, p3.y),
        pressure: lerp(p1.pressure, p2.pressure, u),
        timestamp: lerp(p1.timestamp, p2.timestamp, u),
        tiltX: lerp(p1.tiltX, p2.tiltX, u),
        tiltY: lerp(p1.tiltY, p2.tiltY, u),
      });
    }
  }
  return out;
}
