import { create } from 'zustand';
import { getDB } from '@/db/db';
import { createFolder } from '@/db/repo';
import { isPdf, readHeader, ImportError } from '@/lib/fileTypes';
import { sniffImageType } from '@/lib/images';
import type { UUID } from '@/model/types';
import { extractEntry, isZipBytes, listZip, MAX_ZIP_BYTES, type ZipEntryInfo } from './zip';

export type JobStatus = 'pending' | 'working' | 'done' | 'skipped' | 'error';

export interface ImportJob {
  id: number;
  name: string;
  /** Folder path inside the library (from the ZIP structure). */
  path: string[];
  status: JobStatus;
  message?: string;
}

interface ImportState {
  open: boolean;
  running: boolean;
  cancelRequested: boolean;
  jobs: ImportJob[];
  notice: string | null;
  close(): void;
  cancel(): void;
}

export const useImport = create<ImportState>((set, get) => ({
  open: false,
  running: false,
  cancelRequested: false,
  jobs: [],
  notice: null,
  close() {
    if (!get().running) set({ open: false, jobs: [], notice: null });
  },
  cancel() {
    set({ cancelRequested: true });
  },
}));

let nextId = 1;
const update = (id: number, patch: Partial<ImportJob>) => useImport.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));

/** A unit of work: a file from disk or an entry inside a ZIP. */
interface Source {
  job: ImportJob;
  read(): Promise<Blob>;
}

const isGoodnotesName = (n: string) => /\.goodnotes(\.zip)?$/i.test(n);

