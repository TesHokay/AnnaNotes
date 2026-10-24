import { describe, expect, it } from 'vitest';
import { eraseStrokePartially, resample, strokeHitBySweep } from './eraser';
import { makeStroke, pts } from '@/test/helpers';

let n = 0;
const id = () => `frag-${++n}`;

describe('eraser', () => {
  const line = () => makeStroke(pts([[0, 0], [100, 0]]), { baseWidth: 2 });

  it('hit test uses the swept capsule so fast eraser moves do not skip strokes', () => {
    const s = line();
    expect(strokeHitBySweep(s, { from: { x: 50, y: -50 }, to: { x: 50, y: 50 }, radius: 2 })).toBe(true);
    expect(strokeHitBySweep(s, { from: { x: 50, y: 10 }, to: { x: 60, y: 10 }, radius: 2 })).toBe(false);
  });

  it('resamples long segments', () => {
    const r = resample(pts([[0, 0], [10, 0]]), 1);
    expect(r.length).toBe(11);
    expect(r[5]!.x).toBeCloseTo(5);
  });

  it('splits a stroke into two fragments when erasing the middle', () => {
    const frags = eraseStrokePartially(line(), { from: { x: 50, y: 0 }, to: { x: 50, y: 0 }, radius: 5 }, id)!;
    expect(frags).toHaveLength(2);
    expect(Math.max(...frags[0]!.points.map((p) => p.x))).toBeLessThan(45);
    expect(Math.min(...frags[1]!.points.map((p) => p.x))).toBeGreaterThan(55);
    expect(frags[0]!.id).not.toBe(frags[1]!.id);
    expect(frags[0]!.boundingBox.maxX).toBeLessThan(50);
  });

  it('returns null when untouched and [] when fully erased', () => {
    expect(eraseStrokePartially(line(), { from: { x: 50, y: 40 }, to: { x: 50, y: 40 }, radius: 5 }, id)).toBeNull();
    expect(eraseStrokePartially(line(), { from: { x: -10, y: 0 }, to: { x: 110, y: 0 }, radius: 5 }, id)).toEqual([]);
  });

  it('trims the end of a stroke', () => {
    const frags = eraseStrokePartially(line(), { from: { x: 100, y: 0 }, to: { x: 100, y: 0 }, radius: 10 }, id)!;
    expect(frags).toHaveLength(1);
    expect(frags[0]!.points[0]!.x).toBe(0);
  });
});
