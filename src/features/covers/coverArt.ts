import type { CoverDecor, CoverDesign, CoverFont, CoverPattern } from '@/model/types';

export const COVER_FONTS: Record<CoverFont, { label: string; stack: string; weight: number }> = {
  serif: { label: 'Классический', stack: '"Iowan Old Style", Palatino, "Palatino Linotype", Georgia, "Times New Roman", serif', weight: 600 },
  sans: { label: 'Современный', stack: '-apple-system, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', weight: 600 },
  rounded: { label: 'Округлый', stack: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", Nunito, -apple-system, sans-serif', weight: 700 },
  script: { label: 'Рукописный', stack: '"Snell Roundhand", "Apple Chancery", "Segoe Script", "Brush Script MT", cursive', weight: 600 },
  mono: { label: 'Печатная машинка', stack: '"American Typewriter", "Courier New", Courier, monospace', weight: 600 },
};

export const COVER_PATTERNS: { id: CoverPattern; label: string }[] = [
  { id: 'none', label: 'Без узора' },
  { id: 'dots', label: 'Горошек' },
  { id: 'stripes', label: 'Полоски' },
  { id: 'grid', label: 'Клетка' },
  { id: 'gingham', label: 'Виши' },
  { id: 'hearts', label: 'Сердечки' },
  { id: 'stars', label: 'Звёздочки' },
  { id: 'flowers', label: 'Цветочки' },
  { id: 'waves', label: 'Волны' },
  { id: 'linen', label: 'Лён' },
];

export const COVER_DECOR: { id: CoverDecor; label: string }[] = [
  { id: 'bow', label: 'Бантик' },
  { id: 'heart', label: 'Сердечко' },
  { id: 'flower', label: 'Цветочки' },
  { id: 'star', label: 'Звёздочки' },
  { id: 'frame', label: 'Тонкая рамка' },
  { id: 'corners', label: 'Уголки' },
  { id: 'gold', label: 'Золотые линии' },
];

/** Design-system accents (4.3) plus a few deeper tones for text. */
export const COVER_SWATCHES = ['#fff9f2', '#f6cad8', '#dfa3b7', '#d7c8f0', '#c4d8be', '#b8d8f2', '#f8dfa8', '#80666d', '#2d3e5c', '#3e5a4a', '#1f1d24', '#ffffff'];
export const TEXT_SWATCHES = ['#3b3638', '#80666d', '#b8304e', '#5b4630', '#2d3e5c', '#ffffff', '#d9bf7f', '#ecd9a8'];

export interface CoverPreset {
  id: string;
  collection: string;
  name: string;
  design: Omit<CoverDesign, 'title' | 'preset'>;
}

const base = { fontSize: 0.095, textY: 0.3, align: 'center' as const, label: false, decor: [] as CoverDecor[], accent: '#c9a45c' };
const P = (id: string, collection: string, name: string, d: Partial<CoverPreset['design']> & Pick<CoverDesign, 'background' | 'pattern' | 'patternColor' | 'font' | 'textColor'>): CoverPreset => ({ id, collection, name, design: { ...base, ...d } });

/** Original cover designs, grouped in seven collections. */
export const COVER_PRESETS: CoverPreset[] = [
  P('m-paper', 'Minimal', 'Бумага', { background: '#f6f3ee', pattern: 'none', patternColor: '#000000', font: 'sans', textColor: '#3b3638', textY: 0.22, align: 'left' }),
  P('m-blush', 'Minimal', 'Пудра', { background: '#f6cad8', pattern: 'none', patternColor: '#ffffff', font: 'sans', textColor: '#80666d', textY: 0.5 }),
  P('m-ink', 'Minimal', 'Чернила', { background: '#2f2c33', pattern: 'none', patternColor: '#ffffff', font: 'serif', textColor: '#fff9f2', textY: 0.5 }),
  P('p-strawberry', 'Pastel', 'Клубничное молоко', { background: '#f6cad8', pattern: 'dots', patternColor: '#ffffff', font: 'rounded', textColor: '#80666d', label: true }),
  P('p-lavender', 'Pastel', 'Лаванда', { background: '#d7c8f0', pattern: 'gingham', patternColor: '#ffffff', font: 'rounded', textColor: '#5e4d80', label: true }),
  P('p-sage', 'Pastel', 'Шалфей', { background: '#c4d8be', pattern: 'stripes', patternColor: '#ffffff', font: 'rounded', textColor: '#4b5f45', label: true }),
  P('f-sakura', 'Floral', 'Сакура', { background: '#fff1f4', pattern: 'flowers', patternColor: '#f6b6c8', font: 'serif', textColor: '#b8304e', label: true, decor: ['flower'] }),
  P('f-meadow', 'Floral', 'Луг', { background: '#e9f1df', pattern: 'flowers', patternColor: '#a8c79a', font: 'serif', textColor: '#4b5f45', label: true }),
  P('f-lilac', 'Floral', 'Сирень', { background: '#ece4f7', pattern: 'flowers', patternColor: '#c3aee6', font: 'script', textColor: '#5e4d80', label: true, decor: ['flower'] }),
  P('r-hearts', 'Romantic', 'Сердечки', { background: '#f6cad8', pattern: 'hearts', patternColor: '#ffffff', font: 'script', textColor: '#b8304e', label: true, decor: ['bow'], accent: '#dfa3b7' }),
  P('r-rose', 'Romantic', 'Роза', { background: '#dfa3b7', pattern: 'none', patternColor: '#ffffff', font: 'script', textColor: '#fff9f2', textY: 0.42, decor: ['frame', 'heart'], accent: '#fff9f2' }),
  P('r-letter', 'Romantic', 'Любовное письмо', { background: '#fff9f2', pattern: 'hearts', patternColor: '#f2b8c8', font: 'script', textColor: '#b8304e', textY: 0.4, decor: ['bow'], accent: '#dfa3b7' }),
  P('a-navy', 'Academic', 'Тёмно-синяя', { background: '#2d3e5c', pattern: 'grid', patternColor: '#ffffff', font: 'serif', textColor: '#2d3e5c', label: true, decor: ['gold'] }),
  P('a-forest', 'Academic', 'Лесная', { background: '#3e5a4a', pattern: 'linen', patternColor: '#ffffff', font: 'serif', textColor: '#3e5a4a', label: true }),
  P('a-kraft', 'Academic', 'Крафт', { background: '#c9a87c', pattern: 'linen', patternColor: '#5b4630', font: 'mono', textColor: '#5b4630', label: true }),
  P('v-cream', 'Vintage', 'Кремовая', { background: '#efe3cc', pattern: 'linen', patternColor: '#9b7b55', font: 'serif', textColor: '#5b4630', textY: 0.42, decor: ['frame', 'corners'], accent: '#9b7b55' }),
  P('v-rose', 'Vintage', 'Чайная роза', { background: '#d9b8b0', pattern: 'stripes', patternColor: '#fff9f2', font: 'serif', textColor: '#5b3a36', textY: 0.42, label: true, decor: ['corners'], accent: '#fff9f2' }),
  P('v-sea', 'Vintage', 'Морская', { background: '#b9cfcf', pattern: 'waves', patternColor: '#ffffff', font: 'mono', textColor: '#2f4f55', label: true, decor: ['frame'], accent: '#ffffff' }),
  P('d-noir', 'Dark Elegant', 'Нуар', { background: '#1f1d24', pattern: 'none', patternColor: '#ffffff', font: 'serif', textColor: '#d9bf7f', textY: 0.45, decor: ['gold', 'frame'], accent: '#c9a45c' }),
  P('d-plum', 'Dark Elegant', 'Слива', { background: '#3a2438', pattern: 'stars', patternColor: '#d9bf7f', font: 'script', textColor: '#ecd9a8', textY: 0.45, decor: ['gold'], accent: '#c9a45c' }),
  P('d-midnight', 'Dark Elegant', 'Полночь', { background: '#1d2438', pattern: 'stars', patternColor: '#c9d3f0', font: 'serif', textColor: '#e8ecf8', textY: 0.45, decor: ['frame', 'star'], accent: '#c9d3f0' }),
];

export const COVER_COLLECTIONS = [...new Set(COVER_PRESETS.map((p) => p.collection))];

export function designFromPreset(p: CoverPreset, title: string): CoverDesign {
  return { ...p.design, decor: [...p.design.decor], title, preset: p.id };
}

/** Default design for a notebook without a custom cover: the plain colour it already has. */
export function designFromColor(color: string, title: string): CoverDesign {
  return { ...base, background: color, pattern: 'none', patternColor: '#ffffff', font: 'sans', textColor: '#3b3638', title, label: true, textY: 0.24, align: 'left', fontSize: 0.075 };
}

// ---------------------------------------------------------------- drawing

type Ctx = CanvasRenderingContext2D;
export interface CoverPhoto {
  source: CanvasImageSource;
  width: number;
  height: number;
}

function heart(ctx: Ctx, cx: number, cy: number, s: number): void {
  const h = s * 0.9;
  const top = cy - h * 0.32;
  ctx.moveTo(cx, cy + h * 0.5);
  ctx.bezierCurveTo(cx - s * 0.62, cy + h * 0.05, cx - s * 0.55, top - h * 0.38, cx, top);
  ctx.bezierCurveTo(cx + s * 0.55, top - h * 0.38, cx + s * 0.62, cy + h * 0.05, cx, cy + h * 0.5);
  ctx.closePath();
}

function star(ctx: Ctx, cx: number, cy: number, r: number, points = 5, inner = 0.45): void {
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function flower(ctx: Ctx, cx: number, cy: number, r: number, rot = 0): void {
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * Math.PI * 2) / 5;
    ctx.moveTo(cx, cy);
    ctx.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.5, r * 0.32, a, 0, Math.PI * 2);
  }
}

