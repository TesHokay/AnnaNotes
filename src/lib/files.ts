import { isAppleTouchDevice, sanitizeFileName } from './utils';

/**
 * Hands a generated file to the user. On iPad/iPhone the share sheet is the most reliable way
 * to save into Files (downloads from standalone PWAs are inconsistent across iOS versions);
 * elsewhere a regular download is used.
 */
export async function saveFile(data: Blob | Uint8Array, fileName: string, mime: string): Promise<void> {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const name = sanitizeFileName(fileName);
  if (isAppleTouchDevice() && typeof navigator.canShare === 'function') {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        // fall through to download
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Opens the native file picker. Resolves with the chosen files (empty when cancelled). */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files ? [...input.files] : []);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}
