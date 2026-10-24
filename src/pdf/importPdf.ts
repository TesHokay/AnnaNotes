import { PDFDocument } from 'pdf-lib';
import { getDB } from '@/db/db';
import { toStorageError } from '@/db/errors';
import { uuid } from '@/lib/id';
import { DEFAULT_SETUP } from '@/model/paper';
import type { Asset, Notebook, Page, UUID } from '@/model/types';
import { displaySize, normalizeRotation, type PdfBox } from './coords';
import { ImportError, isPdf, MAX_PDF_BYTES } from '@/lib/fileTypes';

export { ImportError, isPdf, MAX_PDF_BYTES };


export interface PdfPageInfo {
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  box: PdfBox;
}

/** Visible box as pdf.js uses it: CropBox intersected with MediaBox. */
export function visibleBox(media: PdfBox, crop: PdfBox): PdfBox {
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  if (x1 <= x0 || y1 <= y0) return media;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export async function readPdfPages(bytes: Uint8Array): Promise<PdfPageInfo[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    throw new ImportError(`Не удалось прочитать PDF: ${(err as Error).message}`);
  }
  const pages = doc.getPages();
  if (pages.length === 0) throw new ImportError('PDF не содержит страниц');
  return pages.map((p) => {
    const box = visibleBox(p.getMediaBox(), p.getCropBox());
    const rotation = normalizeRotation(p.getRotation().angle);
    return { ...displaySize(box, rotation), rotation, box };
  });
}

/** Imports a PDF as a new document. The original file is stored untouched as a Blob. */
export async function importPdfAsNotebook(file: Blob, name: string, folderId: UUID | null): Promise<Notebook> {
  if (file.size > MAX_PDF_BYTES) throw new ImportError(`Файл слишком большой (максимум ${MAX_PDF_BYTES / 1024 / 1024} МБ)`);
  if (file.size === 0 || !(await isPdf(file))) throw new ImportError('Файл не является PDF-документом');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const infos = await readPdfPages(bytes);
  const now = Date.now();
  const asset: Asset = {
    id: uuid(),
    kind: 'pdf',
    mime: 'application/pdf',
    name,
    size: file.size,
    blob: file.type === 'application/pdf' ? file : new Blob([bytes], { type: 'application/pdf' }),
    createdAt: now,
  };
  const nb: Notebook = {
    id: uuid(),
    title: name.replace(/\.pdf$/i, '') || 'PDF',
    kind: 'pdf',
    folderId,
    coverColor: '#c9b8f2',
    favorite: 0,
    createdAt: now,
    updatedAt: now,
    openedAt: 0,
    deletedAt: 0,
    pageCount: infos.length,
    defaultSetup: { ...DEFAULT_SETUP, template: 'blank' },
  };
  const pages: Page[] = infos.map((info, i) => ({
    id: uuid(),
    notebookId: nb.id,
    order: i + 1,
    width: info.width,
    height: info.height,
    size: 'custom',
    template: 'blank',
    paperColor: '#ffffff',
    pdf: { assetId: asset.id, pageIndex: i },
    pdfAssetId: asset.id,
    bookmarked: 0,
    createdAt: now,
    updatedAt: now,
  }));
  const db = getDB();
  try {
    await db.transaction('rw', db.assets, db.notebooks, db.pages, async () => {
      await db.assets.add(asset);
      await db.notebooks.add(nb);
      await db.pages.bulkAdd(pages);
    });
  } catch (err) {
    throw toStorageError(err);
  }
  return nb;
}
