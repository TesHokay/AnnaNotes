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

describe('splash composition', () => {
  it.each(['ru', 'en', 'fr', 'it', 'de', 'zh', 'es'] as const)('composes %s with a timeline ending in the heart', async (lang) => {
    const { composePhrase } = await import('./compose');
    const c = composePhrase(lang);
    expect(c.strokes.length).toBeGreaterThan(3);
    const heart = c.strokes[c.strokes.length - 1]!;
    expect(heart.color).toBe('heart');
    const ink = c.strokes.filter((s) => s.color === 'ink');
    const inkEnd = Math.max(...ink.map((s) => s.start + s.duration));
    expect(heart.start).toBeGreaterThan(inkEnd); // short pause, then the heart
    expect(inkEnd - 200).toBeGreaterThanOrEqual(1300);
    expect(inkEnd - 200).toBeLessThanOrEqual(2500);
    expect(c.end).toBeLessThan(3400);
    for (let i = 1; i < ink.length; i++) expect(ink[i]!.start).toBeGreaterThanOrEqual(ink[i - 1]!.start + ink[i - 1]!.duration); // one pen, strokes in order
    for (const s of c.strokes) {
      expect(s.times[0]).toBe(0);
      expect(s.times[s.times.length - 1]).toBeCloseTo(1);
      expect(s.widths.every((w) => w > 0 && Number.isFinite(w))).toBe(true);
    }
    expect(c.bbox.maxX - c.bbox.minX).toBeGreaterThan(0);
  });
});
