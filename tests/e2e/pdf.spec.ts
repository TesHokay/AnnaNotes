import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { countStore, drawStroke, openFresh, waitSaved } from './helpers';

async function makePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Lecture page ${i + 1}`, { x: 60, y: 760, size: 24, font });
    page.drawText('The quick brown fox jumps over the lazy dog.', { x: 60, y: 700, size: 14, font });
  }
  return Buffer.from(await doc.save());
}

test('import PDF → annotate → export annotated PDF', async ({ page }) => {
  await openFresh(page);
  const pdf = await makePdf();

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('new-menu').click();
  await page.getByRole('menuitem', { name: 'Импорт PDF, изображений, ZIP' }).click();
  await (await chooser).setFiles({ name: 'lecture.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'Готово' }).click();

  await expect(page.getByTestId('notebook-item')).toHaveCount(1);
  expect(await countStore(page, 'pages')).toBe(3);
  expect(await countStore(page, 'assets')).toBe(1);

  await page.getByTestId('notebook-item').click();
  await expect(page.getByTestId('page-indicator')).toHaveText('1 / 3');
  await page.getByTestId('tool-highlighter').click();
  await drawStroke(page);
  await waitSaved(page);
  expect(await countStore(page, 'elements')).toBe(1);

  // Reopen at the last viewed PDF page; the file comes from IndexedDB.
  await page.getByTestId('page-indicator').click();
  await page.getByRole('spinbutton', { name: 'Номер страницы' }).fill('3');
  await page.getByRole('button', { name: 'Перейти', exact: true }).click();
  await expect(page.getByTestId('page-indicator')).toHaveText('3 / 3');
  await page.reload();
  await expect(page.getByTestId('page-indicator')).toHaveText('3 / 3');

  const download = page.waitForEvent('download');
  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-pdf').click();
  const file = await (await download).path();
  const out = await PDFDocument.load(await readFile(file));
  expect(out.getPageCount()).toBe(3);
  expect(out.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
});