function sparkle(ctx: Ctx, cx: number, cy: number, r: number): void {
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx, cy, cx + r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + r);
  ctx.quadraticCurveTo(cx, cy, cx - r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - r);
  ctx.closePath();
}

function drawPattern(ctx: Ctx, d: CoverDesign, w: number, h: number): void {
  if (d.pattern === 'none') return;
  const u = w / 10;
  ctx.save();
  ctx.fillStyle = d.patternColor;
  ctx.strokeStyle = d.patternColor;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  switch (d.pattern) {
    case 'dots':
      for (let y = 0, row = 0; y < h + u; y += u * 0.8, row++)
        for (let x = row % 2 ? u / 2 : 0; x < w + u; x += u) {
          ctx.moveTo(x + u * 0.12, y);
          ctx.arc(x, y, u * 0.12, 0, Math.PI * 2);
        }
      ctx.fill();
      break;
    case 'stripes':
      ctx.globalAlpha = 0.32;
      for (let x = -h; x < w; x += u * 0.9) {
        ctx.moveTo(x, h);
        ctx.lineTo(x + h, 0);
        ctx.lineTo(x + h + u * 0.35, 0);
        ctx.lineTo(x + u * 0.35, h);
        ctx.closePath();
      }
      ctx.fill();
      break;
    case 'grid':
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = Math.max(0.6, w / 400);
      for (let x = u / 2; x < w; x += u / 2) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = u / 2; y < h; y += u / 2) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      break;
    case 'gingham':
      ctx.globalAlpha = 0.3;
      for (let x = 0; x < w; x += u) ctx.rect(x, 0, u / 2, h);
      ctx.fill();
      ctx.beginPath();
      for (let y = 0; y < h; y += u) ctx.rect(0, y, w, u / 2);
      ctx.fill();
      break;
    case 'hearts':
      ctx.globalAlpha = 0.55;
      for (let y = u * 0.6, row = 0; y < h + u; y += u * 1.1, row++) for (let x = row % 2 ? u * 0.75 : u * 0.2; x < w + u; x += u * 1.1) heart(ctx, x, y, u * 0.34);
      ctx.fill();
      break;
    case 'stars':
      ctx.globalAlpha = 0.6;
      for (let y = u * 0.6, row = 0; y < h + u; y += u * 1.2, row++)
        for (let x = row % 2 ? u * 0.8 : u * 0.2; x < w + u; x += u * 1.3) {
          const k = ((row * 7 + Math.round(x)) % 3) / 3;
          if (k < 0.34) sparkle(ctx, x, y, u * 0.16);
          else star(ctx, x, y, u * (0.08 + 0.05 * k));
        }
      ctx.fill();
      break;
    case 'flowers':
      ctx.globalAlpha = 0.65;
      for (let y = u * 0.6, row = 0; y < h + u; y += u * 1.3, row++) for (let x = row % 2 ? u * 0.85 : u * 0.2; x < w + u; x += u * 1.3) flower(ctx, x, y, u * 0.28, row * 0.7);
      ctx.fill();
      break;
    case 'waves':
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(1, w / 220);
      for (let y = u * 0.5; y < h + u; y += u * 0.7) {
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += u / 2) ctx.quadraticCurveTo(x + u / 4, y + ((x / (u / 2)) % 2 ? -1 : 1) * u * 0.18, x + u / 2, y);
      }
      ctx.stroke();
      break;
    case 'linen':
      ctx.globalAlpha = 0.09;
      ctx.lineWidth = Math.max(0.5, w / 600);
      for (let x = 0; x < w; x += w / 90) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = 0; y < h; y += w / 90) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function drawPhoto(ctx: Ctx, d: CoverDesign, w: number, h: number, photo: CoverPhoto): void {
  const p = d.photo;
  if (!p) return;
  ctx.save();
  let ax = 0;
  let ay = 0;
  let aw = w;
  let ah = h;
  if (p.area === 'window') {
    ax = w * 0.16;
    ay = h * 0.42;
    aw = w * 0.72;
    ah = h * 0.44;
    ctx.beginPath();
    ctx.roundRect(ax, ay, aw, ah, w * 0.04);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = w * 0.03;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.clip();
  }
  const k = Math.max(aw / photo.width, ah / photo.height) * Math.max(1, p.scale);
  const pw = photo.width * k;
  const ph = photo.height * k;
  const x = ax + (aw - pw) / 2 + ((pw - aw) / 2) * p.x;
  const y = ay + (ah - ph) / 2 + ((ph - ah) / 2) * p.y;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo.source, x, y, pw, ph);
  ctx.restore();
}

