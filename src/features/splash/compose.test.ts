import { composeLines, composePhrase, gaussian, splitPieces } from './compose';
import { CYRILLIC, LATIN, SECRET_LINES } from './glyphs';

const LANGS = ['ru', 'en', 'fr', 'it', 'de', 'zh', 'es'] as const;

describe('splash composition', () => {
  it.each(LANGS)('%s: one pen writes the strokes in order, then the heart', (lang) => {
    const c = composePhrase(lang);
    expect(c.strokes.length).toBeGreaterThan(3);
    const heart = c.strokes[c.strokes.length - 1]!;
    expect(heart.color).toBe('heart');
    const ink = c.strokes.filter((s) => s.color === 'ink');
    const inkStart = ink[0]!.times[0]!;
    const inkEnd = ink.at(-1)!.times.at(-1)!;
    // ~30% slower than 3.0 (which wrote in 1.4–2.3 s), never dragging
    expect(inkEnd - inkStart).toBeGreaterThanOrEqual(1800);
    expect(inkEnd - inkStart).toBeLessThanOrEqual(3600);
    expect(heart.times[0]! - inkEnd).toBeGreaterThanOrEqual(250); // a short pause before the heart
    expect(c.end).toBe(heart.times.at(-1));
    expect(c.end).toBeLessThan(4800);
    for (let i = 1; i < ink.length; i++) expect(ink[i]!.times[0]).toBeGreaterThan(ink[i - 1]!.times.at(-1)!);
  });

  it.each(LANGS)('%s: smooth geometry, smooth widths, monotonic time', (lang) => {
    const c = composePhrase(lang);
    for (const s of c.strokes) {
      expect(s.pts.length).toBe(s.widths.length);
      expect(s.pts.length).toBe(s.times.length);
      for (let i = 1; i < s.pts.length; i++) {
        // uniform arc-length sampling: no jumps in position
        expect(Math.hypot(s.pts[i]!.x - s.pts[i - 1]!.x, s.pts[i]!.y - s.pts[i - 1]!.y)).toBeLessThan(1.6);
        // width changes gradually between neighbouring samples (no steps)
        expect(Math.abs(s.widths[i]! - s.widths[i - 1]!)).toBeLessThan(0.9);
        expect(s.times[i]).toBeGreaterThan(s.times[i - 1]!);
      }
      expect(s.widths.every((w) => w > 0 && Number.isFinite(w))).toBe(true);
      // pieces cover the whole stroke without gaps
      expect(s.pieces[0]![0]).toBe(0);
      expect(s.pieces.at(-1)![1]).toBe(s.pts.length - 1);
      for (let i = 1; i < s.pieces.length; i++) expect(s.pieces[i]![0]).toBe(s.pieces[i - 1]![1]);
    }
  });

  it('pointed pen: shaded downstrokes, hairline upstrokes', () => {
    const c = composePhrase('en');
    const all = c.strokes.filter((s) => s.color === 'ink').flatMap((s) => s.widths);
    expect(Math.max(...all) / Math.min(...all)).toBeGreaterThan(4);
  });

  it('the pen slows down in curves and speeds up on straight lines', () => {
    const c = composePhrase('ru');
    const s = c.strokes.find((x) => x.pts.length > 200)!;
    const speeds: number[] = [];
    for (let i = 1; i < s.pts.length; i++) speeds.push(Math.hypot(s.pts[i]!.x - s.pts[i - 1]!.x, s.pts[i]!.y - s.pts[i - 1]!.y) / (s.times[i]! - s.times[i - 1]!));
    const sorted = [...speeds].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length * 0.9)]! / sorted[Math.floor(sorted.length * 0.1)]!).toBeGreaterThan(1.6);
  });

  it('the secret message has every glyph and is written in two lines', () => {
    for (const ch of SECRET_LINES.join('').replace(/ /g, '')) expect(LATIN[ch] ?? CYRILLIC[ch]).toBeDefined();
    const c = composeLines(SECRET_LINES, { maxWriteMs: 8000 });
    const lines = new Set(c.strokes.map((s) => Math.round(s.pts[0]!.y / 150)));
    expect(lines.size).toBeGreaterThanOrEqual(2);
    expect(c.strokes.at(-1)!.color).toBe('heart');
  });

  it('gaussian keeps constants and smooths steps', () => {
    expect(gaussian([2, 2, 2, 2, 2], 2)).toEqual([2, 2, 2, 2, 2]);
    const g = gaussian([0, 0, 0, 0, 10, 10, 10, 10], 2);
    for (let i = 1; i < g.length; i++) expect(g[i]).toBeGreaterThanOrEqual(g[i - 1]!);
    expect(g[3]! > 0 && g[4]! < 10).toBe(true);
  });

  it('splits at a reversal (hairline up, shade down the same path)', () => {
    const pts = [...Array.from({ length: 10 }, (_, i) => ({ x: 0, y: -i })), ...Array.from({ length: 10 }, (_, i) => ({ x: 0.01, y: -9 + i }))];
    expect(splitPieces(pts).length).toBeGreaterThanOrEqual(2);
  });
});
