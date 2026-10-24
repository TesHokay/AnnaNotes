import { expect, test, type Page } from '@playwright/test';

async function dismissOnboarding(page: Page) {
  const skip = page.getByRole('button', { name: 'Пропустить', exact: true });
  if (await skip.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) await skip.click();
}

test('launch animation: seven launches, seven different languages, then the library', async ({ context }) => {
  const seen: string[] = [];
  for (let i = 0; i < 7; i++) {
    // A new tab is a new session (sessionStorage), sharing the shuffle bag in localStorage.
    const page = await context.newPage();
    await page.goto('/');
    const splash = page.getByTestId('splash');
    await expect(splash).toBeVisible();
    seen.push((await splash.getAttribute('data-lang'))!);
    if (i === 0) {
      // Plays to the end by itself and reveals the library.
      await expect(splash).toBeHidden({ timeout: 6000 });
      await dismissOnboarding(page);
      await expect(page.getByRole('heading', { name: 'Все документы' })).toBeVisible();
      // Reloading within the same session does not replay it.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Все документы' })).toBeVisible();
      await expect(splash).toHaveCount(0);
    } else {
      await page.getByRole('button', { name: 'Пропустить анимацию' }).click();
      await expect(splash).toBeHidden();
    }
    await page.close();
  }
  expect(new Set(seen).size).toBe(7);
});

test('launch animation can be turned off', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('annanotes-splash', 'off'));
  await page.goto('/');
  await expect(page.getByTestId('splash')).toHaveCount(0);
  await dismissOnboarding(page);
  await expect(page.getByRole('heading', { name: 'Все документы' })).toBeVisible();
});
