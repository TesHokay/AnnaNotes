import { expect, test } from '@playwright/test';
import { countStore, createNotebook, drawStroke, openFresh, openLibrarySection, waitSaved } from './helpers';

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

  test('restores the last viewed page separately for each notebook after reopening and reload', async ({ page }) => {
    await openFresh(page);
    await createNotebook(page, 'Первая книга');
    await expect(page.getByTestId('page-indicator')).toHaveText('1 / 1');
    await page.getByRole('button', { name: 'Добавить страницу' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('2 / 2');
    await page.getByRole('button', { name: 'Добавить страницу' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('3 / 3');
    await page.getByTestId('page-indicator').click();
    await page.getByRole('spinbutton', { name: 'Номер страницы' }).fill('2');
    await page.getByRole('button', { name: 'Перейти', exact: true }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('2 / 3');
    await page.getByTestId('back').click();

    await createNotebook(page, 'Вторая книга');
    await expect(page.getByTestId('page-indicator')).toHaveText('1 / 1');
    await page.getByRole('button', { name: 'Добавить страницу' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('2 / 2');
    await page.getByTestId('back').click();
    await page.getByTestId('notebook-item').filter({ hasText: 'Первая книга' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('2 / 3');
    await page.reload();
    await expect(page.getByTestId('page-indicator')).toHaveText('2 / 3');
    await page.getByTestId('back').click();
    await page.getByTestId('notebook-item').filter({ hasText: 'Вторая книга' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('2 / 2');

    // Scrolling updates the position, including a return to the first page.
    // Mobile WebKit's driver cannot send mouse wheel input; dispatch the canvas event directly.
    await page.getByTestId('drawing-surface').dispatchEvent('wheel', { deltaY: -2500 });
    await expect(page.getByTestId('page-indicator')).toHaveText('1 / 2');
    await page.reload();
    await expect(page.getByTestId('page-indicator')).toHaveText('1 / 2');
  });

  test('preserves the viewed page after reordering and handles deletion', async ({ page }) => {
    await openFresh(page);
    await createNotebook(page, 'Порядок страниц');
    await page.getByRole('button', { name: 'Добавить страницу' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('2 / 2');
    const panel = page.getByRole('complementary', { name: 'Страницы' });
    if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Страницы', exact: true }).click();
    await page.getByRole('button', { name: 'Действия со страницей 2', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Переместить выше' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('1 / 2');
    await page.reload();
    await expect(page.getByTestId('page-indicator')).toHaveText('1 / 2');
    if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Страницы', exact: true }).click();
    await page.getByRole('button', { name: 'Действия со страницей 1', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Удалить страницу' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('1 / 1');
    await page.reload();
    await expect(page.getByTestId('page-indicator')).toHaveText('1 / 1');
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
    // The popover overlaps the stroke while its close animation runs.
    await expect(page.getByRole('radio', { name: 'Штрих', exact: true })).toBeHidden();
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
    await openLibrarySection(page, 'Корзина');
    await page.getByRole('button', { name: 'Действия: Чистовик' }).click();
    await page.getByRole('menuitem', { name: 'Восстановить' }).click();
    await expect(page.getByTestId('notebook-item')).toHaveCount(0);
    await openLibrarySection(page, 'Все документы');
    await expect(page.getByTestId('notebook-item')).toHaveCount(1);
  });
});
