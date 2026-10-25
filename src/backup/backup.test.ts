// @vitest-environment node
import 'fake-indexeddb/auto';
import { strToU8, zipSync, unzipSync, strFromU8 } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, parseBackup, restoreBackup } from './backup';
import { BackupValidationError, validateManifest, BACKUP_FORMAT } from './format';
import { addStickerAsset, createFolder, createNotebook, listPages, putAsset, saveCover } from '@/db/repo';
import { useTestDB, makeStroke, pts } from '@/test/helpers';
import type { PencilNotesDB } from '@/db/db';
import { uuid } from '@/lib/id';
import type { ImageElement } from '@/model/types';

async function seed(db: PencilNotesDB) {
  const folder = await createFolder('Учёба', null);
  const nb = await createNotebook({ title: 'Физика', folderId: folder.id });
  const [page] = await listPages(nb.id);
  const stroke = makeStroke(pts([[0, 0], [10, 10]]), { pageId: page!.id, notebookId: nb.id });
  const asset = await putAsset(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2])], { type: 'image/png' }), 'image', 'a.png');
  await db.elements.bulkAdd([
    stroke,
    { id: uuid(), type: 'image', pageId: page!.id, notebookId: nb.id, createdAt: 0, z: 2, x: 1, y: 2, width: 30, height: 20, rotation: 0, assetId: asset.id } as ImageElement,
  ]);
  return { folder, nb, page: page!, stroke, asset };
}

describe('backup', () => {
  let db: PencilNotesDB;
  beforeEach(() => {
    db = useTestDB();
  });

  it('round-trips a library backup in merge mode with fresh ids and intact binary assets', async () => {
    const { nb, stroke, asset } = await seed(db);
    const zip = await createBackup('library');
    const parsed = parseBackup(zip);
    expect(parsed.manifest.version).toBe(2);
    const summary = await restoreBackup(parsed, 'merge');
    expect(summary).toMatchObject({ notebooks: 1, pages: 1, elements: 2, folders: 1 });
    expect(await db.notebooks.count()).toBe(2);
    expect(await db.elements.count()).toBe(4);
    const copies = (await db.notebooks.toArray()).filter((n) => n.id !== nb.id);
    expect(copies[0]!.title).toBe('Физика');
    expect(copies[0]!.folderId).not.toBeNull();
    expect(await db.elements.get(stroke.id)).toBeDefined();
    const images = (await db.elements.toArray()).filter((e) => e.type === 'image');
    const restoredImage = images.find((e) => e.type === 'image' && e.assetId !== asset.id)!;
    const restoredAsset = await db.assets.get((restoredImage as { assetId: string }).assetId);
    expect(new Uint8Array(await restoredAsset!.blob.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]));
  });

  it('replace mode restores original ids after wiping the library', async () => {
    const { nb, stroke } = await seed(db);
    const zip = await createBackup('notebook', [nb.id]);
    await createNotebook({ title: 'Другое' });
    await restoreBackup(parseBackup(zip), 'replace');
    expect(await db.notebooks.count()).toBe(1);
    expect((await db.notebooks.get(nb.id))!.title).toBe('Физика');
    expect(await db.elements.get(stroke.id)).toBeDefined();
  });

  it('rejects files that are not backups or are tampered with', async () => {
    expect(() => parseBackup(new Uint8Array([1, 2, 3]))).toThrow(BackupValidationError);
    const noManifest = zipSync({ 'x.txt': strToU8('hi') });
    expect(() => parseBackup(noManifest)).toThrow(/manifest/);

    const { nb } = await seed(db);
    const zip = await createBackup('notebook', [nb.id]);
    const files = unzipSync(zip);
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));
    manifest.elements[0].pageId = 'missing-page';
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    expect(() => parseBackup(zipSync(files))).toThrow(/отсутствующую страницу/);
  });

  it('validates structure, versions and asset paths', () => {
    const base = { format: BACKUP_FORMAT, version: 1, createdAt: 0, appVersion: 't', scope: 'library', folders: [], notebooks: [], pages: [], elements: [], assets: [] };
    expect(validateManifest(base).notebooks).toEqual([]);
    expect(() => validateManifest({ ...base, version: 99 })).toThrow(/более новой/);
    expect(() => validateManifest({ ...base, format: 'other' })).toThrow();
    expect(() => validateManifest({ ...base, assets: [{ id: 'a', kind: 'pdf', mime: 'application/pdf', file: '../../etc/passwd' }] })).toThrow(/путь/);
    expect(() => validateManifest({ ...base, elements: 'nope' })).toThrow();
  });

  it('covers (with photo and thumbnail) and imported stickers survive a library backup', async () => {
    const { nb } = await seed(db);
    const design = { background: '#f6cad8', pattern: 'hearts' as const, patternColor: '#ffffff', title: 'Физика ♡', font: 'script' as const, fontSize: 0.1, textColor: '#b8304e', textY: 0.3, align: 'center' as const, label: true, decor: ['bow' as const], accent: '#dfa3b7', photo: { scale: 1.2, x: 0.1, y: -0.2, area: 'window' as const } };
    await saveCover(nb.id, design, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }));
    await addStickerAsset({ name: 'котик', mime: 'image/png', blob: new Blob([new Uint8Array([7, 7, 7])], { type: 'image/png' }), width: 64, height: 64 });
    expect((await db.notebooks.get(nb.id))!.coverVersion).toBe(1);

    const parsed = parseBackup(await createBackup('library'));
    expect(parsed.manifest.covers).toHaveLength(1);
    expect(parsed.manifest.stickers).toHaveLength(1);
    await restoreBackup(parsed, 'replace');
    const cover = await db.covers.get(nb.id);
    expect(cover!.design.title).toBe('Физика ♡');
    expect(cover!.design.photo).toMatchObject({ scale: 1.2, area: 'window' });
    expect(new Uint8Array(await cover!.photo!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(cover!.thumb).toBeDefined();
    expect(await db.stickers.count()).toBe(1);

    // merge: the restored notebook gets a fresh id, and so does its cover
    await restoreBackup(parsed, 'merge');
    expect(await db.covers.count()).toBe(2);
    expect(await db.stickers.count()).toBe(1);
  });

  it('old v1 backups (before 4.3) still restore', async () => {
    const { nb } = await seed(db);
    const files = unzipSync(await createBackup('notebook', [nb.id]));
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));
    manifest.version = 1;
    delete manifest.covers;
    delete manifest.stickers;
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    const parsed = parseBackup(zipSync(files));
    expect(parsed.manifest.covers).toEqual([]);
    expect((await restoreBackup(parsed, 'merge')).notebooks).toBe(1);
  });

  it('deleting a notebook removes its cover; duplicating copies it', async () => {
    const { nb } = await seed(db);
    const { duplicateNotebook, deleteNotebooksPermanently } = await import('@/db/repo');
    await saveCover(nb.id, { background: '#fff', pattern: 'none', patternColor: '#000', title: 'x', font: 'serif', fontSize: 0.1, textColor: '#000', textY: 0.3, align: 'center', label: false, decor: [], accent: '#000' }, null, undefined);
    const copy = await duplicateNotebook(nb.id);
    expect(await db.covers.get(copy.id)).toBeDefined();
    await deleteNotebooksPermanently([nb.id]);
    expect(await db.covers.get(nb.id)).toBeUndefined();
    expect(await db.covers.get(copy.id)).toBeDefined();
  });
});
