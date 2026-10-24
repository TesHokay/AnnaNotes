import { uuid } from '@/lib/id';
import type { BBox, PageElement, PenStyle, ShapeElement, ShapeElementKind, ShapeKind, StrokeElement, StrokePoint, StrokeTool, TextAlign, FontFamilyKey, UUID } from '@/model/types';
import type { DocumentModel } from './DocumentModel';
import { nextZ } from './DocumentModel';
import { eraseStrokePartially, strokeHitBySweep } from './eraser';
import {
  applyMatrix,
  bboxCenter,
  bboxFromPoints,
  bboxInflate,
  bboxUnion,
  decompose,
  dist,
  distPointSegment,
  elementBBox,
  isEmptyBBox,
  multiply,
  pathLength as pathLengthOf,
  pointInPolygon,
  rotatedRectCorners,
  rotationAbout,
  scalingAbout,
  strokeBBox,
  translation,
  type Matrix,
  type Vec,
  EMPTY_BBOX,
  IDENTITY,
} from './geometry';
import type { ChangeSet } from './history';
import { computeWidths, outlinePolygon, strokeOutline, tracePolygon, widthProfile } from './outline';
import { normalizePressure, PressureDetector, SimulatedPressure, type PressureCalibration } from './pressure';
import { drawElements, strokeFillStyle, type ImageResolver } from './renderer';
import { isNearlyStraight, rdp, recognizeShape, shapePoints } from './shapes';
import { drawShapeElement, hitShape, shapeFromDrag, shapeFromPolygon } from './shapeElement';
import { AdaptiveSmoother, isOutlier } from './smoothing';
import { snapHighlightToText, type TextRun } from '@/pdf/textLayer';

export type ToolKind = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shape' | 'text';

export interface ToolConfig {
  tool: ToolKind;
  pen: { color: string; width: number; opacity: number; style: PenStyle; stabilization: number };
  highlighter: { color: string; width: number; opacity: number; snapToText: boolean };
  eraser: { mode: 'stroke' | 'partial' | 'object'; size: number };
  lasso: { mode: 'free' | 'rect' };
  shape: { kind: ShapeElementKind | 'auto'; color: string; width: number; fill: string | null; opacity: number };
  text: { fontFamily: FontFamilyKey; fontSize: number; color: string; align: TextAlign };
  smoothing: number;
  calibration: PressureCalibration;
}

/** A pointer sample in page-local document coordinates. */
export interface Sample {
  x: number;
  y: number;
  pressure: number;
  t: number;
  tiltX: number;
  tiltY: number;
  pointerType: string;
}

export interface Selection {
  pageId: UUID;
  ids: UUID[];
  bbox: BBox;
}

export interface ToolContext {
  readonly model: DocumentModel;
  readonly config: ToolConfig;
  readonly resolveImage: ImageResolver;
  /** current zoom (screen px per document unit) */
  scale(): number;
  requestOverlay(): void;
  getSelection(): Selection | null;
  setSelection(sel: Selection | null): void;
  /** Hide elements from the cached page bitmap while they are rendered live on the overlay. */
  setHidden(pageId: UUID, ids: ReadonlySet<UUID> | null): void;
  /** Cached PDF text runs of a page (null when not a PDF page or not loaded yet). */
  textRuns(pageId: UUID): readonly TextRun[] | null;
}

export interface Action {
  readonly pageId: UUID;
  move(samples: Sample[], predicted: Sample[], modifiers: { shift: boolean }): void;
  /** cancelled = pointercancel; actions decide whether to keep partial work. */
  end(cancelled: boolean): void;
  /** Discard all effects (e.g. touch drawing turned out to be a pinch). */
  abort(): void;
  drawOverlay(ctx: CanvasRenderingContext2D): void;
}

export function selectionBBox(elements: readonly PageElement[]): BBox {
  let b = { ...EMPTY_BBOX };
  for (const el of elements) b = bboxUnion(b, elementBBox(el));
  return b;
}

