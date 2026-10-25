/**
 * Persistent document model. All geometry is stored in document units (PostScript points,
 * 1/72 inch), independent of screen resolution. Page-local coordinates have their origin in
 * the top-left corner of the page with Y pointing down.
 */

export type UUID = string;

export type PaperSize = 'A4' | 'A5' | 'Letter';
export type Orientation = 'portrait' | 'landscape';
export type PageTemplate = 'blank' | 'grid' | 'lined' | 'dotted';

/** Built-in decorative papers (Cute Paper). Definitions live in model/cutePaper.ts. */
export type CutePaperId = 'strawberry' | 'lavender' | 'vanilla' | 'matcha' | 'sakura' | 'hearts' | 'gingham' | 'beige' | 'sky' | 'moonlight';

/**
 * Optional ruling/decoration settings of a page (the "PaperTemplate" applied to it). Absent on
 * pages created before 4.3, which keep the classic look.
 */
export interface PaperStyle {
  cute?: CutePaperId;
  /** Grid size / line spacing in points (overrides the template default). */
  spacing?: number;
  /** Ruling colour (#rrggbb); drawn with the template's usual transparency. */
  lineColor?: string;
  /** Decorative details of a cute paper (sakura corners, hearts along the edges). Default on. */
  decor?: boolean;
}

export interface PageSetup {
  size: PaperSize;
  orientation: Orientation;
  template: PageTemplate;
  paperColor: string;
  style?: PaperStyle;
}

export interface Folder {
  id: UUID;
  name: string;
  parentId: UUID | null;
  createdAt: number;
  updatedAt: number;
}

export type NotebookKind = 'notebook' | 'pdf';

export interface Notebook {
  id: UUID;
  title: string;
  kind: NotebookKind;
  folderId: UUID | null;
  coverColor: string;
  favorite: 0 | 1;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  /** Soft delete timestamp; 0 = not deleted. Numbers (not null) so the field can be indexed. */
  deletedAt: number;
  pageCount: number;
  defaultSetup: PageSetup;
  /** Bumped when the custom cover changes (see NotebookCoverRecord); busts cached thumbnails. */
  coverVersion?: number;
}

export interface PdfPageRef {
  assetId: UUID;
  pageIndex: number;
}

export interface Page {
  id: UUID;
  notebookId: UUID;
  /** Sort key inside the notebook; fractional values allow cheap reordering. */
  order: number;
  width: number;
  height: number;
  size: PaperSize | 'custom';
  template: PageTemplate;
  paperColor: string;
  style?: PaperStyle;
  pdf: PdfPageRef | null;
  /** Denormalised copy of pdf.assetId for indexing (schema v2). */
  pdfAssetId?: UUID;
  bookmarked: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface StrokePoint {
  x: number;
  y: number;
  /** Normalised, calibrated pressure 0..1 (real or simulated). */
  pressure: number;
  /** ms since stroke start */
  timestamp: number;
  tiltX: number;
  tiltY: number;
}

export type StrokeTool = 'pen' | 'highlighter' | 'shape';
/** 'ball' is the legacy id of 'ballpoint' (kept so old documents render unchanged). */
export type PenStyle = 'ballpoint' | 'fountain' | 'calligraphy' | 'brush' | 'fineliner' | 'pencil' | 'marker' | 'monoline' | 'ball';
export type ShapeKind = 'line' | 'arrow' | 'rectangle' | 'circle' | 'ellipse' | 'triangle';

interface ElementBase {
  id: UUID;
  pageId: UUID;
  notebookId: UUID;
  createdAt: number;
  /** Stacking order inside the page (monotonic, from creation time). */
  z: number;
}

export interface StrokeElement extends ElementBase {
  type: 'stroke';
  tool: StrokeTool;
  penStyle: PenStyle;
  color: string;
  baseWidth: number;
  opacity: number;
  points: StrokePoint[];
  boundingBox: BBox;
  shape?: ShapeKind;
  /** The device reported no real pressure; widths come from speed/direction simulation. */
  simulatedPressure?: boolean;
  /** User's minimum width (fraction of baseWidth) at the time of writing; overrides the pen default. */
  minWidthRatio?: number;
}

export type TextAlign = 'left' | 'center' | 'right';
export type FontFamilyKey = 'system' | 'serif' | 'mono' | 'rounded';

export interface TextElement extends ElementBase {
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  /** radians, clockwise around the box centre */
  rotation: number;
  text: string;
  fontFamily: FontFamilyKey;
  fontSize: number;
  color: string;
  align: TextAlign;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  assetId: UUID;
  /** Mirror horizontally / vertically (stickers). */
  flipX?: boolean;
  flipY?: boolean;
  /** 0..1, default 1. */
  opacity?: number;
  /** Set for stickers: the library sticker id (`builtin:<id>` or `custom:<uuid>`). */
  sticker?: string;
}

export type ShapeElementKind = 'line' | 'arrow' | 'rectangle' | 'roundedRect' | 'ellipse' | 'triangle' | 'polygon' | 'freeform';

/** Editable vector shape: box + rotation, optional box-local points (line/arrow/polygon). */
export interface ShapeElement extends ElementBase {
  type: 'shape';
  kind: ShapeElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  points?: { x: number; y: number }[];
  stroke: string;
  strokeWidth: number;
  opacity: number;
  /** Fill colour, or null for no fill. */
  fill: string | null;
  cornerRadius?: number;
}

export type PageElement = StrokeElement | TextElement | ImageElement | ShapeElement;

export type AssetKind = 'image' | 'pdf';

export interface Asset {
  id: UUID;
  kind: AssetKind;
  mime: string;
  name: string;
  size: number;
  blob: Blob;
  width?: number;
  height?: number;
  createdAt: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface BackupMetadata {
  id: UUID;
  kind: 'notebook' | 'library';
  direction: 'export' | 'import';
  name: string;
  size: number;
  createdAt: number;
}

/** A sticker the user imported into the Sticker Studio library (built-in stickers live in code). */
export interface StickerAsset {
  id: UUID;
  name: string;
  mime: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

export type CoverPattern = 'none' | 'dots' | 'stripes' | 'grid' | 'gingham' | 'hearts' | 'stars' | 'flowers' | 'waves' | 'linen';
export type CoverDecor = 'bow' | 'heart' | 'flower' | 'star' | 'frame' | 'corners' | 'gold';
export type CoverFont = 'serif' | 'sans' | 'rounded' | 'script' | 'mono';

/** Structured description of a custom notebook cover. */
export interface CoverDesign {
  preset?: string;
  background: string;
  pattern: CoverPattern;
  patternColor: string;
  title: string;
  font: CoverFont;
  /** Title size relative to the cover width (0.05..0.16). */
  fontSize: number;
  textColor: string;
  /** Title position: vertical centre as a fraction of the height (0..1) and alignment. */
  textY: number;
  align: 'left' | 'center' | 'right';
  /** Title on a soft label plate. */
  label: boolean;
  decor: CoverDecor[];
  accent: string;
  /** Photo placement (present when a photo is stored): scale ≥ 1 covers the area; x/y offsets -1..1. */
  photo?: { scale: number; x: number; y: number; area: 'full' | 'window' };
}

/** NotebookCover entity: one per notebook (id = notebook id). */
export interface NotebookCoverRecord {
  id: UUID;
  design: CoverDesign;
  photo?: Blob;
  /** Rendered 300×400 JPEG for the library grid. */
  thumb?: Blob;
  updatedAt: number;
}
