// @vitest-environment node
import 'fake-indexeddb/auto';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDB } from '@/db/db';
import { useTestDB } from '@/test/helpers';
import { fixZipName, listZip, safeSegments } from './zip';
import { runImport, useImport } from './importQueue';

async function pdfBytes(pages = 1): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([300, 400]);
  return d.save();
}

describe('zip helpers', () => {
  it('decodes CP866 (Windows) and UTF-8-without-flag (macOS) names', () => {
    const cp866 = String.fromCharCode(...[0x8f, 0xe0, 0xa8, 0xa2, 0xa5, 0xe2]); // "Привет" in CP866, read as latin1
    expect(fixZipName(cp866)).toBe('Привет');
    const utf8 = String.fromCharCode(...new TextEncoder().encode('Тетрадь'));
    expect(fixZipName(utf8)).toBe('Тетрадь');
    expect(fixZipName('plain.pdf')).toBe('plain.pdf');
  });

  it('rejects unsafe paths and OS metadata', () => {
    expect(safeSegments('../evil.pdf')).toBeNull();
    expect(safeSegments('/abs/evil.pdf')).toBeNull();
    expect(safeSegments('C:/evil.pdf')).toBeNull();
    expect(safeSegments('__MACOSX/a/._x.pdf')).toBeNull();
    expect(safeSegments('Учёба\\Физика\\1.pdf')).toEqual(['Учёба', 'Физика', '1.pdf']);
  });
});

describe('bulk import', () => {
  beforeEach(() => {
    useTestDB();
    useImport.setState({ open: false, running: false, jobs: [], notice: null, cancelRequested: false });
  });

  it('imports a ZIP with nested folders, skips junk and duplicates', async () => {
    const pdf = await pdfBytes(2);
    const zip = zipSync({
      'Goodnotes Export/Учёба/Физика.pdf': pdf,
      'Goodnotes Export/Учёба/Математика/Алгебра.pdf': await pdfBytes(1),
      'Goodnotes Export/Дневник.pdf': await pdfBytes(3),
      '__MACOSX/Goodnotes Export/._Дневник.pdf': strToU8('junk'),
      'Goodnotes Export/readme.txt': strToU8('hi'),
    });
    expect(listZip(zip)).toHaveLength(4); // __MACOSX dropped, txt listed but not imported
    const file = new File([zip], 'Goodnotes Export.zip', { type: 'application/zip' });

    const created = await runImport([file], null);
    expect(created).toBe(3);
    const db = getDB();
    const folders = await db.folders.toArray();
    const byName = (n: string) => folders.find((f) => f.name === n)!;
    expect(byName('Goodnotes Export').parentId).toBeNull();
    expect(byName('Учёба').parentId).toBe(byName('Goodnotes Export').id);
    expect(byName('Математика').parentId).toBe(byName('Учёба').id);
    const algebra = (await db.notebooks.toArray()).find((n) => n.title === 'Алгебра')!;
    expect(algebra.folderId).toBe(byName('Математика').id);
    expect((await db.notebooks.toArray()).find((n) => n.title === 'Физика')!.pageCount).toBe(2);

    // Importing the same archive again reuses folders and skips identical documents.
    const again = await runImport([file], null);
    expect(again).toBe(0);
    expect(await db.folders.count()).toBe(folders.length);
    expect(useImport.getState().jobs.every((j) => j.status === 'skipped')).toBe(true);
  });

  it('reports per-file errors without stopping the queue', async () => {
    const good = new File([await pdfBytes(1)], 'ok.pdf', { type: 'application/pdf' });
    const bad = new File(['not a pdf'], 'broken.pdf', { type: 'application/pdf' });
    const created = await runImport([bad, good], null);
    expect(created).toBe(1);
    const jobs = useImport.getState().jobs;
    expect(jobs.find((j) => j.name === 'broken.pdf')!.status).toBe('error');
    expect(jobs.find((j) => j.name === 'ok.pdf')!.status).toBe('done');
  });

  it('native .goodnotes archives: imports embedded PDFs only and explains why', async () => {
    const zip = zipSync({ 'index.notes.pb': strToU8('x'), 'notes/abc': strToU8('protobuf'), 'attachments/lecture.pdf': await pdfBytes(1) });
    await runImport([new File([zip], 'Лекции.goodnotes')], null);
    expect(useImport.getState().notice).toMatch(/Goodnotes/);
    expect(await getDB().notebooks.count()).toBe(1);
  });

  it('can be cancelled between files', async () => {
    const files = await Promise.all([1, 2, 3].map(async (i) => new File([await pdfBytes(1)], `f${i}.pdf`)));
    const p = runImport(files, null);
    useImport.getState().cancel();
    await p;
    expect(useImport.getState().jobs.some((j) => j.message === 'Отменено')).toBe(true);
  });
});
