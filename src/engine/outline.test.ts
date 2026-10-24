import { describe, expect, it } from 'vitest';
import { computeWidths, outlinePolygon, polygonToSvgPath, strokeOutline, widthProfile } from './outline';
import { bboxFromPoints, pointInPolygon } from './geometry';
import { makeStroke, pts } from '@/test/helpers';

describe('stroke outline', () => {
  it('width follows pressure for the fountain pen and stays constant for shapes', () => {
    const light = pts(Array.from({ length: 30 }, (_, i) => [i * 2, 0] as [number, number]), 0.1);
    const heavy = pts(Array.from({ length: 30 }, (_, i) => [i * 2, 0] as [number, number]), 1);
    const wl = computeWidths(light, 4, widthProfile('pen', 'fountain'));
    const wh = computeWidths(heavy, 4, widthProfile('pen', 'fountain'));
    expect(wl[15]!).toBeLessThan(wh[15]! * 0.6);
    expect(wh[15]!).toBeLessThanOrEqual(4);
    const c = computeWidths(heavy, 4, widthProfile('shape', 'ball'));
    expect(new Set(c).size).toBe(1);
  });

  it('outline encloses the centre line and spans the width', () => {
    const s = makeStroke(pts([[0, 0], [50, 0], [100, 0]], 1), { baseWidth: 10, penStyle: 'ball' });
    const poly = strokeOutline(s);
    expect(pointInPolygon({ x: 50, y: 0 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 4 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 6 }, poly)).toBe(false);
    const b = bboxFromPoints(poly);
    expect(b.minX).toBeLessThan(0);
    expect(b.maxX).toBeGreaterThan(100);
  });

  it('handles single points as dots and builds an SVG path', () => {
    const dot = outlinePolygon([{ x: 5, y: 5 }], [4]);
    expect(dot.length).toBeGreaterThan(6);
    expect(pointInPolygon({ x: 5, y: 5 }, dot)).toBe(true);
    const d = polygonToSvgPath(dot);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('survives hairpin turns and duplicate points without NaN', () => {
    const poly = outlinePolygon(
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }],
      [2, 2, 2, 2],
    );
    expect(poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});
