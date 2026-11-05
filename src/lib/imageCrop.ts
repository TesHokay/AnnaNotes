import type { ImageElement } from '@/model/types';
import { canvasToBlob, decodeImage, type PreparedImage } from './images';

/** Fractions of the unrotated source image. */
export interface CropRect { x: number; y: number; width: number; height: number }
export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };
export type CropHandle = 'nw' | 'ne' | 'sw' | 'se' | 'move';
const MIN_SIDE = 0.02;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function dragCrop(start: CropRect, handle: CropHandle, dx: number, dy: number): CropRect {
  if (handle === 'move') return { ...start, x: clamp(start.x + dx, 0, 1 - start.width), y: clamp(start.y + dy, 0, 1 - start.height) };
  let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_SIDE);
  else right = clamp(right + dx, left + MIN_SIDE, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_SIDE);
  else bottom = clamp(bottom + dy, top + MIN_SIDE, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export async function cropImageBlob(image: PreparedImage, rect: CropRect): Promise<PreparedImage> {
  if (rect.x === 0 && rect.y === 0 && rect.width === 1 && rect.height === 1) return image;
  const decoded = await decodeImage(image.blob);
  const canvas = document.createElement('canvas');
  try {
    const x = Math.max(0, Math.min(decoded.width - 1, Math.round(rect.x * decoded.width)));
    const y = Math.max(0, Math.min(decoded.height - 1, Math.round(rect.y * decoded.height)));
    canvas.width = Math.max(1, Math.min(decoded.width - x, Math.round(rect.width * decoded.width)));
    canvas.height = Math.max(1, Math.min(decoded.height - y, Math.round(rect.height * decoded.height)));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas недоступен');
    ctx.drawImage(decoded.source, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, image.blob.type, image.blob.type === 'image/jpeg' ? 0.92 : undefined);
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    decoded.close();
    canvas.width = canvas.height = 0;
  }
}

/** Keep the retained pixels in place, including rotated and mirrored photos. */
export function croppedImageElement(image: ImageElement, assetId: string, crop: CropRect): ImageElement {
  const width = image.width * crop.width;
  const height = image.height * crop.height;
  const dx = (crop.x + crop.width / 2 - 0.5) * image.width * (image.flipX ? -1 : 1);
  const dy = (crop.y + crop.height / 2 - 0.5) * image.height * (image.flipY ? -1 : 1);
  const cos = Math.cos(image.rotation), sin = Math.sin(image.rotation);
  return { ...image, assetId, width, height,
    x: image.x + image.width / 2 + dx * cos - dy * sin - width / 2,
    y: image.y + image.height / 2 + dx * sin + dy * cos - height / 2 };
}
