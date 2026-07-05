import fs from 'node:fs';
import path from 'node:path';
import type { Database } from './db.js';
import type { Config } from './config.js';
import type { ParsedMedia, ScanResult, MediaKind } from './types.js';
import {
  formatOf, kindForFormat, mimeForFormat, hashFile, titleFromFilename,
} from './util.js';
import { parseEpub } from './formats/epub.js';
import { parsePdf } from './formats/pdf.js';
import { parseAudio } from './formats/audio.js';
import { saveCover, coverImageInDir } from './covers.js';
import * as repo from './repo.js';
import { log } from './logger.js';

interface DiskFile {
  path: string;
  relPath: string;
  dir: string;
  format: string;
  kind: MediaKind;
  size: number;
  mtimeMs: number;
  hash: string;
  changed: boolean; // hash differs from DB / new file
  existingItemId?: number;
}

function walk(root: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export async function scanLibrary(db: Database, config: Config): Promise<ScanResult> {
  const started = Date.now();
  const result: ScanResult = { scannedFiles: 0, addedItems: 0, updatedItems: 0, removedItems: 0, errors: [], durationMs: 0 };

  if (!fs.existsSync(config.libraryDir)) {
    fs.mkdirSync(config.libraryDir, { recursive: true });
  }

  const dbFiles = new Map<string, { hash: string; mtimeMs: number; size: number; itemId: number }>();
  for (const p of repo.allFilePaths(db)) {
    const f = repo.findFileByPath(db, p);
    if (f) dbFiles.set(p, { hash: f.hash, mtimeMs: f.mtimeMs, size: f.sizeBytes, itemId: f.itemId });
  }

  const rawPaths: string[] = [];
  walk(config.libraryDir, rawPaths);

  const diskFiles: DiskFile[] = [];
  const seenPaths = new Set<string>();

  for (const full of rawPaths) {
    const format = formatOf(full);
    const kind = kindForFormat(format);
    if (!kind) continue;
    seenPaths.add(full);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    result.scannedFiles++;
    const known = dbFiles.get(full);
    const quickUnchanged = known && known.mtimeMs === stat.mtimeMs && known.size === stat.size;
    let hash: string;
    let changed: boolean;
    if (quickUnchanged) {
      hash = known!.hash;
      changed = false;
    } else {
      try {
        hash = await hashFile(full);
      } catch (err) {
        result.errors.push({ path: full, message: (err as Error).message });
        continue;
      }
      changed = !known || known.hash !== hash;
    }
    diskFiles.push({
      path: full,
      relPath: path.relative(config.libraryDir, full),
      dir: path.dirname(full),
      format,
      kind,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash,
      changed,
      existingItemId: known?.itemId,
    });
  }

  // Remove files that vanished from disk. Only reconcile paths *inside* the
  // scanned library root, so files imported from elsewhere (e.g. a Calibre
  // library) are never deleted by a routine scan.
  const rootPrefix = path.resolve(config.libraryDir) + path.sep;
  const removedPaths = [...dbFiles.keys()].filter(
    (p) => !seenPaths.has(p) && (p + path.sep).startsWith(rootPrefix),
  );
  if (removedPaths.length) {
    const orphaned = repo.deleteFilesUnder(db, removedPaths);
    result.removedItems += orphaned.length;
    log.info(`Skaner: usunięto ${removedPaths.length} plików, ${orphaned.length} pozycji`);
  }

  // --- Group files into items ---
  const groups = buildGroups(diskFiles);

  for (const group of groups) {
    try {
      const outcome = await processGroup(db, config, group);
      if (outcome === 'added') result.addedItems++;
      else if (outcome === 'updated') result.updatedItems++;
    } catch (err) {
      result.errors.push({ path: group.files[0]?.path ?? '?', message: (err as Error).message });
      log.warn(`Skaner: błąd grupy ${group.files[0]?.relPath}:`, (err as Error).message);
    }
  }

  result.durationMs = Date.now() - started;
  return result;
}

interface Group {
  kind: MediaKind;
  files: DiskFile[];
}

function baseNameNoExt(p: string): string {
  return path.basename(p, path.extname(p)).toLowerCase();
}

/** Group disk files: audiobooks by directory, ebooks by directory + base filename. */
function buildGroups(files: DiskFile[]): Group[] {
  const audioByDir = new Map<string, DiskFile[]>();
  const ebookByKey = new Map<string, DiskFile[]>();

  for (const f of files) {
    if (f.kind === 'audiobook') {
      const list = audioByDir.get(f.dir) ?? [];
      list.push(f);
      audioByDir.set(f.dir, list);
    } else {
      const key = `${f.dir}::${baseNameNoExt(f.path)}`;
      const list = ebookByKey.get(key) ?? [];
      list.push(f);
      ebookByKey.set(key, list);
    }
  }

  const groups: Group[] = [];
  for (const list of audioByDir.values()) {
    list.sort((a, b) => naturalCompare(a.path, b.path));
    groups.push({ kind: 'audiobook', files: list });
  }
  for (const list of ebookByKey.values()) {
    list.sort((a, b) => naturalCompare(a.path, b.path));
    groups.push({ kind: 'ebook', files: list });
  }
  return groups;
}

async function processGroup(db: Database, config: Config, group: Group): Promise<'added' | 'updated' | 'skipped'> {
  const existingIds = new Set(group.files.map((f) => f.existingItemId).filter((v): v is number => v != null));
  const anyChanged = group.files.some((f) => f.changed);

  // Existing item + nothing changed + same file count → skip.
  if (existingIds.size === 1 && !anyChanged) {
    const itemId = [...existingIds][0];
    const existing = repo.getItem(db, itemId);
    if (existing && existing.files.length === group.files.length) return 'skipped';
  }

  const isNew = existingIds.size === 0;
  const itemId = isNew ? undefined : [...existingIds][0];

  return group.kind === 'audiobook'
    ? processAudiobook(db, config, group, itemId)
    : processEbook(db, config, group, itemId);
}

function toUpsert(kind: MediaKind, parsed: ParsedMedia, fallbackTitle: string): repo.UpsertItemInput {
  return {
    kind,
    title: parsed.title?.trim() || fallbackTitle,
    subtitle: parsed.subtitle ?? null,
    authors: parsed.authors?.filter(Boolean) ?? [],
    narrators: parsed.narrators?.filter(Boolean) ?? [],
    series: parsed.series ?? null,
    seriesIndex: parsed.seriesIndex ?? null,
    publisher: parsed.publisher ?? null,
    publishedYear: parsed.publishedYear ?? null,
    language: parsed.language ?? null,
    isbn: parsed.isbn ?? null,
    asin: parsed.asin ?? null,
    description: parsed.description ?? null,
    tags: parsed.tags?.filter(Boolean) ?? [],
    durationSec: parsed.durationSec ?? null,
  };
}

async function processEbook(db: Database, config: Config, group: Group, itemId?: number): Promise<'added' | 'updated'> {
  // Pick the richest format for metadata.
  const priority = ['epub', 'pdf', 'fb2', 'azw3', 'mobi', 'azw'];
  const primary = [...group.files].sort(
    (a, b) => (priority.indexOf(a.format) + 1 || 99) - (priority.indexOf(b.format) + 1 || 99),
  )[0];

  let parsed: ParsedMedia = { kind: 'ebook' };
  try {
    if (primary.format === 'epub') parsed = parseEpub(primary.path);
    else if (primary.format === 'pdf') parsed = parsePdf(primary.path);
  } catch (err) {
    log.warn(`Nie udało się odczytać metadanych ${primary.relPath}:`, (err as Error).message);
  }

  const input = toUpsert('ebook', parsed, titleFromFilename(primary.path));
  const id = itemId ?? repo.createItem(db, input);
  if (itemId) repo.updateItem(db, id, input);

  for (const f of group.files) {
    repo.upsertFile(db, {
      itemId: id, path: f.path, relPath: f.relPath, format: f.format,
      mimeType: mimeForFormat(f.format), sizeBytes: f.size, durationSec: null,
      hash: f.hash, mtimeMs: f.mtimeMs, trackNo: null,
    });
  }

  // Cover: embedded first, then a sidecar image in the folder.
  const cover = parsed.cover ?? coverImageInDir(primary.dir);
  if (cover) {
    const name = saveCover(config.coversDir, id, cover.data, cover.mimeType);
    repo.updateItem(db, id, { coverPath: name });
  }

  repo.replaceChapters(db, id, []);
  return itemId ? 'updated' : 'added';
}

async function processAudiobook(db: Database, config: Config, group: Group, itemId?: number): Promise<'added' | 'updated'> {
  // Parse every audio file (needed for durations, ordering, chapters).
  const parsedFiles: { file: DiskFile; parsed: ParsedMedia }[] = [];
  for (const f of group.files) {
    let parsed: ParsedMedia = { kind: 'audiobook' };
    try {
      parsed = await parseAudio(f.path);
    } catch (err) {
      log.warn(`Nie udało się odczytać tagów ${f.relPath}:`, (err as Error).message);
    }
    parsedFiles.push({ file: f, parsed });
  }

  // Order by track number when present, otherwise by natural filename order.
  parsedFiles.sort((a, b) => {
    const ta = a.parsed.trackNo ?? null;
    const tb = b.parsed.trackNo ?? null;
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    return naturalCompare(a.file.path, b.file.path);
  });

  const book = parsedFiles[0].parsed;
  const folderName = path.basename(group.files[0].dir);
  const input = toUpsert('audiobook', book, book.albumTitle?.trim() || book.title?.trim() || folderName);

  // Merge narrators/authors/tags across files.
  const narrators = new Set(input.narrators);
  const authors = new Set(input.authors);
  const tags = new Set(input.tags);
  for (const { parsed } of parsedFiles) {
    parsed.narrators?.forEach((n) => narrators.add(n));
    parsed.authors?.forEach((a) => authors.add(a));
    parsed.tags?.forEach((t) => tags.add(t));
  }
  input.narrators = [...narrators];
  input.authors = [...authors];
  input.tags = [...tags];

  const totalDuration = parsedFiles.reduce((sum, pf) => sum + (pf.parsed.durationSec ?? 0), 0);
  input.durationSec = totalDuration || null;

  const id = itemId ?? repo.createItem(db, input);
  if (itemId) repo.updateItem(db, id, input);

  // Persist files and build the chapter timeline.
  const chapters: { fileId: number | null; index: number; title: string; startSec: number; endSec: number | null }[] = [];
  let timeline = 0;
  let chapterIdx = 0;
  const singleFile = parsedFiles.length === 1;

  for (let i = 0; i < parsedFiles.length; i++) {
    const { file, parsed } = parsedFiles[i];
    const fileId = repo.upsertFile(db, {
      itemId: id, path: file.path, relPath: file.relPath, format: file.format,
      mimeType: mimeForFormat(file.format), sizeBytes: file.size,
      durationSec: parsed.durationSec ?? null, hash: file.hash, mtimeMs: file.mtimeMs,
      trackNo: parsed.trackNo ?? i + 1,
    });
    const fileDuration = parsed.durationSec ?? 0;

    if (singleFile && parsed.chapters && parsed.chapters.length > 0) {
      // Embedded chapters within one file.
      parsed.chapters.forEach((c, ci) => {
        const start = timeline + c.startSec;
        const next = parsed.chapters![ci + 1];
        const end = next ? timeline + next.startSec : fileDuration ? timeline + fileDuration : null;
        chapters.push({ fileId, index: chapterIdx++, title: c.title, startSec: start, endSec: end });
      });
    } else {
      // One chapter per file (folder-of-files audiobook) or single untagged file.
      const title = parsed.trackTitle?.trim() || titleFromFilename(file.path) || `Część ${i + 1}`;
      chapters.push({
        fileId, index: chapterIdx++, title,
        startSec: timeline, endSec: fileDuration ? timeline + fileDuration : null,
      });
    }
    timeline += fileDuration;
  }
  repo.replaceChapters(db, id, chapters);

  // Cover: embedded art, then a sidecar image in the folder.
  const embedded = parsedFiles.find((pf) => pf.parsed.cover)?.parsed.cover;
  const cover = embedded ?? coverImageInDir(group.files[0].dir);
  if (cover) {
    const name = saveCover(config.coversDir, id, cover.data, cover.mimeType);
    repo.updateItem(db, id, { coverPath: name });
  }

  return itemId ? 'updated' : 'added';
}
