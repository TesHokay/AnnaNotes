import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '@/test/engineHarness';

let h: Harness | null = null;
afterEach(() => {
  h?.destroy();
  h = null;
});

describe('scrolling with a finger (stylus-only mode)', () => {
  it('ten consecutive swipes down and ten up all move the document', async () => {
    h = await createHarness({ pageCount: 30 });
    const vp = h.engine.viewport;
    for (let i = 0; i < 10; i++) {
      const before = vp.ty;
      await h.swipe(i + 1, 400, 800, 300);
      expect(vp.ty, `swipe up #${i + 1}`).toBeLessThan(before - 300);
    }
    for (let i = 0; i < 10; i++) {
      const before = vp.ty;
      await h.swipe(100 + i, 400, 300, 800);
      // Either it moved, or it legitimately reached the top of the document (margin 40).
      const atTop = vp.ty >= 39.5;
      expect(atTop || vp.ty > before + 300, `swipe down #${i + 1}`).toBe(true);
    }
  });

  it('a lost pointerup (iOS sometimes drops it) does not block the next swipes', async () => {
    h = await createHarness({ pageCount: 30 });
    const vp = h.engine.viewport;
    // First swipe: Safari never delivers pointerup for pointer 1.
    h.down(1, 400, 800);
    for (let i = 1; i <= 10; i++) h.move(1, 400, 800 - i * 40);
    await h.flush();
    // Next touches arrive as new primary pointers.
    for (let i = 0; i < 5; i++) {
      const before = vp.ty;
      await h.swipe(10 + i, 400, 800, 300);
      expect(vp.ty, `swipe after lost pointerup #${i + 1}`).toBeLessThan(before - 300);
    }
  });

  it('large contact areas (flat finger) still scroll in stylus-only mode', async () => {
    h = await createHarness({ pageCount: 30 });
    const vp = h.engine.viewport;
    const before = vp.ty;
    h.down(1, 400, 800, { width: 80, height: 80 });
    for (let i = 1; i <= 10; i++) h.move(1, 400, 800 - i * 50, { width: 80, height: 80 });
    h.up(1, 400, 300, { width: 80, height: 80 });
    await h.flush();
    expect(vp.ty).toBeLessThan(before - 300);
  });

  it('pointercancel ends the gesture cleanly', async () => {
    h = await createHarness({ pageCount: 30 });
    const vp = h.engine.viewport;
    h.down(1, 400, 800);
    h.move(1, 400, 700);
    h.cancel(1, 400, 700);
    await h.flush();
    const before = vp.ty;
    await h.swipe(2, 400, 800, 300);
    expect(vp.ty).toBeLessThan(before - 300);
  });

  it('does not create strokes while scrolling with a finger', async () => {
    h = await createHarness({ pageCount: 5 });
    await h.swipe(1, 400, 800, 300);
    for (let i = 0; i < 5; i++) expect(h.model.getElements(`p${i}`)).toHaveLength(0);
  });

  it('scroll stays within the document bounds', async () => {
    h = await createHarness({ pageCount: 3 });
    for (let i = 0; i < 30; i++) await h.swipe(i + 1, 400, 900, 100);
    const vp = h.engine.viewport;
    const docBottom = vp.toScreen({ x: 0, y: 3 * 842 + 2 * 24 }).y;
    expect(docBottom).toBeGreaterThan(0); // last page still reachable on screen
    for (let i = 0; i < 30; i++) await h.swipe(100 + i, 400, 100, 900);
    expect(vp.toScreen({ x: 0, y: 0 }).y).toBeLessThanOrEqual(80);
  });
});

describe('pinch to zoom', () => {
  it('zooms around the midpoint between the fingers and keeps it under them', async () => {
    h = await createHarness({ pageCount: 10 });
    const vp = h.engine.viewport;
    const mid = { x: 400, y: 500 };
    const anchorDoc = vp.toDoc(mid);
    const startScale = vp.scale;
    h.down(1, 300, 500);
    h.down(2, 500, 500, { isPrimary: false });
    for (let i = 1; i <= 10; i++) {
      h.move(1, 300 - i * 10, 500, {});
      h.move(2, 500 + i * 10, 500, { isPrimary: false });
    }
    // Fingers apart 400 px instead of 200 → ~2x
    const after = vp.toScreen(anchorDoc);
    expect(vp.scale / startScale).toBeGreaterThan(1.6);
    expect(Math.abs(after.x - mid.x)).toBeLessThan(2);
    expect(Math.abs(after.y - mid.y)).toBeLessThan(2);
    h.up(1, 200, 500);
    h.up(2, 600, 500, { isPrimary: false });
    await h.flush();
  });

  it('zoom range is 50%..400%', async () => {
    h = await createHarness({ pageCount: 3 });
    h.engine.setZoom(10);
    expect(h.engine.viewport.scale).toBeCloseTo(4);
    h.engine.setZoom(0.1);
    expect(h.engine.viewport.scale).toBeCloseTo(0.5);
  });

  it('normal scrolling works right after a pinch', async () => {
    h = await createHarness({ pageCount: 10 });
    const vp = h.engine.viewport;
    h.down(1, 300, 500);
    h.down(2, 500, 500, { isPrimary: false });
    h.move(1, 250, 500);
    h.move(2, 550, 500, { isPrimary: false });
    h.up(2, 550, 500, { isPrimary: false });
    h.up(1, 250, 500);
    await new Promise((r) => setTimeout(r, 200));
    for (let i = 0; i < 3; i++) {
      const before = vp.ty;
      await h.swipe(10 + i, 400, 800, 300);
      expect(vp.ty).toBeLessThan(before - 200);
    }
  });

  it('two-finger pan moves the page', async () => {
    h = await createHarness({ pageCount: 10 });
    const vp = h.engine.viewport;
    const before = vp.ty;
    h.down(1, 350, 700);
    h.down(2, 450, 700, { isPrimary: false });
    for (let i = 1; i <= 10; i++) {
      h.move(1, 350, 700 - i * 30);
      h.move(2, 450, 700 - i * 30, { isPrimary: false });
    }
    expect(vp.ty).toBeLessThan(before - 250);
    h.up(1, 350, 400);
    h.up(2, 450, 400, { isPrimary: false });
  });
});

describe('pen and finger together', () => {
  it('the pen draws, fingers do not, and coordinates match the zoomed page', async () => {
    h = await createHarness({ pageCount: 2 });
    h.engine.setZoom(2);
    await h.flush();
    const vp = h.engine.viewport;
    const target = { x: 120, y: 200 }; // page-local point on page 1
    const start = vp.toScreen({ x: -595 / 2 + target.x, y: target.y });
    h.down(7, start.x, start.y, { pointerType: 'pen', pressure: 0.3 });
    for (let i = 1; i <= 10; i++) h.move(7, start.x + i * 6, start.y + i * 2, { pointerType: 'pen', pressure: 0.3 + i * 0.04 });
    h.up(7, start.x + 60, start.y + 20, { pointerType: 'pen' });
    const els = h.model.getElements('p0')!;
    expect(els).toHaveLength(1);
    const s = els[0]!;
    expect(s.type).toBe('stroke');
    if (s.type === 'stroke') {
      expect(s.points[0]!.x).toBeCloseTo(target.x, 0);
      expect(s.points[0]!.y).toBeCloseTo(target.y, 0);
      expect(s.simulatedPressure).toBeFalsy(); // varying pen pressure is detected as real
    }
  });
});
