import { unzipSync } from 'fflate';

export const MAX_ZIP_BYTES = 1536 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 200 * 1024 * 1024;
export const MAX_TOTAL_UNPACKED = 3 * 1024 * 1024 * 1024;

export interface ZipEntryInfo {
  /** Path as stored in the archive (raw, used to extract). */
  raw: string;
  /** Cleaned, display-safe path segments. */
  segments: string[];
  size: number;
}

/**
 * ZIP file names without the UTF-8 flag are decoded by fflate as Latin-1. Windows Explorer and
 * older tools store Cyrillic names that way in CP866; macOS uses UTF-8 without the flag. We
 * re-interpret the bytes: valid UTF-8 first, then CP866.
 */
export function fixZipName(name: string): string {
  if (!/[\u0080-ÿ]/.test(name)) return name;
  const bytes = Uint8Array.from(name, (c) => c.charCodeAt(0) & 0xff);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('ibm866').decode(bytes);
    } catch {
      return name;
    }
  }
}

/** Rejects absolute paths, drive letters and `..` traversal; drops OS metadata entries. */
export function safeSegments(path: string): string[] | null {
  const norm = fixZipName(path).replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) return null;
  const parts = norm.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  if (parts[0] === '__MACOSX' || parts.some((p) => p.startsWith('._') || p === '.DS_Store' || p === 'Thumbs.db')) return null;
  return parts.map((p) => p.replace(/[\u0000-\u001f]/g, '').slice(0, 200));
}

/** Lists entries without decompressing anything. */
export function listZip(data: Uint8Array): ZipEntryInfo[] {
  const out: ZipEntryInfo[] = [];
  let total = 0;
  unzipSync(data, {
    filter: (f) => {
      if (f.name.endsWith('/')) return false;
      const segments = safeSegments(f.name);
      if (segments && segments.length) {
        total += f.originalSize;
        out.push({ raw: f.name, segments, size: f.originalSize });
      }
      return false;
    },
  });
  if (total > MAX_TOTAL_UNPACKED) throw new Error('Архив слишком большой после распаковки');
  return out;
}

/** Decompresses a single entry (one at a time keeps memory bounded). */
export function extractEntry(data: Uint8Array, entry: ZipEntryInfo): Uint8Array {
  if (entry.size > MAX_ENTRY_BYTES) throw new Error(`Файл «${entry.segments.at(-1)}» больше ${MAX_ENTRY_BYTES / 1024 / 1024} МБ`);
  const files = unzipSync(data, { filter: (f) => f.name === entry.raw });
  const bytes = files[entry.raw];
  if (!bytes) throw new Error('Не удалось распаковать файл');
  // Header sizes are attacker-controlled: verify what we actually got.
  if (bytes.byteLength > MAX_ENTRY_BYTES) throw new Error('Файл в архиве превышает допустимый размер');
  return bytes;
}

export function isZipBytes(head: Uint8Array): boolean {
  return head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05);
}
