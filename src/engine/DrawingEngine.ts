import { uuid } from '@/lib/id';
import type { BBox, Page, PageElement, ShapeElement, TextElement, UUID } from '@/model/types';
import { BoxResizeAction, drawOrientedFrame, hitBoxHandles, isBoxElement, type BoxElement } from './boxEdit';

function pickShapeStyle(e: ShapeElement): NonNullable<SelectionInfo['shape']> {
  return { kind: e.kind, stroke: e.stroke, fill: e.fill, strokeWidth: e.strokeWidth, opacity: e.opacity, cornerRadius: e.cornerRadius };
}
import { nextZ, type DocumentModel, type ModelChange } from './DocumentModel';
import { bboxContains, bboxInflate, bboxIntersects, elementBBox, isEmptyBBox, translation, type Vec } from './geometry';
import type { ImageCache } from './imageCache';
import type { TextRun } from '@/pdf/textLayer';
import { drawElements, drawStroke, drawTemplate } from './renderer';
import { measureTextHeight } from './text';
import {
  drawEraserCursor,
  drawSelectionFrame,
  EraserAction,
  hitSelectionHandle,
  hitTestElement,
  InkAction,
  LassoAction,
  selectionBBox,
  ShapeAction,
  transformElement,
  TransformAction,
  type Action,
  type Sample,
  type Selection,
  type ToolConfig,
  type ToolContext,
} from './tools';
import { capResolution, computeLayout, resolutionBucket, slotAt, visibleSlots, Viewport, type Layout, type PageSlot } from './viewport';

export interface SelectionInfo {
  pageId: UUID;
  count: number;
  /** CSS pixels relative to the engine container */
  screenRect: { x: number; y: number; width: number; height: number };
  hasStrokes: boolean;
  hasText: boolean;
  /** Style of the selected vector shapes (present when the selection contains only shapes). */
  shape?: Pick<ShapeElement, 'kind' | 'stroke' | 'fill' | 'strokeWidth' | 'opacity' | 'cornerRadius'>;
}

export type ShapeStylePatch = Partial<Pick<ShapeElement, 'stroke' | 'fill' | 'strokeWidth' | 'opacity' | 'cornerRadius'>>;

export interface TextEditRequest {
  element: TextElement;
  isNew: boolean;
}

export interface ViewInfo {
  scale: number;
  pageIndex: number;
  pageCount: number;
}

export interface EngineCallbacks {
  onViewChange?(v: ViewInfo): void;
  onSelectionChange?(s: SelectionInfo | null): void;
  onHistoryChange?(h: { canUndo: boolean; canRedo: boolean }): void;
  onTextEdit?(req: TextEditRequest | null): void;
  onContentChange?(pageId: UUID): void;
  onInteractionChange?(active: boolean): void;
  onError?(message: string): void;
}

export interface PdfRasterizer {
  /** Renders `region` (page coords) of a PDF-backed page at `res` pixels per document unit. */
  render(page: Page, res: number, region: BBox, signal: AbortSignal): Promise<HTMLCanvasElement | null>;
}

export interface EngineOptions {
  model: DocumentModel;
  images: ImageCache;
  pdf: PdfRasterizer;
  config: ToolConfig;
  callbacks: EngineCallbacks;
  stylusOnly: boolean;
  /** Synchronous lookup of cached PDF text runs; may start loading and return null. */
  textRuns?(page: Page): readonly TextRun[] | null;
}

interface Bitmap {
  canvas: HTMLCanvasElement;
  res: number;
  region: BBox;
}

interface PageCache {
  content: Bitmap | null;
  dirty: boolean;
  bg: Bitmap | null;
  bgKey: string | null;
  bgCtrl: AbortController | null;
}

interface PointerInfo {
  type: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  t: number;
}

type Gesture =
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number; samples: { t: number; x: number; y: number }[] }
  | { kind: 'pinch'; a: number; b: number; startDist: number; startMid: Vec; start: { scale: number; tx: number; ty: number } };

/** Max pixels of one cached page bitmap; keeps iPad Safari well under its canvas memory limits. */
const MAX_BITMAP_PIXELS = 6_000_000;
/** Total pixel budget for all cached page bitmaps (~4 bytes each). */
const MAX_CACHE_PIXELS = 36_000_000;
const PREFETCH_PAGES = 2;
const MAX_DPR = 2;

let clipboard: PageElement[] = [];

/**
 * Release velocity (px/ms) from the last ~100 ms of a pan, using event timestamps. Returns null
 * when the finger had stopped before lifting. Capped so a burst of events can never cause a
 * runaway fling.
 */
export function flingVelocity(samples: readonly { t: number; x: number; y: number }[], endT: number): { vx: number; vy: number } | null {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1]!;
  if (endT - last.t > 60) return null;
  let first = samples[0]!;
  for (const smp of samples) {
    if (last.t - smp.t <= 100) {
      first = smp;
      break;
    }
  }
  const dt = last.t - first.t;
  if (dt < 16) return null;
  const MAX = 3.5;
  let vx = (last.x - first.x) / dt;
  let vy = (last.y - first.y) / dt;
  const speed = Math.hypot(vx, vy);
  if (speed > MAX) {
    vx *= MAX / speed;
    vy *= MAX / speed;
  }
  return { vx, vy };
}

export interface PerfStats {
  frameMs: number;
  bitmapRenders: number;
  overlayMs: number;
  inputEvents: number;
  coalesced: boolean;
  predicted: boolean;
  cachedPages: number;
}

export type GestureState = 'IDLE' | 'DRAWING' | 'PANNING' | 'PINCHING' | 'SELECTING' | 'ERASING';

/**
 * The drawing engine owns the canvases, input handling, viewport and rendering. It is plain
 * TypeScript: React mounts it into a container and talks to it through methods and callbacks,
 * so no React state is touched on the drawing hot path.
 */
export class DrawingEngine {
  readonly viewport = new Viewport();
  private readonly main: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly mctx: CanvasRenderingContext2D;
  private readonly octx: CanvasRenderingContext2D;
  private dpr = 1;
  private rect: DOMRect | null = null;

  private model: DocumentModel;
  private readonly images: ImageCache;
  private readonly pdf: PdfRasterizer;
  private config: ToolConfig;
  private callbacks: EngineCallbacks;
  private stylusOnly: boolean;
  private readonly textRunsFn: EngineOptions['textRuns'];

  private pages: Page[] = [];
  private pageById = new Map<UUID, Page>();
  private layout: Layout = { slots: [], width: 0, height: 0 };
  private caches = new Map<UUID, PageCache>();
  private initialized = false;

  private selection: Selection | null = null;
  private hidden: { pageId: UUID; ids: ReadonlySet<UUID> } | null = null;
  private editingText: { element: TextElement; isNew: boolean } | null = null;

  private action: { a: Action; pointerId: number; pointerType: string; startedAt: number } | null = null;
  private textTap: { pointerId: number; pageId: UUID; local: Vec; screen: Vec } | null = null;
  private pointers = new Map<number, PointerInfo>();
  private gesture: Gesture | null = null;
  private tapCandidate: { start: number; maxTouches: number; moved: boolean } | null = null;
  private lastPenUp = 0;
  private hover: { x: number; y: number } | null = null;
  private spacePan = false;
  private interacting = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private inertia: { vx: number; vy: number; last: number } | null = null;

  private frameId = 0;
  private needsMain = false;
  private needsOverlay = false;
  private lastView: ViewInfo | null = null;
  private lastSelectionKey = '';
  private canvasColor = '#e9e9ee';
  private readonly disposers: (() => void)[] = [];
  private readonly frameListeners = new Set<() => void>();
  private resizeObserver: ResizeObserver | null = null;
  readonly perf: PerfStats = { frameMs: 0, bitmapRenders: 0, overlayMs: 0, inputEvents: 0, coalesced: false, predicted: false, cachedPages: 0 };

