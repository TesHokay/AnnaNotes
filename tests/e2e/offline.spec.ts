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

test('cold start offline: a brand-new page in the same browser opens from cache', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit on Windows does not run service workers');
  await openFresh(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await createNotebook(page, 'Холодный старт');
  await drawStroke(page);
  await waitSaved(page);
  await page.close();

  // Simulates relaunching the installed app with no network: new page, deep link, offline.
  await context.setOffline(true);
  const fresh = await context.newPage();
  await fresh.goto('/');
  await expect(fresh.getByTestId('notebook-item')).toHaveCount(1);
  await fresh.goto('/index.html'); // Cloudflare redirects this URL; offline it must still work
  await expect(fresh.getByTestId('notebook-item')).toHaveCount(1);
  await fresh.goto('/#/diagnostics');
  await expect(fresh.getByText('Офлайн-запуск готов')).toBeVisible();
  await context.setOffline(false);
});

test('airplane mode: the launch animation plays offline and never blocks the app', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit on Windows does not run service workers');
  await openFresh(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    localStorage.setItem('annanotes-splash', 'on');
  });
  await page.close();
  await context.setOffline(true);
  const fresh = await context.newPage(); // new session → the animation is due again
  await fresh.goto('/');
  const splash = fresh.getByTestId('splash');
  await expect(splash).toBeVisible();
  await expect(splash).toBeHidden({ timeout: 9000 });
  await expect(fresh.getByRole('heading', { name: 'Все документы' })).toBeVisible();
  await context.setOffline(false);
});
