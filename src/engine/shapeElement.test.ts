import { describe, expect, it } from 'vitest';
import { hitShape, localToPagePoint, pageToLocal, resizeShapeLocal, shapeBBox, shapeFromDrag, shapeFromPolygon, shapeSvgPath } from './shapeElement';
import { rotationAbout } from './geometry';
import { transformElement } from './tools';
import { History } from './history';
import type { ShapeElement } from '@/model/types';

function shape(extra: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id: 's1',
    type: 'shape',
    pageId: 'p',
    notebookId: 'n',
    createdAt: 0,
    z: 1,
    kind: 'rectangle',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
    stroke: '#000000',
    strokeWidth: 2,
    opacity: 1,
    fill: null,
    ...extra,
  };
}

describe('vector shapes', () => {
  it('builds shapes from a drag, including constrained squares and lines', () => {
    expect(shapeFromDrag('rectangle', { x: 10, y: 10 }, { x: 110, y: 60 }, false)).toMatchObject({ x: 10, y: 10, width: 100, height: 50 });
    expect(shapeFromDrag('ellipse', { x: 10, y: 10 }, { x: 110, y: 60 }, true)).toMatchObject({ width: 100, height: 100 });
    const line = shapeFromDrag('arrow', { x: 50, y: 50 }, { x: 10, y: 52 }, true);
    expect(line.points![1]!.y).toBeCloseTo(line.points![0]!.y); // snapped horizontal, drawn right-to-left
    expect(shapeFromDrag('polygon', { x: 0, y: 0 }, { x: 60, y: 60 }, false).points).toHaveLength(6);
  });

  it('hit test: outline always, interior only when filled', () => {
    const s = shape();
    expect(hitShape(s, { x: 100, y: 150 }, 2)).toBe(true); // on the left edge
    expect(hitShape(s, { x: 200, y: 150 }, 2)).toBe(false); // inside, no fill
    expect(hitShape({ ...s, fill: '#ff0000' }, { x: 200, y: 150 }, 2)).toBe(true);
  });

  it('resizes along each axis independently (stretch) and keeps the opposite edge fixed', () => {
    const s = shape();
    const wider = resizeShapeLocal(s, { x: 0, y: 0, width: 300, height: 100 });
    expect(wider).toMatchObject({ x: 100, y: 100, width: 300, height: 100 });
    const taller = resizeShapeLocal(s, { x: 0, y: -50, width: 200, height: 150 });
    expect(taller).toMatchObject({ x: 100, y: 50, width: 200, height: 150 });
  });

  it('resizing a rotated shape happens in its own frame', () => {
    const s = shape({ rotation: Math.PI / 2 });
    // The local left edge must stay where it was on the page.
    const leftMidBefore = localToPagePoint(s, { x: 0, y: 50 });
    const r = resizeShapeLocal(s, { x: 0, y: 0, width: 300, height: 100 });
    const leftMidAfter = localToPagePoint(r, { x: 0, y: 50 });
    expect(leftMidAfter.x).toBeCloseTo(leftMidBefore.x);
    expect(leftMidAfter.y).toBeCloseTo(leftMidBefore.y);
    // and page <-> local are inverse
    const q = pageToLocal(r, localToPagePoint(r, { x: 37, y: 12 }));
    expect(q.x).toBeCloseTo(37);
    expect(q.y).toBeCloseTo(12);
  });

  it('scales polygon points with the box', () => {
    const tri = { ...shape(), ...shapeFromPolygon('triangle', [{ x: 0, y: 100 }, { x: 50, y: 0 }, { x: 100, y: 100 }]) } as ShapeElement;
    const r = resizeShapeLocal(tri, { x: 0, y: 0, width: 200, height: 100 });
    expect(r.points![2]).toEqual({ x: 200, y: 100 });
  });

  it('rotation (via selection transform) keeps the centre and accumulates the angle', () => {
    const s = shape();
    const r = transformElement(s, rotationAbout(0.5, 200, 150)) as ShapeElement;
    expect(r.x + r.width / 2).toBeCloseTo(200);
    expect(r.y + r.height / 2).toBeCloseTo(150);
    expect(r.rotation).toBeCloseTo(0.5);
    const b = shapeBBox(r);
    expect(b.maxX - b.minX).toBeGreaterThan(200); // rotated rectangle is wider in page space
  });

  it('produces SVG paths for PDF export (closed shapes end with Z)', () => {
    expect(shapeSvgPath(shape())).toMatch(/^M.*Z$/);
    expect(shapeSvgPath(shape({ kind: 'line', points: [{ x: 0, y: 0 }, { x: 200, y: 100 }] }))).not.toContain('Z');
    expect(shapeSvgPath(shape({ kind: 'arrow', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] })).match(/M/g)).toHaveLength(2);
  });

  it('style slider drags merge into one undo step', () => {
    const h = new History();
    const a = shape();
    h.push({ label: 'w', removed: [a], added: [{ ...a, strokeWidth: 3 }], mergeKey: 'k' });
    h.push({ label: 'w', removed: [{ ...a, strokeWidth: 3 }], added: [{ ...a, strokeWidth: 6 }], mergeKey: 'k' });
    expect(h.size).toBe(1);
    const undo = h.undo()!;
    expect((undo.added[0] as ShapeElement).strokeWidth).toBe(2);
    expect((undo.removed[0] as ShapeElement).strokeWidth).toBe(6);
  });
});
