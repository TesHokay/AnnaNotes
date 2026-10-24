import { describe, expect, it } from 'vitest';
import { capResolution, computeLayout, PAGE_GAP, resolutionBucket, slotAt, Viewport, visibleSlots } from './viewport';

const pages = [
  { id: 'a', width: 600, height: 800 },
  { id: 'b', width: 800, height: 600 },
  { id: 'c', width: 600, height: 800 },
];

describe('layout & viewport', () => {
  it('stacks pages vertically, centred on x=0', () => {
    const l = computeLayout(pages);
    expect(l.slots[1]!.y).toBe(800 + PAGE_GAP);
    expect(l.slots[1]!.x).toBe(-400);
    expect(l.height).toBe(800 + 600 + 800 + 2 * PAGE_GAP);
    expect(l.width).toBe(800);
  });

  it('finds visible slots and the slot under a point', () => {
    const l = computeLayout(pages);
    expect(visibleSlots(l, 0, 100).map((s) => s.id)).toEqual(['a']);
    expect(visibleSlots(l, 790, 830).map((s) => s.id)).toEqual(['a', 'b']);
    expect(slotAt(l, { x: 0, y: 900 })?.id).toBe('b');
    expect(slotAt(l, { x: 0, y: 810 })).toBeNull();
  });

  it('screen <-> doc transforms are inverse and zoom keeps the anchor fixed', () => {
    const v = new Viewport();
    v.width = 1000;
    v.height = 800;
    v.scale = 1.5;
    v.tx = 120;
    v.ty = -40;
    const p = { x: 33, y: 77 };
    const back = v.toDoc(v.toScreen(p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
    const anchor = { x: 300, y: 200 };
    const before = v.toDoc(anchor);
    v.zoomAt(2, anchor.x, anchor.y);
    const after = v.toDoc(anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(v.scale).toBe(3);
  });

  it('centres narrow content horizontally when clamping', () => {
    const v = new Viewport();
    v.width = 2000;
    v.height = 800;
    v.tx = -500;
    v.clampTo(computeLayout(pages));
    expect(v.tx).toBe(1000);
  });

  it('quantises bitmap resolution and caps pixels', () => {
    expect(resolutionBucket(1, 2)).toBe(2);
    expect(resolutionBucket(1.1, 2)).toBeCloseTo(Math.SQRT2 * 2);
    const capped = capResolution(10, 600, 800, 6_000_000);
    expect(600 * 800 * capped * capped).toBeLessThanOrEqual(6_000_000 + 1);
  });
});
