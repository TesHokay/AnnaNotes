/**
 * Built-in Sticker Studio stickers: original vector drawings made for this app (no third-party
 * artwork). Each sticker is a small self-contained SVG with a transparent background, generated
 * from a few parametric shapes so the set stays consistent: pastel fills, a soft darker outline
 * with round joins, and a white highlight.
 */

export type StickerCategory = 'hearts' | 'bows' | 'flowers' | 'stars' | 'butterflies' | 'study' | 'labels' | 'love' | 'seasonal';

export const STICKER_CATEGORIES: { id: StickerCategory; label: string }[] = [
  { id: 'hearts', label: 'Hearts' },
  { id: 'bows', label: 'Bows' },
  { id: 'flowers', label: 'Flowers' },
  { id: 'stars', label: 'Stars' },
  { id: 'butterflies', label: 'Butterflies' },
  { id: 'study', label: 'Study' },
  { id: 'labels', label: 'Cute Labels' },
  { id: 'love', label: 'Love Notes' },
  { id: 'seasonal', label: 'Seasonal' },
];

export interface BuiltinSticker {
  id: string;
  category: StickerCategory;
  name: string;
  /** Extra search words (Russian and English). */
  keywords: string;
  svg: string;
}

// ---------------------------------------------------------------- palette (pastel fill, outline)

const C = {
  pink: ['#f7c4d3', '#d9849f'],
  rose: ['#f2a7bd', '#c76a88'],
  red: ['#f08da5', '#b9496a'],
  lav: ['#d9ccf2', '#9a84c9'],
  sage: ['#cfe2c7', '#86a87c'],
  sky: ['#c8e0f6', '#7aa6cf'],
  butter: ['#fbe6a6', '#d1aa4c'],
  peach: ['#fbd2b8', '#d59273'],
  cocoa: ['#e6d3c8', '#80666d'],
  cream: ['#fff9f2', '#c2a98f'],
  mint: ['#c9eadf', '#6fae98'],
} as const;
type Tone = keyof typeof C;

const SW = 3.2; // outline width in a 120×120 box

const wrap = (body: string, w = 120, h = 120) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 2}" height="${h * 2}"><g stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;

const shape = (d: string, t: Tone, extra = '') => `<path d="${d}" fill="${C[t][0]}" stroke="${C[t][1]}" stroke-width="${SW}" ${extra}/>`;
const line = (d: string, color: string, w = SW) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
const shine = (d: string, o = 0.75) => `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${SW * 1.1}" opacity="${o}"/>`;
const dot = (x: number, y: number, r: number, fill: string, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
const n = (v: number) => +v.toFixed(2);

function heartD(cx: number, cy: number, s: number): string {
  const h = s * 0.9;
  const top = cy - h * 0.32;
  return `M${n(cx)} ${n(cy + h * 0.5)}C${n(cx - s * 0.62)} ${n(cy + h * 0.05)} ${n(cx - s * 0.55)} ${n(top - h * 0.38)} ${n(cx)} ${n(top)}C${n(cx + s * 0.55)} ${n(top - h * 0.38)} ${n(cx + s * 0.62)} ${n(cy + h * 0.05)} ${n(cx)} ${n(cy + h * 0.5)}Z`;
}

function starD(cx: number, cy: number, r: number, points = 5, inner = 0.48, rot = -Math.PI / 2): string {
  const p: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    p.push(`${n(cx + Math.cos(a) * rr)} ${n(cy + Math.sin(a) * rr)}`);
  }
  return `M${p.join('L')}Z`;
}

function sparkleD(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;
}

function petalsD(cx: number, cy: number, r: number, count: number, width = 0.55, rot = 0, notch = false): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = rot + (i * Math.PI * 2) / count;
    const pt = (ang: number, rad: number) => `${n(cx + Math.cos(ang) * rad)} ${n(cy + Math.sin(ang) * rad)}`;
    if (notch) parts.push(`M${pt(a, r * 0.15)}C${pt(a - width, r * 0.6)} ${pt(a - width * 0.5, r * 1.08)} ${pt(a - 0.13, r)}L${pt(a, r * 0.85)}L${pt(a + 0.13, r)}C${pt(a + width * 0.5, r * 1.08)} ${pt(a + width, r * 0.6)} ${pt(a, r * 0.15)}Z`);
    else parts.push(`M${pt(a, r * 0.15)}C${pt(a - width, r * 0.65)} ${pt(a - width * 0.45, r * 1.05)} ${pt(a, r)}C${pt(a + width * 0.45, r * 1.05)} ${pt(a + width, r * 0.65)} ${pt(a, r * 0.15)}Z`);
  }
  return parts.join('');
}

