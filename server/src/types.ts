export type MediaKind = 'ebook' | 'audiobook';

/** A physical file backing an item (e.g. the same book as EPUB + MOBI, or a multi-file audiobook). */
export interface MediaFile {
  id: number;
  itemId: number;
  path: string; // absolute path on disk
  relPath: string; // relative to the library root
  format: string; // epub, pdf, mobi, mp3, m4b, ...
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null; // audio only
  hash: string; // sha1 of file contents (for dedupe / change detection)
  mtimeMs: number;
  trackNo: number | null; // ordering for multi-file audiobooks
}

export interface Chapter {
  id: number;
  itemId: number;
  fileId: number | null;
  index: number;
  title: string;
  startSec: number; // offset within the whole audiobook timeline
  endSec: number | null;
}

export interface Item {
  id: number;
  kind: MediaKind;
  title: string;
  sortTitle: string;
  subtitle: string | null;
  authors: string[];
  narrators: string[]; // audiobook readers
  series: string | null;
  seriesIndex: number | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  isbn: string | null;
  asin: string | null;
  description: string | null;
  tags: string[];
  rating: number | null; // 0..5, one decimal
  coverPath: string | null; // relative filename inside covers dir
  durationSec: number | null; // audiobook total
  addedAt: string;
  updatedAt: string;
  files: MediaFile[];
  chapters: Chapter[];
  progress?: Progress | null;
}

export interface Progress {
  itemId: number;
  positionSec: number | null; // audiobook playback position
  locator: string | null; // ebook reading locator (chapter href + offset)
  progressPct: number; // 0..100
  status: 'unread' | 'reading' | 'finished';
  finishedAt: string | null;
  updatedAt: string;
}

export interface Collection {
  id: number;
  name: string;
  description: string | null;
  kind: 'shelf' | 'smart';
  rules: string | null; // JSON for smart collections
  createdAt: string;
  itemCount?: number;
}

export interface ScanResult {
  scannedFiles: number;
  addedItems: number;
  updatedItems: number;
  removedItems: number;
  errors: { path: string; message: string }[];
  durationMs: number;
}

/** Metadata extracted from a single file by a format-specific parser. */
export interface ParsedMedia {
  kind: MediaKind;
  title?: string;
  subtitle?: string;
  authors?: string[];
  narrators?: string[];
  series?: string;
  seriesIndex?: number;
  publisher?: string;
  publishedYear?: number;
  language?: string;
  isbn?: string;
  asin?: string;
  description?: string;
  tags?: string[];
  durationSec?: number;
  trackNo?: number;
  trackTitle?: string; // per-file title (becomes a chapter name for multi-file audiobooks)
  albumTitle?: string; // for grouping multi-file audiobooks
  chapters?: { title: string; startSec: number; endSec?: number }[];
  cover?: { data: Buffer; mimeType: string };
}
