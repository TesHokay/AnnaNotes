import { expect, test } from '@playwright/test';
import { countStore, createNotebook, drawStroke, openFresh, waitSaved } from './helpers';

test('works offline after the first visit (service worker app shell)', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit on Windows does not run service workers');
  await openFresh(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The page must be controlled by the SW before going offline.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await createNotebook(page, 'Офлайн');
  await drawStroke(page);
  await waitSaved(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('drawing-surface')).toBeVisible();
  expect(await countStore(page, 'elements')).toBe(1);

  // Navigate to the library and back, still offline.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('notebook-item')).toHaveCount(1);
  await page.getByTestId('notebook-item').click();
  await drawStroke(page, 80);
  await waitSaved(page);
  expect(await countStore(page, 'elements')).toBe(2);
  await context.setOffline(false);
});