/** Applies a similarity transform (translate/uniform scale/rotate) to an element. */
export function transformElement(el: PageElement, m: Matrix): PageElement {
  const { scale, rotation } = decompose(m);
  if (el.type === 'stroke') {
    const points = el.points.map((p) => {
      const q = applyMatrix(m, p);
      return { ...p, x: q.x, y: q.y };
    });
    const baseWidth = el.baseWidth * scale;
    return { ...el, points, baseWidth, boundingBox: strokeBBox(points, baseWidth) };
  }
  const c = applyMatrix(m, { x: el.x + el.width / 2, y: el.y + el.height / 2 });
  const w = el.width * scale;
  const h = el.height * scale;
  const base = { ...el, x: c.x - w / 2, y: c.y - h / 2, width: w, height: h, rotation: el.rotation + rotation };
  if (el.type === 'text') return { ...base, type: 'text', fontSize: el.fontSize * scale } as PageElement;
  if (el.type === 'shape') {
    return { ...base, type: 'shape', points: el.points?.map((p) => ({ x: p.x * scale, y: p.y * scale })), strokeWidth: el.strokeWidth * scale, cornerRadius: el.cornerRadius !== undefined ? el.cornerRadius * scale : undefined } as PageElement;
  }
  return base as PageElement;
}

/** New shape element with the current shape tool style. */
export function makeShape(ctx: ToolContext, pageId: UUID, geom: Pick<ShapeElement, 'kind' | 'x' | 'y' | 'width' | 'height' | 'points'>): ShapeElement {
  const c = ctx.config.shape;
  return {
    id: uuid(),
    type: 'shape',
    pageId,
    notebookId: ctx.model.notebookId,
    createdAt: Date.now(),
    z: nextZ(),
    rotation: 0,
    stroke: c.color,
    strokeWidth: c.width,
    opacity: c.opacity,
    fill: geom.kind === 'line' || geom.kind === 'arrow' ? null : c.fill,
    cornerRadius: geom.kind === 'roundedRect' ? 14 : undefined,
    ...geom,
  };
}

/** Topmost element under a point (page coords), with a tolerance in document units. */
export function hitTestElement(elements: readonly PageElement[], p: Vec, tolerance: number): PageElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!;
    if (el.type === 'stroke') {
      const reach = tolerance + el.baseWidth / 2;
      const b = el.boundingBox;
      if (p.x < b.minX - reach || p.x > b.maxX + reach || p.y < b.minY - reach || p.y > b.maxY + reach) continue;
      const pts = el.points;
      if (pts.length === 1 && dist(p, pts[0]!) <= reach) return el;
      for (let k = 1; k < pts.length; k++) if (distPointSegment(p, pts[k - 1]!, pts[k]!) <= reach) return el;
    } else if (el.type === 'shape') {
      if (hitShape(el, p, tolerance)) return el;
    } else if (pointInPolygon(p, rotatedRectCorners(el.x, el.y, el.width, el.height, el.rotation))) {
      return el;
    }
  }
  return null;
}

/** Elements selected by a lasso polygon (page coords). */
export function elementsInLasso(elements: readonly PageElement[], poly: readonly Vec[]): PageElement[] {
  if (poly.length < 3) return [];
  const pb = bboxFromPoints(poly);
  return elements.filter((el) => {
    const b = elementBBox(el);
    if (b.maxX < pb.minX || b.minX > pb.maxX || b.maxY < pb.minY || b.minY > pb.maxY) return false;
    if (el.type === 'stroke') {
      let inside = 0;
      for (const p of el.points) if (pointInPolygon(p, poly)) inside++;
      return inside / el.points.length >= 0.5;
    }
    return pointInPolygon(bboxCenter(b), poly);
  });
}

// ------------------------------------------------------------------ ink

