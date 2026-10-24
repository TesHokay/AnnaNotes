import { describe, expect, it } from 'vitest';
import {
  applyMatrix,
  bboxFromPoints,
  bboxIntersects,
  decompose,
  distPointSegment,
  distSegmentSegment,
  invert,
  multiply,
  pointInPolygon,
  polygonArea,
  rotatedRectCorners,
  rotationAbout,
  scalingAbout,
  segmentsIntersect,
  translation,
} from './geometry';

describe('geometry', () => {
  it('computes bounding boxes with padding', () => {
    expect(bboxFromPoints([{ x: 1, y: 2 }, { x: 5, y: -1 }], 1)).toEqual({ minX: 0, minY: -2, maxX: 6, maxY: 3 });
  });

  it('point to segment distance clamps to endpoints', () => {
    expect(distPointSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distPointSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it('detects segment intersection and distance', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(distSegmentSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(5);
  });

  it('point in polygon and area', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
    expect(polygonArea(sq)).toBe(100);
  });

  it('matrix multiply / invert round-trip and decomposition', () => {
    const m = multiply(translation(10, 5), multiply(rotationAbout(0.7, 3, 4), scalingAbout(2, 1, 1)));
    const p = { x: 7, y: -2 };
    const q = applyMatrix(invert(m), applyMatrix(m, p));
    expect(q.x).toBeCloseTo(p.x);
    expect(q.y).toBeCloseTo(p.y);
    const d = decompose(m);
    expect(d.scale).toBeCloseTo(2);
    expect(d.rotation).toBeCloseTo(0.7);
  });

  it('rotation keeps the pivot fixed and is clockwise on screen (y down)', () => {
    const r = applyMatrix(rotationAbout(Math.PI / 2, 0, 0), { x: 1, y: 0 });
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
    expect(applyMatrix(rotationAbout(1, 5, 5), { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it('rotated rect corners and bbox intersection', () => {
    const c = rotatedRectCorners(0, 0, 10, 10, Math.PI);
    expect(c[0]!.x).toBeCloseTo(10);
    expect(c[0]!.y).toBeCloseTo(10);
    expect(bboxIntersects({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { minX: 1, minY: 1, maxX: 2, maxY: 2 })).toBe(true);
  });
});
