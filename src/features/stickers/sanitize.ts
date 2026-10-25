/**
 * Makes an untrusted SVG safe to store and render: an allow-list of drawing elements and
 * attributes, no scripts or event handlers, no external references (only in-document `#id`
 * links and embedded raster `data:` images), no `foreignObject`. Stickers are rendered through
 * <img>/canvas, where scripts never run anyway — this is defence in depth, and it also keeps
 * exported backups clean.
 */

const ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'use', 'symbol', 'title', 'desc', 'image', 'style', 'filter',
  'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feMerge', 'feMergeNode', 'feFlood', 'feComposite', 'feDropShadow',
]);

const SAFE_DATA = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]+$/i;

function safeUrlRefs(value: string): boolean {
  // url(...) may only point inside the document
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) if (!m[2]!.startsWith('#')) return false;
  return !/expression\s*\(|javascript:|@import/i.test(value);
}

export class SvgSanitizeError extends Error {}

export interface SanitizedSvg {
  svg: string;
  width: number;
  height: number;
}

export function sanitizeSvg(source: string): SanitizedSvg {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new SvgSanitizeError('Файл не является корректным SVG');

  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!ELEMENTS.has(child.localName)) {
        child.remove();
        continue;
      }
      walk(child);
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if (name === 'href' || name === 'xlink:href' || name === 'src') {
        const ok = value.startsWith('#') || (el.localName === 'image' && SAFE_DATA.test(value));
        if (!ok) el.removeAttribute(attr.name);
      } else if (!safeUrlRefs(value)) el.removeAttribute(attr.name);
    }
    if (el.localName === 'style') {
      const css = el.textContent ?? '';
      if (!safeUrlRefs(css)) el.textContent = css.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(['"]?)(?!#)[^)]*\)/gi, 'none');
    }
  };
  walk(root);

  // Intrinsic size: needed for <img> decoding (Firefox/Safari) and for the aspect ratio.
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const num = (v: string | null) => {
    const n = v ? parseFloat(v) : NaN;
    return Number.isFinite(n) && n > 0 && !/%$/.test(v ?? '') ? n : NaN;
  };
  let w = num(root.getAttribute('width'));
  let h = num(root.getAttribute('height'));
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0) {
    if (!Number.isFinite(w) && !Number.isFinite(h)) {
      const k = 512 / Math.max(vb[2]!, vb[3]!);
      w = vb[2]! * k;
      h = vb[3]! * k;
    } else if (!Number.isFinite(w)) w = (h * vb[2]!) / vb[3]!;
    else if (!Number.isFinite(h)) h = (w * vb[3]!) / vb[2]!;
  }
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    w = 512;
    h = 512;
  }
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  root.setAttribute('width', String(Math.round(w)));
  root.setAttribute('height', String(Math.round(h)));
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return { svg: new XMLSerializer().serializeToString(root), width: Math.round(w), height: Math.round(h) };
}