export class InkAction implements Action {
  private points: StrokePoint[] = [];
  private predicted: StrokePoint[] = [];
  private detector: PressureDetector;
  private simulated = new SimulatedPressure();
  private smoother: AdaptiveSmoother;
  private t0 = 0;
  private lastRaw: Sample | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private holdAnchor: Vec | null = null;
  /** After draw-and-hold the stroke becomes a rubber-band line or recognised shape. */
  private snapped: { kind: ShapeKind; strokes: StrokePoint[][]; start: Vec } | null = null;
  private readonly tool: StrokeTool;

  constructor(
    private readonly ctx: ToolContext,
    readonly pageId: UUID,
    first: Sample,
    private readonly mode: 'pen' | 'highlighter' | 'auto-shape',
  ) {
    this.tool = mode === 'highlighter' ? 'highlighter' : mode === 'auto-shape' ? 'shape' : 'pen';
    this.detector = new PressureDetector(first.pointerType);
    this.smoother = new AdaptiveSmoother(mode === 'pen' ? ctx.config.pen.stabilization : mode === 'highlighter' ? 0.6 : 0.3, 1 / ctx.scale());
    this.t0 = first.t;
    this.add(first);
    this.armHold(first);
  }

  private style() {
    const c = this.ctx.config;
    if (this.mode === 'highlighter') return { color: c.highlighter.color, width: c.highlighter.width, opacity: c.highlighter.opacity, penStyle: 'ball' as PenStyle };
    if (this.mode === 'auto-shape') return { color: c.shape.color, width: c.shape.width, opacity: 1, penStyle: 'ball' as PenStyle };
    return { color: c.pen.color, width: c.pen.width, opacity: c.pen.opacity, penStyle: c.pen.style };
  }

  private toPoint(s: Sample): StrokePoint {
    this.detector.add(s.pressure);
    let pressure: number;
    if (this.detector.hasRealPressure) {
      pressure = normalizePressure(s.pressure, this.ctx.config.calibration);
    } else {
      const prev = this.lastRaw;
      const dt = prev ? Math.max(1, s.t - prev.t) : 16;
      const speed = prev ? Math.hypot(s.x - prev.x, s.y - prev.y) / dt : 0;
      pressure = this.simulated.next(speed * this.ctx.scale());
    }
    this.lastRaw = s;
    return { x: s.x, y: s.y, pressure, timestamp: s.t - this.t0, tiltX: s.tiltX, tiltY: s.tiltY };
  }