function bow(t: Tone, extra = ''): string {
  const loops = `M60 58C46 36 18 30 16 48C14 64 36 72 60 62ZM60 58C74 36 102 30 104 48C106 64 84 72 60 62Z`;
  const tails = `M56 62C50 76 42 90 34 100L46 98L50 108C56 94 60 80 62 64ZM64 62C70 76 78 90 86 100L74 98L70 108C64 94 60 80 58 64Z`;
  return shape(tails, t) + shape(loops, t) + extra + shape('M53 52Q60 48 67 52Q70 60 67 67Q60 70 53 67Q50 60 53 52Z', t) + shine('M26 46C28 40 36 40 44 44', 0.7) + shine('M84 42C90 40 96 42 98 46', 0.6);
}

function butterfly(t: Tone, spots: string): string {
  const upper = `M60 58C50 30 22 18 16 34C10 50 30 62 58 62ZM60 58C70 30 98 18 104 34C110 50 90 62 62 62Z`;
  const lower = `M58 62C40 64 26 80 32 94C38 106 54 92 60 70ZM62 62C80 64 94 80 88 94C82 106 66 92 60 70Z`;
  return shape(lower, t) + shape(upper, t) + spots + `<path d="M60 44C64 52 64 78 60 92C56 78 56 52 60 44Z" fill="${C.cocoa[1]}"/>` + line('M59 46Q52 30 46 26M61 46Q68 30 74 26', C.cocoa[1], 2.4) + dot(46, 26, 2.6, C.cocoa[1]) + dot(74, 26, 2.6, C.cocoa[1]);
}

function label(text: string, t: Tone, fontSize = 22, shapeKind: 'tag' | 'pill' | 'ribbon' | 'cloud' = 'pill'): string {
  const w = 200;
  const h = 80;
  const outline =
    shapeKind === 'tag'
      ? `M30 10H186Q194 10 194 18V62Q194 70 186 70H30L8 40Z`
      : shapeKind === 'ribbon'
        ? `M14 14H186L174 40L186 66H14L26 40Z`
        : shapeKind === 'cloud'
          ? `M40 66C22 66 12 56 16 44C10 32 22 18 38 22C44 10 64 8 74 18C86 8 108 8 116 20C128 10 152 12 158 24C176 20 192 32 186 46C192 58 178 68 162 66Z`
          : `M38 12H162Q190 12 190 40Q190 68 162 68H38Q10 68 10 40Q10 12 38 12Z`;
  const hole = shapeKind === 'tag' ? `<circle cx="30" cy="40" r="5" fill="#ffffff" stroke="${C[t][1]}" stroke-width="2.4"/>` : '';
  const tx = shapeKind === 'tag' ? 112 : 100;
  return wrap(
    `<path d="${outline}" fill="${C[t][0]}" stroke="${C[t][1]}" stroke-width="${SW}"/>${hole}<path d="M${shapeKind === 'tag' ? 40 : 30} 22H${shapeKind === 'tag' ? 70 : 60}" stroke="#fff" stroke-width="3.4" opacity="0.7" fill="none"/><text x="${tx}" y="${h / 2 + fontSize * 0.36}" text-anchor="middle" font-family="ui-rounded, 'SF Pro Rounded', -apple-system, 'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="${fontSize}" fill="${C[t][1]}">${text}</text>`,
    w,
    h,
  );
}

function flowerHead(cx: number, cy: number, r: number, t: Tone, centre: string, count = 5, notch = false, rot = 0): string {
  return shape(petalsD(cx, cy, r, count, 0.55, rot, notch), t) + dot(cx, cy, r * 0.24, centre, `stroke="${C[t][1]}" stroke-width="2.4"`);
}

const S = (id: string, category: StickerCategory, name: string, keywords: string, svg: string): BuiltinSticker => ({ id, category, name, keywords, svg });

