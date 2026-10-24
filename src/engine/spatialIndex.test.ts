import { describe, expect, it } from 'vitest';
import { GridIndex } from './spatialIndex';
import { DocumentModel } from './DocumentModel';
import { bboxFromPoints, bboxInflate, bboxIntersects } from './geometry';
import { eraseStrokePartially, strokeHitBySweep } from './eraser';
import { makeStroke, pts } from '@/test/helpers';
import type { StrokeElement } from '@/model/types';

/** Deterministic pseudo-random page with `n` handwriting-like strokes. */
function denseStrokes(n: number): StrokeElement[] {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return Array.from({ length: n }, (_, i) => {
    const x = rnd() * 560 + 10;
    const y = rnd() * 800 + 10;
    const coords: [number, number][] = Array.from({ length: 24 }, (_, k) => [x + k * 1.5, y + Math.sin(k / 3) * 4]);
    return makeStroke(pts(coords), { id: `s${i}`, z: i, baseWidth: 2 });
  });
}

describe('GridIndex', () => {
  it('returns exactly the elements whose boxes intersect the query', () => {
    const strokes = denseStrokes(800);
    const idx = GridIndex.build(strokes);
    const q = { minX: 100, minY: 200, maxX: 180, maxY: 260 };
    const expected = strokes.filter((s) => bboxIntersects(s.boundingBox, q)).map((s) => s.id).sort();
    expect(idx.query(q).map((s) => s.id).sort()).toEqual(expected);
    idx.remove(expected[0]!);
    expect(idx.query(q).map((s) => s.id)).not.toContain(expected[0]);
    expect(idx.size).toBe(799);
  });

  it('handles huge elements and negative coordinates', () => {
    const big = makeStroke(pts([[-500, -500], [5000, 5000]]), { id: 'big' });
    const idx = GridIndex.build([big]);
    expect(idx.query({ minX: 10, minY: 10, maxX: 11, maxY: 11 }).map((e) => e.id)).toEqual(['big']);
  });

  it('stress: 300 eraser sweeps over a page with 5000 strokes', () => {
    const strokes = denseStrokes(5000);
    const sweeps = Array.from({ length: 300 }, (_, i) => ({ from: { x: 50 + i * 1.6, y: 300 }, to: { x: 52 + i * 1.6, y: 310 }, radius: 8 }));

    // Before: full scan of the page on every pointer move.
    let t0 = performance.now();
    let hitsScan = 0;
    for (const sw of sweeps) for (const s of strokes) if (strokeHitBySweep(s, sw)) hitsScan++;
    const scanMs = performance.now() - t0;

    // After: spatial index broad phase.
    const idx = GridIndex.build(strokes);
    t0 = performance.now();
    let hitsIdx = 0;
    let candidates = 0;
    for (const sw of sweeps) {
      const c = idx.query(bboxInflate(bboxFromPoints([sw.from, sw.to]), sw.radius + 2));
      candidates += c.length;
      for (const s of c) if (s.type === 'stroke' && strokeHitBySweep(s, sw)) hitsIdx++;
    }
    const idxMs = performance.now() - t0;

    expect(hitsIdx).toBe(hitsScan);
    expect(candidates / sweeps.length).toBeLessThan(150); // vs 5000 per move before
    console.info(`eraser 5000 strokes: full scan ${scanMs.toFixed(1)} ms, index ${idxMs.toFixed(1)} ms, ${(candidates / sweeps.length).toFixed(0)} candidates/move`);
    expect(idxMs).toBeLessThan(scanMs);
  });

  it('model keeps the index in sync while partially erasing', async () => {
    const strokes = denseStrokes(2000);
    const model = new DocumentModel('nb-1', async () => strokes, { enqueue: () => {} });
    await model.ensureLoaded('page-1');
    let n = 0;
    for (let i = 0; i < 50; i++) {
      const sw = { from: { x: 100 + i * 4, y: 100 }, to: { x: 100 + i * 4, y: 700 }, radius: 3 };
      const box = bboxInflate(bboxFromPoints([sw.from, sw.to]), sw.radius + 2);
      const removed: StrokeElement[] = [];
      const added: StrokeElement[] = [];
      for (const el of model.query('page-1', box)) {
        if (el.type !== 'stroke') continue;
        const frags = eraseStrokePartially(el, sw, () => `f${++n}`);
        if (frags) {
          removed.push(el);
          added.push(...frags);
        }
      }
      model.apply({ removed, added }, { history: null, persist: false });
    }
    // Index and array agree after many incremental updates.
    const all = model.getElements('page-1')!;
    const everything = model.query('page-1', { minX: -1e4, minY: -1e4, maxX: 1e4, maxY: 1e4 });
    expect(everything.length).toBe(all.length);
    // z-order is preserved without full re-sorts.
    for (let i = 1; i < all.length; i++) expect(all[i]!.z).toBeGreaterThanOrEqual(all[i - 1]!.z);
  });
});
