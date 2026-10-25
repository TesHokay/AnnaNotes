import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '@/test/engineHarness';
import type { ImageElement, PageElement } from '@/model/types';
import { BUILTIN_STICKERS, matchesSticker, STICKER_CATEGORIES } from './library';
import { sanitizeSvg } from './sanitize';

let h: Harness | null = null;
afterEach(() => {
  h?.destroy();
  h = null;
});

describe('sticker library', () => {
  it('has at least 50 original stickers in every category, all valid SVG', () => {
    expect(BUILTIN_STICKERS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(BUILTIN_STICKERS.map((s) => s.id)).size).toBe(BUILTIN_STICKERS.length);
    for (const c of STICKER_CATEGORIES) expect(BUILTIN_STICKERS.filter((s) => s.category === c.id).length, c.id).toBeGreaterThanOrEqual(5);
    for (const s of BUILTIN_STICKERS) {
      const doc = new DOMParser().parseFromString(s.svg, 'image/svg+xml');
      expect(doc.getElementsByTagName('parsererror').length, s.id).toBe(0);
      expect(doc.documentElement.getAttribute('width'), s.id).toBeTruthy();
      // self-contained: no external references besides the SVG namespace
      expect(s.svg.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:|href=/);
    }
  });

  it('search matches names, keywords and categories, ignoring case and ё', () => {
    const find = (q: string) => BUILTIN_STICKERS.filter((s) => matchesSticker({ ...s }, q)).map((s) => s.id);
    expect(find('сердце')).toContain('heart-pink');
    expect(find('BOW')).toContain('bow-pink');
    expect(find('ёлка')).toContain('season-tree');
    expect(find('')).toHaveLength(BUILTIN_STICKERS.length);
  });
});

describe('SVG sanitising for imported stickers', () => {
  it('removes scripts, handlers, foreignObject and external references', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50" onload="alert(1)">
      <script>alert(2)</script>
      <foreignObject><div>x</div></foreignObject>
      <style>@import url(https://evil.example/x.css); .a{fill:url(https://evil.example/p)}</style>
      <image href="https://evil.example/t.png" width="10" height="10"/>
      <use xlink:href="#ok"/>
      <path id="ok" d="M0 0L10 10" fill="url(#grad)" onclick="x()"/>
      <a href="javascript:alert(3)"><path d="M1 1"/></a>
    </svg>`;
    const { svg, width, height } = sanitizeSvg(dirty);
    expect(svg).not.toMatch(/script|onload|onclick|foreignObject|evil\.example|javascript:|@import/i);
    expect(svg).toContain('url(#grad)');
    expect(svg).toContain('#ok');
    expect(width / height).toBeCloseTo(2);
  });

  it('rejects non-SVG input', () => {
    expect(() => sanitizeSvg('<html><body>no</body></html>')).toThrow();
    expect(() => sanitizeSvg('not xml at all <')).toThrow();
  });
});

describe('stickers on the page (real engine)', () => {
  it('insert → auto-selected; flip, opacity, duplicate, reorder, delete; all undoable', async () => {
    h = await createHarness({ pageCount: 2 });
    const e = h.engine;
    const pageId = e.currentPageId()!;
    const els = () => (h!.model.getElements(pageId) ?? []) as PageElement[];
    const sticker = () => els().find((x): x is ImageElement => x.type === 'image' && !!x.sticker)!;

    e.insertImage('asset-1', 240, 240, { maxSide: 96, extra: { sticker: 'builtin:heart-pink' } });
    expect(sticker().width).toBeCloseTo(96);
    expect(sticker().sticker).toBe('builtin:heart-pink');
    expect(e.hasSelection).toBe(true);

    e.updateSelectedImages({ flipX: true });
    expect(sticker().flipX).toBe(true);
    e.updateSelectedImages({ opacity: 0.6 });
    e.updateSelectedImages({ opacity: 0.4 });
    expect(sticker().opacity).toBe(0.4);

    e.duplicateSelection();
    expect(els().filter((x) => x.type === 'image')).toHaveLength(2);
    const copy = els().filter((x): x is ImageElement => x.type === 'image').at(-1)!;
    expect(copy.flipX).toBe(true);
    expect(copy.sticker).toBe('builtin:heart-pink');
    e.arrangeSelection('back');

    e.undo(); // arrange
    e.undo(); // duplicate
    expect(els().filter((x) => x.type === 'image')).toHaveLength(1);
    e.undo(); // both opacity changes merged into one step
    expect(sticker().opacity ?? 1).toBe(1);
    e.undo(); // flip
    expect(sticker().flipX).toBeFalsy();
    e.undo(); // insert
    expect(els().filter((x) => x.type === 'image')).toHaveLength(0);
    e.redo();
    expect(sticker()).toBeDefined();
  });
});
