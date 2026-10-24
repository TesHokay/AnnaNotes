import type { BBox, PageElement, UUID } from '@/model/types';
import { bboxUnion, elementBBox } from './geometry';
import { History, type ChangeSet } from './history';
import { GridIndex } from './spatialIndex';

export interface Persistence {
  enqueue(put: readonly PageElement[], del: readonly UUID[]): void;
}

export type ElementLoader = (pageId: UUID) => Promise<PageElement[]>;

export interface ModelChange {
  /** Dirty region per affected page (page-local coordinates). */
  regions: Map<UUID, BBox>;
  /** True when the change came from undo/redo or a committed edit (not a transient preview). */
  committed: boolean;
  change: ChangeSet;
}

type Listener = (c: ModelChange) => void;

export interface ApplyOptions {
  /** History label; null = not recorded (transient preview or undo/redo). */
  history: string | null;
  /** Write the change to storage. */
  persist: boolean;
  /** Merge with the previous history entry of the same key (slider drags). */
  mergeKey?: string;
}

let zCounter = 0;
/** Monotonic stacking key: creation time with a tie-breaker. */
export function nextZ(): number {
  zCounter = (zCounter + 1) % 1000;
  return Date.now() * 1000 + zCounter;
}

/**
 * In-memory working copy of a notebook's elements, loaded lazily per page. All edits go through
 * apply(), which updates the cache, records undo history and forwards writes to persistence.
 */
export class DocumentModel {
  readonly history = new History();
  private cache = new Map<UUID, PageElement[]>();
  private indexes = new Map<UUID, GridIndex>();
  private loading = new Map<UUID, Promise<PageElement[]>>();
  private listeners = new Set<Listener>();

  constructor(
    readonly notebookId: UUID,
    private readonly loader: ElementLoader,
    private readonly persistence: Persistence,
  ) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  isLoaded(pageId: UUID): boolean {
    return this.cache.has(pageId);
  }

  getElements(pageId: UUID): readonly PageElement[] | undefined {
    return this.cache.get(pageId);
  }

  getElement(pageId: UUID, id: UUID): PageElement | undefined {
    return this.cache.get(pageId)?.find((e) => e.id === id);
  }

  /** Elements whose bounding box intersects `b`, via the page's spatial index. */
  query(pageId: UUID, b: BBox): PageElement[] {
    const els = this.cache.get(pageId);
    if (!els) return [];
    let idx = this.indexes.get(pageId);
    if (!idx) this.indexes.set(pageId, (idx = GridIndex.build(els)));
    return idx.query(b);
  }

  private setPage(pageId: UUID, els: PageElement[]): void {
    this.cache.set(pageId, els);
    this.indexes.delete(pageId); // rebuilt lazily on the next query
  }

  ensureLoaded(pageId: UUID): Promise<readonly PageElement[]> {
    const cached = this.cache.get(pageId);
    if (cached) return Promise.resolve(cached);
    let p = this.loading.get(pageId);
    if (!p) {
      p = this.loader(pageId).then(
        (els) => {
          this.loading.delete(pageId);
          // An edit may have happened on a not-yet-loaded page (e.g. paste); merge, edits win.
          const existing = this.cache.get(pageId);
          if (existing) {
            const ids = new Set(existing.map((e) => e.id));
            const merged = [...existing, ...els.filter((e) => !ids.has(e.id))].sort((a, b) => a.z - b.z);
            this.setPage(pageId, merged);
            return merged;
          }
          this.setPage(pageId, els);
          return els;
        },
        (err) => {
          this.loading.delete(pageId);
          throw err;
        },
      );
      this.loading.set(pageId, p);
    }
    return p;
  }

  /** Drop cached elements of pages that are far from the viewport to bound memory. */
  evictExcept(keep: ReadonlySet<UUID>): void {
    for (const id of [...this.cache.keys()]) {
      if (!keep.has(id)) {
        this.cache.delete(id);
        this.indexes.delete(id);
      }
    }
  }

  forgetPage(pageId: UUID): void {
    this.cache.delete(pageId);
    this.indexes.delete(pageId);
    this.history.dropPage(pageId);
  }

  apply(change: ChangeSet, opts: ApplyOptions): ModelChange {
    const regions = new Map<UUID, BBox>();
    const mark = (el: PageElement) => {
      const b = elementBBox(el);
      const prev = regions.get(el.pageId);
      regions.set(el.pageId, prev ? bboxUnion(prev, b) : b);
    };
    const removedIds = new Set(change.removed.map((e) => e.id));
    for (const el of change.removed) mark(el);
    const byPage = new Map<UUID, PageElement[]>();
    for (const el of change.added) {
      mark(el);
      const list = byPage.get(el.pageId) ?? [];
      list.push(el);
      byPage.set(el.pageId, list);
    }
    for (const pageId of regions.keys()) {
      // Pages that are not in memory are only updated in storage; they load fresh later.
      const current = this.cache.get(pageId);
      if (!current) continue;
      const added = byPage.get(pageId) ?? [];
      const addedIds = new Set(added.map((e) => e.id));
      const next = current.filter((e) => !removedIds.has(e.id) && !addedIds.has(e.id));
      if (added.length) {
        // Usually the new elements are on top (new strokes) or replace one at the same z
        // (eraser fragments, transforms): insert in order instead of re-sorting the page.
        for (const el of [...added].sort((a, b) => a.z - b.z)) {
          let i = next.length;
          while (i > 0 && next[i - 1]!.z > el.z) i--;
          next.splice(i, 0, el);
        }
      }
      this.cache.set(pageId, next);
      const idx = this.indexes.get(pageId);
      if (idx) {
        for (const id of removedIds) idx.remove(id);
        for (const el of added) idx.insert(el);
      }
    }
    if (opts.history) this.history.push({ label: opts.history, removed: change.removed, added: change.added, mergeKey: opts.mergeKey });
    if (opts.persist) {
      const addedIds = new Set(change.added.map((e) => e.id));
      this.persistence.enqueue(
        change.added,
        change.removed.filter((e) => !addedIds.has(e.id)).map((e) => e.id),
      );
    }
    const result: ModelChange = { regions, committed: opts.persist, change };
    for (const l of this.listeners) l(result);
    return result;
  }

  /** Record an already-applied (transient) change in history and storage without re-applying it. */
  commitTransient(change: ChangeSet, label: string): void {
    this.history.push({ label, removed: change.removed, added: change.added });
    const addedIds = new Set(change.added.map((e) => e.id));
    this.persistence.enqueue(
      change.added,
      change.removed.filter((e) => !addedIds.has(e.id)).map((e) => e.id),
    );
    const regions = new Map<UUID, BBox>();
    for (const el of [...change.removed, ...change.added]) {
      const prev = regions.get(el.pageId);
      regions.set(el.pageId, prev ? bboxUnion(prev, elementBBox(el)) : elementBBox(el));
    }
    // Already applied visually: report with an empty change so renderers don't redraw again.
    for (const l of this.listeners) l({ regions, committed: true, change: { removed: [], added: [] } });
  }

  undo(): ModelChange | null {
    const c = this.history.undo();
    return c ? this.apply(c, { history: null, persist: true }) : null;
  }

  redo(): ModelChange | null {
    const c = this.history.redo();
    return c ? this.apply(c, { history: null, persist: true }) : null;
  }
}
