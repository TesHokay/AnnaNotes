// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { PencilNotesDB, SCHEMA_V1, setDB } from './db';
import {
  addPage,
  createFolder,
  createNotebook,
  deleteFolder,
  deleteNotebooksPermanently,
  deletePage,
  duplicateNotebook,
  duplicatePage,
  listPages,
  moveFolder,
  movePage,
  moveNotebooks,
  putAsset,
  restoreNotebooks,
  trashNotebooks,
} from './repo';
import { SaveQueue } from './saveQueue';
import { isQuotaError, toStorageError } from './errors';
import { useTestDB, makeStroke, pts } from '@/test/helpers';
import { DEFAULT_SETUP } from '@/model/paper';
import { uuid } from '@/lib/id';
import type { ImageElement } from '@/model/types';

describe('repository', () => {
  let db: PencilNotesDB;
  beforeEach(() => {
    db = useTestDB();
  });

  it('creates a notebook with a first page in one transaction', async () => {
    const nb = await createNotebook({ title: '  Лекции  ' });
    expect(nb.title).toBe('Лекции');
    const pages = await listPages(nb.id);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.width).toBeCloseTo(595.28);
    expect((await db.notebooks.get(nb.id))!.pageCount).toBe(1);
  });

  it('adds, duplicates, reorders and deletes pages', async () => {
    const nb = await createNotebook({ title: 'A' });
    const [p1] = await listPages(nb.id);
    const p3 = await addPage(nb.id, p1!.id, DEFAULT_SETUP);
    const p2 = await addPage(nb.id, p1!.id, { ...DEFAULT_SETUP, template: 'grid' });
    expect((await listPages(nb.id)).map((p) => p.id)).toEqual([p1!.id, p2.id, p3.id]);

    await db.elements.add(makeStroke(pts([[0, 0], [1, 1]]), { pageId: p2.id, notebookId: nb.id }));
    const copy = await duplicatePage(p2.id);
    expect(await db.elements.where('pageId').equals(copy.id).count()).toBe(1);
    expect((await listPages(nb.id)).map((p) => p.id)).toEqual([p1!.id, p2.id, copy.id, p3.id]);

    await movePage(nb.id, p3.id, 0);
    expect((await listPages(nb.id))[0]!.id).toBe(p3.id);

    await deletePage(p2.id);
    expect(await db.elements.where('pageId').equals(p2.id).count()).toBe(0);
    expect((await db.notebooks.get(nb.id))!.pageCount).toBe(3);
  });

  it('refuses to delete the last page', async () => {
    const nb = await createNotebook({ title: 'A' });
    const [p] = await listPages(nb.id);
    await expect(deletePage(p!.id)).rejects.toThrow(/хотя бы одна/);
  });

  it('trash, restore and permanent deletion with asset garbage collection', async () => {
    const nb = await createNotebook({ title: 'A' });
    const [page] = await listPages(nb.id);
    const asset = await putAsset(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'image', 'x.png');
    await db.elements.add({ id: uuid(), type: 'image', pageId: page!.id, notebookId: nb.id, createdAt: 0, z: 1, x: 0, y: 0, width: 10, height: 10, rotation: 0, assetId: asset.id } as ImageElement);
    const copy = await duplicateNotebook(nb.id);

    await trashNotebooks([nb.id]);
    expect((await db.notebooks.get(nb.id))!.deletedAt).toBeGreaterThan(0);
    await restoreNotebooks([nb.id]);
    expect((await db.notebooks.get(nb.id))!.deletedAt).toBe(0);

    await deleteNotebooksPermanently([nb.id]);
    expect(await db.notebooks.get(nb.id)).toBeUndefined();
    expect(await db.assets.get(asset.id)).toBeDefined(); // still used by the copy
    await deleteNotebooksPermanently([copy.id]);
    expect(await db.assets.get(asset.id)).toBeUndefined();
    expect(await db.elements.count()).toBe(0);
  });

  it('nested folders: delete moves contents up, cycles are rejected', async () => {
    const a = await createFolder('A', null);
    const b = await createFolder('B', a.id);
    const nb = await createNotebook({ title: 'n', folderId: b.id });
    await expect(moveFolder(a.id, b.id)).rejects.toThrow();
    await deleteFolder(b.id);
    expect((await db.notebooks.get(nb.id))!.folderId).toBe(a.id);
    await moveNotebooks([nb.id], null);
    expect((await db.notebooks.get(nb.id))!.folderId).toBeNull();
  });
});

