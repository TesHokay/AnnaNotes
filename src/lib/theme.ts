export type ThemeId = 'system' | 'pink' | 'light' | 'dark' | 'warm' | 'graphite';

export const THEMES: { id: ThemeId; label: string; swatch: [string, string] }[] = [
  { id: 'system', label: 'Системная', swatch: ['#fcf1f5', '#161013'] },
  { id: 'pink', label: 'Розовая', swatch: ['#fcf1f5', '#e46a96'] },
  { id: 'light', label: 'Светлая', swatch: ['#f2f2f7', '#0a84ff'] },
  { id: 'dark', label: 'Тёмная', swatch: ['#161013', '#f08cb3'] },
  { id: 'warm', label: 'Тёплая бумага', swatch: ['#f5efe3', '#c8623a'] },
  { id: 'graphite', label: 'Графит', swatch: ['#1b1d20', '#58b4e0'] },
];

export const THEME_STORAGE_KEY = 'annanotes-theme';

/** Resolves the theme to CSS classes on <html>. Also used by the inline pre-React script. */
export function applyTheme(theme: ThemeId): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const id = theme === 'system' ? (prefersDark ? 'dark' : 'pink') : theme;
  const root = document.documentElement;
  root.classList.toggle('dark', id === 'dark' || id === 'graphite');
  root.classList.toggle('theme-light', id === 'light');
  root.classList.toggle('theme-warm', id === 'warm');
  root.classList.toggle('theme-graphite', id === 'graphite');
  const bg = getComputedStyle(root).getPropertyValue('--background').trim();
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  if (bg) meta.content = `hsl(${bg})`;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
}
