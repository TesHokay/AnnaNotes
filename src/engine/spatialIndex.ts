import type { BBox, PageElement } from '@/model/types';
import { elementBBox } from './geometry';

/**
 * Uniform-grid spatial index over element bounding boxes. Pages have bounded size and strokes
 * are small, so a grid gives O(1) inserts/removes (needed while erasing, where elements change
 * on every frame) and fast rectangle queries without the rebalancing cost of an R-tree.
 */
export class GridIndex {
  private cells = new Map<number, Set<string>>();
  private boxes = new Map<string, { el: PageElement; keys: number[] }>();

  constructor(private readonly cellSize = 64) {}

  private key(cx: number, cy: number): number {
    // Pages are < 20000 units; offset keeps negative coordinates (content off-page) valid.
    return (cx + 1024) * 4096 + (cy + 1024);
  }

  private cellRange(b: BBox): [number, number, number, number] {
    const s = this.cellSize;
    return [Math.floor(b.minX / s), Math.floor(b.minY / s), Math.floor(b.maxX / s), Math.floor(b.maxY / s)];
  }

  insert(el: PageElement): void {
    if (this.boxes.has(el.id)) this.remove(el.id);
    const [x0, y0, x1, y1] = this.cellRange(elementBBox(el));
    const keys: number[] = [];
    // Huge elements (e.g. full-page images) would occupy many cells; cap by clamping the range.
    const maxCells = 4096;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > maxCells) {
      keys.push(-1);
    } else {
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) keys.push(this.key(cx, cy));
    }
    for (const k of keys) {
      let set = this.cells.get(k);
      if (!set) this.cells.set(k, (set = new Set()));
      set.add(el.id);
    }
    this.boxes.set(el.id, { el, keys });
  }

  remove(id: string): void {
    const entry = this.boxes.get(id);
    if (!entry) return;
    for (const k of entry.keys) {
      const set = this.cells.get(k);
      set?.delete(id);
      if (set && set.size === 0) this.cells.delete(k);
    }
    this.boxes.delete(id);
  }

  /** Elements whose bounding box may intersect `b` (broad phase; callers do the exact test). */
  query(b: BBox): PageElement[] {
    const [x0, y0, x1, y1] = this.cellRange(b);
    const ids = new Set<string>();
    const add = (set: Set<string> | undefined) => set?.forEach((id) => ids.add(id));
    add(this.cells.get(-1));
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) add(this.cells.get(this.key(cx, cy)));
    const out: PageElement[] = [];
    for (const id of ids) {
      const e = this.boxes.get(id)!.el;
      const eb = elementBBox(e);
      if (eb.minX <= b.maxX && eb.maxX >= b.minX && eb.minY <= b.maxY && eb.maxY >= b.minY) out.push(e);
    }
    return out;
  }

  get size(): number {
    return this.boxes.size;
  }

  static build(elements: readonly PageElement[]): GridIndex {
    const g = new GridIndex();
    for (const e of elements) g.insert(e);
    return g;
  }
}
