// pdf.js 4 uses Promise.withResolvers, which Safari only has since 17.4 (iPadOS 17.4).
if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function') {
  (Promise as unknown as { withResolvers: () => unknown }).withResolvers = function withResolvers<T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// CanvasRenderingContext2D.roundRect / Path2D.roundRect arrived in Safari 16 (covers, stickers).
type RoundRectHost = { roundRect?: (x: number, y: number, w: number, h: number, r?: number) => void; moveTo(x: number, y: number): void; arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void; closePath(): void };
for (const proto of [typeof CanvasRenderingContext2D !== 'undefined' ? CanvasRenderingContext2D.prototype : null, typeof Path2D !== 'undefined' ? Path2D.prototype : null]) {
  const p = proto as unknown as RoundRectHost | null;
  if (p && typeof p.roundRect !== 'function') {
    p.roundRect = function roundRect(this: RoundRectHost, x: number, y: number, w: number, h: number, r = 0) {
      const rr = Math.max(0, Math.min(typeof r === 'number' ? r : 0, Math.abs(w) / 2, Math.abs(h) / 2));
      this.moveTo(x + rr, y);
      this.arcTo(x + w, y, x + w, y + h, rr);
      this.arcTo(x + w, y + h, x, y + h, rr);
      this.arcTo(x, y + h, x, y, rr);
      this.arcTo(x, y, x + w, y, rr);
      this.closePath();
    };
  }
}

export {};
