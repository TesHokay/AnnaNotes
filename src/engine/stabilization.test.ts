import { describe, expect, it } from 'vitest';
import { AdaptiveSmoother, isOutlier, splineResample } from './smoothing';
import { computeWidths, renderPoints, widthProfile } from './outline';
import type { StrokePoint } from '@/model/types';

const P = (x: number, y: number, t: number, pressure = 0.5): StrokePoint => ({ x, y, pressure, timestamp: t, tiltX: 0, tiltY: 0 });

function jitterLine(noise: number): StrokePoint[] {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return Array.from({ length: 120 }, (_, i) => P(i * 2, 50 + rnd() * noise, i * 8));
}

function roughness(points: readonly StrokePoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    sum += Math.abs(a.y - 2 * b.y + c.y); // second difference: high-frequency energy
  }
  return sum / points.length;
}

describe('stabilisation', () => {
  it('stronger settings remove more tremor', () => {
    const raw = jitterLine(1.5);
    const run = (s: number) => {
      const f = new AdaptiveSmoother(s, 1);
      return raw.map((p) => f.push(p));
    };
    const r0 = roughness(run(0));
    const r3 = roughness(run(0.3));
    const r8 = roughness(run(0.8));
    expect(r0).toBeCloseTo(roughness(raw)); // "off" is raw input
    expect(r3).toBeLessThan(r0 * 0.7);
    expect(r8).toBeLessThan(r3);
  });

  it('keeps fast intentional movement: little lag on quick strokes', () => {
    const f = new AdaptiveSmoother(0.55, 1);
    let last: StrokePoint = P(0, 0, 0);
    for (let i = 0; i <= 20; i++) last = f.push(P(i * 15, 0, i * 4)); // ~3.75 px/ms flick
    expect(300 - last.x).toBeLessThan(25);
  });

  it('catches up to the pen-up position without a backwards hook', () => {
    const f = new AdaptiveSmoother(0.6, 1);
    const pts: StrokePoint[] = [];
    for (let i = 0; i <= 30; i++) pts.push(f.push(P(i * 3, 0, i * 8)));
    const tail = f.finish(P(90, 0, 240), pts[pts.length - 2]);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail[tail.length - 1]!.x).toBe(90);
    // A last sample that jumps backwards (pen slipping on lift) is ignored.
    const g = new AdaptiveSmoother(0.6, 1);
    const q: StrokePoint[] = [];
    for (let i = 0; i <= 30; i++) q.push(g.push(P(i * 3, 0, i * 8)));
    expect(g.finish(P(q[q.length - 1]!.x - 6, 4, 260), q[q.length - 2])).toEqual([]);
  });

  it('rejects teleporting samples only', () => {
    expect(isOutlier({ x: 0, y: 0, t: 0 }, { x: 200, y: 0, t: 4 }, 1)).toBe(true);
    expect(isOutlier({ x: 0, y: 0, t: 0 }, { x: 12, y: 0, t: 4 }, 1)).toBe(false);
  });
});

describe('spline centre line', () => {
  it('passes through the end points and resamples densely and evenly', () => {
    const pts = [P(0, 0, 0), P(40, 30, 10), P(80, 0, 20), P(120, 30, 30)];
    const out = splineResample(pts, 1);
    expect(out[0]).toMatchObject({ x: 0, y: 0 });
    expect(out[out.length - 1]!.x).toBeCloseTo(120);
    expect(out.length).toBeGreaterThan(100);
    for (let i = 1; i < out.length; i++) expect(Math.hypot(out[i]!.x - out[i - 1]!.x, out[i]!.y - out[i - 1]!.y)).toBeLessThan(2);
  });

  it('does not overshoot at sharp corners (centripetal)', () => {
    const out = splineResample([P(0, 0, 0), P(50, 0, 1), P(50.5, 50, 2), P(51, 100, 3)], 0.5);
    const maxX = Math.max(...out.map((p) => p.x));
    expect(maxX).toBeLessThan(56);
  });

  it('shapes keep their exact polyline (no rounding of corners)', () => {
    const pts = [P(0, 0, 0), P(10, 0, 1), P(10, 10, 2)];
    expect(renderPoints({ points: pts, baseWidth: 2, tool: 'shape', penStyle: 'ballpoint' })).toBe(pts);
  });
});

describe('pen width models', () => {
  const vertical = (dir: 1 | -1) => Array.from({ length: 40 }, (_, i) => P(0, dir * i * 2, i * 8, 0.8));

  it('calligraphy: downstrokes are much thicker than upstrokes', () => {
    const prof = widthProfile('pen', 'calligraphy');
    const down = computeWidths(vertical(1), 6, prof);
    const up = computeWidths(vertical(-1), 6, prof);
    const mid = 20;
    expect(down[mid]!).toBeGreaterThan(up[mid]! * 4);
    // tapered thin ends
    expect(down[0]!).toBeLessThan(down[mid]! * 0.5);
  });

  it('calligraphy without real pressure still has contrast (simulation from direction)', () => {
    const prof = widthProfile('pen', 'calligraphy');
    const flat = (dir: 1 | -1) => vertical(dir).map((p) => ({ ...p, pressure: 0.5 }));
    expect(computeWidths(flat(1), 6, prof, true)[20]!).toBeGreaterThan(computeWidths(flat(-1), 6, prof, true)[20]! * 4);
  });

  it('monoline and fineliner ignore pressure; brush reacts strongly', () => {
    const light = vertical(1).map((p) => ({ ...p, pressure: 0.1 }));
    const heavy = vertical(1).map((p) => ({ ...p, pressure: 1 }));
    const ratio = (style: 'monoline' | 'fineliner' | 'brush') => computeWidths(heavy, 4, widthProfile('pen', style))[20]! / computeWidths(light, 4, widthProfile('pen', style))[20]!;
    expect(ratio('monoline')).toBeCloseTo(1);
    expect(ratio('fineliner')).toBeLessThan(1.1);
    expect(ratio('brush')).toBeGreaterThan(4);
  });

  it('widths change smoothly (no jumps between neighbours)', () => {
    const noisy = vertical(1).map((p, i) => ({ ...p, pressure: i % 2 ? 0.9 : 0.3 }));
    const w = computeWidths(noisy, 4, widthProfile('pen', 'fountain'));
    for (let i = 5; i < w.length - 5; i++) expect(Math.abs(w[i]! - w[i - 1]!)).toBeLessThan(0.6);
  });
});