describe('schema migration v1 -> v2', () => {
  it('upgrades an existing v1 database without losing data and backfills indexes', async () => {
    const name = `migrate-${uuid()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores(SCHEMA_V1);
    await v1.open();
    await v1.table('notebooks').add({ id: 'nb', title: 'Old', kind: 'pdf', folderId: null, coverColor: '#000', favorite: 0, createdAt: 1, updatedAt: 1, openedAt: 0, deletedAt: 0, pageCount: 1, defaultSetup: DEFAULT_SETUP });
    await v1.table('pages').add({ id: 'p', notebookId: 'nb', order: 1, width: 100, height: 100, size: 'custom', template: 'blank', paperColor: '#fff', pdf: { assetId: 'asset-1', pageIndex: 0 }, bookmarked: true, createdAt: 1, updatedAt: 1 });
    await v1.table('elements').add({ id: 'img', type: 'image', pageId: 'p', notebookId: 'nb', assetId: 'asset-2', z: 1 });
    v1.close();

    const v2 = new PencilNotesDB(name);
    setDB(v2);
    await v2.open();
    expect(v2.verno).toBe(2);
    const page = await v2.pages.get('p');
    expect(page!.pdfAssetId).toBe('asset-1');
    expect(page!.bookmarked).toBe(1);
    expect(await v2.pages.where('pdfAssetId').equals('asset-1').count()).toBe(1);
    expect(await v2.elements.where('assetId').equals('asset-2').count()).toBe(1);
    expect((await v2.notebooks.get('nb'))!.title).toBe('Old');
    v2.close();
  });
});

describe('SaveQueue', () => {
  beforeEach(() => {
    useTestDB();
  });

  it('batches writes, last write wins, and reports saved', async () => {
    const q = new SaveQueue(10_000);
    const states: string[] = [];
    q.subscribe((s) => states.push(s.status));
    const nb = await createNotebook({ title: 'x' });
    const s1 = makeStroke(pts([[0, 0], [1, 1]]), { notebookId: nb.id });
    const s2 = makeStroke(pts([[2, 2], [3, 3]]), { notebookId: nb.id });
    q.enqueue([s1, s2], []);
    q.enqueue([], [s2.id]);
    expect(q.hasPending).toBe(true);
    await q.flush();
    const { getDB } = await import('./db');
    expect(await getDB().elements.get(s1.id)).toBeDefined();
    expect(await getDB().elements.get(s2.id)).toBeUndefined();
    expect(states).toContain('saving');
    expect(q.getState().status).toBe('saved');
    expect(q.hasPending).toBe(false);
  });

  it('keeps the batch and reports quota errors, then succeeds on retry', async () => {
    const q = new SaveQueue(10_000);
    const nb = await createNotebook({ title: 'x' });
    const s = makeStroke(pts([[0, 0], [1, 1]]), { notebookId: nb.id });
    const { getDB } = await import('./db');
    const db = getDB();
    const original = db.transaction.bind(db);
    let fail = true;
    (db as unknown as { transaction: unknown }).transaction = (...args: unknown[]) => {
      if (fail) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        return Promise.reject(err);
      }
      return (original as (...a: unknown[]) => unknown)(...args);
    };
    q.enqueue([s], []);
    await expect(q.flush()).rejects.toMatchObject({ kind: 'quota' });
    expect(q.getState().status).toBe('quota');
    expect(q.hasPending).toBe(true);
    fail = false;
    await q.flush();
    expect(await db.elements.get(s.id)).toBeDefined();
    expect(q.getState().status).toBe('saved');
    q.dispose();
  });

  it('classifies storage errors', () => {
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe(true);
    expect(toStorageError({ name: 'MissingAPIError' }).kind).toBe('unavailable');
    expect(toStorageError(new Error('boom')).kind).toBe('unknown');
  });
});
