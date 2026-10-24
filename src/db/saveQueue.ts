import type { PageElement, UUID } from '@/model/types';
import { getDB } from './db';
import { toStorageError, type StorageError } from './errors';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'quota';

export interface SaveState {
  status: SaveStatus;
  lastSavedAt: number | null;
  error: StorageError | null;
  pendingCount: number;
}

type Listener = (s: SaveState) => void;

/**
 * Batches element writes and flushes them to IndexedDB in a single transaction.
 *
 * - Finished strokes are enqueued immediately; the flush is debounced so a burst of strokes
 *   costs one transaction.
 * - The latest write for an id wins (put after delete and vice versa).
 * - On failure the batch is kept and retried with backoff; nothing is dropped.
 * - flush() is awaited on visibilitychange/pagehide/navigation so data is on disk before the page
 *   can be discarded. beforeunload is not relied upon (unreliable on iOS).
 */
export class SaveQueue {
  private puts = new Map<UUID, PageElement>();
  private deletes = new Set<UUID>();
  private touchedNotebooks = new Set<UUID>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private retryDelay = 1000;
  private listeners = new Set<Listener>();
  private state: SaveState = { status: 'idle', lastSavedAt: null, error: null, pendingCount: 0 };

  constructor(private readonly debounceMs = 350) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): SaveState {
    return this.state;
  }

  private setState(patch: Partial<SaveState>): void {
    this.state = { ...this.state, ...patch, pendingCount: this.puts.size + this.deletes.size };
    for (const l of this.listeners) l(this.state);
  }

  get hasPending(): boolean {
    return this.puts.size > 0 || this.deletes.size > 0 || this.inflight !== null;
  }

  enqueue(put: readonly PageElement[], del: readonly UUID[]): void {
    for (const id of del) {
      this.puts.delete(id);
      this.deletes.add(id);
    }
    for (const el of put) {
      this.deletes.delete(el.id);
      this.puts.set(el.id, el);
      this.touchedNotebooks.add(el.notebookId);
    }
    if (this.puts.size === 0 && this.deletes.size === 0) return;
    this.setState({ status: this.state.status === 'error' || this.state.status === 'quota' ? this.state.status : 'pending' });
    this.schedule(this.debounceMs);
  }

  /** Mark a notebook as modified (e.g. page operations that bypass the element queue). */
  touchNotebook(id: UUID): void {
    this.touchedNotebooks.add(id);
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => {});
    }, ms);
  }

  /** Write everything pending. Resolves when the data is committed; rejects on failure. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Serialise flushes: wait for the running transaction, then write whatever accumulated meanwhile.
    while (this.inflight) await this.inflight.catch(() => {});
    if (this.puts.size === 0 && this.deletes.size === 0) return;

    const puts = [...this.puts.values()];
    const deletes = [...this.deletes];
    const notebooks = [...this.touchedNotebooks];
    this.puts.clear();
    this.deletes.clear();
    this.touchedNotebooks.clear();
    this.setState({ status: 'saving' });

    const run = async () => {
      const db = getDB();
      const ts = Date.now();
      await db.transaction('rw', db.elements, db.notebooks, async () => {
        if (deletes.length) await db.elements.bulkDelete(deletes);
        if (puts.length) await db.elements.bulkPut(puts);
        for (const id of notebooks) await db.notebooks.update(id, { updatedAt: ts });
      });
    };

    this.inflight = run();
    try {
      await this.inflight;
      this.retryDelay = 1000;
      this.inflight = null;
      const more = this.puts.size > 0 || this.deletes.size > 0;
      this.setState({ status: more ? 'pending' : 'saved', lastSavedAt: Date.now(), error: null });
    } catch (err) {
      this.inflight = null;
      // Put the batch back without overwriting newer changes made while we were writing.
      for (const el of puts) if (!this.puts.has(el.id) && !this.deletes.has(el.id)) this.puts.set(el.id, el);
      for (const id of deletes) if (!this.puts.has(id)) this.deletes.add(id);
      for (const id of notebooks) this.touchedNotebooks.add(id);
      const se = toStorageError(err);
      this.setState({ status: se.kind === 'quota' ? 'quota' : 'error', error: se });
      this.schedule(this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
      throw se;
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }
}

export const saveQueue = new SaveQueue();
