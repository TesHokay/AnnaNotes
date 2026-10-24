export const MAX_PDF_BYTES = 200 * 1024 * 1024;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export async function readHeader(blob: Blob, n: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, n).arrayBuffer());
}

/** Signature check: "%PDF-" may be preceded by a little garbage; the spec allows it within the first 1024 bytes. */
export async function isPdf(blob: Blob): Promise<boolean> {
  const head = await readHeader(blob, 1024);
  return new TextDecoder('latin1').decode(head).includes('%PDF-');
}
