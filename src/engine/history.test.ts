import { describe, expect, it, vi } from 'vitest';
import { History } from './history';
import { DocumentModel } from './DocumentModel';
import { makeStroke, pts } from '@/test/helpers';

describe('History', () => {
  it('undo returns the inverse and redo re-applies', () => {
    const h = new History();
    const a = makeStroke(pts([[0, 0], [1, 1]]));
    h.push({ label: 'add', removed: [], added: [a] });
    expect(h.canUndo).toBe(true);
    const u = h.undo()!;
    expect(u.removed[0]!.id).toBe(a.id);
    expect(u.added).toHaveLength(0);
    expect(h.canRedo).toBe(true);
    expect(h.redo()!.added[0]!.id).toBe(a.id);
  });

  it('a new command clears redo and the stack is bounded', () => {
    const h = new History(3);
    for (let i = 0; i < 5; i++) h.push({ label: String(i), removed: [], added: [makeStroke(pts([[i, i]]))] });
    expect(h.size).toBe(3);
    h.undo();
    h.push({ label: 'x', removed: [], added: [makeStroke(pts([[9, 9]]))] });
    expect(h.canRedo).toBe(false);
  });

  it('snapshots are deep copies', () => {
    const h = new History();
    const a = makeStroke(pts([[0, 0], [1, 1]]));
    h.push({ label: 'add', removed: [], added: [a] });
    a.points[0]!.x = 999;
    expect((h.undo()!.removed[0] as typeof a).points[0]!.x).toBe(0);
  });
});

describe('DocumentModel', () => {
  const setup = () => {
    const enqueue = vi.fn();
    const stored = [makeStroke(pts([[0, 0], [5, 5]]), { id: 'old', z: 1 })];
    const model = new DocumentModel('nb-1', async () => stored.map((s) => ({ ...s })), { enqueue });
    return { model, enqueue };
  };

  it('applies, persists and undoes changes', async () => {
    const { model, enqueue } = setup();
    await model.ensureLoaded('page-1');
    const s = makeStroke(pts([[10, 10], [20, 20]]), { id: 'new', z: 2 });
    model.apply({ removed: [], added: [s] }, { history: 'Штрих', persist: true });
    expect(model.getElements('page-1')!.map((e) => e.id)).toEqual(['old', 'new']);
    expect(enqueue).toHaveBeenLastCalledWith([s], []);
    model.undo();
    expect(model.getElements('page-1')!.map((e) => e.id)).toEqual(['old']);
    expect(enqueue).toHaveBeenLastCalledWith([], ['new']);
    model.redo();
    expect(model.getElements('page-1')!.map((e) => e.id)).toEqual(['old', 'new']);
  });

  it('updates (remove + add with the same id) persist as a put, not a delete', async () => {
    const { model, enqueue } = setup();
    const [old] = await model.ensureLoaded('page-1');
    const recolored = { ...old!, color: '#ff0000' };
    model.apply({ removed: [old!], added: [recolored] }, { history: 'Цвет', persist: true });
    expect(enqueue).toHaveBeenLastCalledWith([recolored], []);
    expect(model.getElement('page-1', 'old')).toMatchObject({ color: '#ff0000' });
  });

  it('transient changes are not recorded until committed', async () => {
    const { model, enqueue } = setup();
    const [old] = await model.ensureLoaded('page-1');
    model.apply({ removed: [old!], added: [] }, { history: null, persist: false });
    expect(enqueue).not.toHaveBeenCalled();
    expect(model.history.canUndo).toBe(false);
    model.commitTransient({ removed: [old!], added: [] }, 'Ластик');
    expect(enqueue).toHaveBeenCalledWith([], ['old']);
    model.undo();
    expect(model.getElements('page-1')!.map((e) => e.id)).toEqual(['old']);
  });

  it('does not create partial pages for unloaded pages (undo after eviction)', async () => {
    const { model } = setup();
    await model.ensureLoaded('page-1');
    const s = makeStroke(pts([[1, 1], [2, 2]]), { id: 'x', z: 5 });
    model.apply({ removed: [], added: [s] }, { history: 'Штрих', persist: true });
    model.evictExcept(new Set());
    model.undo();
    expect(model.isLoaded('page-1')).toBe(false);
  });
});
