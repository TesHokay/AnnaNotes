import type { FontFamilyKey, TextElement } from '@/model/types';

export const FONT_STACKS: Record<FontFamilyKey, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"New York", "Iowan Old Style", Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", sans-serif',
};

export const FONT_LABELS: Record<FontFamilyKey, string> = {
  system: 'Системный',
  serif: 'С засечками',
  mono: 'Моноширинный',
  rounded: 'Округлый',
};

export const LINE_HEIGHT = 1.3;
export const TEXT_PADDING = 4;

export function fontString(el: Pick<TextElement, 'fontFamily' | 'fontSize'>): string {
  return `${el.fontSize}px ${FONT_STACKS[el.fontFamily]}`;
}

type Measurer = (s: string) => number;

/** Greedy word wrap that also breaks words longer than the box. */
export function wrapText(text: string, maxWidth: number, measure: Measurer): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      lines.push('');
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (measure(candidate) <= maxWidth || line === '') {
        if (measure(candidate) > maxWidth && line === '') {
          // Hard-break a single overlong word.
          let chunk = '';
          for (const ch of word) {
            if (measure(chunk + ch) > maxWidth && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = candidate;
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function layoutText(ctx: CanvasRenderingContext2D, el: TextElement): string[] {
  ctx.font = fontString(el);
  return wrapText(el.text, Math.max(10, el.width - TEXT_PADDING * 2), (s) => ctx.measureText(s).width);
}

export function measureTextHeight(ctx: CanvasRenderingContext2D, el: TextElement): number {
  const lines = layoutText(ctx, el);
  return Math.max(1, lines.length) * el.fontSize * LINE_HEIGHT + TEXT_PADDING * 2;
}
