import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHarness, type Harness } from '@/test/engineHarness';
import { DEFAULT_TOOLS, toolConfigFrom } from '@/store/settings';
import { DEFAULT_CALIBRATION } from './pressure';
import type { ImageElement } from '@/model/types';

let h: Harness | null = null;
afterEach(() => { h?.destroy(); h = null; vi.useRealTimers(); });
const photo: ImageElement = { id: 'photo', type: 'image', pageId: 'p0', notebookId: 'nb', assetId: 'original', createdAt: 0, z: 1, x: 100, y: 150, width: 200, height: 120, rotation: 0 };
const hold = async () => { await vi.advanceTimersByTimeAsync(600); };

describe('canvas context menu', () => {
  it('a finger hold opens the page menu without drawing, even with finger drawing enabled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onContextMenu = vi.fn();
    h = await createHarness({ pageCount: 1, stylusOnly: false, callbacks: { onContextMenu } });
    const p = h.engine.pageToScreen('p0', { x: 80, y: 90 })!;
    h.down(1, p.x, p.y);
    await hold();
    h.up(1, p.x, p.y);
    expect(onContextMenu).toHaveBeenLastCalledWith(expect.objectContaining({ pageId: 'p0', point: expect.objectContaining({ x: expect.closeTo(80), y: expect.closeTo(90) }) }));
    expect(h.model.getElements('p0')).toHaveLength(0);
    expect(h.model.history.canUndo).toBe(false);
  });

  it('selects a placed photo with a hold and lets a finger move it in stylus-only mode', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    h = await createHarness({ pageCount: 1, elements: [photo] });
    const p = h.engine.pageToScreen('p0', { x: 200, y: 210 })!;
    h.down(1, p.x, p.y);
    await hold();
    h.up(1, p.x, p.y);
    expect(h.engine.getSelectedImage()?.id).toBe(photo.id);
    const ty = h.engine.viewport.ty;
    const scale = h.engine.viewport.scale;
    h.down(2, p.x, p.y);
    h.move(2, p.x + 60, p.y + 30);
    h.up(2, p.x + 60, p.y + 30);
    expect(h.engine.viewport.ty).toBe(ty);
    expect(h.engine.getSelectedImage()?.x).toBeCloseTo(photo.x + 60 / scale);
    expect(h.engine.getSelectedImage()?.y).toBeCloseTo(photo.y + 30 / scale);
    h.engine.undo();
    expect(h.model.getElements('p0')![0]).toEqual(photo);
  });

  it.each(['swipe', 'pinch', 'cancel', 'release', 'pen'] as const)('%s cancels or bypasses a hold', async (kind) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onContextMenu = vi.fn();
    h = await createHarness({ pageCount: 1, callbacks: { onContextMenu } });
    const p = h.engine.pageToScreen('p0', { x: 200, y: 300 })!;
    h.down(1, p.x, p.y, { pointerType: kind === 'pen' ? 'pen' : 'touch' });
    if (kind === 'swipe') h.move(1, p.x, p.y - 30);
    if (kind === 'pinch') h.down(2, p.x + 60, p.y, { isPrimary: false });
    if (kind === 'cancel') h.cancel(1, p.x, p.y);
    if (kind === 'release') h.up(1, p.x, p.y);
    await hold();
    expect(onContextMenu.mock.calls.filter(([menu]) => menu !== null)).toHaveLength(0);
  });

  it('cut and paste places a photo at the held point and is undoable', async () => {
    h = await createHarness({ pageCount: 1, elements: [photo] });
    h.engine.selectAll();
    h.engine.cutSelection();
    expect(h.model.getElements('p0')).toHaveLength(0);
    h.engine.paste({ pageId: 'p0', point: { x: 250, y: 300 } });
    const pasted = h.engine.getSelectedImage()!;
    expect(pasted).toMatchObject({ x: 250, y: 300, assetId: 'original', width: 200 });
    expect(pasted.id).not.toBe(photo.id);
    h.engine.undo();
    expect(h.model.getElements('p0')).toHaveLength(0);
    h.engine.undo();
    expect(h.model.getElements('p0')).toEqual([photo]);
  });

  it('backgrounding the editor cancels a pending hold', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onContextMenu = vi.fn();
    h = await createHarness({ pageCount: 1, callbacks: { onContextMenu } });
    const p = h.engine.pageToScreen('p0', { x: 200, y: 300 })!;
    h.down(1, p.x, p.y);
    h.engine.releaseCaches();
    await hold();
    expect(onContextMenu.mock.calls.filter(([menu]) => menu !== null)).toHaveLength(0);
  });

  it('right-click selects the photo without panning', async () => {
    const onContextMenu = vi.fn();
    h = await createHarness({ pageCount: 1, elements: [photo], callbacks: { onContextMenu } });
    const p = h.engine.pageToScreen('p0', { x: 200, y: 210 })!;
    h.down(1, p.x, p.y, { pointerType: 'mouse', button: 2 });
    h.surface.dispatchEvent(new MouseEvent('contextmenu', { clientX: p.x, clientY: p.y, cancelable: true }));
    expect(h.engine.getSelectedImage()?.id).toBe(photo.id);
    expect(h.engine.gestureState).toBe('IDLE');
    expect(onContextMenu).toHaveBeenLastCalledWith(expect.objectContaining({ pageId: 'p0' }));
  });

  it('holding with the eraser restores its transient deletion before selecting the photo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    h = await createHarness({ pageCount: 1, stylusOnly: false, elements: [photo] });
    h.engine.setConfig(toolConfigFrom({ tools: { ...DEFAULT_TOOLS, tool: 'eraser' }, smoothing: 0.5, calibration: DEFAULT_CALIBRATION }));
    const p = h.engine.pageToScreen('p0', { x: 200, y: 210 })!;
    h.down(1, p.x, p.y);
    await hold();
    h.up(1, p.x, p.y);
    expect(h.model.getElements('p0')).toEqual([photo]);
    expect(h.engine.getSelectedImage()?.id).toBe(photo.id);
    expect(h.model.history.canUndo).toBe(false);
  });

  it('crop retains the old asset for undo, and stale edits cannot replace a newer photo', async () => {
    h = await createHarness({ pageCount: 1, elements: [photo] });
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    expect(h.engine.cropImage(photo, 'cropped', crop)).toBe(true);
    expect(h.engine.getSelectedImage()).toMatchObject({ assetId: 'cropped', x: 150, width: 100 });
    expect(h.engine.cropImage(photo, 'stale', crop)).toBe(false);
    h.engine.undo();
    expect(h.model.getElements('p0')).toEqual([photo]);
    h.engine.redo();
    expect(h.model.getElements('p0')![0]).toMatchObject({ assetId: 'cropped', x: 150, width: 100 });
  });
});
