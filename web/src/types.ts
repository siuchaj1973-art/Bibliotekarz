export type MediaKind = 'ebook' | 'audiobook';

export interface MediaFile {
  id: number;
  itemId: number;
  relPath: string;
  format: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  trackNo: number | null;
}

export interface Chapter {
  id: number;
  index: number;
  title: string;
  startSec: number;
  endSec: number | null;
  fileId: number | null;
}

export interface Progress {
  itemId: number;
  positionSec: number | null;
  locator: string | null;
  progressPct: number;
  status: 'unread' | 'reading' | 'finished';
  finishedAt: string | null;
  updatedAt: string;
}

export interface Item {
  id: number;
  kind: MediaKind;
  title: string;
  subtitle: string | null;
  authors: string[];
  narrators: string[];
  series: string | null;
  seriesIndex: number | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  isbn: string | null;
  asin: string | null;
  description: string | null;
  tags: string[];
  rating: number | null;
  coverPath: string | null;
  durationSec: number | null;
  addedAt: string;
  updatedAt: string;
  files: MediaFile[];
  chapters: Chapter[];
  progress: Progress | null;
  collections?: number[];
}

export interface Collection {
  id: number;
  name: string;
  description: string | null;
  kind: 'shelf' | 'smart';
  itemCount: number;
}

export interface Facet {
  name: string;
  count: number;
}

export interface Stats {
  ebooks: number;
  audiobooks: number;
  authors: number;
  series: number;
  reading: number;
  finished: number;
  files: number;
  audioSeconds: number;
}

export interface ScanState {
  running: boolean;
  startedAt: string | null;
  lastResult: {
    scannedFiles: number;
    addedItems: number;
    updatedItems: number;
    removedItems: number;
    errors: { path: string; message: string }[];
    durationMs: number;
  } | null;
  lastError: string | null;
}

export interface ListResult {
  items: Item[];
  total: number;
}

export interface EpubManifest {
  fileId: number;
  opfDir: string;
  spine: { id: string; href: string; mediaType: string }[];
  toc: { title: string; href: string }[];
  resources: Record<string, { href: string; mediaType: string }>;
}
