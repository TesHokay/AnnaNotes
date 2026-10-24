import { describe, expect, it } from 'vitest';
import { normalizePressure, PressureDetector, SimulatedPressure } from './pressure';
import { AdaptiveSmoother, simplifyByDistance } from './smoothing';
import { pts } from '@/test/helpers';

describe('pressure', () => {
  it('normalises into 0..1 and is monotonic', () => {
    let prev = -1;
    for (let r = 0; r <= 1; r += 0.05) {
      const n = normalizePressure(r);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(normalizePressure(Number.NaN)).toBe(0.5);
  });

  it('higher sensitivity gives more width for the same light pressure', () => {
    const hi = normalizePressure(0.25, { sensitivity: 0.9, floor: 0.02, ceiling: 0.75 });
    const lo = normalizePressure(0.25, { sensitivity: 0.1, floor: 0.02, ceiling: 0.75 });
    expect(hi).toBeGreaterThan(lo);
  });

  it('detects real vs constant pressure', () => {
    const mouse = new PressureDetector('mouse');
    mouse.add(0.5);
    expect(mouse.hasRealPressure).toBe(false);

    const constantPen = new PressureDetector('pen');
    for (let i = 0; i < 10; i++) constantPen.add(0.5);
    expect(constantPen.hasRealPressure).toBe(false);

    const pencil = new PressureDetector('pen');
    [0.21, 0.25, 0.33, 0.4].forEach((p) => pencil.add(p));
    expect(pencil.hasRealPressure).toBe(true);

    const touch = new PressureDetector('touch');
    for (let i = 0; i < 5; i++) touch.add(0);
    expect(touch.hasRealPressure).toBe(false);
  });

  it('simulated pressure thins out with speed', () => {
    const slow = new SimulatedPressure();
    const fast = new SimulatedPressure();
    let s = 0;
    let f = 0;
    for (let i = 0; i < 20; i++) {
      s = slow.next(0.05);
      f = fast.next(3);
    }
    expect(f).toBeLessThan(s);
  });
});

describe('smoothing', () => {
  it('reduces jitter and ends exactly at the pen-up position', () => {
    const sm = new AdaptiveSmoother(0.6, 1);
    const jitter = pts(Array.from({ length: 40 }, (_, i) => [i * 2, i % 2 ? 1.5 : -1.5] as [number, number]));
    const out = jitter.map((p) => sm.push(p));
    const rawVar = jitter.slice(10).reduce((a, p) => a + p.y * p.y, 0);
    const outVar = out.slice(10).reduce((a, p) => a + p.y * p.y, 0);
    expect(outVar).toBeLessThan(rawVar * 0.5);
    const last = jitter[jitter.length - 1]!;
    expect(sm.finish(last)).toMatchObject({ x: last.x, y: last.y });
  });

  it('simplifies by distance but keeps endpoints', () => {
    const p = pts([[0, 0], [0.1, 0], [0.2, 0], [5, 0], [5.1, 0]]);
    const s = simplifyByDistance(p, 1);
    expect(s[0]).toBe(p[0]);
    expect(s[s.length - 1]).toBe(p[4]);
    expect(s.length).toBe(3);
  });
});
