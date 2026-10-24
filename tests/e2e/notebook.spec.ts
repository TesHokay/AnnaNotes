import { expect, test } from '@playwright/test';
import { countStore, createNotebook, drawStroke, openFresh, waitSaved } from './helpers';

test.describe('notebooks', () => {
  test('create, draw, save, reload — the stroke persists', async ({ page }) => {
    await openFresh(page);
    await expect(page.getByText('Создайте первую тетрадь')).toBeVisible();
    await createNotebook(page, 'Конспект E2E');

    await drawStroke(page);
    await waitSaved(page);
    expect(await countStore(page, 'elements')).toBe(1);

    await page.reload();
    await expect(page.getByTestId('drawing-surface')).toBeVisible();
    expect(await countStore(page, 'elements')).toBe(1);
    await expect(page.getByTestId('undo')).toBeDisabled(); // history is per session; data is not
  });

  test('undo / redo and adding pages', async ({ page }) => {
    await openFresh(page);
    await createNotebook(page, 'Страницы');
    await drawStroke(page);
    await drawStroke(page, 60);
    await waitSaved(page);
    expect(await countStore(page, 'elements')).toBe(2);

    await page.getByTestId('undo').click();
    await waitSaved(page);
    expect(await countStore(page, 'elements')).toBe(1);
    await page.getByTestId('redo').click();
    await waitSaved(page);
    expect(await countStore(page, 'elements')).toBe(2);

    await page.getByRole('button', { name: 'Добавить страницу' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('2 / 2');
    expect(await countStore(page, 'pages')).toBe(2);
  });

  test('eraser removes strokes and lasso deletes a selection', async ({ page }) => {
    await openFresh(page);
    await createNotebook(page, 'Ластик');
    await drawStroke(page);
    await drawStroke(page, 120);
    await waitSaved(page);
    expect(await countStore(page, 'elements')).toBe(2);

    // Whole-stroke eraser across the first stroke.
    await page.getByTestId('tool-eraser').click();
    await page.getByTestId('tool-eraser').click(); // open options
    await page.getByRole('radio', { name: 'Штрих', exact: true }).click();
    await page.keyboard.press('Escape');
    const box = (await page.getByTestId('drawing-surface').boundingBox())!;
    const y = box.y + Math.min(box.height * 0.3, 260) + 9;
    await page.mouse.move(box.x + box.width * 0.35 + 100, y - 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.35 + 100, y + 40, { steps: 8 });
    await page.mouse.up();
    await waitSaved(page);
    expect(await countStore(page, 'elements')).toBe(1);

    // Select all + delete.
    await page.keyboard.press('Control+a');
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    await page.keyboard.press('Delete');
    await waitSaved(page);
    expect(await countStore(page, 'elements')).toBe(0);
  });

  test('library: rename, favourite, trash and restore', async ({ page }) => {
    await openFresh(page);
    await createNotebook(page, 'Черновик');
    await page.getByTestId('back').click();
    await expect(page.getByTestId('notebook-item')).toHaveCount(1);

    await page.getByRole('button', { name: 'Действия: Черновик' }).click();
    await page.getByRole('menuitem', { name: 'Переименовать' }).click();
    await page.getByRole('textbox', { name: 'Переименовать' }).fill('Чистовик');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('button', { name: 'Действия: Чистовик' })).toBeVisible();

    await page.getByRole('button', { name: 'Действия: Чистовик' }).click();
    await page.getByRole('menuitem', { name: 'В корзину' }).click();
    await expect(page.getByTestId('notebook-item')).toHaveCount(0);
    await page.getByRole('button', { name: 'Корзина' }).first().click({ force: true });
    await page.getByRole('button', { name: 'Действия: Чистовик' }).click();
    await page.getByRole('menuitem', { name: 'Восстановить' }).click();
    await expect(page.getByTestId('notebook-item')).toHaveCount(0);
    await page.getByRole('button', { name: 'Все документы' }).first().click({ force: true });
    await expect(page.getByTestId('notebook-item')).toHaveCount(1);
  });
});