  private add(s: Sample): void {
    if (isOutlier(this.lastRaw, s, 1 / this.ctx.scale())) return;
    const p = this.smoother.push(this.toPoint(s));
    const last = this.points[this.points.length - 1];
    const minDist = 0.4 / this.ctx.scale();
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) this.points.push(p);
  }

  /** Draw-and-hold: if the pen rests for a moment the stroke is straightened or recognised. */
  private armHold(s: Sample): void {
    const anchor = this.holdAnchor;
    if (anchor && Math.hypot(s.x - anchor.x, s.y - anchor.y) * this.ctx.scale() < 4) return;
    this.holdAnchor = { x: s.x, y: s.y };
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => this.onHold(), 550);
  }

  private onHold(): void {
    this.holdTimer = null;
    if (this.snapped || this.points.length < 3) return;
    const first = this.points[0]!;
    const last = this.points[this.points.length - 1]!;
    if (isNearlyStraight(this.points, 0.08)) {
      this.snapped = { kind: 'line', strokes: shapePoints('line', first, last), start: first };
    } else if (this.mode !== 'highlighter') {
      const rec = recognizeShape(this.points);
      if (rec) this.snapped = { kind: rec.kind, strokes: rec.strokes, start: first };
    }
    if (this.snapped) this.ctx.requestOverlay();
  }

  move(samples: Sample[], predicted: Sample[]): void {
    if (this.snapped) {
      // Rubber-band: only lines follow the pen after snapping.
      const s = samples[samples.length - 1];
      if (s && this.snapped.kind === 'line') this.snapped.strokes = shapePoints('line', this.snapped.start, s);
      this.ctx.requestOverlay();
      return;
    }
    for (const s of samples) this.add(s);
    const lastSample = samples[samples.length - 1];
    if (lastSample) this.armHold(lastSample);
    this.predicted = predicted.map((s) => ({ x: s.x, y: s.y, pressure: this.points[this.points.length - 1]?.pressure ?? 0.5, timestamp: 0, tiltX: 0, tiltY: 0 }));
    this.ctx.requestOverlay();
  }

  private buildStrokes(): StrokeElement[] {
    const st = this.style();
    const now = Date.now();
    const make = (points: StrokePoint[], shape?: ShapeKind): StrokeElement => ({
      id: uuid(),
      type: 'stroke',
      pageId: this.pageId,
      notebookId: this.ctx.model.notebookId,
      createdAt: now,
      z: nextZ(),
      tool: shape ? (this.tool === 'highlighter' ? 'highlighter' : 'shape') : this.tool,
      penStyle: st.penStyle,
      color: st.color,
      baseWidth: st.width,
      opacity: st.opacity,
      points,
      boundingBox: strokeBBox(points, st.width),
      shape,
      simulatedPressure: shape ? undefined : !this.detector.hasRealPressure || undefined,
    });
    if (this.snapped) return this.snapped.strokes.map((pts) => make(pts, this.snapped!.kind));
    if (this.mode === 'highlighter' && this.ctx.config.highlighter.snapToText) {
      const runs = this.ctx.textRuns(this.pageId);
      const segs = runs ? snapHighlightToText(this.points, runs, st.width) : [];
      if (segs.length) {
        return segs.map((seg) => {
          const pts = shapePoints('line', seg.from, seg.to)[0]!;
          const s = make(pts);
          return { ...s, baseWidth: seg.height, boundingBox: strokeBBox(pts, seg.height) };
        });
      }
    }
    if (this.mode === 'auto-shape') {
      const rec = recognizeShape(this.points);
      if (rec) return rec.strokes.map((pts) => make(pts, rec.kind));
    }
    return [make(this.points)];
  }

  /** Auto-shape tool: freehand → editable vector shape (recognised, or freeform when closed). */
  private buildAutoShape(): ShapeElement | null {
    if (this.points.length < 3) return null;
    const first = this.points[0]!;
    const last = this.points[this.points.length - 1]!;
    const rec = recognizeShape(this.points);
    const box = (pts: readonly Vec[]) => bboxFromPoints(pts);
    let geom: Pick<ShapeElement, 'kind' | 'x' | 'y' | 'width' | 'height' | 'points'> | null = null;
    if (rec) {
      const b = box(rec.strokes.flat());
      if (rec.kind === 'line') geom = shapeFromDrag('line', first, last, false);
      else if (rec.kind === 'rectangle') geom = { kind: 'rectangle', x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
      else if (rec.kind === 'circle' || rec.kind === 'ellipse') geom = { kind: 'ellipse', x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
      else if (rec.kind === 'triangle' && rec.vertices) geom = shapeFromPolygon('triangle', rec.vertices);
    } else if (dist(first, last) < Math.max(18, pathLengthOf(this.points) * 0.12)) {
      geom = shapeFromPolygon('freeform', rdp([...this.points, first], 1.2).slice(0, -1));
    }
    return geom ? makeShape(this.ctx, this.pageId, geom) : null;
  }

  end(cancelled: boolean): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    if (this.mode === 'auto-shape' && !cancelled) {
      const shape = this.buildAutoShape();
      if (shape) {
        this.ctx.model.apply({ removed: [], added: [shape] }, { history: 'Фигура', persist: true });
        this.ctx.setSelection({ pageId: this.pageId, ids: [shape.id], bbox: selectionBBox([shape]) });
        return;
      }
    }
    if (!this.snapped && this.lastRaw) {
      this.points.push(...this.smoother.finish(this.toPoint(this.lastRaw), this.points[this.points.length - 2]));
    }
    // On pointercancel (iOS system gesture, palm) keep what was drawn if it is a real stroke.
    if (cancelled && this.points.length < 3 && !this.snapped) return;
    if (this.points.length === 0) return;
    const strokes = this.buildStrokes();
    this.ctx.model.apply({ removed: [], added: strokes }, { history: this.tool === 'highlighter' ? 'Маркер' : 'Штрих', persist: true });
  }

  abort(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.points = [];
    this.snapped = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const st = this.style();
    ctx.globalAlpha = st.opacity;
    const path = new Path2D();
    if (this.snapped) {
      const profile = widthProfile('shape', st.penStyle);
      for (const pts of this.snapped.strokes) tracePolygon(path, outlinePolygon(pts, computeWidths(pts, st.width, profile)));
    } else {
      // Same geometry pipeline as the committed stroke, so the line does not change on pen-up.
      const pts = this.predicted.length ? [...this.points, ...this.predicted] : this.points;
      tracePolygon(path, strokeOutline({ points: pts, baseWidth: st.width, tool: this.tool, penStyle: st.penStyle, simulatedPressure: !this.detector.hasRealPressure }));
    }
    ctx.fillStyle = strokeFillStyle(ctx, st.color, this.tool === 'pen' ? st.penStyle : 'ballpoint');
    ctx.fill(path);
    ctx.globalAlpha = 1;
  }}

