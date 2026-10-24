import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, THEME_STORAGE_KEY } from './theme';

function mockScheme(dark: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark'), addEventListener() {}, removeEventListener() {} }));
}

describe('themes', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    localStorage.clear();
  });

  it('applies classes and persists the choice for the pre-React script', () => {
    mockScheme(false);
    applyTheme('graphite');
    const c = document.documentElement.classList;
    expect(c.contains('dark')).toBe(true);
    expect(c.contains('theme-graphite')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('graphite');
    applyTheme('warm');
    expect(c.contains('dark')).toBe(false);
    expect(c.contains('theme-graphite')).toBe(false);
    expect(c.contains('theme-warm')).toBe(true);
  });

  it('system follows the OS: pink in light mode, dark in dark mode', () => {
    mockScheme(false);
    applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    mockScheme(true);
    applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
});