export const BUILTIN_STICKERS: BuiltinSticker[] = [
  // ------------------------------------------------------------ hearts
  S('heart-pink', 'hearts', 'Розовое сердечко', 'heart love сердце', wrap(shape(heartD(60, 62, 92), 'pink') + shine('M30 44C30 34 40 28 48 32'))),
  S('heart-lavender', 'hearts', 'Лавандовое сердечко', 'heart love сердце', wrap(shape(heartD(60, 62, 92), 'lav') + shine('M30 44C30 34 40 28 48 32'))),
  S('heart-red', 'hearts', 'Алое сердечко', 'heart love red сердце', wrap(shape(heartD(60, 62, 92), 'red') + shine('M30 44C30 34 40 28 48 32'))),
  S('heart-sparkle', 'hearts', 'Сердечко с блеском', 'heart sparkle сердце блеск', wrap(shape(heartD(56, 66, 84), 'rose') + shine('M30 50C30 40 38 34 46 37') + shape(sparkleD(96, 26, 14), 'butter') + shape(sparkleD(104, 52, 7), 'butter'))),
  S('hearts-double', 'hearts', 'Два сердечка', 'hearts pair два сердца', wrap(shape(heartD(76, 52, 62), 'lav') + shape(heartD(46, 72, 70), 'pink') + shine('M24 62C24 54 30 50 36 52'))),
  S('heart-balloon', 'hearts', 'Сердце-шарик', 'balloon heart шарик', wrap(line('M60 92C54 100 66 106 58 116', C.cocoa[1], 2.4) + shape(heartD(60, 50, 80), 'rose') + shape('M56 92L64 92L60 86Z', 'rose') + shine('M34 36C34 28 40 24 46 26'))),
  S('heart-doodle', 'hearts', 'Сердечко-каракуля', 'heart doodle outline сердце', wrap(`<path d="${heartD(60, 62, 88)}" fill="none" stroke="${C.red[1]}" stroke-width="5"/>` + `<path d="${heartD(60, 64, 66)}" fill="none" stroke="${C.pink[1]}" stroke-width="2.6" stroke-dasharray="6 7"/>`)),

  // ------------------------------------------------------------ bows
  S('bow-pink', 'bows', 'Розовый бантик', 'bow ribbon бант', wrap(bow('pink'))),
  S('bow-lavender', 'bows', 'Лавандовый бантик', 'bow ribbon бант', wrap(bow('lav'))),
  S('bow-sage', 'bows', 'Мятный бантик', 'bow ribbon green бант', wrap(bow('sage'))),
  S('bow-dots', 'bows', 'Бантик в горошек', 'bow polka dots бант горошек', wrap(bow('rose', [dot(30, 46, 3, '#fff'), dot(40, 54, 2.6, '#fff'), dot(86, 44, 3, '#fff'), dot(96, 52, 2.6, '#fff'), dot(46, 42, 2.4, '#fff'), dot(76, 50, 2.4, '#fff')].join('')))),
  S('bow-butter', 'bows', 'Солнечный бантик', 'bow yellow бант жёлтый', wrap(bow('butter'))),

  // ------------------------------------------------------------ flowers
  S('flower-sakura', 'flowers', 'Сакура', 'sakura cherry blossom цветок', wrap(flowerHead(60, 60, 50, 'pink', '#f6e3a1', 5, true, -Math.PI / 2) + line('M60 52V44M54 56L48 50M66 56L72 50', C.rose[1], 2.2))),
  S('flower-daisy', 'flowers', 'Ромашка', 'daisy ромашка цветок', wrap(flowerHead(60, 60, 50, 'cream', C.butter[0], 10, false) + dot(60, 60, 12, C.butter[0], `stroke="${C.butter[1]}" stroke-width="2.6"`))),
  S('flower-tulip', 'flowers', 'Тюльпан', 'tulip тюльпан цветок', wrap(shape('M60 70C58 88 60 100 60 112', 'sage') + shape('M60 98C48 96 36 84 34 72C46 74 56 84 60 98Z', 'sage') + shape('M40 30C40 56 48 70 60 70C72 70 80 56 80 30L70 42L60 26L50 42Z', 'rose') + shine('M48 40C48 50 50 58 54 62', 0.6))),
  S('flower-rose', 'flowers', 'Роза', 'rose роза цветок', wrap(shape('M60 82C58 96 60 104 60 114', 'sage') + shape('M62 100C74 96 84 88 86 78C74 80 64 88 62 100Z', 'sage') + shape('M60 18C84 18 96 34 92 52C88 72 72 82 60 82C48 82 32 72 28 52C24 34 36 18 60 18Z', 'red') + line('M60 34C72 34 76 46 68 52C60 58 50 50 54 44C58 38 66 42 62 46M44 44C42 60 52 70 64 68C76 66 82 56 80 44', C.red[1], 2.6))),
  S('flower-sunflower', 'flowers', 'Подсолнух', 'sunflower подсолнух', wrap(shape(petalsD(60, 60, 52, 14, 0.32), 'butter') + dot(60, 60, 20, '#b9876a', `stroke="${C.cocoa[1]}" stroke-width="2.6"`) + [52, 60, 68].map((x) => dot(x, 56, 2, '#7b5340') + dot(x - 4, 64, 2, '#7b5340')).join(''))),
  S('flower-lavender', 'flowers', 'Веточка лаванды', 'lavender лаванда', wrap(line('M60 112C60 80 62 56 66 20', C.sage[1], 3) + [26, 36, 46, 56, 66, 76].map((y, i) => shape(`M${64 - y * 0.04} ${y}m-${4 + i * 0.4} 0a${5 + i * 0.4} ${7 + i * 0.3} ${i % 2 ? 20 : -20} 1 0 ${10 + i * 0.8} 0a${5 + i * 0.4} ${7 + i * 0.3} ${i % 2 ? 20 : -20} 1 0 -${10 + i * 0.8} 0`, 'lav')).join('') + shape('M60 96C48 92 42 84 40 76C50 78 58 86 60 96Z', 'sage'))),
  S('flower-bouquet', 'flowers', 'Букетик', 'bouquet букет цветы', wrap(line('M60 104L46 64M60 104L60 60M60 104L76 64', C.sage[1], 3) + flowerHead(44, 54, 20, 'pink', C.butter[0]) + flowerHead(76, 52, 20, 'lav', C.butter[0]) + flowerHead(60, 40, 22, 'peach', C.butter[0], 6) + shape('M42 92Q60 84 78 92L72 112H48Z', 'cream') + shape(heartD(60, 100, 12), 'rose'))),

  // ------------------------------------------------------------ stars
  S('star-yellow', 'stars', 'Звёздочка', 'star звезда', wrap(shape(starD(60, 62, 52), 'butter') + shine('M42 46L50 44'))),
  S('star-pink', 'stars', 'Розовая звезда', 'star pink звезда', wrap(shape(starD(60, 62, 52), 'pink') + shine('M42 46L50 44'))),
  S('star-sparkle', 'stars', 'Блёстка', 'sparkle shine блеск', wrap(shape(sparkleD(56, 60, 46), 'lav') + shape(sparkleD(98, 24, 12), 'butter') + shape(sparkleD(96, 96, 9), 'pink'))),
  S('star-cluster', 'stars', 'Созвездие', 'stars cluster звёзды', wrap(shape(starD(42, 70, 30), 'sky') + shape(starD(84, 40, 22), 'butter') + shape(starD(86, 90, 14), 'pink') + shape(sparkleD(30, 26, 9), 'lav'))),
  S('star-shooting', 'stars', 'Падающая звезда', 'shooting star падающая звезда', wrap(line('M14 104Q40 80 62 66', C.lav[1], 4) + line('M10 86Q34 70 56 60', C.pink[1], 3) + line('M28 112Q50 92 70 74', C.sky[1], 3) + shape(starD(78, 46, 32, 5, 0.48, -1.2), 'butter'))),
  S('moon-star', 'stars', 'Месяц и звезда', 'moon месяц луна', wrap(shape('M70 14C46 18 30 40 32 64C34 90 58 108 84 104C64 96 52 76 54 56C56 38 64 24 70 14Z', 'butter') + shape(starD(88, 46, 14), 'lav') + shape(sparkleD(96, 80, 8), 'pink'))),

  // ------------------------------------------------------------ butterflies
  S('butterfly-pink', 'butterflies', 'Розовая бабочка', 'butterfly бабочка', wrap(butterfly('pink', dot(36, 40, 6, '#ffffff', 'opacity="0.8"') + dot(84, 40, 6, '#ffffff', 'opacity="0.8"')))),
  S('butterfly-lavender', 'butterflies', 'Лавандовая бабочка', 'butterfly бабочка', wrap(butterfly('lav', dot(34, 38, 7, C.pink[0]) + dot(86, 38, 7, C.pink[0]) + dot(42, 86, 4, '#fff') + dot(78, 86, 4, '#fff')))),
  S('butterfly-sky', 'butterflies', 'Голубая бабочка', 'butterfly blue бабочка', wrap(butterfly('sky', dot(36, 40, 6, C.butter[0]) + dot(84, 40, 6, C.butter[0])))),
  S('butterfly-sage', 'butterflies', 'Мятная бабочка', 'butterfly green бабочка', wrap(butterfly('mint', dot(36, 42, 5, '#fff') + dot(84, 42, 5, '#fff') + dot(44, 88, 3.5, C.pink[0]) + dot(76, 88, 3.5, C.pink[0])))),
  S('butterfly-peach', 'butterflies', 'Персиковая бабочка', 'butterfly peach бабочка', wrap(butterfly('peach', shape(heartD(36, 42, 12), 'rose') + shape(heartD(84, 42, 12), 'rose')))),

  // ------------------------------------------------------------ study
  S('study-pencil', 'study', 'Карандаш', 'pencil карандаш', wrap(`<g transform="rotate(-40 60 60)">${shape('M30 48H86V72H30Z', 'butter')}${shape('M86 48L108 60L86 72Z', 'peach')}${`<path d="M101 56L108 60L101 64Z" fill="${C.cocoa[1]}"/>`}${shape('M18 48H30V72H18Q12 72 12 66V54Q12 48 18 48Z', 'pink')}${line('M30 60H86', C.butter[1], 2.4)}</g>`)),
  S('study-book', 'study', 'Открытая книга', 'book книга учёба', wrap(shape('M60 34C46 26 26 24 12 28V92C26 88 46 90 60 98Z', 'sky') + shape('M60 34C74 26 94 24 108 28V92C94 88 74 90 60 98Z', 'sky') + line('M22 44C32 42 42 43 50 46M22 56C32 54 42 55 50 58M70 46C78 43 88 42 98 44M70 58C78 55 88 54 98 56', C.sky[1], 2.2) + shape(heartD(84, 74, 12), 'pink'))),
  S('study-coffee', 'study', 'Кофе', 'coffee cup кофе чай', wrap(line('M86 56C102 56 102 80 84 80', C.cream[1], 6) + shape('M24 46H90L84 98Q82 106 74 106H40Q32 106 30 98Z', 'cream') + shape('M24 46H90', 'cocoa') + shape(heartD(57, 76, 22), 'pink') + line('M46 34C42 26 50 22 46 14M62 34C58 26 66 22 62 14', C.cocoa[1], 2.6))),
  S('study-apple', 'study', 'Яблоко', 'apple яблоко', wrap(shape('M60 36C42 24 16 34 18 62C20 92 42 112 60 100C78 112 100 92 102 62C104 34 78 24 60 36Z', 'red') + line('M60 36C60 28 62 20 66 14', C.cocoa[1], 3.4) + shape('M64 26C70 14 86 12 92 18C84 28 74 30 64 26Z', 'sage') + shine('M32 52C32 44 38 40 44 40'))),
  S('study-clip', 'study', 'Скрепка', 'paperclip скрепка', wrap(`<path d="M44 96V36Q44 18 60 18Q76 18 76 36V88Q76 98 66 98Q56 98 56 88V40" fill="none" stroke="${C.lav[1]}" stroke-width="8"/><path d="M44 96V36Q44 18 60 18Q76 18 76 36V88Q76 98 66 98Q56 98 56 88V40" fill="none" stroke="${C.lav[0]}" stroke-width="4"/>`)),
  S('study-cap', 'study', 'Выпускная шапочка', 'graduation cap выпускной экзамен', wrap(shape('M34 62V80Q60 96 86 80V62', 'lav') + shape('M60 30L108 50L60 70L12 50Z', 'lav') + line('M96 55V80', C.butter[1], 3) + shape(starD(96, 84, 7), 'butter'))),
  S('study-note', 'study', 'Стикер-записка', 'sticky note записка', wrap(shape('M20 20H100V82L82 100H20Z', 'butter') + shape('M82 100V82H100Z', 'peach') + line('M32 42H86M32 56H78M32 70H64', C.butter[1], 2.6) + shape(heartD(60, 20, 14), 'red'))),
  S('study-clock', 'study', 'Часики', 'clock time часы время', wrap(shape('M26 30L36 20M94 30L84 20', 'pink') + dot(60, 64, 44, C.pink[0], `stroke="${C.pink[1]}" stroke-width="${SW}"`) + dot(60, 64, 34, '#fff', `stroke="${C.pink[1]}" stroke-width="2"`) + line('M60 64V42M60 64L74 72', C.cocoa[1], 3.4) + dot(60, 64, 3.4, C.cocoa[1]))),

  // ------------------------------------------------------------ cute labels
  S('label-important', 'labels', 'Важно!', 'important важно метка', label('Важно!', 'red', 26)),
  S('label-review', 'labels', 'Повторить', 'review повторить метка', label('Повторить', 'lav', 24, 'tag')),
  S('label-exam', 'labels', 'Экзамен', 'exam экзамен метка', label('Экзамен', 'butter', 26, 'ribbon')),
  S('label-todo', 'labels', 'To do', 'todo дела метка', label('To do ♡', 'pink', 28, 'pill')),
  S('label-done', 'labels', 'Готово', 'done готово метка', label('Готово ✓', 'sage', 26, 'tag')),
  S('label-remember', 'labels', 'Не забыть', 'remember не забыть метка', label('Не забыть', 'sky', 24, 'cloud')),

  // ------------------------------------------------------------ love notes
  S('love-envelope', 'love', 'Письмо с сердечком', 'envelope letter письмо конверт', wrap(shape('M14 34H106V96H14Z', 'cream') + line('M14 34L60 70L106 34', C.cream[1], SW) + line('M14 96L48 62M106 96L72 62', C.cream[1], 2.2) + shape(heartD(60, 68, 26), 'red'))),
  S('love-note', 'love', 'Люблю тебя', 'love you люблю тебя записка', wrap(shape('M16 22H104V90H16Z', 'pink', 'transform="rotate(-4 60 56)"') + `<text x="60" y="62" text-anchor="middle" transform="rotate(-4 60 56)" font-family="'Snell Roundhand','Apple Chancery','Segoe Script',cursive" font-size="15" font-weight="600" textLength="72" lengthAdjust="spacingAndGlyphs" fill="${C.red[1]}">Люблю тебя</text>` + shape(heartD(92, 92, 22), 'red') + shape(heartD(76, 100, 12), 'rose'))),
  S('love-youme', 'love', 'Ты и я', 'you me ты и я', label('ты + я ♡', 'rose', 28, 'pill')),
  S('love-bubble', 'love', 'Облачко с сердцем', 'speech bubble облачко сообщение', wrap(shape('M24 20H96Q108 20 108 32V72Q108 84 96 84H52L32 102L36 84H24Q12 84 12 72V32Q12 20 24 20Z', 'lav') + shape(heartD(60, 54, 34), 'pink'))),
  S('love-xoxo', 'love', 'XOXO', 'xoxo hugs kisses обнимашки', label('xoxo', 'pink', 32, 'cloud')),
  S('love-lock', 'love', 'Замочек-сердце', 'lock heart замок', wrap(`<path d="M42 54V40Q42 20 60 20Q78 20 78 40V54" fill="none" stroke="${C.cocoa[1]}" stroke-width="7"/><path d="M42 54V40Q42 20 60 20Q78 20 78 40V54" fill="none" stroke="${C.cream[0]}" stroke-width="3"/>` + shape(heartD(60, 80, 70), 'red') + dot(60, 74, 5, C.red[1]) + line('M60 76V88', C.red[1], 4))),

  // ------------------------------------------------------------ seasonal
  S('season-snowflake', 'seasonal', 'Снежинка', 'snow winter снежинка зима', wrap([0, 60, 120].map((a) => `<g transform="rotate(${a} 60 60)"><path d="M60 12V108M60 26L50 18M60 26L70 18M60 94L50 102M60 94L70 102" fill="none" stroke="${C.sky[1]}" stroke-width="7"/><path d="M60 12V108M60 26L50 18M60 26L70 18M60 94L50 102M60 94L70 102" fill="none" stroke="${C.sky[0]}" stroke-width="3"/></g>`).join('') + dot(60, 60, 8, '#fff', `stroke="${C.sky[1]}" stroke-width="2.6"`))),
  S('season-leaf', 'seasonal', 'Осенний лист', 'leaf autumn осень лист', wrap(shape('M60 108C30 88 18 58 30 30C48 36 54 20 60 12C66 20 72 36 90 30C102 58 90 88 60 108Z', 'peach') + line('M60 108V30M60 60L42 44M60 76L80 58M60 90L44 78', C.peach[1], 2.4))),
  S('season-pumpkin', 'seasonal', 'Тыква', 'pumpkin тыква осень', wrap(shape('M60 34C36 30 16 46 18 70C20 96 40 104 60 100C80 104 100 96 102 70C104 46 84 30 60 34Z', 'peach') + line('M60 36C46 52 46 86 60 100M60 36C74 52 74 86 60 100', C.peach[1], 2.4) + shape('M56 36C56 26 58 18 64 14L68 18C64 22 62 28 64 36Z', 'sage') + shape(heartD(60, 70, 14), 'rose'))),
  S('season-sun', 'seasonal', 'Солнышко', 'sun summer солнце лето', wrap(shape(petalsD(60, 60, 54, 12, 0.22), 'butter') + dot(60, 60, 28, C.butter[0], `stroke="${C.butter[1]}" stroke-width="${SW}"`) + dot(50, 58, 3, C.cocoa[1]) + dot(70, 58, 3, C.cocoa[1]) + line('M52 68Q60 74 68 68', C.cocoa[1], 2.6) + dot(44, 66, 4, C.pink[0]) + dot(76, 66, 4, C.pink[0]))),
  S('season-umbrella', 'seasonal', 'Зонтик', 'umbrella rain зонт дождь осень', wrap(line('M60 50V96Q60 106 70 106Q78 106 78 98', C.cocoa[1], 4) + shape('M12 56Q14 18 60 16Q106 18 108 56Q96 48 84 56Q72 46 60 56Q48 46 36 56Q24 48 12 56Z', 'lav') + line('M60 16Q44 30 36 56M60 16Q76 30 84 56', C.lav[1], 2.2) + [[22, 84], [96, 82], [30, 104], [94, 104]].map(([x, y]) => `<path d="M${x} ${y! - 8}Q${x! + 5} ${y} ${x} ${y! + 3}Q${x! - 5} ${y} ${x} ${y! - 8}Z" fill="${C.sky[0]}" stroke="${C.sky[1]}" stroke-width="2"/>`).join(''))),
  S('season-tree', 'seasonal', 'Ёлочка', 'tree christmas новый год ёлка', wrap(shape('M60 10L86 44H74L96 74H82L104 100H16L38 74H24L46 44H34Z', 'sage') + shape('M54 100H66V112H54Z', 'cocoa') + shape(starD(60, 12, 10), 'butter') + dot(48, 62, 4, C.red[0]) + dot(72, 84, 4, C.pink[0]) + dot(64, 50, 3.4, C.butter[0]) + dot(42, 90, 3.4, C.lav[0]))),
];

export const BUILTIN_BY_ID = new Map(BUILTIN_STICKERS.map((s) => [s.id, s]));

/** SVG blob of a built-in sticker (inserted into a page as an ordinary image asset). */
export function builtinBlob(s: BuiltinSticker): Blob {
  return new Blob([s.svg], { type: 'image/svg+xml' });
}

const urlCache = new Map<string, string>();

/** Data URL for thumbnails: cached, decoded lazily by the browser. */
export function builtinUrl(s: BuiltinSticker): string {
  let u = urlCache.get(s.id);
  if (!u) {
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`;
    urlCache.set(s.id, u);
  }
  return u;
}

/** Search over names, keywords and category names (case-insensitive, ё = е). */
export function matchesSticker(s: { name: string; keywords?: string; category?: string }, query: string): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/ё/g, 'е');
  const q = norm(query.trim());
  if (!q) return true;
  const hay = norm(`${s.name} ${s.keywords ?? ''} ${s.category ?? ''}`);
  return q.split(/\s+/).every((w) => hay.includes(w));
}