// ------------------------------------------------------------------ eraser

export class EraserAction implements Action {
  private last: Vec;
  private removedOriginals = new Map<UUID, PageElement>();
  private created = new Map<UUID, PageElement>();
  private cursor: Vec;
  /** Path segments not yet applied; processed at most once per animation frame. */
  private pendingPath: Vec[] = [];
  private frame = 0;

  constructor(
    private readonly ctx: ToolContext,
    readonly pageId: UUID,
    first: Sample,
  ) {
    this.last = first;
    this.cursor = first;
    this.pendingPath.push(first);
    this.flush();
  }

  private radius(): number {
    // Eraser size is defined in screen points so it feels the same at every zoom.
    return this.ctx.config.eraser.size / 2 / this.ctx.scale();
  }

  private sweep(to: Vec, removed: Map<UUID, PageElement>, added: Map<UUID, PageElement>): void {
    const r = this.radius();
    const sweep = { from: this.last, to, radius: r };
    const box = bboxInflate(bboxFromPoints([this.last, to]), r + 2);
    const mode = this.ctx.config.eraser.mode;
    // Broad phase through the spatial index, then exact tests. Elements created earlier in this
    // same frame (fragments) are not yet in the model, so test them too.
    const candidates = [...this.ctx.model.query(this.pageId, box).filter((e) => !removed.has(e.id)), ...added.values()];
    for (const el of candidates) {
      if (mode === 'object') {
        if (el.type === 'stroke' && el.tool !== 'shape') continue;
        const hit = el.type === 'stroke' ? strokeHitBySweep(el, sweep) : hitTestElement([el], to, r) !== null || hitTestElement([el], sweep.from, r) !== null;
        if (hit) {
          if (added.has(el.id)) added.delete(el.id);
          else removed.set(el.id, el);
        }
        continue;
      }
      if (el.type !== 'stroke') continue;
      if (mode === 'stroke') {
        if (strokeHitBySweep(el, sweep)) {
          if (added.has(el.id)) added.delete(el.id);
          else removed.set(el.id, el);
        }
      } else {
        const frags = eraseStrokePartially(el, sweep, uuid);
        if (frags) {
          if (added.has(el.id)) added.delete(el.id);
          else removed.set(el.id, el);
          for (const f of frags) added.set(f.id, f);
        }
      }
    }
    this.last = to;
  }

