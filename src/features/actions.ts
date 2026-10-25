import type { ParsedBackup } from '@/backup/backup';
import { getDB } from '@/db/db';
import { createNotebook, getAsset, listPages, loadPageElements, putAsset } from '@/db/repo';
import { saveQueue } from '@/db/saveQueue';
import { nextZ } from '@/engine/DocumentModel';
import { saveFile } from '@/lib/files';
import { trackTask } from '@/lib/activity';
import { uuid } from '@/lib/id';
import { blobToPngBytes, prepareImage } from '@/lib/images';

// pdf-lib, pdf.js and fflate are large: load them only when an import/export actually runs.
const loadBackup = () => import('@/backup/backup');
const loadPdfExport = () => import('@/pdf/exportPdf');
const loadPdfImport = () => import('@/pdf/importPdf');
const loadRaster = () => import('@/export/pageRaster');
import { pluralRu } from '@/lib/utils';
import { DEFAULT_SETUP } from '@/model/paper';
import type { ImageElement, Notebook, UUID } from '@/model/types';
import { isPdf } from '@/lib/fileTypes';
import { useSettings } from '@/store/settings';
import { errorMessage, toast } from '@/store/ui';

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Imports PDFs and images from a file picker / drop. Returns the created notebooks. */
export async function importFiles(files: File[], folderId: UUID | null): Promise<Notebook[]> {
  return trackTask(async () => {
    const created: Notebook[] = [];
    for (const file of files) {
      try {
        if (await isPdf(file)) {
          toast(`Импорт «${file.name}»…`);
          const { importPdfAsNotebook } = await loadPdfImport();
          created.push(await importPdfAsNotebook(file, file.name, folderId));
        } else {
          created.push(await notebookFromImage(file, folderId));
        }
      } catch (err) {
        toast(`«${file.name}»: ${errorMessage(err)}`, { kind: 'error' });
      }
    }
    if (created.length) toast(`Импортировано: ${created.length} ${pluralRu(created.length, 'документ', 'документа', 'документов')}`, { kind: 'success' });
    return created;
  });
}

/** A new notebook whose first (blank) page holds the image, fitted with margins. */
export async function notebookFromImage(file: File, folderId: UUID | null): Promise<Notebook> {
  const img = await prepareImage(file);
  const asset = await putAsset(img.blob, 'image', file.name, { width: img.width, height: img.height });
  const landscape = img.width > img.height;
  const nb = await createNotebook({ title: file.name.replace(/\.(png|jpe?g)$/i, ''), folderId, setup: { ...DEFAULT_SETUP, template: 'blank', orientation: landscape ? 'landscape' : 'portrait' } });
  const [page] = await listPages(nb.id);
  const margin = 24;
  const k = Math.min((page!.width - margin * 2) / img.width, (page!.height - margin * 2) / img.height, 1);
  const w = img.width * k;
  const h = img.height * k;
  const el: ImageElement = {
    id: uuid(),
    type: 'image',
    pageId: page!.id,
    notebookId: nb.id,
    createdAt: Date.now(),
    z: nextZ(),
    x: (page!.width - w) / 2,
    y: (page!.height - h) / 2,
    width: w,
    height: h,
    rotation: 0,
    assetId: asset.id,
  };
  await getDB().elements.add(el);
  return nb;
}

export async function exportNotebookAsPdf(nb: Notebook, onProgress?: (done: number, total: number) => void): Promise<void> {
  return trackTask(async () => {
    await saveQueue.flush();
    const pages = await listPages(nb.id);
    const [{ exportNotebookPdf }, { rasterizeTextElement }] = await Promise.all([loadPdfExport(), loadRaster()]);
    const bytes = await exportNotebookPdf(
      pages,
      { loadElements: loadPageElements, getAsset, rasterizeText: rasterizeTextElement, toPng: blobToPngBytes, onProgress },
      nb.title,
    );
    await saveFile(bytes, `${nb.title}.pdf`, 'application/pdf');
  });
}

export async function exportPageAsPng(nb: Notebook, pageIndex: number): Promise<void> {
  return trackTask(async () => {
    await saveQueue.flush();
    const pages = await listPages(nb.id);
    const page = pages[pageIndex];
    if (!page) return;
    const { exportPagePng } = await loadRaster();
    const blob = await exportPagePng(page, 3);
    await saveFile(blob, `${nb.title} — стр. ${pageIndex + 1}.png`, 'image/png');
  });
}

export async function exportNotebookBackup(nb: Notebook): Promise<void> {
  return trackTask(async () => {
    await saveQueue.flush();
    const { createBackup } = await loadBackup();
    const zip = await createBackup('notebook', [nb.id]);
    await saveFile(zip, `${nb.title}.annanotes`, 'application/zip');
  });
}

export async function exportLibraryBackup(): Promise<void> {
  return trackTask(async () => {
    await saveQueue.flush();
    const { createBackup } = await loadBackup();
    const zip = await createBackup('library');
    await saveFile(zip, `AnnaNotes — резервная копия ${stamp()}.annanotes`, 'application/zip');
    useSettings.getState().set('lastBackupAt', Date.now());
  });
}

export async function readBackupFile(file: File): Promise<ParsedBackup> {
  const { parseBackup } = await loadBackup();
  return parseBackup(new Uint8Array(await file.arrayBuffer()));
}

export async function applyBackup(parsed: ParsedBackup, mode: 'merge' | 'replace'): Promise<void> {
  return trackTask(async () => {
    await saveQueue.flush();
    const { restoreBackup } = await loadBackup();
    const s = await restoreBackup(parsed, mode);
    toast(`Восстановлено: ${s.notebooks} ${pluralRu(s.notebooks, 'документ', 'документа', 'документов')}, ${s.pages} ${pluralRu(s.pages, 'страница', 'страницы', 'страниц')}`, { kind: 'success' });
  });
}
