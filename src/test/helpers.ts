import { PencilNotesDB, setDB } from '@/db/db';
import { uuid } from '@/lib/id';
import type { StrokeElement, StrokePoint } from '@/model/types';
import { strokeBBox } from '@/engine/geometry';

/** Fresh, uniquely named database for each test. */
export function useTestDB(): PencilNotesDB {
  const db = new PencilNotesDB(`test-${uuid()}`);
  setDB(db);
  return db;
}

export function pts(coords: [number, number][], pressure = 0.5): StrokePoint[] {
  return coords.map(([x, y], i) => ({ x, y, pressure, timestamp: i * 8, tiltX: 0, tiltY: 0 }));
}

export function makeStroke(points: StrokePoint[], extra: Partial<StrokeElement> = {}): StrokeElement {
  const baseWidth = extra.baseWidth ?? 2;
  return {
    id: uuid(),
    type: 'stroke',
    pageId: 'page-1',
    notebookId: 'nb-1',
    createdAt: 0,
    z: 1,
    tool: 'pen',
    penStyle: 'fountain',
    color: '#000000',
    baseWidth,
    opacity: 1,
    points,
    boundingBox: strokeBBox(points, baseWidth),
    ...extra,
  };
}
