import { expect, test, type Page } from '@playwright/test';
import { createNotebook, openFresh, waitSaved } from './helpers';

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/cozy/${name}.png` });

/** Elements of the app database, read straight from IndexedDB. */
function readElements(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ type: string; sticker?: string; flipX?: boolean }[]>((resolve, reject) => {
        const req = indexedDB.open('pencil-notes');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const all = req.result.transaction('elements', 'readonly').objectStore('elements').getAll();
          all.onsuccess = () => {
            resolve(all.result);
            req.result.close();
          };
        };
      }),
  );
}

test.setTimeout(120_000);

test('Cute Paper, stickers, cover and the secret message work end to end (offline-capable build)', async ({ page }) => {
  await openFresh(page);
  await createNotebook(page, 'Учёба');

  // Cute Paper on the whole notebook
  await page.getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('menuitem', { name: 'Шаблон и бумага' }).click();
  await page.getByTestId('cute-paper').getByRole('button', { name: 'Cherry Blossom' }).click();
  await page.getByRole('radio', { name: 'Все страницы' }).click();
  await shot(page, '1-page-settings');
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Stickers: insert, auto-selected, flip; undo/redo
  await page.getByTestId('tool-stickers').click();
  await expect(page.getByTestId('sticker-studio')).toBeVisible();
  await page.getByRole('tab', { name: 'Flowers' }).click();
  await shot(page, '2-sticker-studio');
  await page.getByRole('button', { name: 'Вставить: Сакура' }).click();
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  await page.getByRole('button', { name: 'Отразить по горизонтали' }).first().click();
  await page.getByTestId('tool-stickers').click();
  await page.getByRole('tab', { name: 'Cute Labels' }).click();
  await page.getByRole('button', { name: 'Вставить: Важно!' }).click();
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  await shot(page, '3-stickers-on-page');
  await page.getByTestId('undo').click();
  await page.getByTestId('redo').click();
  await waitSaved(page);

  await page.reload();
  await expect(page.getByTestId('drawing-surface')).toBeVisible();
  const els = await readElements(page);
  const stickers = els.filter((e) => e.type === 'image' && e.sticker);
  expect(stickers.map((s) => s.sticker).sort()).toEqual(['builtin:flower-sakura', 'builtin:label-important']);
  expect(stickers.find((s) => s.sticker === 'builtin:flower-sakura')!.flipX).toBe(true);

  // PDF export with decorative paper and stickers
  const download = page.waitForEvent('download');
  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-pdf').click();
  const file = await download;
  const path = await file.path();
  expect(path).toBeTruthy();

  // Cover
  await page.getByTestId('back').click();
  await page.getByRole('button', { name: 'Действия: Учёба' }).click();
  await page.getByRole('menuitem', { name: 'Обложка…' }).click();
  await page.getByRole('button', { name: 'Romantic' }).click();
  await page.getByRole('button', { name: 'Сердечки' }).first().click();
  await page.getByLabel('Название на обложке').fill('Учёба ♡');
  await shot(page, '4-cover-editor');
  await page.getByTestId('cover-save').click();
  await expect(page.getByTestId('custom-cover')).toBeVisible();
  await shot(page, '5-library-cover');
  await page.reload();
  await expect(page.getByTestId('custom-cover')).toBeVisible();

  // Secret message: four taps do nothing, five open it
  await page.getByRole('button', { name: 'Настройки' }).click();
  const heart = page.getByTestId('about-heart');
  await heart.scrollIntoViewIfNeeded();
  for (let i = 0; i < 4; i++) await heart.click();
  await page.waitForTimeout(1700);
  await expect(page.getByTestId('secret-message')).toHaveCount(0);
  for (let i = 0; i < 5; i++) await heart.click();
  await expect(page.getByTestId('secret-message')).toBeVisible();
  await expect(page.getByText('В каждой строчке — немного моей любви')).toBeVisible();
  await page.waitForTimeout(9000);
  await shot(page, '6-secret');
  await page.getByTestId('secret-message').getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.getByTestId('secret-message')).toHaveCount(0);
});