  private flush = (): void => {
    this.frame = 0;
    if (!this.pendingPath.length) return;
    const removed = new Map<UUID, PageElement>();
    const added = new Map<UUID, PageElement>();
    for (const p of this.pendingPath) this.sweep(p, removed, added);
    this.pendingPath = [];
    if (!removed.size && !added.size) return;
    for (const el of removed.values()) {
      if (this.created.has(el.id)) this.created.delete(el.id);
      else this.removedOriginals.set(el.id, el);
    }
    for (const el of added.values()) this.created.set(el.id, el);
    this.ctx.model.apply({ removed: [...removed.values()], added: [...added.values()] }, { history: null, persist: false });
  };

  move(samples: Sample[]): void {
    // Keep only points that moved meaningfully; the capsule sweep covers the gaps.
    const minStep = Math.max(0.5, this.radius() / 3);
    for (const s of samples) {
      const prev = this.pendingPath[this.pendingPath.length - 1] ?? this.last;
      if (dist(prev, s) >= minStep) this.pendingPath.push({ x: s.x, y: s.y });
    }
    const s = samples[samples.length - 1];
    if (s) this.cursor = s;
    // The cursor is redrawn immediately; erasing work is batched into the next frame.
    this.ctx.requestOverlay();
    if (!this.frame && this.pendingPath.length) this.frame = requestAnimationFrame(this.flush);
  }

  end(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    const last = this.pendingPath.length ? null : this.cursor;
    if (last && dist(last, this.last) > 0) this.pendingPath.push(last);
    this.flush();
    const change: ChangeSet = { removed: [...this.removedOriginals.values()], added: [...this.created.values()] };
    // One undo step for the whole eraser pass.
    if (change.removed.length || change.added.length) this.ctx.model.commitTransient(change, 'Ластик');
  }

  abort(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.pendingPath = [];
    const change: ChangeSet = { removed: [...this.created.values()], added: [...this.removedOriginals.values()] };
    if (change.removed.length || change.added.length) this.ctx.model.apply(change, { history: null, persist: false });
    this.created.clear();
    this.removedOriginals.clear();
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    drawEraserCursor(ctx, this.cursor, this.radius(), this.ctx.scale());
  }
}

export function drawEraserCursor(ctx: CanvasRenderingContext2D, c: Vec, r: number, scale: number): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
  ctx.lineWidth = 1 / scale;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();
}

// ------------------------------------------------------------------ shapes

export class ShapeAction implements Action {
  private end_: Vec;
  private constrain = false;

  constructor(
    private readonly ctx: ToolContext,
    readonly pageId: UUID,
    private readonly start: Sample,
    private readonly kind: ShapeElementKind,
  ) {
    this.end_ = start;
  }

  private preview(): ShapeElement {
    return makeShape(this.ctx, this.pageId, shapeFromDrag(this.kind, this.start, this.end_, this.constrain));
  }

  move(samples: Sample[], _p: Sample[], mods: { shift: boolean }): void {
    const s = samples[samples.length - 1];
    if (s) this.end_ = s;
    this.constrain = mods.shift;
    this.ctx.requestOverlay();
  }

  end(cancelled: boolean): void {
    if (cancelled) return;
    if (dist(this.start, this.end_) * this.ctx.scale() < 4) {
      // A tap with the shape tool selects an existing shape for editing.
      const els = (this.ctx.model.getElements(this.pageId) ?? []).filter((e) => e.type === 'shape' || (e.type === 'stroke' && e.tool === 'shape'));
      const hit = hitTestElement(els, this.start, 8 / this.ctx.scale());
      if (hit) this.ctx.setSelection({ pageId: this.pageId, ids: [hit.id], bbox: selectionBBox([hit]) });
      return;
    }
    const shape = this.preview();
    this.ctx.model.apply({ removed: [], added: [shape] }, { history: 'Фигура', persist: true });
    // Newly drawn shapes are selected right away with resize/rotate handles and the style panel.
    this.ctx.setSelection({ pageId: this.pageId, ids: [shape.id], bbox: selectionBBox([shape]) });
  }

