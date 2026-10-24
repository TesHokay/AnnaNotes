import { DrawingEngine, type EngineCallbacks } from '@/engine/DrawingEngine';
import { DocumentModel } from '@/engine/DocumentModel';
import { ImageCache } from '@/engine/imageCache';
import { toolConfigFrom, DEFAULT_TOOLS } from '@/store/settings';
import { DEFAULT_CALIBRATION } from '@/engine/pressure';
import type { Page, PageElement } from '@/model/types';

/**
 * Runs the real DrawingEngine in jsdom: a no-op 2D context, a PointerEvent polyfill and a
 * container with a fixed size. Lets us drive gestures exactly as Safari would deliver them.
 */

class PointerEventPolyfill extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  pressure: number;
  width: number;
  height: number;
  tiltX: number;
  tiltY: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, { bubbles: true, cancelable: true, ...init });
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
    this.pressure = init.pressure ?? 0;
    this.width = init.width ?? 1;
    this.height = init.height ?? 1;
    this.tiltX = init.tiltX ?? 0;
    this.tiltY = init.tiltY ?? 0;
  }
}

export function installDomStubs(): void {
  if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
    (globalThis as { PointerEvent?: unknown }).PointerEvent = PointerEventPolyfill;
  }
  const noop = () => {};
  const ctx = new Proxy(
    { canvas: null as unknown, getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), measureText: () => ({ width: 10 }), createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) },
    { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : noop), set: () => true },
  );
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    (ctx as { canvas: unknown }).canvas = this;
    return ctx as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class {
      moveTo() {}
      lineTo() {}
      quadraticCurveTo() {}
      closePath() {}
      rect() {}
      arc() {}
    };
  }
}

export function pages(n: number): Page[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    notebookId: 'nb',
    order: i + 1,
    width: 595,
    height: 842,
    size: 'A4' as const,
    template: 'blank' as const,
    paperColor: '#ffffff',
    pdf: null,
    bookmarked: 0 as const,
    createdAt: 0,
    updatedAt: 0,
  }));
}

export interface Harness {
  engine: DrawingEngine;
  surface: HTMLElement;
  model: DocumentModel;
  flush(): Promise<void>;
  down(id: number, x: number, y: number, extra?: PointerEventInit): void;
  move(id: number, x: number, y: number, extra?: PointerEventInit): void;
  up(id: number, x: number, y: number, extra?: PointerEventInit): void;
  cancel(id: number, x: number, y: number, extra?: PointerEventInit): void;
  /** One-finger vertical swipe from y0 to y1 (screen px). */
  swipe(id: number, x: number, y0: number, y1: number, steps?: number): Promise<void>;
  destroy(): void;
}

export async function createHarness(opts: { pageCount?: number; stylusOnly?: boolean; elements?: PageElement[]; width?: number; height?: number; callbacks?: EngineCallbacks } = {}): Promise<Harness> {
  installDomStubs();
  const width = opts.width ?? 800;
  const height = opts.height ?? 1000;
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} }) as DOMRect;
  document.body.appendChild(container);
  const model = new DocumentModel('nb', async () => opts.elements ?? [], { enqueue: () => {} });
  const ps = pages(opts.pageCount ?? 30);
  for (const p of ps) await model.ensureLoaded(p.id);
  const engine = new DrawingEngine(container, {
    model,
    images: new ImageCache(async () => undefined),
    pdf: { render: async () => null },
    config: toolConfigFrom({ tools: DEFAULT_TOOLS, smoothing: 0.5, calibration: DEFAULT_CALIBRATION }),
    stylusOnly: opts.stylusOnly ?? true,
    callbacks: opts.callbacks ?? {},
  });
  engine.setPages(ps);
  const surface = container.querySelector('[data-testid="drawing-surface"]') as HTMLElement;
  let t = 1000;
  const fire = (type: string, id: number, x: number, y: number, extra: PointerEventInit = {}) => {
    t += 8;
    const ev = new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, pressure: type === 'pointerup' ? 0 : 0.5, width: 24, height: 24, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, ...extra } as PointerEventInit);
    Object.defineProperty(ev, 'timeStamp', { value: t });
    surface.dispatchEvent(ev);
  };
  const flush = () => new Promise<void>((r) => setTimeout(r, 40));
  return {
    engine,
    surface,
    model,
    flush,
    down: (id, x, y, e) => fire('pointerdown', id, x, y, e),
    move: (id, x, y, e) => fire('pointermove', id, x, y, e),
    up: (id, x, y, e) => fire('pointerup', id, x, y, e),
    cancel: (id, x, y, e) => fire('pointercancel', id, x, y, e),
    async swipe(id, x, y0, y1, steps = 12) {
      fire('pointerdown', id, x, y0);
      for (let i = 1; i <= steps; i++) fire('pointermove', id, x, y0 + ((y1 - y0) * i) / steps);
      fire('pointerup', id, x, y1);
      await flush();
    },
    destroy() {
      engine.destroy();
      container.remove();
    },
  };
}
