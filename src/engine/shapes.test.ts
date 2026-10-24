import { describe, expect, it } from 'vitest';
import { isNearlyStraight, rdp, recognizeShape, shapePoints } from './shapes';
import { bboxFromPoints } from './geometry';

const circle = (cx: number, cy: number, r: number, n = 64, noise = 0) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (i % 2 ? noise : -noise);
    return { x: cx + Math.cos(a) * r * k, y: cy + Math.sin(a) * r * k };
  });

describe('shapes', () => {
  it('generates closed rectangles and arrows with heads', () => {
    const [rect] = shapePoints('rectangle', { x: 0, y: 0 }, { x: 100, y: 50 });
    expect(bboxFromPoints(rect!)).toMatchObject({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
    expect(rect![0]).toMatchObject(rect![rect!.length - 1]!);
    expect(shapePoints('arrow', { x: 0, y: 0 }, { x: 100, y: 0 })).toHaveLength(2);
  });

  it('constrain makes squares and snaps lines to 45 degrees', () => {
    const [sq] = shapePoints('rectangle', { x: 0, y: 0 }, { x: 100, y: 40 }, true);
    const b = bboxFromPoints(sq!);
    expect(b.maxX - b.minX).toBeCloseTo(b.maxY - b.minY);
    const [ln] = shapePoints('line', { x: 0, y: 0 }, { x: 100, y: 8 }, true);
    expect(ln![ln!.length - 1]!.y).toBeCloseTo(0);
  });

  it('detects nearly straight strokes', () => {
    const wobbly = Array.from({ length: 30 }, (_, i) => ({ x: i * 5, y: Math.sin(i) * 1.5 }));
    expect(isNearlyStraight(wobbly)).toBe(true);
    expect(isNearlyStraight(circle(0, 0, 50))).toBe(false);
  });

  it('recognises circles, ellipses, rectangles and triangles', () => {
    expect(recognizeShape(circle(100, 100, 60, 64, 0.03))?.kind).toBe('circle');
    const ellipse = circle(0, 0, 1, 64).map((p) => ({ x: p.x * 120, y: p.y * 50 }));
    expect(recognizeShape(ellipse)?.kind).toBe('ellipse');
    const rectPath = [
      ...Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 200, y: i * 10 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 200 - i * 10, y: 100 })),
      ...Array.from({ length: 11 }, (_, i) => ({ x: 0, y: 100 - i * 10 })),
    ];
    expect(recognizeShape(rectPath)?.kind).toBe('rectangle');
    const tri = [
      ...Array.from({ length: 15 }, (_, i) => ({ x: i * 10, y: 150 - i * 10 })),
      ...Array.from({ length: 15 }, (_, i) => ({ x: 150 + i * 10, y: i * 10 })),
      ...Array.from({ length: 31 }, (_, i) => ({ x: 300 - i * 10, y: 150 })),
    ];
    expect(recognizeShape(tri)?.kind).toBe('triangle');
  });

  it('rdp keeps corners', () => {
    expect(rdp([{ x: 0, y: 0 }, { x: 5, y: 0.1 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 1)).toHaveLength(3);
  });
});
