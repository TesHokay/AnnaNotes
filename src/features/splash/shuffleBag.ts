export const SPLASH_LANGS = ['ru', 'en', 'fr', 'it', 'de', 'zh', 'es'] as const;
export type SplashLang = (typeof SPLASH_LANGS)[number];

const BAG_KEY = 'annanotes-splash-bag';
const SESSION_KEY = 'annanotes-splash-shown';
export const SPLASH_ENABLED_KEY = 'annanotes-splash';

interface Bag {
  queue: SplashLang[];
  last: SplashLang | null;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Shuffle bag: every language is shown once per cycle of seven, in random order. A new cycle
 * never starts with the language that ended the previous one, so no language repeats twice in
 * a row even across cycles.
 */
export function nextLanguage(storage: Pick<Storage, 'getItem' | 'setItem'>, random: () => number = Math.random): SplashLang {
  let bag: Bag = { queue: [], last: null };
  try {
    const raw = storage.getItem(BAG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Bag;
      if (Array.isArray(parsed.queue)) bag = { queue: parsed.queue.filter((l): l is SplashLang => (SPLASH_LANGS as readonly string[]).includes(l)), last: parsed.last ?? null };
    }
  } catch {
    /* corrupted → start a new bag */
  }
  if (bag.queue.length === 0) {
    let q = shuffle(SPLASH_LANGS, random);
    if (q[0] === bag.last) q = [...q.slice(1), q[0]!];
    bag.queue = q;
  }
  const lang = bag.queue.shift()!;
  bag.last = lang;
  try {
    storage.setItem(BAG_KEY, JSON.stringify(bag));
  } catch {
    /* private mode: still works for this launch */
  }
  return lang;
}

/** True once per app session (a new launch of the PWA / tab), never on in-app navigation. */
export function claimSplashForSession(session: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  try {
    if (session.getItem(SESSION_KEY)) return false;
    session.setItem(SESSION_KEY, '1');
    return true;
  } catch {
    return true;
  }
}

export function isSplashEnabled(): boolean {
  try {
    return localStorage.getItem(SPLASH_ENABLED_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSplashEnabled(on: boolean): void {
  try {
    localStorage.setItem(SPLASH_ENABLED_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}