  abort(): void {}

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    drawShapeElement(ctx, this.preview());
  }
}

// ------------------------------------------------------------------ lasso

export class LassoAction implements Action {
  private path: Vec[] = [];
  private start: Vec;
  private current: Vec;

  constructor(
    private readonly ctx: ToolContext,
    readonly pageId: UUID,
    first: Sample,
  ) {
    this.start = first;
    this.current = first;
    this.path.push(first);
  }

  private get rect(): boolean {
    return this.ctx.config.lasso.mode === 'rect';
  }

  move(samples: Sample[]): void {
    for (const s of samples) {
      const last = this.path[this.path.length - 1]!;
      if (dist(last, s) * this.ctx.scale() > 2) this.path.push(s);
      this.current = s;
    }
    this.ctx.requestOverlay();
  }

  private polygon(): Vec[] {
    if (!this.rect) return this.path;
    const a = this.start;
    const b = this.current;
    return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  }

  end(cancelled: boolean): void {
    if (cancelled) return;
    const els = this.ctx.model.getElements(this.pageId) ?? [];
    const tap = dist(this.start, this.current) * this.ctx.scale() < 6 && this.path.length < 4;
    let selected: PageElement[];
    if (tap) {
      const hit = hitTestElement(els, this.start, 8 / this.ctx.scale());
      selected = hit ? [hit] : [];
    } else {
      selected = elementsInLasso(els, this.polygon());
    }
    this.ctx.setSelection(selected.length ? { pageId: this.pageId, ids: selected.map((e) => e.id), bbox: selectionBBox(selected) } : null);
  }

  abort(): void {}

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const poly = this.polygon();
    if (poly.length < 2) return;
    const s = this.ctx.scale();
    ctx.beginPath();
    ctx.moveTo(poly[0]!.x, poly[0]!.y);
    for (const p of poly) ctx.lineTo(p.x, p.y);
    if (this.rect) ctx.closePath();
    ctx.fillStyle = 'rgba(232,108,158,0.08)';
    ctx.fill();
    ctx.setLineDash([6 / s, 4 / s]);
    ctx.lineWidth = 1.5 / s;
    ctx.strokeStyle = '#e86c9e';
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ------------------------------------------------------------------ selection transform

export type Handle = 'move' | 'scale-nw' | 'scale-ne' | 'scale-se' | 'scale-sw' | 'rotate';

const HANDLE_RADIUS_PX = 22;
const ROTATE_OFFSET_PX = 30;

export function selectionHandles(b: BBox, scale: number): Record<Exclude<Handle, 'move'>, Vec> {
  return {
    'scale-nw': { x: b.minX, y: b.minY },
    'scale-ne': { x: b.maxX, y: b.minY },
    'scale-se': { x: b.maxX, y: b.maxY },
    'scale-sw': { x: b.minX, y: b.maxY },
    rotate: { x: (b.minX + b.maxX) / 2, y: b.minY - ROTATE_OFFSET_PX / scale },
  };
}

export function hitSelectionHandle(sel: Selection, p: Vec, scale: number): Handle | null {
  const r = HANDLE_RADIUS_PX / scale;
  const handles = selectionHandles(sel.bbox, scale);
  for (const [k, v] of Object.entries(handles) as [Exclude<Handle, 'move'>, Vec][]) if (dist(p, v) <= r) return k;
  const pad = 6 / scale;
  const b = sel.bbox;
  if (p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad) return 'move';
  return null;
}

export function drawSelectionFrame(ctx: CanvasRenderingContext2D, b: BBox, scale: number, matrix: Matrix = IDENTITY): void {
  if (isEmptyBBox(b)) return;
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map((p) => applyMatrix(matrix, p));
  ctx.save();
  ctx.lineWidth = 1.5 / scale;
  ctx.strokeStyle = '#e86c9e';
  ctx.setLineDash([5 / scale, 4 / scale]);
  ctx.beginPath();
  corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  const h = selectionHandles(b, scale);
  const rot = applyMatrix(matrix, h.rotate);
  const topMid = applyMatrix(matrix, { x: (b.minX + b.maxX) / 2, y: b.minY });
  ctx.beginPath();
  ctx.moveTo(topMid.x, topMid.y);
  ctx.lineTo(rot.x, rot.y);
  ctx.stroke();
  const dot = (p: Vec) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6 / scale, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2 / scale;
    ctx.stroke();
  };
  corners.forEach(dot);
  dot(rot);
  ctx.restore();
}

