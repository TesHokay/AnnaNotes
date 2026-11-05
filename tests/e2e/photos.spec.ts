import { expect, test, type Page } from '@playwright/test';
import { countStore, createNotebook, drawStroke, openFresh, waitSaved } from './helpers';

interface StoredImage { id: string; type: string; assetId: string; x: number; y: number; width: number; height: number }

async function records<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate((storeName) => new Promise<T[]>((resolve, reject) => {
    const request = indexedDB.open('pencil-notes');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction(storeName).objectStore(storeName).getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  }), store);
}

async function importPhoto(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f08080'; ctx.fillRect(0, 0, 200, 300);
    ctx.fillStyle = '#6080c0'; ctx.fillRect(200, 0, 200, 300);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Вставить изображение', exact: true }).click();
  await (await picker).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await expect(page.getByTestId('image-crop-dialog')).toBeVisible();
  await expect(page.getByTestId('crop-stage').getByRole('img')).toBeVisible();
  await expect(page.getByTestId('crop-save')).toBeEnabled();
}

async function finger(page: Page, type: string, x: number, y: number) {
  await page.getByTestId('drawing-surface').dispatchEvent(type, {
    pointerId: 71, pointerType: 'touch', isPrimary: true, button: 0,
    buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, width: 20, height: 20, pressure: 0.5,
  });
}

async function hold(page: Page, x: number, y: number) {
  await finger(page, 'pointerdown', x, y);
  await expect(page.getByTestId('canvas-context-menu')).toBeVisible();
  await finger(page, 'pointerup', x, y);
}

test('crop, reselect, move, recrop, undo, cut, paste and reload a photo', async ({ page, browserName }) => {
  await openFresh(page);
  await createNotebook(page, 'Фото и долгое нажатие');
  // WebKit for Windows can reject every IndexedDB Blob, including a plain new Blob.
  // Probe the browser capability so this still runs on Safari and on fixed runtimes.
  if (browserName === 'webkit' && process.platform === 'win32') {
    const supportsBlob = await page.evaluate(() => new Promise<boolean>((resolve) => {
      const request = indexedDB.open('photo-blob-probe', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('probe');
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('probe', 'readwrite');
        tx.objectStore('probe').put(new Blob(['probe']), 'probe');
        const finish = (ok: boolean) => { db.close(); indexedDB.deleteDatabase('photo-blob-probe'); resolve(ok); };
        tx.oncomplete = () => finish(true);
        tx.onabort = () => finish(false);
        tx.onerror = () => {};
      };
    }));
    test.skip(!supportsBlob, 'This Windows WebKit runtime cannot store any Blob in IndexedDB');
  }
  await importPhoto(page);
  await page.getByRole('button', { name: 'Верхний левый угол', exact: true }).hover();
  const stage = (await page.getByTestId('crop-stage').boundingBox())!;
  const handle = (await page.getByRole('button', { name: 'Верхний левый угол', exact: true }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + stage.width * 0.2, handle.y + handle.height / 2 + stage.height * 0.2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('image-crop-dialog')).toContainText('320 × 240 пикс.');
  await page.getByTestId('crop-save').click();
  await expect(page.getByTestId('image-crop-dialog')).toHaveCount(0);
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  await waitSaved(page);
  const initial = (await records<StoredImage>(page, 'elements'))[0]!;
  const assets = await records<{ id: string; width: number; height: number }>(page, 'assets');
  const asset = assets.find((a) => a.id === initial.assetId)!;
  expect(asset.width).toBeGreaterThan(250);
  expect(asset.width).toBeLessThan(360);
  expect(asset.height).toBeLessThan(280);

  await page.getByTestId('tool-pen').click();
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  const surface = (await page.getByTestId('drawing-surface').boundingBox())!;
  const center = { x: surface.x + surface.width / 2, y: surface.y + surface.height / 2 };
  await hold(page, center.x, center.y);
  await expect(page.getByRole('menuitem', { name: 'Обрезать фото', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Переместить', exact: true }).click();
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  await finger(page, 'pointerdown', center.x, center.y);
  await finger(page, 'pointermove', center.x + 60, center.y + 40);
  await finger(page, 'pointerup', center.x + 60, center.y + 40);
  await waitSaved(page);
  const moved = (await records<StoredImage>(page, 'elements'))[0]!;
  expect(moved.x).toBeGreaterThan(initial.x + 10);
  expect(moved.y).toBeGreaterThan(initial.y + 10);
  expect(moved.assetId).toBe(initial.assetId);

  await page.getByRole('button', { name: 'Обрезать фото', exact: true }).click();
  await expect(page.getByTestId('crop-save')).toBeEnabled();
  await page.getByRole('button', { name: 'Верхний левый угол', exact: true }).focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.getByTestId('crop-save').click();
  await expect(page.getByTestId('image-crop-dialog')).toHaveCount(0);
  await waitSaved(page);
  const cropped = (await records<StoredImage>(page, 'elements'))[0]!;
  expect(cropped.assetId).not.toBe(moved.assetId);
  expect(cropped.width).toBeLessThan(moved.width);
  await page.getByTestId('undo').click();
  await waitSaved(page);
  expect((await records<StoredImage>(page, 'elements'))[0]!.assetId).toBe(moved.assetId);
  await page.getByTestId('redo').click();
  await waitSaved(page);

  await hold(page, center.x + 60, center.y + 40);
  await page.getByRole('menuitem', { name: 'Вырезать', exact: true }).click();
  await waitSaved(page);
  expect(await countStore(page, 'elements')).toBe(0);
  await hold(page, surface.x + surface.width * 0.3, surface.y + surface.height * 0.2);
  await page.getByRole('menuitem', { name: 'Вставить', exact: true }).click();
  await waitSaved(page);
  expect(await countStore(page, 'elements')).toBe(1);
  const pasted = (await records<StoredImage>(page, 'elements'))[0]!;
  expect(pasted.assetId).toBe(cropped.assetId);
  expect(pasted.id).not.toBe(cropped.id);
  await page.reload();
  await expect(page.getByTestId('drawing-surface')).toBeVisible();
  expect((await records<StoredImage>(page, 'elements'))[0]).toEqual(pasted);
});

test('cancelled import creates no photo; a page hold copies and pastes page contents', async ({ page }) => {
  await openFresh(page);
  await createNotebook(page, 'Меню страницы');
  await importPhoto(page);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByTestId('image-crop-dialog')).toHaveCount(0);
  expect(await countStore(page, 'elements')).toBe(0);
  expect(await countStore(page, 'assets')).toBe(0);
  await drawStroke(page);
  await waitSaved(page);
  const surface = (await page.getByTestId('drawing-surface').boundingBox())!;
  const point = { x: surface.x + surface.width * 0.25, y: surface.y + surface.height * 0.7 };
  await hold(page, point.x, point.y);
  await page.getByRole('menuitem', { name: 'Копировать содержимое страницы', exact: true }).click();
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  await hold(page, point.x, point.y);
  await page.getByRole('menuitem', { name: 'Вставить', exact: true }).click();
  await waitSaved(page);
  expect(await countStore(page, 'elements')).toBe(2);
});
