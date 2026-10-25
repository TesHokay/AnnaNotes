import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { getDB } from '@/db/db';
import { toStorageError } from '@/db/errors';
import { uuid } from '@/lib/id';
import type { Asset, Folder, Notebook, NotebookCoverRecord, Page, PageElement, StickerAsset, UUID } from '@/model/types';
import { BACKUP_FORMAT, BACKUP_VERSION, MAX_BACKUP_BYTES, BackupValidationError, validateManifest, type AssetMeta, type BackupManifest, type CoverMeta, type StickerMeta } from './format';

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

/** Collects the records for a set of notebooks (or the whole library) into a zip archive. */
export async function createBackup(scope: 'notebook' | 'library', notebookIds?: UUID[]): Promise<Uint8Array> {
  const db = getDB();
  const notebooks = scope === 'library' ? await db.notebooks.toArray() : await db.notebooks.where('id').anyOf(notebookIds ?? []).toArray();
  if (scope === 'notebook' && notebooks.length === 0) throw new Error('Документ не найден');
  const ids = notebooks.map((n) => n.id);
  const pages = await db.pages.where('notebookId').anyOf(ids).toArray();
  const elements = await db.elements.where('notebookId').anyOf(ids).toArray();
  const assetIds = new Set<UUID>();
  for (const p of pages) if (p.pdf) assetIds.add(p.pdf.assetId);
  for (const e of elements) if (e.type === 'image') assetIds.add(e.assetId);
  const assets = (await db.assets.bulkGet([...assetIds])).filter((a): a is Asset => !!a);
  let folders: Folder[] = [];
  if (scope === 'library') folders = await db.folders.toArray();

  const files: Zippable = {};
  const assetMetas: AssetMeta[] = [];
  for (const a of assets) {
    const { blob, ...meta } = a;
    const file = `assets/${a.id}.bin`;
    // PDFs and images are already compressed; store them as-is.
    files[file] = [await blobBytes(blob), { level: 0 }];
    assetMetas.push({ ...meta, file });
  }
  const coverMetas: CoverMeta[] = [];
  for (const c of (await db.covers.bulkGet(ids)).filter((x): x is NotebookCoverRecord => !!x)) {
    const { photo, thumb, ...meta } = c;
    const cm: CoverMeta = { ...meta };
    if (photo) {
      cm.photoFile = `assets/cover-${c.id}-photo.bin`;
      cm.photoMime = photo.type;
      files[cm.photoFile] = [await blobBytes(photo), { level: 0 }];
    }
    if (thumb) {
      cm.thumbFile = `assets/cover-${c.id}-thumb.bin`;
      files[cm.thumbFile] = [await blobBytes(thumb), { level: 0 }];
    }
    coverMetas.push(cm);
  }
  const stickerMetas: StickerMeta[] = [];
  if (scope === 'library') {
    for (const st of await db.stickers.toArray()) {
      const { blob, ...meta } = st;
      const file = `assets/sticker-${st.id}.bin`;
      files[file] = [await blobBytes(blob), { level: st.mime === 'image/svg+xml' ? 6 : 0 }];
      stickerMetas.push({ ...meta, file });
    }
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    appVersion: APP_VERSION,
    scope,
    folders,
    notebooks: scope === 'notebook' ? notebooks.map((n) => ({ ...n, folderId: null })) : notebooks,
    pages,
    elements,
    assets: assetMetas,
    covers: coverMetas,
    stickers: stickerMetas,
  };
  files['manifest.json'] = [strToU8(JSON.stringify(manifest)), { level: 6 }];
  const zip = zipSync(files);
  await db.backupsMetadata.add({ id: uuid(), kind: scope, direction: 'export', name: scope === 'library' ? 'Вся библиотека' : notebooks[0]!.title, size: zip.byteLength, createdAt: Date.now() }).catch(() => {});
  return zip;
}

export interface ParsedBackup {
  manifest: BackupManifest;
  files: Record<string, Uint8Array>;
}

export function parseBackup(bytes: Uint8Array): ParsedBackup {
  if (bytes.byteLength > MAX_BACKUP_BYTES) throw new BackupValidationError(['файл больше 1 ГБ']);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new BackupValidationError(['это не архив резервной копии AnnaNotes']);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new BackupValidationError(['архив повреждён']);
  }
  const m = files['manifest.json'];
  if (!m) throw new BackupValidationError(['в архиве нет manifest.json']);
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(m));
  } catch {
    throw new BackupValidationError(['manifest.json не является корректным JSON']);
  }
  const manifest = validateManifest(raw);
  const needed = [...manifest.assets.map((a) => a.file), ...manifest.stickers.map((s) => s.file), ...manifest.covers.flatMap((c) => [c.photoFile, c.thumbFile]).filter((f): f is string => !!f)];
  for (const f of needed) if (!files[f]) throw new BackupValidationError([`в архиве отсутствует файл ${f}`]);
  return { manifest, files };
}