function drawBow(ctx: Ctx, cx: number, cy: number, s: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = s * 0.03;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.bezierCurveTo(cx + dir * s * 0.3, cy - s * 0.5, cx + dir * s * 0.75, cy - s * 0.35, cx + dir * s * 0.62, cy);
    ctx.bezierCurveTo(cx + dir * s * 0.75, cy + s * 0.35, cx + dir * s * 0.3, cy + s * 0.35, cx, cy);
    ctx.fill();
    ctx.stroke();
    // tails
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + dir * s * 0.2, cy + s * 0.5, cx + dir * s * 0.38, cy + s * 0.78);
    ctx.lineTo(cx + dir * s * 0.18, cy + s * 0.72);
    ctx.quadraticCurveTo(cx + dir * s * 0.08, cy + s * 0.4, cx, cy);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * 0.13, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawDecor(ctx: Ctx, d: CoverDesign, w: number, h: number, spine: number, titleBox: { y: number; h: number }): void {
  const a = d.accent;
  ctx.save();
  if (d.decor.includes('gold')) {
    ctx.strokeStyle = '#c9a45c';
    ctx.lineWidth = Math.max(1, w * 0.006);
    for (const y of [h * 0.07, h * 0.075 + w * 0.02, h * 0.93, h * 0.925 - w * 0.02]) {
      ctx.beginPath();
      ctx.moveTo(spine + w * 0.06, y);
      ctx.lineTo(w * 0.94, y);
      ctx.stroke();
    }
  }
  if (d.decor.includes('frame')) {
    ctx.strokeStyle = a;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(1, w * 0.005);
    ctx.beginPath();
    ctx.roundRect(spine + w * 0.05, h * 0.04, w * 0.9 - spine, h * 0.92, w * 0.025);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (d.decor.includes('corners')) {
    ctx.strokeStyle = a;
    ctx.lineWidth = Math.max(1, w * 0.007);
    const m = w * 0.08;
    const L = w * 0.12;
    const corners: [number, number, number, number][] = [
      [spine + m, h * 0.06, 1, 1],
      [w - m, h * 0.06, -1, 1],
      [spine + m, h * 0.94, 1, -1],
      [w - m, h * 0.94, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * L, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * L);
      ctx.moveTo(x + sx * L * 0.5, y + sy * L * 0.18);
      ctx.quadraticCurveTo(x + sx * L * 0.18, y + sy * L * 0.18, x + sx * L * 0.18, y + sy * L * 0.5);
      ctx.stroke();
    }
  }
  if (d.decor.includes('bow')) drawBow(ctx, spine / 2 + w / 2, Math.max(h * 0.08, titleBox.y - w * 0.12), w * 0.16, a);
  if (d.decor.includes('heart')) {
    ctx.fillStyle = a;
    ctx.beginPath();
    heart(ctx, spine / 2 + w / 2, Math.min(h * 0.92, titleBox.y + titleBox.h + w * 0.08), w * 0.07);
    ctx.fill();
  }
  if (d.decor.includes('flower')) {
    const cluster: [number, number, number][] = [
      [0.82, 0.88, 0.07],
      [0.7, 0.92, 0.045],
      [0.9, 0.78, 0.04],
    ];
    for (const [x, y, r] of cluster) {
      ctx.fillStyle = '#f7c3d0';
      ctx.beginPath();
      flower(ctx, w * x, h * y, w * r, x * 3);
      ctx.fill();
      ctx.fillStyle = '#e38aa2';
      ctx.beginPath();
      ctx.arc(w * x, h * y, w * r * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (d.decor.includes('star')) {
    ctx.fillStyle = a;
    ctx.beginPath();
    sparkle(ctx, w * 0.82, h * 0.12, w * 0.04);
    sparkle(ctx, w * 0.9, h * 0.2, w * 0.022);
    sparkle(ctx, w * 0.74, h * 0.18, w * 0.016);
    ctx.fill();
  }
  ctx.restore();
}

function wrapLines(ctx: Ctx, text: string, maxW: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  // A single very long word: shrink is handled by the caller; cut as a last resort.
  return lines.map((l) => {
    if (ctx.measureText(l).width <= maxW) return l;
    let s = l;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    return `${s}…`;
  });
}

/** Draws a cover into a w×h box (3:4). Used for the live preview and the library thumbnail. */
export function drawCover(ctx: Ctx, d: CoverDesign, w: number, h: number, photo?: CoverPhoto | null): void {
  ctx.save();
  ctx.fillStyle = d.background;
  ctx.fillRect(0, 0, w, h);
  if (photo && d.photo?.area === 'full') drawPhoto(ctx, d, w, h, photo);
  drawPattern(ctx, d, w, h);
  if (photo && d.photo?.area === 'window') drawPhoto(ctx, d, w, h, photo);
  // Light from the top-left, like the default covers.
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Spine
  const spine = w * 0.09;
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(0, 0, spine, h);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(spine, 0, Math.max(1, w / 300), h);

  // Title
  const font = COVER_FONTS[d.font] ?? COVER_FONTS.sans;
  let size = Math.max(8, d.fontSize * w);
  const maxW = (w - spine) * 0.76;
  ctx.font = `${font.weight} ${size}px ${font.stack}`;
  let lines = d.title.trim() ? wrapLines(ctx, d.title, maxW, 3) : [];
  // Long single words get a smaller size instead of being cut, down to 60%.
  while (lines.some((l) => l.endsWith('…')) && size > d.fontSize * w * 0.6) {
    size *= 0.92;
    ctx.font = `${font.weight} ${size}px ${font.stack}`;
    lines = wrapLines(ctx, d.title, maxW, 3);
  }
  const lh = size * (d.font === 'script' ? 1.25 : 1.18);
  const blockH = lines.length * lh;
  const cy = Math.min(h - blockH / 2 - h * 0.05, Math.max(blockH / 2 + h * 0.05, d.textY * h));
  const top = cy - blockH / 2;
  const left = spine + (w - spine - maxW) / 2;
  const x = d.align === 'left' ? left : d.align === 'right' ? left + maxW : spine + (w - spine) / 2;
  if (lines.length && d.label) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const padX = size * 0.6;
    const padY = size * 0.42;
    const bw = Math.min(w - spine - w * 0.08, widest + padX * 2);
    const bx = d.align === 'left' ? left - padX : d.align === 'right' ? left + maxW + padX - bw : spine + (w - spine - bw) / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.shadowColor = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur = w * 0.02;
    ctx.shadowOffsetY = w * 0.004;
    ctx.beginPath();
    ctx.roundRect(bx, top - padY, bw, blockH + padY * 2, w * 0.03);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = d.textColor;
  ctx.textAlign = d.align;
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x, top + lh * (i + 0.5)));

  drawDecor(ctx, d, w, h, spine, { y: top, h: blockH });
  ctx.restore();
}
