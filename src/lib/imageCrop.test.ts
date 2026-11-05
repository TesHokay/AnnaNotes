import { describe, expect, it } from 'vitest';
import { croppedImageElement, dragCrop, FULL_CROP } from './imageCrop';
import type { ImageElement } from '@/model/types';

describe('photo crop geometry', () => {
  it('keeps handles inside the source and prevents an empty crop', () => {
    const crop = dragCrop(FULL_CROP, 'nw', 2, 2);
    expect(crop.x).toBeCloseTo(0.98);
    expect(crop.y).toBeCloseTo(0.98);
    expect(crop.width).toBeCloseTo(0.02);
    expect(crop.height).toBeCloseTo(0.02);
    expect(dragCrop(FULL_CROP, 'se', 1, 1)).toEqual(FULL_CROP);
    expect(dragCrop({ x: 0.2, y: 0.3, width: 0.4, height: 0.4 }, 'move', 2, -2)).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.4 });
  });

  it.each([0, Math.PI / 2, 0.7])('retains the same page coordinates for cropped pixels at rotation %s', (rotation) => {
    const image: ImageElement = { id: 'i', type: 'image', pageId: 'p', notebookId: 'n', assetId: 'old', createdAt: 0, z: 1, x: 100, y: 200, width: 400, height: 200, rotation, flipX: true, flipY: true };
    const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    const result = croppedImageElement(image, 'new', crop);
    const pagePoint = (element: ImageElement, u: number, v: number) => {
      const dx = (u - 0.5) * element.width * (element.flipX ? -1 : 1);
      const dy = (v - 0.5) * element.height * (element.flipY ? -1 : 1);
      return { x: element.x + element.width / 2 + dx * Math.cos(rotation) - dy * Math.sin(rotation),
        y: element.y + element.height / 2 + dx * Math.sin(rotation) + dy * Math.cos(rotation) };
    };
    for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.5]]) {
      const before = pagePoint(image, crop.x + u! * crop.width, crop.y + v! * crop.height);
      const after = pagePoint(result, u!, v!);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
    }
    expect(result.assetId).toBe('new');
    expect(image.assetId).toBe('old');
  });
});