export interface RestoreSummary {
  notebooks: number;
  pages: number;
  elements: number;
  folders: number;
}

/**
 * Restores a backup.
 *  - 'merge'   — adds everything as new records with fresh ids (never conflicts, never overwrites).
 *  - 'replace' — wipes the library first (the UI must get explicit confirmation) and restores ids as-is.
 */
export async function restoreBackup(parsed: ParsedBackup, mode: 'merge' | 'replace'): Promise<RestoreSummary> {
  const { manifest: m, files } = parsed;
  const map = new Map<UUID, UUID>();
  const remap = (id: UUID): UUID => {
    if (mode === 'replace') return id;
    let n = map.get(id);
    if (!n) {
      n = uuid();
      map.set(id, n);
    }
    return n;
  };
  const folderIds = new Set(m.folders.map((f) => f.id));
  const folders: Folder[] = m.folders.map((f) => ({ ...f, id: remap(f.id), parentId: f.parentId && folderIds.has(f.parentId) ? remap(f.parentId) : null }));
  const notebooks: Notebook[] = m.notebooks.map((n) => ({
    ...n,
    id: remap(n.id),
    folderId: n.folderId && folderIds.has(n.folderId) ? remap(n.folderId) : null,
    favorite: n.favorite ? 1 : 0,
    deletedAt: n.deletedAt || 0,
  }));
  const assets: Asset[] = m.assets.map(({ file, ...meta }) => ({ ...meta, id: remap(meta.id), blob: new Blob([files[file]!], { type: meta.mime }) }));
  const pages: Page[] = m.pages.map((p) => {
    const pdf = p.pdf ? { assetId: remap(p.pdf.assetId), pageIndex: p.pdf.pageIndex } : null;
    return { ...p, id: remap(p.id), notebookId: remap(p.notebookId), pdf, pdfAssetId: pdf?.assetId, bookmarked: p.bookmarked ? 1 : 0 };
  });
  const elements: PageElement[] = m.elements.map((e) => {
    const base = { ...e, id: remap(e.id), pageId: remap(e.pageId), notebookId: remap(e.notebookId) };
    return e.type === 'image' ? ({ ...base, assetId: remap(e.assetId) } as PageElement) : (base as PageElement);
  });
  const covers: NotebookCoverRecord[] = m.covers.map(({ photoFile, photoMime, thumbFile, ...meta }) => ({
    ...meta,
    id: remap(meta.id),
    ...(photoFile ? { photo: new Blob([files[photoFile]!], { type: photoMime || 'image/jpeg' }) } : {}),
    ...(thumbFile ? { thumb: new Blob([files[thumbFile]!], { type: 'image/jpeg' }) } : {}),
  }));
  // Stickers keep their ids: restoring the same library twice does not duplicate them.
  const stickers: StickerAsset[] = m.stickers.map(({ file, ...meta }) => ({ ...meta, blob: new Blob([files[file]!], { type: meta.mime }) }));
  // Page counts are derived, recompute instead of trusting the file.
  const counts = new Map<UUID, number>();
  for (const p of pages) counts.set(p.notebookId, (counts.get(p.notebookId) ?? 0) + 1);
  for (const n of notebooks) n.pageCount = counts.get(n.id) ?? 0;

  const db = getDB();
  try {
    await db.transaction('rw', [db.folders, db.notebooks, db.pages, db.elements, db.assets, db.backupsMetadata, db.covers, db.stickers], async () => {
      if (mode === 'replace') {
        await Promise.all([db.folders.clear(), db.notebooks.clear(), db.pages.clear(), db.elements.clear(), db.assets.clear(), db.covers.clear()]);
      }
      await db.covers.bulkPut(covers);
      await db.stickers.bulkPut(stickers);
      await db.assets.bulkPut(assets);
      await db.folders.bulkPut(folders);
      await db.notebooks.bulkPut(notebooks);
      await db.pages.bulkPut(pages);
      await db.elements.bulkPut(elements);
      await db.backupsMetadata.add({ id: uuid(), kind: m.scope, direction: 'import', name: m.scope === 'library' ? 'Вся библиотека' : (notebooks[0]?.title ?? ''), size: 0, createdAt: Date.now() });
    });
  } catch (err) {
    throw toStorageError(err);
  }
  return { notebooks: notebooks.length, pages: pages.length, elements: elements.length, folders: folders.length };
}
