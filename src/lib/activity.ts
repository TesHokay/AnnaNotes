/**
 * Long-running user operations in progress (export, backup, restore). Decorative features ask
 * this before showing anything, so they never appear in the middle of such work.
 */
let running = 0;

export function isBackgroundTaskRunning(): boolean {
  return running > 0;
}

export async function trackTask<T>(fn: () => Promise<T>): Promise<T> {
  running++;
  try {
    return await fn();
  } finally {
    running--;
  }
}
