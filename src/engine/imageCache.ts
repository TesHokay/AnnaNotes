import type { UUID } from '@/model/types';

export type DecodedImage = ImageBitmap | HTMLImageElement;

interface Entry {
  image: DecodedImage | null;
  promise: Promise<DecodedImage | null>;
  lastUsed: number;
}

async function decode(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through to <img> decoding (older Safari, unusual formats) */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decoded image assets shared by all canvases, with LRU eviction to cap memory. */
export class ImageCache {
  private entries = new Map<UUID, Entry>();
  private listeners = new Set<(id: UUID) => void>();

  constructor(
    private readonly fetchBlob: (id: UUID) => Promise<Blob | undefined>,
    private readonly maxEntries = 48,
  ) {}

  onLoad(fn: (id: UUID) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Synchronous lookup for rendering; starts loading on a miss. */
  get(id: UUID): DecodedImage | null {
    const e = this.entries.get(id);
    if (e) {
      e.lastUsed = performance.now();
      return e.image;
    }
    void this.load(id);
    return null;
  }

  load(id: UUID): Promise<DecodedImage | null> {
    const existing = this.entries.get(id);
    if (existing) return existing.promise;
    const entry: Entry = { image: null, lastUsed: performance.now(), promise: Promise.resolve(null) };
    entry.promise = this.fetchBlob(id)
      .then((blob) => (blob ? decode(blob) : null))
      .then((img) => {
        entry.image = img;
        if (img) for (const l of this.listeners) l(id);
        return img;
      })
      .catch(() => null);
    this.entries.set(id, entry);
    this.evict();
    return entry.promise;
  }

  private evict(): void {
    if (this.entries.size <= this.maxEntries) return;
    const sorted = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id, e] of sorted.slice(0, this.entries.size - this.maxEntries)) {
      if (e.image && 'close' in e.image) e.image.close();
      this.entries.delete(id);
    }
  }

  clear(): void {
    for (const e of this.entries.values()) if (e.image && 'close' in e.image) e.image.close();
    this.entries.clear();
  }
}
