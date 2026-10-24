export type StorageErrorKind = 'quota' | 'unavailable' | 'unknown';

export class StorageError extends Error {
  constructor(
    public readonly kind: StorageErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; inner?: unknown; message?: string; code?: number };
  if (e.name === 'QuotaExceededError' || e.code === 22) return true;
  // Dexie wraps native errors; Safari sometimes reports quota problems as UnknownError.
  if (e.inner && isQuotaError(e.inner)) return true;
  return typeof e.message === 'string' && /quota|exceeded|storage.*full/i.test(e.message);
}

export function toStorageError(err: unknown): StorageError {
  if (err instanceof StorageError) return err;
  if (isQuotaError(err)) return new StorageError('quota', 'Хранилище устройства заполнено. Освободите место или удалите ненужные документы.', err);
  const name = (err as { name?: string } | null)?.name;
  if (name === 'InvalidStateError' || name === 'MissingAPIError' || name === 'DatabaseClosedError' || name === 'OpenFailedError') {
    return new StorageError('unavailable', 'Локальная база данных недоступна. В приватном режиме Safari хранение может быть отключено.', err);
  }
  return new StorageError('unknown', `Ошибка сохранения: ${(err as Error)?.message ?? String(err)}`, err);
}
