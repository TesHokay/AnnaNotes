import type { PageElement } from '@/model/types';

/**
 * A reversible change set. Updates are expressed as removing the old version and adding the
 * new version of an element with the same id, so every command is symmetric.
 */
export interface ChangeSet {
  removed: PageElement[];
  added: PageElement[];
}

export interface Command extends ChangeSet {
  label: string;
  /** Commands with the same key pushed in quick succession merge into one undo step. */
  mergeKey?: string;
  at?: number;
}

export function invertChange(c: ChangeSet): ChangeSet {
  return { removed: c.added, added: c.removed };
}

export function isEmptyChange(c: ChangeSet): boolean {
  return c.removed.length === 0 && c.added.length === 0;
}

function cloneElement<T extends PageElement>(el: T): T {
  if (el.type === 'stroke') return { ...el, points: el.points.map((p) => ({ ...p })), boundingBox: { ...el.boundingBox } };
  return { ...el };
}

/** Linear undo/redo stack with a size limit. Stored elements are deep copies (immutable snapshots). */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  constructor(private readonly limit = 300) {}

  push(cmd: Command): void {
    if (isEmptyChange(cmd)) return;
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (cmd.mergeKey && top && top.mergeKey === cmd.mergeKey && now - (top.at ?? 0) < 1500) {
      // Keep the state before the first change, take the latest state as the result.
      top.added = cmd.added.map(cloneElement);
      top.at = now;
      this.redoStack = [];
      return;
    }
    this.undoStack.push({ label: cmd.label, removed: cmd.removed.map(cloneElement), added: cmd.added.map(cloneElement), mergeKey: cmd.mergeKey, at: now });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Returns the change to apply in order to undo, or null. */
  undo(): ChangeSet | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    this.redoStack.push(cmd);
    return invertChange(cmd);
  }

  redo(): ChangeSet | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    this.undoStack.push(cmd);
    return { removed: cmd.removed, added: cmd.added };
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get size(): number {
    return this.undoStack.length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Remove history entries that touch the given page (used when a page is deleted). */
  dropPage(pageId: string): void {
    const touches = (c: Command) => c.added.some((e) => e.pageId === pageId) || c.removed.some((e) => e.pageId === pageId);
    this.undoStack = this.undoStack.filter((c) => !touches(c));
    this.redoStack = this.redoStack.filter((c) => !touches(c));
  }
}
