import { expect, type Page } from '@playwright/test';

export async function openFresh(page: Page): Promise<void> {
  await page.goto('/');
  const skip = page.getByRole('button', { name: 'Пропустить' });
  await skip.click({ timeout: 10_000 }).catch(() => {});
}

/** Number of records in an IndexedDB object store of the app database. */
export async function countStore(page: Page, store: string): Promise<number> {
  return page.evaluate(
    (storeName) =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('pencil-notes');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, 'readonly');
          const c = tx.objectStore(storeName).count();
          c.onsuccess = () => {
            resolve(c.result);
            db.close();
          };
          c.onerror = () => reject(c.error);
        };
      }),
    store,
  );
}

export async function createNotebook(page: Page, title: string): Promise<void> {
  await page.getByTestId('new-menu').click();
  await page.getByRole('menuitem', { name: 'Тетрадь' }).click();
  await page.getByPlaceholder('Новая тетрадь').fill(title);
  await page.getByRole('button', { name: 'Создать' }).click();
  await expect(page.getByTestId('drawing-surface')).toBeVisible();
}

/** Draws a zig-zag with the mouse in the middle of the drawing surface. */
export async function drawStroke(page: Page, offsetY = 0): Promise<void> {
  const box = (await page.getByTestId('drawing-surface').boundingBox())!;
  const x0 = box.x + box.width * 0.35;
  const y0 = box.y + Math.min(box.height * 0.3, 260) + offsetY;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(x0 + i * 10, y0 + (i % 2 ? 18 : 0), { steps: 2 });
  await page.mouse.up();
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', /saved|idle/, { timeout: 10_000 });
}