export class TransformAction implements Action {
  private matrix: Matrix = IDENTITY;
  private elements: PageElement[];
  private readonly start: Vec;
  private readonly center: Vec;
  private moved = false;

  constructor(
    private readonly ctx: ToolContext,
    private readonly sel: Selection,
    private readonly handle: Handle,
    first: Sample,
  ) {
    this.start = first;
    this.center = bboxCenter(sel.bbox);
    const ids = new Set(sel.ids);
    this.elements = (ctx.model.getElements(sel.pageId) ?? []).filter((e) => ids.has(e.id));
    ctx.setHidden(sel.pageId, ids);
  }

  get pageId(): UUID {
    return this.sel.pageId;
  }

  move(samples: Sample[], _p: Sample[], mods: { shift: boolean }): void {
    const p = samples[samples.length - 1];
    if (!p) return;
    if (dist(p, this.start) * this.ctx.scale() > 2) this.moved = true;
    const b = this.sel.bbox;
    if (this.handle === 'move') {
      this.matrix = translation(p.x - this.start.x, p.y - this.start.y);
    } else if (this.handle === 'rotate') {
      let a = Math.atan2(p.y - this.center.y, p.x - this.center.x) - Math.atan2(this.start.y - this.center.y, this.start.x - this.center.x);
      if (mods.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      this.matrix = rotationAbout(a, this.center.x, this.center.y);
    } else {
      const anchor: Vec =
        this.handle === 'scale-nw' ? { x: b.maxX, y: b.maxY } : this.handle === 'scale-ne' ? { x: b.minX, y: b.maxY } : this.handle === 'scale-se' ? { x: b.minX, y: b.minY } : { x: b.maxX, y: b.minY };
      const d0 = dist(this.start, anchor);
      const d1 = dist(p, anchor);
      const s = Math.max(0.05, d0 > 0 ? d1 / d0 : 1);
      this.matrix = scalingAbout(s, anchor.x, anchor.y);
    }
    this.ctx.requestOverlay();
  }

  end(cancelled: boolean): void {
    this.ctx.setHidden(this.sel.pageId, null);
    if (cancelled || !this.moved) {
      this.ctx.requestOverlay();
      return;
    }
    const transformed = this.elements.map((e) => transformElement(e, this.matrix));
    this.ctx.model.apply({ removed: this.elements, added: transformed }, { history: 'Трансформация', persist: true });
    this.ctx.setSelection({ pageId: this.sel.pageId, ids: this.sel.ids, bbox: selectionBBox(transformed) });
  }

  abort(): void {
    this.ctx.setHidden(this.sel.pageId, null);
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const m = this.matrix;
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    drawElements(ctx, this.elements, { resolveImage: this.ctx.resolveImage });
    ctx.restore();
    drawSelectionFrame(ctx, this.sel.bbox, this.ctx.scale(), this.matrix);
  }
}

/** Compose helper exported for tests. */
export const composeMatrices = multiply;