async function folderFor(path: string[], root: UUID | null, cache: Map<string, UUID | null>): Promise<UUID | null> {
  let parent = root;
  let key = '';
  for (const name of path) {
    key += `/${name}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      parent = cached;
      continue;
    }
    // Reuse an existing folder with the same name at this level (re-importing merges, no duplicates).
    const existing = (await getDB().folders.toArray()).find((f) => f.parentId === parent && f.name === name);
    const id = existing ? existing.id : (await createFolder(name, parent)).id;
    cache.set(key, id);
    parent = id;
  }
  return parent;
}

/** Same title and same file size in the same folder → already imported. */
async function isDuplicate(title: string, size: number, folderId: UUID | null): Promise<boolean> {
  const db = getDB();
  const candidates = (await db.notebooks.where('title').equals(title).toArray()).filter((n) => n.folderId === folderId && !n.deletedAt);
  for (const nb of candidates) {
    const page = await db.pages.where('notebookId').equals(nb.id).first();
    const assetId = page?.pdf?.assetId;
    const asset = assetId ? await db.assets.get(assetId) : undefined;
    if (asset && asset.size === size) return true;
    if (!assetId) {
      const img = (await db.elements.where('notebookId').equals(nb.id).toArray()).find((e) => e.type === 'image');
      const a = img && img.type === 'image' ? await db.assets.get(img.assetId) : undefined;
      if (a && a.size === size) return true;
    }
  }
  return false;
}

async function expandZip(file: File, sources: Source[]): Promise<string | null> {
  if (file.size > MAX_ZIP_BYTES) throw new ImportError('Архив больше 1,5 ГБ — разделите его на части');
  const data = new Uint8Array(await file.arrayBuffer());
  const entries = listZip(data);
  const rootName = file.name.replace(/\.(goodnotes\.zip|goodnotes|zip)$/i, '');
  const goodnotes = isGoodnotesName(file.name) || entries.some((e) => /\.notes?\.pb$|^index\.(notes|attachments)/i.test(e.segments.join('/')));
  const usable = entries.filter((e) => /\.(pdf|png|jpe?g)$/i.test(e.segments.at(-1)!));
  // Native Goodnotes archives: only embedded original PDFs/images are recoverable, not handwriting.
  const pick = (e: ZipEntryInfo) => (goodnotes ? e.segments.includes('attachments') || /\.pdf$/i.test(e.segments.at(-1)!) : true);
  // Archives usually wrap everything in one top-level folder: use it as the root instead of
  // nesting it inside another folder named after the ZIP.
  const tops = new Set(usable.map((e) => (e.segments.length > 1 ? e.segments[0] : '')));
  const wrapped = tops.size === 1 && !tops.has('');
  for (const e of usable.filter(pick)) {
    const name = e.segments.at(-1)!;
    const path = goodnotes ? [rootName] : wrapped ? e.segments.slice(0, -1) : [rootName, ...e.segments.slice(0, -1)];
    sources.push({
      job: { id: nextId++, name, path, status: 'pending' },
      read: async () => new Blob([extractEntry(data, e)]),
    });
  }
  if (goodnotes) {
    return usable.length
      ? `«${file.name}»: формат Goodnotes не документирован. Импортированы только вложенные исходные PDF и изображения — рукописные записи из него извлечь нельзя. Для полного переноса экспортируйте тетради из Goodnotes в PDF.`
      : `«${file.name}»: формат Goodnotes не поддерживается (не документирован). Экспортируйте тетради из Goodnotes как PDF («Поделиться» → «Экспорт» → PDF) и импортируйте PDF или ZIP с ними.`;
  }
  return null;
}

/**
 * Imports files one at a time (bounded memory): PDFs and images become notebooks; ZIP archives
 * are expanded with their folder structure. Each file succeeds or fails on its own; a failure
 * never touches existing documents (every notebook is written in its own transaction).
 */
export async function runImport(files: File[], targetFolder: UUID | null): Promise<number> {
  if (useImport.getState().running) throw new ImportError('Импорт уже выполняется');
  const sources: Source[] = [];
  const notices: string[] = [];
  useImport.setState({ open: true, running: true, cancelRequested: false, jobs: [], notice: null });
  try {
    for (const f of files) {
      const head = await readHeader(f, 4);
      if (isZipBytes(head) && !/\.pencilnotes$|\.annanotes$/i.test(f.name)) {
        try {
          const n = await expandZip(f, sources);
          if (n) notices.push(n);
        } catch (err) {
          sources.push({ job: { id: nextId++, name: f.name, path: [], status: 'error', message: (err as Error).message }, read: async () => f });
        }
      } else {
        sources.push({ job: { id: nextId++, name: f.name, path: [], status: 'pending' }, read: async () => f });
      }
    }
    useImport.setState({ jobs: sources.map((s) => s.job), notice: notices.join('\n') || null });

    const { importPdfAsNotebook } = await import('@/pdf/importPdf');
    const { notebookFromImage } = await import('@/features/actions');
    const folders = new Map<string, UUID | null>();
    let created = 0;
    for (const src of sources) {
      if (src.job.status === 'error') continue;
      if (useImport.getState().cancelRequested) {
        update(src.job.id, { status: 'skipped', message: 'Отменено' });
        continue;
      }
      update(src.job.id, { status: 'working' });
      try {
        const blob = await src.read();
        const folderId = await folderFor(src.job.path, targetFolder, folders);
        const title = src.job.name.replace(/\.(pdf|png|jpe?g)$/i, '');
        if (await isDuplicate(title, blob.size, folderId)) {
          update(src.job.id, { status: 'skipped', message: 'Уже есть в библиотеке' });
          continue;
        }
        if (await isPdf(blob)) await importPdfAsNotebook(blob, src.job.name, folderId);
        else if (await sniffImageType(blob)) await notebookFromImage(new File([blob], src.job.name), folderId);
        else throw new ImportError(isGoodnotesName(src.job.name) ? 'Формат Goodnotes не поддерживается — экспортируйте в PDF' : 'Неподдерживаемый формат (нужен PDF, PNG, JPEG или ZIP)');
        created++;
        update(src.job.id, { status: 'done' });
      } catch (err) {
        update(src.job.id, { status: 'error', message: (err as Error).message });
      }
      // Yield so the UI stays responsive between large files.
      await new Promise((r) => setTimeout(r, 0));
    }
    return created;
  } finally {
    useImport.setState({ running: false });
  }
}
