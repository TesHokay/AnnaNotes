import type { StrokePoint } from '@/model/types';

/**
 * Adaptive low-pass filter in the spirit of the 1€ filter: when the pen moves slowly the
 * cut-off frequency is low (strong smoothing removes hand jitter), when it moves fast the
 * cut-off rises so the line does not lag behind the pen.
 */
export class AdaptiveSmoother {
  private prev: StrokePoint | null = null;
  private dxFiltered = 0;
  private dyFiltered = 0;

  constructor(
    /** smoothing strength 0..1 (0 = raw input) */
    private readonly strength = 0.5,
    /** scale: document units per screen pixel, so behaviour is zoom independent */
    private readonly unitsPerPixel = 1,
  ) {}

  private static alpha(cutoff: number, dtMs: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    const te = Math.max(dtMs, 1) / 1000;
    return 1 / (1 + tau / te);
  }

  push(p: StrokePoint): StrokePoint {
    const prev = this.prev;
    if (!prev || this.strength <= 0) {
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
    const minCutoff = 1 + (1 - this.strength) * 6; // Hz
    const beta = 0.012 + (1 - this.strength) * 0.02;
    const cutoff = minCutoff + beta * speed;
    const a = AdaptiveSmoother.alpha(cutoff, dt);
    const out: StrokePoint = {
      ...p,
      x: prev.x + (p.x - prev.x) * a,
      y: prev.y + (p.y - prev.y) * a,
      pressure: prev.pressure + (p.pressure - prev.pressure) * Math.min(1, a * 1.5),
    };
    this.prev = out;
    return out;
  }

  /**
   * The filtered position trails the pen slightly; on pen-up we append the true final position
   * so the stroke ends exactly where the pen was lifted.
   */
  finish(last: StrokePoint): StrokePoint | null {
    if (!this.prev) return null;
    if (Math.hypot(this.prev.x - last.x, this.prev.y - last.y) < 0.05) return null;
    return { ...last, pressure: this.prev.pressure };
  }
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
