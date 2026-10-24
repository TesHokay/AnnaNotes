import { describe, expect, it } from 'vitest';
import { DocumentModel } from './DocumentModel';
import { computeLayout, visibleSlots } from './viewport';
import { makeStroke, pts } from '@/test/helpers';
import type { PageElement } from '@/model/types';

describe('stress: large notebooks', () => {
  it('100 pages: only nearby pages are loaded, fast page switching keeps memory bounded', async () => {
    const pages = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, width: 595, height: 842 }));
    const loads: string[] = [];
    const model = new DocumentModel(
      'nb',
      async (pageId) => {
        loads.push(pageId);
        return Array.from({ length: 200 }, (_, k) => makeStroke(pts([[k, k], [k + 5, k + 3]]), { id: `${pageId}-${k}`, pageId, z: k })) as PageElement[];
      },
      { enqueue: () => {} },
    );
    const layout = computeLayout(pages);
    // Simulate flicking through all pages: viewport shows ~1.2 pages at a time.
    for (let i = 0; i < 100; i++) {
      const top = layout.slots[i]!.y;
      const vis = visibleSlots(layout, top, top + 1000);
      await Promise.all(vis.map((s) => model.ensureLoaded(s.id)));
      const keep = new Set<string>();
      for (let d = -4; d <= 4; d++) if (layout.slots[i + d]) keep.add(layout.slots[i + d]!.id);
      model.evictExcept(keep);
    }
    expect(loads.length).toBeLessThanOrEqual(100); // each page loaded once on the way down
    const loaded = pages.filter((p) => model.isLoaded(p.id)).length;
    expect(loaded).toBeLessThanOrEqual(9);
  });

  it('layout of 1000 pages and visibility queries are cheap', () => {
    const pages = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, width: 595, height: i % 2 ? 842 : 595 }));
    const t0 = performance.now();
    const layout = computeLayout(pages);
    for (let i = 0; i < 10_000; i++) visibleSlots(layout, (i * 37) % layout.height, ((i * 37) % layout.height) + 900);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('5000 strokes on one page: adding strokes keeps order without re-sorting cost blowing up', async () => {
    const model = new DocumentModel('nb', async () => [], { enqueue: () => {} });
    await model.ensureLoaded('page-1');
    const t0 = performance.now();
    for (let i = 0; i < 5000; i++) model.apply({ removed: [], added: [makeStroke(pts([[i % 500, i / 10], [i % 500 + 4, i / 10 + 2]]), { id: `s${i}`, z: i })] }, { history: null, persist: false });
    const ms = performance.now() - t0;
    expect(model.getElements('page-1')!.length).toBe(5000);
    console.info(`5000 sequential stroke commits: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
  });
});
