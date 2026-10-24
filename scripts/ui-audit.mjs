// UI overflow audit: opens every menu/popover/dialog at iPad portrait, iPad landscape and
// iPhone sizes and reports horizontal overflow, clipped labels and content outside the screen.
// Usage: node scripts/ui-audit.mjs [baseUrl]   (default http://127.0.0.1:5173/)
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const sizes = [
  { name: 'iPad portrait', width: 820, height: 1180 },
  { name: 'iPad landscape', width: 1180, height: 820 },
  { name: 'iPhone', width: 390, height: 844 },
];

/** Runs inside the page: inspects open overlays (dialogs, popovers, menus). */
function inspect() {
  const problems = [];
  const vw = window.innerWidth;
  const roots = [...document.querySelectorAll('[role="dialog"], [data-radix-popper-content-wrapper] > *, [role="menu"]')];
  for (const root of roots) {
    const label = (root.getAttribute('aria-label') || root.querySelector('h2,h3')?.textContent || root.getAttribute('role') || 'overlay').slice(0, 40);
    const r = root.getBoundingClientRect();
    if (r.left < -1 || r.right > vw + 1) problems.push(`${label}: outside screen (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`);
    if (root.scrollWidth > root.clientWidth + 1) problems.push(`${label}: horizontal overflow ${root.scrollWidth} > ${root.clientWidth}`);
    for (const el of root.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const er = el.getBoundingClientRect();
      if (er.width === 0) continue;
      // Content wider than its own box (clipped or spilling text)
      if ((el.tagName === 'BUTTON' || el.tagName === 'SPAN' || el.tagName === 'LABEL') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.overflowX !== 'auto') {
        problems.push(`${label}: clipped "${(el.textContent || '').trim().slice(0, 30)}" (${el.scrollWidth} > ${el.clientWidth})`);
      }
      if (er.right > r.right + 1 && cs.position !== 'fixed') problems.push(`${label}: "${(el.textContent || el.tagName).trim().slice(0, 30)}" sticks out by ${Math.round(er.right - r.right)}px`);
    }
  }
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`page: horizontal scroll ${document.documentElement.scrollWidth} > ${vw}`);
  return [...new Set(problems)];
}

const b = await chromium.launch();
let total = 0;
for (const size of sizes) {
  const p = await b.newPage({ viewport: { width: size.width, height: size.height }, hasTouch: true });
  await p.goto(base);
  await p.getByRole('button', { name: 'Пропустить' }).click({ timeout: 8000 }).catch(() => {});
  const report = async (name) => {
    await p.waitForTimeout(250);
    const probs = await p.evaluate(inspect);
    total += probs.length;
    console.log(`${probs.length ? '✗' : '✓'} [${size.name}] ${name}${probs.length ? '\n    ' + probs.join('\n    ') : ''}`);
  };
  const close = async () => {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
  };
  // Library
  await p.getByTestId('new-menu').click();
  await report('Новый (меню)');
  await p.getByRole('menuitem', { name: 'Тетрадь' }).click();
  await report('Новая тетрадь');
  await p.getByRole('button', { name: 'Создать' }).click();
  await p.getByTestId('drawing-surface').waitFor();
  for (const tool of ['pen', 'highlighter', 'eraser', 'lasso', 'shape', 'text']) {
    await p.getByTestId(`tool-${tool}`).click();
    await p.getByTestId(`tool-${tool}`).click();
    await report(`Инструмент: ${tool}`);
    await close();
  }
  await p.getByTestId('export-menu').click();
  await report('Экспорт');
  await close();
  await p.getByRole('button', { name: 'Ещё' }).click();
  await report('Ещё');
  await p.getByRole('menuitem', { name: 'Шаблон и бумага' }).click();
  await report('Шаблон и бумага');
  await close();
  await p.getByRole('button', { name: 'Ещё' }).click();
  await p.getByRole('menuitem', { name: 'Настройки' }).click();
  await report('Настройки');
  await close();
  await p.close();
}
await b.close();
console.log(total ? `\n${total} problem(s)` : '\nno problems');
process.exit(total ? 1 : 0);
