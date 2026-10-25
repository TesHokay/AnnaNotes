import { describe, expect, it } from 'vitest';
import { claimSplashForSession, nextLanguage, SPLASH_LANGS } from './shuffleBag';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('splash language shuffle bag', () => {
  it('shows all seven languages once per cycle, in random order', () => {
    const s = memoryStorage();
    const seen = Array.from({ length: 7 }, () => nextLanguage(s));
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...SPLASH_LANGS].sort());
  });

  it('never repeats a language on consecutive launches, including across cycles', () => {
    const s = memoryStorage();
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let prev = '';
    for (let i = 0; i < 7 * 50; i++) {
      const l = nextLanguage(s, rnd);
      expect(l).not.toBe(prev);
      prev = l;
    }
  });

  it('survives corrupted storage', () => {
    const s = memoryStorage();
    s.setItem('annanotes-splash-bag', '{not json');
    expect(SPLASH_LANGS).toContain(nextLanguage(s));
  });

  it('plays once per session', () => {
    const session = memoryStorage();
    expect(claimSplashForSession(session)).toBe(true);
    expect(claimSplashForSession(session)).toBe(false);
  });
});
