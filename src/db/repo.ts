import { uuid } from '@/lib/id';
import { DEFAULT_SETUP, COVER_COLORS, pageDimensions } from '@/model/paper';
import type { Asset, AssetKind, CoverDesign, Folder, Notebook, NotebookCoverRecord, Page, PageElement, PageSetup, StickerAsset, UUID } from '@/model/types';
import { getDB } from './db';
import { toStorageError } from './errors';

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toStorageError(err);
  }
}

const now = () => Date.now();

// ---------------------------------------------------------------- folders

export function createFolder(name: string, parentId: UUID | null): Promise<Folder> {
  return guard(async () => {
    const folder: Folder = { id: uuid(), name: name.trim() || 'Новая папка', parentId, createdAt: now(), updatedAt: now() };
    await getDB().folders.add(folder);
    return folder;
  });
}

export function renameFolder(id: UUID, name: string): Promise<void> {
  return guard(async () => {
    await getDB().folders.update(id, { name: name.trim() || 'Без названия', updatedAt: now() });
  });
}

/** True when `candidate` is `folderId` itself or one of its descendants. */
export async function isFolderInSubtree(folderId: UUID, candidate: UUID | null): Promise<boolean> {
  const folders = await getDB().folders.toArray();
  const byId = new Map(folders.map((f) => [f.id, f]));
  let cur: UUID | null = candidate;
  while (cur) {
    if (cur === folderId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export function moveFolder(id: UUID, parentId: UUID | null): Promise<void> {
  return guard(async () => {
    if (await isFolderInSubtree(id, parentId)) throw new Error('Нельзя переместить папку внутрь самой себя');
    await getDB().folders.update(id, { parentId, updatedAt: now() });
  });
}

/** Deletes a folder; its notebooks and sub-folders move to the parent folder (nothing is lost). */
export function deleteFolder(id: UUID): Promise<void> {
  return guard(async () => {
    const db = getDB();
    await db.transaction('rw', db.folders, db.notebooks, async () => {
      const folder = await db.folders.get(id);
      if (!folder) return;
      await db.folders.where('parentId').equals(id).modify({ parentId: folder.parentId });
      await db.notebooks.where('folderId').equals(id).modify({ folderId: folder.parentId });
      await db.folders.delete(id);
    });
  });
}

// ---------------------------------------------------------------- notebooks

export function makePage(notebookId: UUID, order: number, setup: PageSetup): Page {
  const { width, height } = pageDimensions(setup.size, setup.orientation);
  return {
    id: uuid(),
    notebookId,
    order,
    width,
    height,
    size: setup.size,
    template: setup.template,
    paperColor: setup.paperColor,
    ...(setup.style ? { style: setup.style } : {}),
    pdf: null,
    bookmarked: 0,
    createdAt: now(),
    updatedAt: now(),
  };
}

export interface NewNotebookInput {
  title: string;
  folderId?: UUID | null;
  coverColor?: string;
  setup?: PageSetup;
}

export function createNotebook(input: NewNotebookInput): Promise<Notebook> {
  return guard(async () => {
    const db = getDB();
    const setup = input.setup ?? DEFAULT_SETUP;
    const nb: Notebook = {
      id: uuid(),
      title: input.title.trim() || 'Без названия',
      kind: 'notebook',
      folderId: input.folderId ?? null,
      coverColor: input.coverColor ?? COVER_COLORS[0]!,
      favorite: 0,
      createdAt: now(),
      updatedAt: now(),
      openedAt: 0,
      deletedAt: 0,
      pageCount: 1,
      defaultSetup: setup,
    };
    await db.transaction('rw', db.notebooks, db.pages, async () => {
      await db.notebooks.add(nb);
      await db.pages.add(makePage(nb.id, 1, setup));
    });
    return nb;
  });
}

export function updateNotebook(id: UUID, patch: Partial<Omit<Notebook, 'id'>>): Promise<void> {
  return guard(async () => {
    await getDB().notebooks.update(id, { ...patch, updatedAt: patch.updatedAt ?? now() });
  });
}

export function renameNotebook(id: UUID, title: string): Promise<void> {
  return updateNotebook(id, { title: title.trim() || 'Без названия' });
}

export function markOpened(id: UUID): Promise<void> {
  return guard(async () => {
    await getDB().notebooks.update(id, { openedAt: now() });
  });
}

export function setFavorite(ids: UUID[], favorite: boolean): Promise<void> {
  return guard(async () => {
    await getDB().notebooks.where('id').anyOf(ids).modify({ favorite: favorite ? 1 : 0 });
  });
}

export function moveNotebooks(ids: UUID[], folderId: UUID | null): Promise<void> {
  return guard(async () => {
    await getDB().notebooks.where('id').anyOf(ids).modify({ folderId, updatedAt: now() });
  });
}

export function trashNotebooks(ids: UUID[]): Promise<void> {
  return guard(async () => {
    await getDB().notebooks.where('id').anyOf(ids).modify({ deletedAt: now() });
  });
}

export function restoreNotebooks(ids: UUID[]): Promise<void> {
  return guard(async () => {
    const db = getDB();
    await db.transaction('rw', db.notebooks, db.folders, async () => {
      const folderIds = new Set((await db.folders.toArray()).map((f) => f.id));
      await db.notebooks
        .where('id')
        .anyOf(ids)
        .modify((nb) => {
          nb.deletedAt = 0;
          // The original folder may have been deleted while the notebook was in the trash.
          if (nb.folderId && !folderIds.has(nb.folderId)) nb.folderId = null;
        });
    });
  });
}

/** Removes assets no longer referenced by any page or element. Must run inside a transaction covering pages/elements/assets. */
async function collectGarbageAssets(candidateIds: Iterable<UUID>): Promise<void> {
  const db = getDB();
  for (const assetId of new Set(candidateIds)) {
    const pageRefs = await db.pages.where('pdfAssetId').equals(assetId).count();
    const elRefs = await db.elements.where('assetId').equals(assetId).count();
    if (pageRefs === 0 && elRefs === 0) await db.assets.delete(assetId);
  }
}

export function deleteNotebooksPermanently(ids: UUID[]): Promise<void> {
  return guard(async () => {
    const db = getDB();
    await db.transaction('rw', [db.notebooks, db.pages, db.elements, db.assets, db.covers], async () => {
      const assetIds: UUID[] = [];
      for (const id of ids) {
        const pages = await db.pages.where('notebookId').equals(id).toArray();
        for (const p of pages) if (p.pdf) assetIds.push(p.pdf.assetId);
        const els = await db.elements.where('notebookId').equals(id).toArray();
        for (const e of els) if (e.type === 'image') assetIds.push(e.assetId);
        await db.elements.where('notebookId').equals(id).delete();
        await db.pages.where('notebookId').equals(id).delete();
        await db.notebooks.delete(id);
        await db.covers.delete(id);
      }
      await collectGarbageAssets(assetIds);
    });
  });
}

export function emptyTrash(): Promise<void> {
  return guard(async () => {
    const ids = (await getDB().notebooks.where('deletedAt').above(0).primaryKeys()) as UUID[];
    if (ids.length) await deleteNotebooksPermanently(ids);
  });
}

/** Deep copy of a notebook: pages and elements get new ids, binary assets are shared. */
export function duplicateNotebook(id: UUID): Promise<Notebook> {
  return guard(async () => {
    const db = getDB();
    return db.transaction('rw', [db.notebooks, db.pages, db.elements, db.covers], async () => {
      const src = await db.notebooks.get(id);
      if (!src) throw new Error('Документ не найден');
      const copy: Notebook = { ...src, id: uuid(), title: `${src.title} (копия)`, createdAt: now(), updatedAt: now(), openedAt: 0, favorite: 0, deletedAt: 0 };
      const pages = await db.pages.where('notebookId').equals(id).toArray();
      const pageMap = new Map<UUID, UUID>();
      const newPages = pages.map((p) => {
        const nid = uuid();
        pageMap.set(p.id, nid);
        return { ...p, id: nid, notebookId: copy.id };
      });
      const els = await db.elements.where('notebookId').equals(id).toArray();
      const newEls = els.map((e) => ({ ...e, id: uuid(), notebookId: copy.id, pageId: pageMap.get(e.pageId) ?? e.pageId }));
      await db.notebooks.add(copy);
      await db.pages.bulkAdd(newPages);
      await db.elements.bulkAdd(newEls);
      const cover = await db.covers.get(id);
      if (cover) await db.covers.add({ ...cover, id: copy.id });
      return copy;
    });
  });
}

// ---------------------------------------------------------------- pages

export async function listPages(notebookId: UUID): Promise<Page[]> {
  return guard(() => getDB().pages.where('[notebookId+order]').between([notebookId, -Infinity], [notebookId, Infinity]).toArray());
}

async function syncPageCount(notebookId: UUID): Promise<void> {
  const db = getDB();
  const count = await db.pages.where('notebookId').equals(notebookId).count();
  await db.notebooks.update(notebookId, { pageCount: count, updatedAt: now() });
}

/** Insert a page after `afterPageId` (or at the end). */
export function addPage(notebookId: UUID, afterPageId: UUID | null, setup: PageSetup): Promise<Page> {
  return guard(async () => {
    const db = getDB();
    return db.transaction('rw', db.pages, db.notebooks, async () => {
      const pages = await listPages(notebookId);
      const idx = afterPageId ? pages.findIndex((p) => p.id === afterPageId) : pages.length - 1;
      const prev = pages[idx];
      const next = pages[idx + 1];
      const order = prev ? (next ? (prev.order + next.order) / 2 : prev.order + 1) : next ? next.order - 1 : 1;
      const page = makePage(notebookId, order, setup);
      await db.pages.add(page);
      await syncPageCount(notebookId);
      return page;
    });
  });
}

export function duplicatePage(pageId: UUID): Promise<Page> {
  return guard(async () => {
    const db = getDB();
    return db.transaction('rw', db.pages, db.elements, db.notebooks, async () => {
      const src = await db.pages.get(pageId);
      if (!src) throw new Error('Страница не найдена');
      const pages = await listPages(src.notebookId);
      const idx = pages.findIndex((p) => p.id === pageId);
      const next = pages[idx + 1];
      const copy: Page = { ...src, id: uuid(), order: next ? (src.order + next.order) / 2 : src.order + 1, createdAt: now(), updatedAt: now() };
      const els = await db.elements.where('pageId').equals(pageId).toArray();
      await db.pages.add(copy);
      await db.elements.bulkAdd(els.map((e) => ({ ...e, id: uuid(), pageId: copy.id })));
      await syncPageCount(src.notebookId);
      return copy;
    });
  });
}

export function deletePage(pageId: UUID): Promise<void> {
  return guard(async () => {
    const db = getDB();
    await db.transaction('rw', [db.pages, db.elements, db.notebooks, db.assets], async () => {
      const page = await db.pages.get(pageId);
      if (!page) return;
      const count = await db.pages.where('notebookId').equals(page.notebookId).count();
      if (count <= 1) throw new Error('В документе должна остаться хотя бы одна страница');
      const assets: UUID[] = [];
      if (page.pdf) assets.push(page.pdf.assetId);
      const els = await db.elements.where('pageId').equals(pageId).toArray();
      for (const e of els) if (e.type === 'image') assets.push(e.assetId);
      await db.elements.where('pageId').equals(pageId).delete();
      await db.pages.delete(pageId);
      await collectGarbageAssets(assets);
      await syncPageCount(page.notebookId);
    });
  });
}

/** Move a page to a new position (0-based) and renumber orders. */
export function movePage(notebookId: UUID, pageId: UUID, toIndex: number): Promise<void> {
  return guard(async () => {
    const db = getDB();
    await db.transaction('rw', db.pages, db.notebooks, async () => {
      const pages = await listPages(notebookId);
      const from = pages.findIndex((p) => p.id === pageId);
      if (from < 0) return;
      const [moved] = pages.splice(from, 1);
      pages.splice(Math.max(0, Math.min(pages.length, toIndex)), 0, moved!);
      await db.pages.bulkPut(pages.map((p, i) => ({ ...p, order: i + 1 })));
      await db.notebooks.update(notebookId, { updatedAt: now() });
    });
  });
}

export function updatePages(ids: UUID[], patch: Partial<Pick<Page, 'template' | 'paperColor' | 'style' | 'bookmarked' | 'width' | 'height' | 'size'>>): Promise<void> {
  return guard(async () => {
    await getDB().pages.where('id').anyOf(ids).modify({ ...patch, updatedAt: now() });
  });
}

// ---------------------------------------------------------------- elements

export function loadPageElements(pageId: UUID): Promise<PageElement[]> {
  return guard(async () => {
    const els = await getDB().elements.where('pageId').equals(pageId).toArray();
    return els.sort((a, b) => a.z - b.z);
  });
}

export function countNotebookElements(notebookId: UUID): Promise<number> {
  return guard(() => getDB().elements.where('notebookId').equals(notebookId).count());
}

// ---------------------------------------------------------------- assets

export function putAsset(blob: Blob, kind: AssetKind, name: string, extra: Partial<Pick<Asset, 'width' | 'height'>> = {}): Promise<Asset> {
  return guard(async () => {
    const asset: Asset = { id: uuid(), kind, mime: blob.type || (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'), name, size: blob.size, blob, createdAt: now(), ...extra };
    await getDB().assets.add(asset);
    return asset;
  });
}

export function getAsset(id: UUID): Promise<Asset | undefined> {
  return guard(() => getDB().assets.get(id));
}

// ---------------------------------------------------------------- settings

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const rec = await getDB().settings.get(key);
    return rec ? (rec.value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): Promise<void> {
  return guard(async () => {
    await getDB().settings.put({ key, value });
  });
}

// ---------------------------------------------------------------- covers (4.3)

export function getCover(notebookId: UUID): Promise<NotebookCoverRecord | undefined> {
  return guard(() => getDB().covers.get(notebookId));
}

/**
 * Saves a custom cover. `photo`: a Blob replaces it, null removes it, undefined keeps it.
 * Only the cover record and the notebook's cover fields change — pages and `updatedAt` are
 * untouched, so the library order does not jump.
 */
export function saveCover(notebookId: UUID, design: CoverDesign, photo: Blob | null | undefined, thumb: Blob | undefined): Promise<void> {
  return guard(async () => {
    const db = getDB();
    await db.transaction('rw', db.covers, db.notebooks, async () => {
      const prev = await db.covers.get(notebookId);
      const rec: NotebookCoverRecord = { id: notebookId, design, updatedAt: now(), thumb };
      const keep = photo === undefined ? prev?.photo : photo ?? undefined;
      if (keep) rec.photo = keep;
      if (!keep) delete rec.design.photo;
      await db.covers.put(rec);
      const nb = await db.notebooks.get(notebookId);
      if (nb) await db.notebooks.update(notebookId, { coverColor: design.background, coverVersion: (nb.coverVersion ?? 0) + 1 });
    });
  });
}

export function removeCover(notebookId: UUID): Promise<void> {
  return guard(async () => {
    const db = getDB();
    await db.transaction('rw', db.covers, db.notebooks, async () => {
      await db.covers.delete(notebookId);
      const nb = await db.notebooks.get(notebookId);
      if (nb) await db.notebooks.update(notebookId, { coverVersion: 0 });
    });
  });
}

// ---------------------------------------------------------------- stickers (4.3)

export function addStickerAsset(input: Omit<StickerAsset, 'id' | 'createdAt'>): Promise<StickerAsset> {
  return guard(async () => {
    const rec: StickerAsset = { ...input, id: uuid(), createdAt: now() };
    await getDB().stickers.add(rec);
    return rec;
  });
}

export function deleteStickerAsset(id: UUID): Promise<void> {
  return guard(async () => {
    await getDB().stickers.delete(id);
  });
}
