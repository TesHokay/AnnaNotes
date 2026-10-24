import Dexie, { type EntityTable } from 'dexie';
import type { Asset, BackupMetadata, Folder, Notebook, Page, PageElement, SettingRecord } from '@/model/types';

export const DB_NAME = 'pencil-notes';

/**
 * Schema history. Never edit an existing version: add a new one with an upgrade function so
 * existing users' data is migrated in place when the app updates.
 *
 * v1 — initial schema.
 * v2 — indexes elements.assetId and pages.pdfAssetId (asset reference counting) and
 *      backfills them; normalises missing `bookmarked` flags.
 */
export const SCHEMA_V1 = {
  folders: 'id, parentId, name',
  notebooks: 'id, folderId, updatedAt, openedAt, title, deletedAt, favorite',
  pages: 'id, notebookId, [notebookId+order]',
  elements: 'id, pageId, notebookId',
  assets: 'id, kind',
  settings: 'key',
  backupsMetadata: 'id, createdAt',
} as const;

export const SCHEMA_V2 = {
  ...SCHEMA_V1,
  pages: 'id, notebookId, [notebookId+order], pdfAssetId',
  elements: 'id, pageId, notebookId, assetId',
} as const;

export class PencilNotesDB extends Dexie {
  folders!: EntityTable<Folder, 'id'>;
  notebooks!: EntityTable<Notebook, 'id'>;
  pages!: EntityTable<Page, 'id'>;
  elements!: EntityTable<PageElement, 'id'>;
  assets!: EntityTable<Asset, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;
  backupsMetadata!: EntityTable<BackupMetadata, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    this.version(2)
      .stores(SCHEMA_V2)
      .upgrade(async (tx) => {
        await tx
          .table('pages')
          .toCollection()
          .modify((page: Page) => {
            if (page.pdf && !page.pdfAssetId) page.pdfAssetId = page.pdf.assetId;
            if (page.bookmarked !== 0 && page.bookmarked !== 1) page.bookmarked = page.bookmarked ? 1 : 0;
          });
        // assetId on image elements already exists as a field; re-put so the new index is populated.
        await tx
          .table('elements')
          .filter((el: PageElement) => el.type === 'image')
          .modify(() => {});
      });
  }
}

export const CURRENT_SCHEMA_VERSION = 2;

let instance: PencilNotesDB | null = null;

export function getDB(): PencilNotesDB {
  if (!instance) instance = new PencilNotesDB();
  return instance;
}

/** Test hook: replace the singleton (e.g. with a freshly named database). */
export function setDB(db: PencilNotesDB | null): void {
  instance = db;
}
