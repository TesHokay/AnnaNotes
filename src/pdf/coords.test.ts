import { describe, expect, it } from 'vitest';
import { displaySize, docToPdf, flippedDocMatrix, normalizeRotation, pdfToDoc } from './coords';
import { visibleBox } from './importPdf';
import { snapHighlightToText } from './textLayer';

const box = { x: 10, y: 20, width: 400, height: 600 };

describe('PDF coordinate mapping', () => {
  it('normalises rotation', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
  });

  it.each([0, 90, 180, 270])('doc <-> pdf round-trips for rotation %i', (r) => {
    const size = displaySize(box, r);
    for (const p of [{ x: 0, y: 0 }, { x: size.width, y: size.height }, { x: 37, y: 91 }]) {
      const q = docToPdf(p.x, p.y, box, r);
      expect(q.x).toBeGreaterThanOrEqual(box.x - 1e-9);
      expect(q.x).toBeLessThanOrEqual(box.x + box.width + 1e-9);
      expect(q.y).toBeGreaterThanOrEqual(box.y - 1e-9);
      expect(q.y).toBeLessThanOrEqual(box.y + box.height + 1e-9);
      const back = pdfToDoc(q.x, q.y, box, r);
      expect(back.x).toBeCloseTo(p.x);
      expect(back.y).toBeCloseTo(p.y);
    }
  });

  it('top-left of the displayed page maps to the right PDF corner', () => {
    expect(docToPdf(0, 0, box, 0)).toEqual({ x: 10, y: 620 });
    expect(docToPdf(0, 0, box, 90)).toEqual({ x: 10, y: 20 });
    expect(docToPdf(0, 0, box, 180)).toEqual({ x: 410, y: 20 });
    expect(docToPdf(0, 0, box, 270)).toEqual({ x: 410, y: 620 });
    expect(displaySize(box, 90)).toEqual({ width: 600, height: 400 });
  });

  it.each([0, 90, 180, 270])('flipped content matrix agrees with docToPdf (rotation %i)', (r) => {
    const m = flippedDocMatrix(box, r);
    const p = { x: 55, y: 123 };
    const u = p.x;
    const v = -p.y;
    const viaMatrix = { x: m[0] * u + m[2] * v + m[4], y: m[1] * u + m[3] * v + m[5] };
    const direct = docToPdf(p.x, p.y, box, r);
    expect(viaMatrix.x).toBeCloseTo(direct.x);
    expect(viaMatrix.y).toBeCloseTo(direct.y);
  });

  it('visible box is crop intersected with media', () => {
    expect(visibleBox({ x: 0, y: 0, width: 600, height: 800 }, { x: 50, y: 50, width: 1000, height: 100 })).toEqual({ x: 50, y: 50, width: 550, height: 100 });
  });
});

describe('highlighter text snapping', () => {
  const runs = [
    { minX: 50, maxX: 300, minY: 100, maxY: 112, text: 'line one' },
    { minX: 50, maxX: 280, minY: 120, maxY: 132, text: 'line two' },
  ];

  it('snaps a wobbly stroke to one line', () => {
    const segs = snapHighlightToText([{ x: 80, y: 104 }, { x: 150, y: 109 }, { x: 200, y: 106 }], runs, 10);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.from).toEqual({ x: 80, y: 106 });
    expect(segs[0]!.to.x).toBe(200);
  });

  it('spans multiple lines and ignores empty areas', () => {
    expect(snapHighlightToText([{ x: 100, y: 105 }, { x: 150, y: 127 }], runs, 8)).toHaveLength(2);
    expect(snapHighlightToText([{ x: 100, y: 400 }, { x: 150, y: 400 }], runs, 8)).toEqual([]);
  });
});
