import type { Asset, Folder, Notebook, Page, PageElement } from '@/model/types';

export const BACKUP_FORMAT = 'pencil-notes-backup';
/**
 * Backup format version. Bump when the manifest shape changes and add a step to
 * migrateManifest() so older backups keep restoring.
 */
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;

export type AssetMeta = Omit<Asset, 'blob'> & { file: string };

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  appVersion: string;
  scope: 'notebook' | 'library';
  folders: Folder[];
  notebooks: Notebook[];
  pages: Page[];
  elements: PageElement[];
  assets: AssetMeta[];
}

export class BackupValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Файл резервной копии повреждён или имеет неверный формат: ${problems.slice(0, 3).join('; ')}`);
    this.name = 'BackupValidationError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Upgrades older manifests to the current version (no older versions exist yet). */
export function migrateManifest(raw: Record<string, unknown>): Record<string, unknown> {
  const m = { ...raw };
  // Example for the future:
  // if (m.version === 1) { ...transform...; m.version = 2; }
  return m;
}

/**
 * Structural validation of an untrusted manifest. Checks types of every field that the app
 * relies on and referential integrity, so a malformed file cannot corrupt the database.
 */
export function validateManifest(raw: unknown): BackupManifest {
  const problems: string[] = [];
  if (!isObj(raw)) throw new BackupValidationError(['манифест не является объектом']);
  if (raw.format !== BACKUP_FORMAT) throw new BackupValidationError(['неизвестный формат файла']);
  if (!isNum(raw.version) || raw.version < 1) throw new BackupValidationError(['не указана версия формата']);
  if (raw.version > BACKUP_VERSION) throw new BackupValidationError([`копия создана более новой версией приложения (формат ${raw.version})`]);
  const m = migrateManifest(raw);
  for (const key of ['folders', 'notebooks', 'pages', 'elements', 'assets'] as const) {
    if (!Array.isArray(m[key])) problems.push(`отсутствует раздел ${key}`);
  }
  if (problems.length) throw new BackupValidationError(problems);

  const folders = m.folders as unknown[];
  const notebooks = m.notebooks as unknown[];
  const pages = m.pages as unknown[];
  const elements = m.elements as unknown[];
  const assets = m.assets as unknown[];

  const folderIds = new Set<string>();
  folders.forEach((f, i) => {
    if (!isObj(f) || !isStr(f.id) || !isStr(f.name) || !(f.parentId === null || isStr(f.parentId))) problems.push(`папка #${i}`);
    else folderIds.add(f.id);
  });
  const nbIds = new Set<string>();
  notebooks.forEach((n, i) => {
    if (!isObj(n) || !isStr(n.id) || !isStr(n.title) || !(n.kind === 'notebook' || n.kind === 'pdf') || !isObj(n.defaultSetup)) problems.push(`документ #${i}`);
    else nbIds.add(n.id);
  });
  const assetIds = new Set<string>();
  assets.forEach((a, i) => {
    if (!isObj(a) || !isStr(a.id) || !(a.kind === 'image' || a.kind === 'pdf') || !isStr(a.file) || !isStr(a.mime)) problems.push(`файл #${i}`);
    else if (!/^assets\/[\w-]+\.bin$/.test(a.file)) problems.push(`недопустимый путь файла #${i}`);
    else assetIds.add(a.id);
  });
  const pageIds = new Set<string>();
  pages.forEach((p, i) => {
    if (!isObj(p) || !isStr(p.id) || !isStr(p.notebookId) || !isNum(p.width) || !isNum(p.height) || !isNum(p.order) || !isStr(p.template)) {
      problems.push(`страница #${i}`);
      return;
    }
    if (!nbIds.has(p.notebookId)) problems.push(`страница #${i} ссылается на отсутствующий документ`);
    if (p.width <= 0 || p.height <= 0 || p.width > 20000 || p.height > 20000) problems.push(`страница #${i}: недопустимый размер`);
    if (p.pdf !== null && p.pdf !== undefined) {
      if (!isObj(p.pdf) || !isStr(p.pdf.assetId) || !isNum(p.pdf.pageIndex) || !assetIds.has(p.pdf.assetId)) problems.push(`страница #${i}: повреждена ссылка на PDF`);
    }
    pageIds.add(p.id);
  });
  elements.forEach((e, i) => {
    if (!isObj(e) || !isStr(e.id) || !isStr(e.pageId) || !isNum(e.z)) {
      problems.push(`элемент #${i}`);
      return;
    }
    if (!pageIds.has(e.pageId)) problems.push(`элемент #${i} ссылается на отсутствующую страницу`);
    if (e.type === 'stroke') {
      if (!Array.isArray(e.points) || !isStr(e.color) || !isNum(e.baseWidth) || !isObj(e.boundingBox)) problems.push(`штрих #${i}`);
      else if (!(e.points as unknown[]).every((p) => isObj(p) && isNum(p.x) && isNum(p.y) && isNum(p.pressure))) problems.push(`штрих #${i}: точки`);
    } else if (e.type === 'text') {
      if (!isStr(e.text) || !isNum(e.x) || !isNum(e.y) || !isNum(e.width) || !isNum(e.fontSize)) problems.push(`текст #${i}`);
    } else if (e.type === 'image') {
      if (!isStr(e.assetId) || !assetIds.has(e.assetId) || !isNum(e.width) || !isNum(e.height)) problems.push(`изображение #${i}`);
    } else if (e.type === 'shape') {
      if (!isStr(e.kind) || !isNum(e.x) || !isNum(e.y) || !isNum(e.width) || !isNum(e.height) || !isStr(e.stroke) || !isNum(e.strokeWidth)) problems.push(`фигура #${i}`);
    } else problems.push(`элемент #${i}: неизвестный тип`);
  });
  if (problems.length) throw new BackupValidationError(problems);
  return m as unknown as BackupManifest;
}