  constructor(
    private readonly container: HTMLElement,
    opts: EngineOptions,
  ) {
    this.model = opts.model;
    this.images = opts.images;
    this.pdf = opts.pdf;
    this.config = opts.config;
    this.callbacks = opts.callbacks;
    this.stylusOnly = opts.stylusOnly;
    this.textRunsFn = opts.textRuns;

    this.main = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    for (const c of [this.main, this.overlay]) {
      c.style.position = 'absolute';
      c.style.inset = '0';
      c.style.width = '100%';
      c.style.height = '100%';
      c.style.touchAction = 'none';
      container.appendChild(c);
    }
    this.overlay.setAttribute('data-testid', 'drawing-surface');
    const mctx = this.main.getContext('2d', { alpha: false });
    const octx = this.overlay.getContext('2d');
    if (!mctx || !octx) throw new Error('Canvas 2D недоступен в этом браузере');
    this.mctx = mctx;
    this.octx = octx;

    this.bindEvents();
    this.disposers.push(this.model.subscribe((c) => this.onModelChange(c)));
    this.disposers.push(this.images.onLoad(() => this.invalidateAll()));
    this.resize();
  }

  // ================================================================ public API

  setPages(pages: Page[]): void {
    const prevIndex = this.initialized ? this.currentPageIndex() : 0;
    const prevPageId = this.pages[prevIndex]?.id;
    const old = this.pageById;
    this.pages = pages;
    this.pageById = new Map(pages.map((p) => [p.id, p]));
    for (const p of pages) {
      const o = old.get(p.id);
      if (o && (o.width !== p.width || o.height !== p.height || o.template !== p.template || o.paperColor !== p.paperColor)) this.dropCache(p.id);
    }
    for (const id of [...this.caches.keys()]) if (!this.pageById.has(id)) this.dropCache(id);
    const anchorSlot = prevPageId ? this.layout.slots.find((s) => s.id === prevPageId) : undefined;
    const anchorOffset = anchorSlot ? this.viewport.ty + anchorSlot.y * this.viewport.scale : 0;
    this.layout = computeLayout(pages);
    if (!this.initialized && this.viewport.width > 0) {
      this.initialized = true;
      this.viewport.scale = Math.min(1.6, this.viewport.fitWidthScale(this.layout));
      this.viewport.tx = this.viewport.width / 2;
      this.viewport.ty = 24;
    } else if (anchorSlot) {
      // Keep the page that was on screen in place when pages are inserted/removed above it.
      const slot = this.layout.slots.find((s) => s.id === prevPageId);
      if (slot) this.viewport.ty = anchorOffset - slot.y * this.viewport.scale;
    }
    if (this.selection && !this.pageById.has(this.selection.pageId)) this.setSelection(null);
    this.viewport.clampTo(this.layout);
    this.requestRender(true, true);
  }

  setConfig(config: ToolConfig): void {
    const toolChanged = config.tool !== this.config.tool;
    this.config = config;
    if (toolChanged && config.tool !== 'lasso') this.setSelection(null);
    this.requestRender(false, true);
  }

  setStylusOnly(v: boolean): void {
    this.stylusOnly = v;
  }

  setCanvasColor(color: string): void {
    this.canvasColor = color;
    this.requestRender(true, false);
  }

  setSpacePan(v: boolean): void {
    this.spacePan = v;
    this.overlay.style.cursor = v ? 'grab' : '';
  }

  /** Current interaction state (shown on the performance HUD). */
  get gestureState(): GestureState {
    if (this.gesture) return this.gesture.kind === 'pinch' ? 'PINCHING' : 'PANNING';
    const a = this.action?.a;
    if (!a) return 'IDLE';
    if (a instanceof EraserAction) return 'ERASING';
    if (a instanceof LassoAction || a instanceof TransformAction) return 'SELECTING';
    return 'DRAWING';
  }

  get isInteracting(): boolean {
    return this.action !== null || this.gesture !== null || this.editingText !== null;
  }

  undo(): void {
    if (this.action) return;
    this.setSelection(null);
    this.model.undo();
  }

  redo(): void {
    if (this.action) return;
    this.setSelection(null);
    this.model.redo();
  }

  zoomBy(factor: number): void {
    this.viewport.zoomAt(factor, this.viewport.width / 2, this.viewport.height / 2);
    this.afterViewportJump();
  }

  setZoom(scale: number): void {
    this.zoomBy(scale / this.viewport.scale);
  }

  fitWidth(): void {
    const idx = this.currentPageIndex();
    this.viewport.scale = this.viewport.fitWidthScale(this.layout);
    this.scrollToPage(idx);
  }

  scrollToPage(index: number): void {
    const slot = this.layout.slots[Math.max(0, Math.min(index, this.layout.slots.length - 1))];
    if (!slot) return;
    this.viewport.ty = 24 - slot.y * this.viewport.scale;
    this.afterViewportJump();
  }

  currentPageIndex(): number {
    const slots = this.layout.slots;
    if (!slots.length) return 0;
    const centerY = this.viewport.toDoc({ x: 0, y: this.viewport.height / 2 }).y;
    for (const s of slots) if (centerY <= s.y + s.height + 12) return s.index;
    return slots.length - 1;
  }

  currentPageId(): UUID | null {
    return this.pages[this.currentPageIndex()]?.id ?? null;
  }

  /** Page-local point -> container CSS pixels. */
  pageToScreen(pageId: UUID, p: Vec): Vec | null {
    const slot = this.layout.slots.find((s) => s.id === pageId);
    if (!slot) return null;
    return this.viewport.toScreen({ x: slot.x + p.x, y: slot.y + p.y });
  }

  // ---------------------------------------------------------------- selection commands

  clearSelection(): void {
    this.setSelection(null);
  }

  private selectedElements(): PageElement[] {
    const sel = this.selection;
    if (!sel) return [];
    const ids = new Set(sel.ids);
    return (this.model.getElements(sel.pageId) ?? []).filter((e) => ids.has(e.id));
  }

  deleteSelection(): void {
    const els = this.selectedElements();
    if (!els.length) return;
    this.setSelection(null);
    this.model.apply({ removed: els, added: [] }, { history: 'Удаление', persist: true });
  }

  recolorSelection(color: string): void {
    const els = this.selectedElements();
    const changed = els.filter((e) => (e.type === 'shape' ? e.stroke !== color : e.type !== 'image' && e.color !== color));
    if (!changed.length || !this.selection) return;
    const updated = changed.map((e) => (e.type === 'shape' ? { ...e, stroke: color } : { ...e, color }) as PageElement);
    this.model.apply({ removed: changed, added: updated }, { history: 'Цвет', persist: true });
    this.emitSelection(true);
  }

  copySelection(): boolean {
    const els = this.selectedElements();
    if (!els.length) return false;
    clipboard = els.map((e) => structuredClone(e));
    return true;
  }

  cutSelection(): void {
    if (this.copySelection()) this.deleteSelection();
  }

  get hasClipboard(): boolean {
    return clipboard.length > 0;
  }

  private insertCopies(source: readonly PageElement[], pageId: UUID, offset: Vec, label: string): void {
    if (!source.length) return;
    const now = Date.now();
    const m = translation(offset.x, offset.y);
    const copies = source.map((e) => {
      const moved = transformElement(e, m);
      return { ...moved, id: uuid(), pageId, notebookId: this.model.notebookId, createdAt: now, z: nextZ() } as PageElement;
    });
    this.model.apply({ removed: [], added: copies }, { history: label, persist: true });
    this.setSelection({ pageId, ids: copies.map((c) => c.id), bbox: selectionBBox(copies) });
  }

  duplicateSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    this.insertCopies(this.selectedElements(), sel.pageId, { x: 16, y: 16 }, 'Дублирование');
  }

  paste(): void {
    const pageId = this.selection?.pageId ?? this.currentPageId();
    if (!pageId || !clipboard.length || !this.model.isLoaded(pageId)) return;
    const samePage = clipboard[0]!.pageId === pageId;
    this.insertCopies(clipboard, pageId, samePage ? { x: 16, y: 16 } : { x: 0, y: 0 }, 'Вставка');
  }

  selectAll(): void {
    const pageId = this.currentPageId();
    if (!pageId) return;
    const els = this.model.getElements(pageId) ?? [];
    this.setSelection(els.length ? { pageId, ids: els.map((e) => e.id), bbox: selectionBBox(els) } : null);
  }

  get hasSelection(): boolean {
    return this.selection !== null;
  }

  insertImage(assetId: UUID, naturalWidth: number, naturalHeight: number): void {
    const pageId = this.currentPageId();
    const page = pageId ? this.pageById.get(pageId) : undefined;
    if (!page) return;
    const maxW = page.width * 0.6;
    const maxH = page.height * 0.6;
    const k = Math.min(1, maxW / naturalWidth, maxH / naturalHeight);
    const w = naturalWidth * k;
    const h = naturalHeight * k;
    // Centre on the visible part of the page.
    const slot = this.layout.slots.find((s) => s.id === page.id)!;
    const center = this.viewport.toDoc({ x: this.viewport.width / 2, y: this.viewport.height / 2 });
    const cx = Math.min(Math.max(center.x - slot.x, w / 2), page.width - w / 2);
    const cy = Math.min(Math.max(center.y - slot.y, h / 2), page.height - h / 2);
    const el: PageElement = {
      id: uuid(),
      type: 'image',
      pageId: page.id,
      notebookId: this.model.notebookId,
      createdAt: Date.now(),
      z: nextZ(),
      x: cx - w / 2,
      y: cy - h / 2,
      width: w,
      height: h,
      rotation: 0,
      assetId,
    };
    void this.images.load(assetId);
    this.model.apply({ removed: [], added: [el] }, { history: 'Изображение', persist: true });
    this.setSelection({ pageId: page.id, ids: [el.id], bbox: selectionBBox([el]) });
  }

  // ---------------------------------------------------------------- text editing

  /** Called by the UI when the inline editor closes. */
  commitTextEdit(text: string | null, patch: Partial<TextElement> = {}): void {
    const editing = this.editingText;
    if (!editing) return;
    this.editingText = null;
    this.setHidden(editing.element.pageId, null);
    this.callbacks.onTextEdit?.(null);
    const base = { ...editing.element, ...patch };
    if (text === null) return; // cancelled
    const next: TextElement = { ...base, text: text.replace(/\s+$/, '') };
    next.height = measureTextHeight(this.mctx, next);
    if (editing.isNew) {
      if (next.text.trim()) this.model.apply({ removed: [], added: [next] }, { history: 'Текст', persist: true });
    } else if (!next.text.trim()) {
      this.model.apply({ removed: [editing.element], added: [] }, { history: 'Удаление текста', persist: true });
    } else if (JSON.stringify(next) !== JSON.stringify(editing.element)) {
      this.model.apply({ removed: [editing.element], added: [next] }, { history: 'Текст', persist: true });
    }
  }

  /** Open the text editor for a selected text element (e.g. from the selection toolbar). */
  editSelectedText(): void {
    const el = this.selectedElements().find((e): e is TextElement => e.type === 'text');
    if (!el) return;
    this.setSelection(null);
    this.startTextEdit(el, false);
  }

  private startTextEdit(element: TextElement, isNew: boolean): void {
    this.editingText = { element, isNew };
    if (!isNew) this.setHidden(element.pageId, new Set([element.id]));
    this.callbacks.onTextEdit?.({ element, isNew });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Free cached bitmaps (e.g. when the app goes to the background on iOS). */
  releaseCaches(): void {
    for (const id of [...this.caches.keys()]) this.dropCache(id);
    this.requestRender(true, false);
  }

  destroy(): void {
    cancelAnimationFrame(this.frameId);
    if (this.prefetchHandle) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this.prefetchHandle);
      clearTimeout(this.prefetchHandle);
    }
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.action?.a.abort();
    for (const d of this.disposers) d();
    this.resizeObserver?.disconnect();
    this.releaseCaches();
    this.main.remove();
    this.overlay.remove();
  }

  // ================================================================ internals: tool context

  /** Tool context with live getters: model/config may be replaced while an action runs. */
  private context(): ToolContext {
    const self = this;
    return {
      get model() {
        return self.model;
      },
      get config() {
        return self.config;
      },
      resolveImage: (id) => this.images.get(id),
      scale: () => this.viewport.scale,
      requestOverlay: () => this.requestRender(false, true),
      getSelection: () => this.selection,
      setSelection: (s) => this.setSelection(s),
      setHidden: (pageId, ids) => this.setHidden(pageId, ids),
      textRuns: (pageId) => {
        const page = this.pageById.get(pageId);
        return page?.pdf && this.textRunsFn ? this.textRunsFn(page) : null;
      },
    };
  }

  private setSelection(sel: Selection | null): void {
    this.selection = sel;
    this.emitSelection(true);
    this.requestRender(false, true);
  }

  private setHidden(pageId: UUID, ids: ReadonlySet<UUID> | null): void {
    const prev = this.hidden;
    this.hidden = ids ? { pageId, ids } : null;
    const affected = ids ?? prev?.ids;
    if (!affected) return;
    const els = (this.model.getElements(pageId) ?? []).filter((e) => affected.has(e.id));
    if (els.length) this.redrawRegion(pageId, selectionBBox(els));
    this.requestRender(true, true);
  }

  private emitSelection(force = false): void {
    const sel = this.selection;
    if (!sel) {
      if (this.lastSelectionKey !== '') {
        this.lastSelectionKey = '';
        this.callbacks.onSelectionChange?.(null);
      }
      return;
    }
    const a = this.pageToScreen(sel.pageId, { x: sel.bbox.minX, y: sel.bbox.minY });
    const b = this.pageToScreen(sel.pageId, { x: sel.bbox.maxX, y: sel.bbox.maxY });
    if (!a || !b) return;
    const key = `${sel.ids.join(',')}|${a.x.toFixed(0)},${a.y.toFixed(0)},${b.x.toFixed(0)},${b.y.toFixed(0)}`;
    if (!force && key === this.lastSelectionKey) return;
    this.lastSelectionKey = key;
    const els = this.selectedElements();
    this.callbacks.onSelectionChange?.({
      pageId: sel.pageId,
      count: sel.ids.length,
      screenRect: { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y },
      hasStrokes: els.some((e) => e.type === 'stroke'),
      hasText: els.some((e) => e.type === 'text'),
      shape: els.length && els.every((e) => e.type === 'shape') ? pickShapeStyle(els[0] as ShapeElement) : undefined,
    });
  }

  /** The selection is exactly one shape or image: edited with an oriented frame. */
  private singleBox(): BoxElement | null {
    const sel = this.selection;
    if (!sel || sel.ids.length !== 1) return null;
    const el = this.model.getElement(sel.pageId, sel.ids[0]!);
    return isBoxElement(el) ? el : null;
  }

  /** Restyle selected shapes. Consecutive slider changes merge into one undo step. */
  updateSelectedShapes(patch: ShapeStylePatch): void {
    const els = this.selectedElements().filter((e): e is ShapeElement => e.type === 'shape');
    if (!els.length) return;
    const updated = els.map((e) => ({ ...e, ...patch }));
    this.model.apply({ removed: els, added: updated }, { history: 'Стиль фигуры', persist: true, mergeKey: `style:${els.map((e) => e.id).join(',')}:${Object.keys(patch).join(',')}` });
    this.emitSelection(true);
  }

  /** Bring the selection to the front or send it to the back of the page. */
  arrangeSelection(where: 'front' | 'back'): void {
    const sel = this.selection;
    const els = this.selectedElements();
    if (!sel || !els.length) return;
    const all = this.model.getElements(sel.pageId) ?? [];
    const minZ = all.reduce((m, e) => Math.min(m, e.z), Infinity);
    const ordered = [...els].sort((a, b) => a.z - b.z);
    const updated = ordered.map((e, i) => ({ ...e, z: where === 'front' ? nextZ() : minZ - ordered.length + i }) as PageElement);
    this.model.apply({ removed: els, added: updated }, { history: where === 'front' ? 'На передний план' : 'На задний план', persist: true });
  }

  // ================================================================ internals: events

  private bindEvents(): void {
    const o = this.overlay;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window | Document, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(o, 'pointerdown', (e: PointerEvent) => this.onPointerDown(e));
    on(o, 'pointermove', (e: PointerEvent) => this.onPointerMove(e));
    on(o, 'pointerup', (e: PointerEvent) => this.onPointerUp(e, false));
    on(o, 'pointercancel', (e: PointerEvent) => this.onPointerUp(e, true));
    on(o, 'lostpointercapture', (e: PointerEvent) => {
      if (this.pointers.has(e.pointerId)) this.onPointerUp(e, true);
    });
    on(o, 'pointerleave', () => {
      this.hover = null;
      this.requestRender(false, true);
    });
    on(o, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    on(o, 'contextmenu', (e: Event) => e.preventDefault());
    // iOS Safari: prevent the magnifier loupe, callouts and native scroll/zoom from touches on the canvas.
    on(o, 'touchstart', (e: TouchEvent) => e.preventDefault(), { passive: false });
    // Safety net: touch events carry the authoritative list of fingers. When the last finger
    // lifts, no touch pointer can still be active, whatever happened to its pointerup.
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        setTimeout(() => {
          if ([...this.pointers.values()].some((p) => p.type === 'touch')) this.resetTouches();
        }, 0);
      }
    };
    on(o, 'touchend', onTouchEnd, { passive: true });
    on(o, 'touchcancel', onTouchEnd, { passive: true });
    on(o, 'touchmove', (e: TouchEvent) => e.preventDefault(), { passive: false });
    on(o, 'gesturestart', (e: Event) => e.preventDefault(), { passive: false });
    on(o, 'gesturechange', (e: Event) => e.preventDefault(), { passive: false });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
    }
    on(window, 'resize', () => this.resize());
  }

  private resize(): void {
    const r = this.container.getBoundingClientRect();
    this.rect = r;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (this.main.width !== w || this.main.height !== h || this.dpr !== dpr) {
      this.dpr = dpr;
      for (const c of [this.main, this.overlay]) {
        c.width = w;
        c.height = h;
      }
    }
    const wasZero = this.viewport.width === 0;
    // Keep the document point at the centre of the screen in place (iPad rotation, Split View).
    const anchor = wasZero ? null : this.viewport.toDoc({ x: this.viewport.width / 2, y: this.viewport.height / 2 });
    this.viewport.width = r.width;
    this.viewport.height = r.height;
    if (wasZero && this.pages.length && r.width > 0) this.setPages(this.pages);
    else {
      if (anchor) {
        this.viewport.tx = r.width / 2 - anchor.x * this.viewport.scale;
        this.viewport.ty = r.height / 2 - anchor.y * this.viewport.scale;
      }
      this.viewport.clampTo(this.layout);
    }
    this.requestRender(true, true);
  }

  private screenPoint(e: { clientX: number; clientY: number }): Vec {
    const r = this.rect ?? this.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private slotOf(pageId: UUID): PageSlot | undefined {
    return this.layout.slots.find((s) => s.id === pageId);
  }

  private makeSample(e: PointerEvent, slot: PageSlot): Sample {
    const doc = this.viewport.toDoc(this.screenPoint(e));
    return {
      x: doc.x - slot.x,
      y: doc.y - slot.y,
      pressure: e.pressure,
      t: e.timeStamp,
      tiltX: e.tiltX || 0,
      tiltY: e.tiltY || 0,
      pointerType: e.pointerType,
    };
  }

  /** Forget all tracked touch pointers and any touch gesture (stale state recovery). */
  private resetTouches(): void {
    let changed = false;
    for (const [id, p] of [...this.pointers]) {
      if (p.type !== 'touch') continue;
      this.pointers.delete(id);
      changed = true;
      if (this.action?.pointerId === id) {
        this.action.a.end(true);
        this.action = null;
        this.setInteracting(false);
      }
    }
    if (changed && this.gesture && (this.gesture.kind === 'pinch' || !this.pointers.has(this.gesture.pointerId))) {
      this.gesture = null;
      this.scheduleSettle();
    }
    this.tapCandidate = null;
  }

  private touchIds(): number[] {
    return [...this.pointers.entries()].filter(([, p]) => p.type === 'touch').map(([id]) => id);
  }

  private isPalm(e: PointerEvent): boolean {
    // Large contact areas are palms/sides of the hand; only meaningful when finger drawing is on.
    return e.pointerType === 'touch' && Math.max(e.width || 0, e.height || 0) > 60;
  }

  private setInteracting(active: boolean): void {
    this.callbacks.onInteractionChange?.(active);
  }

  private onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    this.rect = this.container.getBoundingClientRect();
    this.inertia = null;
    const type = e.pointerType;
    if (type === 'touch') {
      // A primary touch means no other finger is on the screen: anything still tracked is a
      // pointer whose pointerup/cancel Safari never delivered. Drop it, or the next one-finger
      // swipe would be treated as a pinch with a ghost finger.
      if (e.isPrimary) this.resetTouches();
      // Size-based palm rejection only matters when fingers draw; a flat finger may scroll.
      if (!this.stylusOnly && this.isPalm(e)) return;
      // Palm rejection: while the pen is writing (or just lifted), touches are ignored.
      if (this.action?.pointerType === 'pen' || performance.now() - this.lastPenUp < 250) return;
    }
    if (type === 'pen' && this.gesture) this.endGesture(false);
    if (type === 'pen' && this.action && this.action.pointerType === 'touch') {
      this.action.a.abort();
      this.action = null;
    }
    const sp = this.screenPoint(e);
    this.pointers.set(e.pointerId, { type, x: sp.x, y: sp.y, startX: sp.x, startY: sp.y, t: performance.now() });
    try {
      this.overlay.setPointerCapture(e.pointerId);
    } catch {
      /* capture can fail for synthetic events */
    }

    if (type === 'mouse') {
      if (e.button === 1 || e.button === 2 || this.spacePan) {
        this.startPan(e.pointerId, sp);
        return;
      }
      if (e.button !== 0) return;
    }

    if (type === 'touch') {
      const touches = this.touchIds();
      if (!this.tapCandidate || touches.length === 1) this.tapCandidate = { start: performance.now(), maxTouches: touches.length, moved: false };
      else this.tapCandidate.maxTouches = Math.max(this.tapCandidate.maxTouches, touches.length);
      if (touches.length >= 2) {
        if (this.action && this.action.pointerType === 'touch') {
          // A second finger soon after the first means the user is pinching, not drawing.
          if (performance.now() - this.action.startedAt < 300) this.action.a.abort();
          else this.action.a.end(false);
          this.action = null;
          this.requestRender(false, true);
        }
        this.textTap = null;
        this.startPinch(touches[0]!, touches[1]!);
        return;
      }
      if (this.stylusOnly) {
        this.startPan(e.pointerId, sp);
        return;
      }
    }
    if (this.action) return; // one drawing pointer at a time
    this.startAction(e, sp);
  }

  private startAction(e: PointerEvent, sp: Vec): void {
    const doc = this.viewport.toDoc(sp);
    const tool = this.config.tool;
    const scale = this.viewport.scale;

    if (this.selection) {
      const slot = this.slotOf(this.selection.pageId);
      if (slot) {
        const local = { x: doc.x - slot.x, y: doc.y - slot.y };
        const box = this.singleBox();
        if (box) {
          const hit = hitBoxHandles(box, local, scale);
          if (hit?.kind === 'resize') {
            this.beginAction(new BoxResizeAction(this.context(), box, hit.handle, this.makeSample(e, slot)), e);
            return;
          }
          if (hit) {
            this.beginAction(new TransformAction(this.context(), this.selection, hit.kind === 'rotate' ? 'rotate' : 'move', this.makeSample(e, slot)), e);
            return;
          }
        }
        const handle = box ? null : hitSelectionHandle(this.selection, local, scale);
        if (handle) {
          this.beginAction(new TransformAction(this.context(), this.selection, handle, this.makeSample(e, slot)), e);
          return;
        }
      }
      this.setSelection(null);
    }

    const slot = slotAt(this.layout, doc);
    if (!slot) {
      if (e.pointerType !== 'pen') this.startPan(e.pointerId, sp);
      return;
    }
    if (!this.model.isLoaded(slot.id)) return;
    const sample = this.makeSample(e, slot);
    const ctx = this.context();
    switch (tool) {
      case 'pen':
        this.beginAction(new InkAction(ctx, slot.id, sample, 'pen'), e);
        break;
      case 'highlighter':
        this.beginAction(new InkAction(ctx, slot.id, sample, 'highlighter'), e);
        break;
      case 'eraser':
        this.beginAction(new EraserAction(ctx, slot.id, sample), e);
        break;
      case 'lasso':
        this.beginAction(new LassoAction(ctx, slot.id, sample), e);
        break;
      case 'shape':
        this.beginAction(
          this.config.shape.kind === 'auto' ? new InkAction(ctx, slot.id, sample, 'auto-shape') : new ShapeAction(ctx, slot.id, sample, this.config.shape.kind),
          e,
        );
        break;
      case 'text':
        this.textTap = { pointerId: e.pointerId, pageId: slot.id, local: { x: sample.x, y: sample.y }, screen: sp };
        break;
    }
  }

  private beginAction(a: Action, e: PointerEvent): void {
    this.action = { a, pointerId: e.pointerId, pointerType: e.pointerType, startedAt: performance.now() };
    this.setInteracting(true);
    this.requestRender(false, true);
  }

  private onPointerMove(e: PointerEvent): void {
    const info = this.pointers.get(e.pointerId);
    const sp = this.screenPoint(e);
    if (!info) {
      // Hover (Apple Pencil hover on supported iPads, or mouse): show the eraser footprint.
      if ((e.pointerType === 'pen' || e.pointerType === 'mouse') && this.config.tool === 'eraser') {
        this.hover = sp;
        this.requestRender(false, true);
      }
      return;
    }
    info.x = sp.x;
    info.y = sp.y;
    if (this.tapCandidate && Math.hypot(sp.x - info.startX, sp.y - info.startY) > 10) this.tapCandidate.moved = true;
    if (this.gesture) {
      this.updateGesture(e.pointerId, e.timeStamp);
      return;
    }
    const act = this.action;
    if (!act || act.pointerId !== e.pointerId) return;
    const slot = this.slotOf(act.a.pageId);
    if (!slot) return;
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    this.perf.coalesced = coalesced.length > 0;
    const events = coalesced.length ? coalesced : [e];
    this.perf.inputEvents += events.length;
    const samples = events.map((ev) => this.makeSample(ev, slot));
    let predicted: Sample[] = [];
    if ((this.config.tool === 'pen' || this.config.tool === 'highlighter') && typeof e.getPredictedEvents === 'function') {
      const pe = e.getPredictedEvents();
      this.perf.predicted = pe.length > 0;
      predicted = pe.slice(0, 2).map((ev) => this.makeSample(ev, slot));
    }
    act.a.move(samples, predicted, { shift: e.shiftKey });
    if (this.config.tool === 'eraser') this.hover = sp;
  }

  private onPointerUp(e: PointerEvent, cancelled: boolean): void {
    const info = this.pointers.get(e.pointerId);
    if (!info) return;
    this.pointers.delete(e.pointerId);
    try {
      if (this.overlay.hasPointerCapture(e.pointerId)) this.overlay.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (info.type === 'pen') this.lastPenUp = performance.now();

    if (this.gesture) {
      this.onGesturePointerUp(e.pointerId, cancelled, e.timeStamp);
    }

    // Multi-finger tap: two fingers = undo, three fingers = redo.
    if (info.type === 'touch' && this.touchIds().length === 0 && this.tapCandidate) {
      const tc = this.tapCandidate;
      this.tapCandidate = null;
      if (!cancelled && !tc.moved && performance.now() - tc.start < 350) {
        if (tc.maxTouches === 2) this.undo();
        else if (tc.maxTouches === 3) this.redo();
      }
    }

    const act = this.action;
    if (act && act.pointerId === e.pointerId) {
      this.action = null;
      act.a.end(cancelled);
      this.setInteracting(false);
      this.requestRender(false, true);
    }

    const tap = this.textTap;
    if (tap && tap.pointerId === e.pointerId) {
      this.textTap = null;
      const sp = this.screenPoint(e);
      if (!cancelled && Math.hypot(sp.x - tap.screen.x, sp.y - tap.screen.y) < 10) this.handleTextTap(tap.pageId, tap.local);
    }
  }

  private handleTextTap(pageId: UUID, local: Vec): void {
    const page = this.pageById.get(pageId);
    if (!page) return;
    const els = this.model.getElements(pageId) ?? [];
    const hit = hitTestElement(
      els.filter((e) => e.type === 'text'),
      local,
      4 / this.viewport.scale,
    );
    if (hit && hit.type === 'text') {
      this.startTextEdit(hit, false);
      return;
    }
    const t = this.config.text;
    const width = Math.max(80, Math.min(280, page.width - local.x - 12));
    const el: TextElement = {
      id: uuid(),
      type: 'text',
      pageId,
      notebookId: this.model.notebookId,
      createdAt: Date.now(),
      z: nextZ(),
      x: Math.max(4, local.x - 4),
      y: Math.max(4, local.y - t.fontSize * 0.8),
      width,
      height: t.fontSize * 1.3 + 8,
      rotation: 0,
      text: '',
      fontFamily: t.fontFamily,
      fontSize: t.fontSize,
      color: t.color,
      align: t.align,
    };
    this.startTextEdit(el, true);
  }

  // ---------------------------------------------------------------- pan / pinch

  private startPan(pointerId: number, sp: Vec, t = performance.now()): void {
    this.inertia = null;
    this.gesture = { kind: 'pan', pointerId, lastX: sp.x, lastY: sp.y, samples: [{ t, x: sp.x, y: sp.y }] };
    this.overlay.style.cursor = 'grabbing';
  }

  private startPinch(a: number, b: number): void {
    const pa = this.pointers.get(a)!;
    const pb = this.pointers.get(b)!;
    this.gesture = {
      kind: 'pinch',
      a,
      b,
      startDist: Math.max(10, Math.hypot(pa.x - pb.x, pa.y - pb.y)),
      startMid: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
      start: this.viewport.snapshot(),
    };
    this.interacting = true;
  }

  private updateGesture(pointerId: number, t: number): void {
    const g = this.gesture!;
    if (g.kind === 'pan') {
      if (pointerId !== g.pointerId) return;
      const p = this.pointers.get(pointerId)!;
      this.viewport.panBy(p.x - g.lastX, p.y - g.lastY);
      g.lastX = p.x;
      g.lastY = p.y;
      // Event timestamps, not "now": Safari delivers several pointermoves in one task, and
      // processing-time deltas of ~0 ms turned into absurd fling velocities.
      g.samples.push({ t, x: p.x, y: p.y });
      while (g.samples.length > 2 && t - g.samples[0]!.t > 100) g.samples.shift();
    } else {
      const pa = this.pointers.get(g.a);
      const pb = this.pointers.get(g.b);
      if (!pa || !pb) return;
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      this.viewport.restore(g.start);
      this.viewport.zoomAt(d / g.startDist, g.startMid.x, g.startMid.y);
      this.viewport.panBy(mid.x - g.startMid.x, mid.y - g.startMid.y);
    }
    this.viewport.clampTo(this.layout, g.kind === 'pinch' ? 80 : 40);
    this.requestRender(true, true);
  }

  private onGesturePointerUp(pointerId: number, cancelled: boolean, endT?: number): void {
    const g = this.gesture!;
    if (g.kind === 'pinch') {
      if (pointerId !== g.a && pointerId !== g.b) return;
      const remaining = this.touchIds();
      if (remaining.length >= 2) {
        this.startPinch(remaining[0]!, remaining[1]!);
      } else if (remaining.length === 1) {
        const p = this.pointers.get(remaining[0]!)!;
        this.startPan(remaining[0]!, { x: p.x, y: p.y });
        this.scheduleSettle();
      } else {
        this.endGesture(false);
      }
      return;
    }
    if (pointerId === g.pointerId) this.endGesture(!cancelled, endT);
  }

  private endGesture(withInertia: boolean, endT?: number): void {
    const g = this.gesture;
    this.gesture = null;
    this.overlay.style.cursor = this.spacePan ? 'grab' : '';
    if (g?.kind === 'pan' && withInertia) {
      const v = flingVelocity(g.samples, endT ?? g.samples[g.samples.length - 1]?.t ?? 0);
      if (v && Math.hypot(v.vx, v.vy) > 0.3) {
        this.inertia = { vx: v.vx, vy: v.vy, last: performance.now() };
        this.requestRender(true, false);
      }
    }
    this.scheduleSettle();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.viewport.height : 1;
    const sp = this.screenPoint(e);
    if (e.ctrlKey || e.metaKey) {
      this.viewport.zoomAt(Math.exp(-e.deltaY * unit * 0.01), sp.x, sp.y);
      this.interacting = true;
    } else {
      this.viewport.panBy(-e.deltaX * unit, -e.deltaY * unit);
    }
    this.viewport.clampTo(this.layout);
    this.requestRender(true, true);
    this.scheduleSettle();
  }

  private scheduleSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.gesture?.kind === 'pinch') return;
      this.interacting = false;
      this.viewport.clampTo(this.layout);
      this.requestRender(true, true);
    }, 140);
  }

  private afterViewportJump(): void {
    this.viewport.clampTo(this.layout);
    this.requestRender(true, true);
  }

  // ================================================================ internals: model changes

  private onModelChange(c: ModelChange): void {
    const { added, removed } = c.change;
    if (added.length || removed.length) {
      for (const [pageId, region] of c.regions) {
        const cache = this.caches.get(pageId);
        if (cache?.content && !cache.dirty) {
          const pureInkAdd =
            removed.length === 0 &&
            added.every((e) => e.type === 'stroke' && e.tool !== 'highlighter') &&
            !(this.model.getElements(pageId) ?? []).some((e) => e.type === 'text' && bboxIntersects(elementBBox(e), region));
          if (pureInkAdd) this.drawIncremental(cache.content, added.filter((e) => e.pageId === pageId));
          else this.redrawRegion(pageId, region);
        }
        this.callbacks.onContentChange?.(pageId);
      }
      if (this.selection) {
        // Drop selection entries that no longer exist (undo, eraser...).
        const existing = new Set((this.model.getElements(this.selection.pageId) ?? []).map((e) => e.id));
        const ids = this.selection.ids.filter((id) => existing.has(id));
        if (ids.length !== this.selection.ids.length) {
          const els = (this.model.getElements(this.selection.pageId) ?? []).filter((e) => ids.includes(e.id));
          this.setSelection(ids.length ? { ...this.selection, ids, bbox: selectionBBox(els) } : null);
        }
      }
    } else {
      for (const pageId of c.regions.keys()) this.callbacks.onContentChange?.(pageId);
    }
    this.callbacks.onHistoryChange?.({ canUndo: this.model.history.canUndo, canRedo: this.model.history.canRedo });
    this.requestRender(true, true);
  }

  private drawIncremental(bm: Bitmap, strokes: PageElement[]): void {
    const ctx = bm.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(bm.res, 0, 0, bm.res, -bm.region.minX * bm.res, -bm.region.minY * bm.res);
    for (const s of strokes) if (s.type === 'stroke') drawStroke(ctx, s);
  }

  /** Dirty-rectangle repaint of one page bitmap. */
  private redrawRegion(pageId: UUID, region: BBox): void {
    const cache = this.caches.get(pageId);
    const page = this.pageById.get(pageId);
    const bm = cache?.content;
    if (!cache || !page || !bm) return;
    const els = this.model.getElements(pageId);
    if (!els) {
      cache.dirty = true;
      return;
    }
    const r = bboxInflate(region, 2);
    const clip = {
      minX: Math.max(r.minX, bm.region.minX),
      minY: Math.max(r.minY, bm.region.minY),
      maxX: Math.min(r.maxX, bm.region.maxX),
      maxY: Math.min(r.maxY, bm.region.maxY),
    };
    if (isEmptyBBox(clip)) return;
    const ctx = bm.canvas.getContext('2d');
    if (!ctx) return;
    const px0 = Math.floor((clip.minX - bm.region.minX) * bm.res);
    const py0 = Math.floor((clip.minY - bm.region.minY) * bm.res);
    const px1 = Math.ceil((clip.maxX - bm.region.minX) * bm.res);
    const py1 = Math.ceil((clip.maxY - bm.region.minY) * bm.res);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(px0, py0, px1 - px0, py1 - py0);
    ctx.clip();
    ctx.clearRect(px0, py0, px1 - px0, py1 - py0);
    ctx.setTransform(bm.res, 0, 0, bm.res, -bm.region.minX * bm.res, -bm.region.minY * bm.res);
    if (!page.pdf) drawTemplate(ctx, page, bm.res);
    const skip = this.hidden?.pageId === pageId ? this.hidden.ids : undefined;
    // Only elements under the dirty rectangle matter: fetch them from the spatial index.
    const local = this.model.query(pageId, clip).sort((a, b) => a.z - b.z);
    drawElements(ctx, local, { resolveImage: (id) => this.images.get(id), skip, region: clip });
    ctx.restore();
    this.perf.bitmapRenders++;
  }

  private invalidateAll(): void {
    for (const c of this.caches.values()) c.dirty = true;
    this.requestRender(true, false);
  }

  private dropCache(pageId: UUID): void {
    const c = this.caches.get(pageId);
    if (!c) return;
    c.bgCtrl?.abort();
    // Zero-size canvases release their backing store immediately on iOS Safari.
    for (const bm of [c.content, c.bg]) {
      if (bm) {
        bm.canvas.width = 0;
        bm.canvas.height = 0;
      }
    }
    this.caches.delete(pageId);
  }

  // ================================================================ internals: rendering

  private requestRender(main: boolean, overlay: boolean): void {
    this.needsMain ||= main;
    this.needsOverlay ||= overlay;
    if (!this.frameId) this.frameId = requestAnimationFrame(() => this.frame());
  }

  private frame(): void {
    this.frameId = 0;
    if (this.inertia) {
      // One clock for the whole animation. The rAF timestamp can be *earlier* than the moment
      // the fling started, which made dt negative: velocity grew and the page ran backwards.
      const now = performance.now();
      const dt = Math.max(0, Math.min(32, now - this.inertia.last));
      this.inertia.last = now;
      const want = { tx: this.viewport.tx + this.inertia.vx * dt, ty: this.viewport.ty + this.inertia.vy * dt };
      this.viewport.panBy(this.inertia.vx * dt, this.inertia.vy * dt);
      this.viewport.clampTo(this.layout);
      // Reaching the end of the document stops the fling on that axis.
      if (Math.abs(this.viewport.ty - want.ty) > 0.5) this.inertia.vy = 0;
      if (Math.abs(this.viewport.tx - want.tx) > 0.5) this.inertia.vx = 0;
      const decay = Math.pow(0.95, dt / 16);
      this.inertia.vx *= decay;
      this.inertia.vy *= decay;
      if (Math.hypot(this.inertia.vx, this.inertia.vy) < 0.02) {
        this.inertia = null;
        this.scheduleSettle();
      }
      this.needsMain = true;
      this.needsOverlay = true;
    }
    if (this.needsMain) {
      this.needsMain = false;
      const t0 = performance.now();
      this.renderMain();
      this.perf.frameMs = performance.now() - t0;
    }
    if (this.needsOverlay) {
      this.needsOverlay = false;
      const t0 = performance.now();
      this.renderOverlay();
      this.perf.overlayMs = performance.now() - t0;
    }
    if (this.inertia) this.requestRender(true, true);
    this.emitView();
    if (this.selection) this.emitSelection();
    for (const l of this.frameListeners) l();
  }

  /** Called after every rendered frame (for DOM overlays that track the viewport without React re-renders). */
  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  private emitView(): void {
    const v: ViewInfo = { scale: this.viewport.scale, pageIndex: this.currentPageIndex(), pageCount: this.pages.length };
    const l = this.lastView;
    if (!l || Math.abs(l.scale - v.scale) > 0.001 || l.pageIndex !== v.pageIndex || l.pageCount !== v.pageCount) {
      this.lastView = v;
      this.callbacks.onViewChange?.(v);
    }
  }

  private visibleLocal(slot: PageSlot): BBox {
    const vis = this.viewport.visibleRect();
    return {
      minX: Math.max(0, vis.minX - slot.x),
      minY: Math.max(0, vis.minY - slot.y),
      maxX: Math.min(slot.width, vis.maxX - slot.x),
      maxY: Math.min(slot.height, vis.maxY - slot.y),
    };
  }

  /** Desired bitmap resolution and region for a page at the current zoom. */
  private targetBitmap(slot: PageSlot): { res: number; region: BBox } {
    const res0 = resolutionBucket(this.viewport.scale, this.dpr);
    const full = { minX: 0, minY: 0, maxX: slot.width, maxY: slot.height };
    if (capResolution(res0, slot.width, slot.height, MAX_BITMAP_PIXELS) >= res0) return { res: res0, region: full };
    // Zoomed in far: render only the visible part of the page (plus a margin for panning).
    const vis = this.visibleLocal(slot);
    const mx = (vis.maxX - vis.minX) * 0.35;
    const my = (vis.maxY - vis.minY) * 0.35;
    const region = {
      minX: Math.max(0, vis.minX - mx),
      minY: Math.max(0, vis.minY - my),
      maxX: Math.min(slot.width, vis.maxX + mx),
      maxY: Math.min(slot.height, vis.maxY + my),
    };
    const res = Math.min(res0, capResolution(res0, region.maxX - region.minX, region.maxY - region.minY, MAX_BITMAP_PIXELS));
    return { res, region };
  }

  private bitmapUsable(bm: Bitmap | null, want: { res: number }, slot: PageSlot): boolean {
    if (!bm) return false;
    if (Math.abs(bm.res - want.res) / want.res > 0.02) return false;
    const vis = this.visibleLocal(slot);
    return isEmptyBBox(vis) || bboxContains(bm.region, vis);
  }

  private getCache(pageId: UUID): PageCache {
    let c = this.caches.get(pageId);
    if (!c) {
      c = { content: null, dirty: true, bg: null, bgKey: null, bgCtrl: null };
      this.caches.set(pageId, c);
    }
    return c;
  }

  private renderContent(page: Page, cache: PageCache, want: { res: number; region: BBox }): void {
    const els = this.model.getElements(page.id);
    if (!els) return;
    const w = Math.max(1, Math.ceil((want.region.maxX - want.region.minX) * want.res));
    const h = Math.max(1, Math.ceil((want.region.maxY - want.region.minY) * want.res));
    const canvas = cache.content?.canvas ?? document.createElement('canvas');
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(want.res, 0, 0, want.res, -want.region.minX * want.res, -want.region.minY * want.res);
    if (!page.pdf) drawTemplate(ctx, page, want.res);
    const skip = this.hidden?.pageId === page.id ? this.hidden.ids : undefined;
    drawElements(ctx, els, { resolveImage: (id) => this.images.get(id), skip });
    cache.content = { canvas, res: want.res, region: want.region };
    cache.dirty = false;
    this.perf.bitmapRenders++;
  }

  private ensurePdfBackground(page: Page, slot: PageSlot, cache: PageCache, want: { res: number; region: BBox }, prefetch = false): void {
    if (this.interacting) return;
    if (cache.bg && (prefetch ? Math.abs(cache.bg.res - want.res) / want.res <= 0.02 : this.bitmapUsable(cache.bg, want, slot))) return;
    const r = want.region;
    const key = `${want.res.toFixed(3)}|${r.minX.toFixed(1)},${r.minY.toFixed(1)},${r.maxX.toFixed(1)},${r.maxY.toFixed(1)}`;
    if (cache.bgKey === key) return; // already rendering this
    cache.bgCtrl?.abort();
    const ctrl = new AbortController();
    cache.bgCtrl = ctrl;
    cache.bgKey = key;
    this.pdf
      .render(page, want.res, r, ctrl.signal)
      .then((canvas) => {
        if (ctrl.signal.aborted || this.caches.get(page.id) !== cache) {
          if (canvas) canvas.width = canvas.height = 0;
          return;
        }
        if (cache.bg && cache.bg.canvas !== canvas) cache.bg.canvas.width = cache.bg.canvas.height = 0;
        if (canvas) cache.bg = { canvas, res: want.res, region: r };
        cache.bgCtrl = null;
        this.requestRender(true, false);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'RenderingCancelledException' || ctrl.signal.aborted) return;
        cache.bgKey = null;
        this.callbacks.onError?.('Не удалось отобразить страницу PDF');
      });
  }

  private renderMain(): void {
    const ctx = this.mctx;
    const vp = this.viewport;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.canvasColor;
    ctx.fillRect(0, 0, this.main.width, this.main.height);
    if (!this.layout.slots.length) return;
    const vis = vp.visibleRect();
    const slots = visibleSlots(this.layout, vis.minY, vis.maxY);
    const s = vp.scale;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * vp.tx, dpr * vp.ty);
    // First frame renders everything visible; afterwards at most one bitmap per frame, and only
    // while the frame is still cheap, so scrolling never stalls on a heavy page.
    let budget = this.caches.size === 0 ? slots.length : 1;
    const frameStart = performance.now();
    let more = false;
    const keep = new Set<UUID>();

    for (const slot of slots) {
      const page = this.pageById.get(slot.id);
      if (!page) continue;
      keep.add(page.id);
      // shadow + hairline border
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(slot.x - 1 / s, slot.y + 1 / s, slot.width + 2 / s, slot.height + 2 / s);
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(slot.x - 0.5 / s, slot.y - 0.5 / s, slot.width + 1 / s, slot.height + 1 / s);

      const cache = this.getCache(page.id);
      const loaded = this.model.isLoaded(page.id);
      if (!loaded) {
        this.model.ensureLoaded(page.id).then(
          () => {
            const c = this.caches.get(page.id);
            if (c) c.dirty = true;
            this.requestRender(true, false);
          },
          () => this.callbacks.onError?.('Не удалось загрузить страницу из хранилища'),
        );
      }
      const want = this.targetBitmap(slot);

      ctx.save();
      ctx.beginPath();
      ctx.rect(slot.x, slot.y, slot.width, slot.height);
      ctx.clip();
      ctx.fillStyle = page.paperColor;
      ctx.fillRect(slot.x, slot.y, slot.width, slot.height);

      if (page.pdf) {
        if (this.config.tool === 'highlighter' && this.config.highlighter.snapToText) this.textRunsFn?.(page);
        this.ensurePdfBackground(page, slot, cache, want);
        const bg = cache.bg;
        if (bg) ctx.drawImage(bg.canvas, slot.x + bg.region.minX, slot.y + bg.region.minY, bg.region.maxX - bg.region.minX, bg.region.maxY - bg.region.minY);
      }

      if (loaded && (cache.dirty || !this.bitmapUsable(cache.content, want, slot))) {
        if (!this.interacting && (budget > 0 || !cache.content) && (performance.now() - frameStart < 10 || !cache.content)) {
          this.renderContent(page, cache, want);
          budget--;
        } else if (!this.interacting) more = true;
      }
      const bm = cache.content;
      const fullCover = bm && bm.region.minX <= 0 && bm.region.minY <= 0 && bm.region.maxX >= slot.width && bm.region.maxY >= slot.height;
      if (!page.pdf && !fullCover) {
        ctx.save();
        ctx.translate(slot.x, slot.y);
        drawTemplate(ctx, page, s * dpr);
        ctx.restore();
      }
      if (bm) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(bm.canvas, slot.x + bm.region.minX, slot.y + bm.region.minY, bm.region.maxX - bm.region.minX, bm.region.maxY - bm.region.minY);
      }
      ctx.restore();
    }

    // Keep visible pages and two neighbours on each side cached (rendered ahead in idle time),
    // bounded by a pixel budget; release everything else.
    const first = slots[0]?.index ?? 0;
    const last = slots[slots.length - 1]?.index ?? 0;
    const n = this.layout.slots.length;
    const near: UUID[] = [];
    for (let d = 1; d <= PREFETCH_PAGES; d++) {
      if (last + d < n) near.push(this.layout.slots[last + d]!.id);
      if (first - d >= 0) near.push(this.layout.slots[first - d]!.id);
    }
    let pixels = 0;
    for (const id of keep) pixels += this.cachePixels(id);
    for (const id of near) {
      const px = this.cachePixels(id);
      if (pixels + px > MAX_CACHE_PIXELS) break;
      pixels += px;
      keep.add(id);
    }
    for (const id of [...this.caches.keys()]) if (!keep.has(id)) this.dropCache(id);
    const modelKeep = new Set(keep);
    for (let i = Math.max(0, first - 4); i <= Math.min(n - 1, last + 4); i++) modelKeep.add(this.layout.slots[i]!.id);
    if (this.selection) modelKeep.add(this.selection.pageId);
    if (this.editingText) modelKeep.add(this.editingText.element.pageId);
    if (this.action) modelKeep.add(this.action.a.pageId);
    this.model.evictExcept(modelKeep);
    this.perf.cachedPages = this.caches.size;
    this.prefetchQueue = near.filter((id) => keep.has(id));
    if (more) this.requestRender(true, false);
    else this.schedulePrefetch();
  }

  private cachePixels(pageId: UUID): number {
    const c = this.caches.get(pageId);
    const a = c?.content ? c.content.canvas.width * c.content.canvas.height : 0;
    const b = c?.bg ? c.bg.canvas.width * c.bg.canvas.height : 0;
    if (a || b) return a + b;
    // Not rendered yet: estimate from the page size at the current resolution.
    const slot = this.slotOf(pageId);
    if (!slot) return 0;
    const want = this.targetBitmap(slot);
    const page = this.pageById.get(pageId);
    const area = Math.max(0, want.region.maxX - want.region.minX) * Math.max(0, want.region.maxY - want.region.minY) * want.res * want.res;
    return page?.pdf ? area * 2 : area;
  }

  private prefetchQueue: UUID[] = [];
  private prefetchHandle = 0;

  /**
   * Idle-time work: load elements and render bitmaps (and PDF backgrounds) of the pages next to
   * the viewport, one page per idle slot, so turning the page shows finished content immediately.
   */
  private schedulePrefetch(): void {
    if (this.prefetchHandle || !this.prefetchQueue.length) return;
    const ric: (cb: () => void) => number =
      typeof requestIdleCallback === 'function' ? (cb) => requestIdleCallback(cb, { timeout: 300 }) : (cb) => window.setTimeout(cb, 60);
    this.prefetchHandle = ric(() => {
      this.prefetchHandle = 0;
      if (this.interacting || this.action || this.gesture || this.inertia) {
        this.schedulePrefetch();
        return;
      }
      const id = this.prefetchQueue.shift();
      if (!id) return;
      const page = this.pageById.get(id);
      const slot = this.slotOf(id);
      if (!page || !slot) return this.schedulePrefetch();
      if (!this.model.isLoaded(id)) {
        this.model.ensureLoaded(id).then(
          () => {
            this.prefetchQueue.unshift(id);
            this.schedulePrefetch();
          },
          () => {},
        );
        return;
      }
      const want = this.targetBitmap(slot);
      // Zoomed far in, bitmaps cover only the visible part of a page: nothing to pre-render.
      if (want.region.maxX <= want.region.minX || want.region.maxY <= want.region.minY) return this.schedulePrefetch();
      const cache = this.getCache(id);
      if (page.pdf) this.ensurePdfBackground(page, slot, cache, want, true);
      if (cache.dirty || !cache.content || Math.abs(cache.content.res - want.res) / want.res > 0.02) this.renderContent(page, cache, want);
      this.schedulePrefetch();
    });
  }

  private renderOverlay(): void {
    const ctx = this.octx;
    const vp = this.viewport;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const s = vp.scale;
    const pageTransform = (slot: PageSlot) => ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (vp.tx + slot.x * s), dpr * (vp.ty + slot.y * s));

    const act = this.action?.a;
    if (act) {
      const slot = this.slotOf(act.pageId);
      if (slot) {
        ctx.save();
        pageTransform(slot);
        if (act instanceof InkAction || act instanceof ShapeAction) {
          ctx.beginPath();
          ctx.rect(0, 0, slot.width, slot.height);
          ctx.clip();
        }
        act.drawOverlay(ctx);
        ctx.restore();
      }
    } else if (this.selection) {
      const slot = this.slotOf(this.selection.pageId);
      if (slot) {
        ctx.save();
        pageTransform(slot);
        const box = this.singleBox();
        if (box) drawOrientedFrame(ctx, box, s);
        else drawSelectionFrame(ctx, this.selection.bbox, s);
        ctx.restore();
      }
    }
    if (this.hover && this.config.tool === 'eraser' && !(act instanceof EraserAction)) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawEraserCursor(ctx, this.hover, this.config.eraser.size / 2, 1);
    }
  }
}
