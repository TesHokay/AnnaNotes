import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '@/test/engineHarness';
import { computeWidths, renderPoints, widthProfile } from './outline';
import { applyCurve, linearPressure, PRESSURE_PRESETS } from './pressure';
import type { StrokeElement } from '@/model/types';

let h: Harness | null = null;
afterEach(() => {
  h?.destroy();
  h = null;
});

/** Draws a horizontal pen stroke with the given raw pressure profile. */
function penStroke(hh: Harness, y: number, pressure: (i: number) => number): StrokeElement {
  const vp = hh.engine.viewport;
  const start = vp.toScreen({ x: -595 / 2 + 100, y });
  const id = Math.floor(Math.random() * 1e6);
  hh.down(id, start.x, start.y, { pointerType: 'pen', pressure: pressure(0) });
  for (let i = 1; i <= 30; i++) hh.move(id, start.x + i * 8, start.y, { pointerType: 'pen', pressure: pressure(i) });
  hh.up(id, start.x + 240, start.y, { pointerType: 'pen' });
  const els = hh.model.getElements('p0')!;
  return els[els.length - 1] as StrokeElement;
}

function meanWidth(s: StrokeElement): number {
  const prof = widthProfile(s.tool, s.penStyle);
  const profile = s.minWidthRatio !== undefined && prof.direction === 'none' ? { ...prof, minRatio: s.minWidthRatio } : prof;
  const pts = renderPoints(s, profile);
  const w = computeWidths(pts, s.baseWidth, profile, s.simulatedPressure === true);
  const mid = w.slice(Math.floor(w.length * 0.3), Math.floor(w.length * 0.7));
  return mid.reduce((a, b) => a + b, 0) / mid.length;
}

describe('Apple Pencil pressure in the engine', () => {
  it('light pressure gives a thin line, strong pressure a thick one', async () => {
    h = await createHarness({ pageCount: 1 });
    const light = penStroke(h, 100, (i) => 0.12 + (i % 2) * 0.01);
    const strong = penStroke(h, 200, (i) => 0.7 + (i % 2) * 0.01);
    expect(light.simulatedPressure).toBeFalsy();
    expect(strong.simulatedPressure).toBeFalsy();
    expect(meanWidth(strong)).toBeGreaterThan(meanWidth(light) * 1.8);
    expect(light.minWidthRatio).toBeCloseTo(0.3); // fountain default (balanced preset) stored on the stroke
  });

  it('pressure changes smoothly along the stroke (no jumps)', async () => {
    h = await createHarness({ pageCount: 1 });
    const s = penStroke(h, 150, (i) => 0.1 + (i / 30) * 0.6);
    for (let i = 1; i < s.points.length; i++) expect(Math.abs(s.points[i]!.pressure - s.points[i - 1]!.pressure)).toBeLessThan(0.12);
  });

  it('constant 0.5 pressure is not trusted as real pressure (simulated)', async () => {
    h = await createHarness({ pageCount: 1 });
    const s = penStroke(h, 150, () => 0.5);
    expect(s.simulatedPressure).toBe(true);
  });

  it('turning sensitivity off gives a constant-width line', async () => {
    h = await createHarness({ pageCount: 1 });
    const cfg = h.engine['config'];
    h.engine.setConfig({ ...cfg, pen: { ...cfg.pen, pressure: { ...cfg.pen.pressure, enabled: false } } });
    const s = penStroke(h, 150, (i) => 0.1 + (i % 3) * 0.3);
    expect(new Set(s.points.slice(1).map((p) => p.pressure))).toEqual(new Set([1]));
  });

  it('direction-based calligraphy is an explicit mode stored on the stroke', async () => {
    h = await createHarness({ pageCount: 1 });
    const cfg = h.engine['config'];
    h.engine.setConfig({ ...cfg, pen: { ...cfg.pen, style: 'calligraphy', calligraphyMode: 'direction' } });
    const s = penStroke(h, 150, (i) => 0.2 + (i % 2) * 0.3);
    expect(s.penStyle).toBe('calligraphy');
    expect(s.simulatedPressure).toBe(true);
  });
});

describe('pressure curves', () => {
  it('soft gives more width for light touch than balanced, balanced more than strong', () => {
    const p = linearPressure(0.2);
    const soft = applyCurve(p, PRESSURE_PRESETS.soft.gamma);
    const bal = applyCurve(p, PRESSURE_PRESETS.balanced.gamma);
    const strong = applyCurve(p, PRESSURE_PRESETS.strong.gamma);
    expect(soft).toBeGreaterThan(bal);
    expect(bal).toBeGreaterThan(strong);
    expect(applyCurve(1, 1.6)).toBe(1);
  });
});
