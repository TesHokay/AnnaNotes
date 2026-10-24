import { readHeader, ImportError } from './fileTypes';

export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
/** Larger images are downscaled on import: iPad Safari decodes every pixel into memory. */
export const MAX_IMAGE_SIDE = 3072;

export type ImageType = 'image/png' | 'image/jpeg';

export async function sniffImageType(blob: Blob): Promise<ImageType | null> {
  const h = await readHeader(blob, 8);
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return 'image/png';
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg';
  return null;
}

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality));
}

async function decodeImage(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new ImportError('Не удалось декодировать изображение');
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

/** Validates a PNG/JPEG file by its signature and downsizes it if needed. */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (file.size > MAX_IMAGE_BYTES) throw new ImportError(`Изображение слишком большое (максимум ${MAX_IMAGE_BYTES / 1024 / 1024} МБ)`);
  const type = await sniffImageType(file);
  if (!type) throw new ImportError('Поддерживаются только изображения PNG и JPEG');
  const img = await decodeImage(file);
  try {
    const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
    if (k === 1) return { blob: file.type === type ? file : new Blob([file], { type }), width: img.width, height: img.height };
    const w = Math.round(img.width * k);
    const h = Math.round(img.height * k);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImportError('Canvas недоступен');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.source, 0, 0, w, h);
    const blob = await canvasToBlob(canvas, type, type === 'image/jpeg' ? 0.9 : undefined);
    canvas.width = canvas.height = 0;
    return { blob, width: w, height: h };
  } finally {
    img.close();
  }
}

export async function blobToPngBytes(blob: Blob): Promise<Uint8Array | null> {
  try {
    const img = await decodeImage(blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d')?.drawImage(img.source, 0, 0);
    img.close();
    const out = await canvasToBlob(canvas, 'image/png');
    return new Uint8Array(await out.arrayBuffer());
  } catch {
    return null;
  }
}

export { canvasToBlob };
