import fs from 'node:fs';
import path from 'node:path';
import { openReadonly, type Database } from '../db.js';
import type { Config } from '../config.js';
import * as repo from '../repo.js';
import { parseAudio } from '../formats/audio.js';
import { saveCover } from '../covers.js';
import {
  formatOf, mimeForFormat, kindForFormat, hashFile, AUDIO_FORMATS,
} from '../util.js';
import { log } from '../logger.js';

export interface CalibreImportResult {
  booksInLibrary: number;
  imported: number;
  updated: number;
  skippedNoFiles: number;
  errors: { title: string; message: string }[];
  durationMs: number;
}

interface CalibreBook {
  id: number;
  title: string;
  pubdate: string | null;
  series_index: number | null;
  isbn: string | null;
  path: string;
  has_cover: number;
}

function one<T>(db: Database, sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get<T>(...params);
}
function many<T>(db: Database, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all<T>(...params);
}

/**
 * Import a Calibre library (its metadata.db + on-disk book files) into
 * Bibliotekarz. Files are referenced in place — nothing is copied or moved.
 * Calibre's curated metadata takes precedence over embedded tags.
 */
export async function importCalibreLibrary(
  db: Database,
  config: Config,
  calibreDir: string,
): Promise<CalibreImportResult> {
  const started = Date.now();
  const result: CalibreImportResult = {
    booksInLibrary: 0, imported: 0, updated: 0, skippedNoFiles: 0, errors: [], durationMs: 0,
  };

  const metadataPath = path.join(calibreDir, 'metadata.db');
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Nie znaleziono metadata.db w ${calibreDir}. Wskaż katalog biblioteki Calibre.`);
  }

  const cal = openReadonly(metadataPath);
  try {
    const books = many<CalibreBook>(
      cal,
      `SELECT id, title, pubdate, series_index, isbn, path, has_cover FROM books ORDER BY id`,
    );
    result.booksInLibrary = books.length;

    for (const book of books) {
      try {
        const outcome = await importBook(db, config, cal, calibreDir, book);
        if (outcome === 'imported') result.imported++;
        else if (outcome === 'updated') result.updated++;
        else result.skippedNoFiles++;
      } catch (err) {
        result.errors.push({ title: book.title, message: (err as Error).message });
        log.warn(`Import Calibre: błąd „${book.title}":`, (err as Error).message);
      }
    }
  } finally {
    cal.close();
  }

  result.durationMs = Date.now() - started;
  return result;
}

async function importBook(
  db: Database,
  config: Config,
  cal: Database,
  calibreDir: string,
  book: CalibreBook,
): Promise<'imported' | 'updated' | 'skipped'> {
  const bookDir = path.join(calibreDir, book.path);

  // Physical files for this book (data table lists format + base filename).
  const formats = many<{ format: string; name: string }>(
    cal,
    'SELECT format, name FROM data WHERE book = ?',
    book.id,
  );
  const files = formats
    .map((f) => ({
      format: f.format.toLowerCase(),
      file: path.join(bookDir, `${f.name}.${f.format.toLowerCase()}`),
    }))
    .filter((f) => kindForFormat(f.format) && fs.existsSync(f.file));

  if (files.length === 0) return 'skipped';

  const isAudiobook = files.every((f) => AUDIO_FORMATS.has(f.format));
  const kind = isAudiobook ? 'audiobook' : 'ebook';

  // --- gather Calibre metadata ---
  const authors = many<{ name: string }>(
    cal,
    'SELECT a.name FROM authors a JOIN books_authors_link bal ON bal.author = a.id WHERE bal.book = ? ORDER BY bal.id',
    book.id,
  ).map((r) => r.name.replace(/\|/g, ', '));
  const series = one<{ name: string }>(
    cal,
    'SELECT s.name FROM series s JOIN books_series_link bsl ON bsl.series = s.id WHERE bsl.book = ?',
    book.id,
  )?.name ?? null;
  const publisher = one<{ name: string }>(
    cal,
    'SELECT p.name FROM publishers p JOIN books_publishers_link bpl ON bpl.publisher = p.id WHERE bpl.book = ?',
    book.id,
  )?.name ?? null;
  const tags = many<{ name: string }>(
    cal,
    'SELECT t.name FROM tags t JOIN books_tags_link btl ON btl.tag = t.id WHERE btl.book = ?',
    book.id,
  ).map((r) => r.name);
  const language = one<{ lang_code: string }>(
    cal,
    'SELECT l.lang_code FROM languages l JOIN books_languages_link bll ON bll.lang_code = l.id WHERE bll.book = ?',
    book.id,
  )?.lang_code ?? null;
  const description = one<{ text: string }>(cal, 'SELECT text FROM comments WHERE book = ?', book.id)?.text ?? null;
  const ratingRaw = one<{ rating: number }>(
    cal,
    'SELECT r.rating FROM ratings r JOIN books_ratings_link brl ON brl.rating = r.id WHERE brl.book = ?',
    book.id,
  )?.rating;
  const identifiers = many<{ type: string; val: string }>(
    cal,
    'SELECT type, val FROM identifiers WHERE book = ?',
    book.id,
  );
  const isbn = book.isbn || identifiers.find((i) => i.type === 'isbn')?.val || null;
  const asin = identifiers.find((i) => i.type === 'amazon' || i.type === 'asin')?.val || null;
  const publishedYear = book.pubdate ? Number.parseInt(String(book.pubdate).slice(0, 4), 10) || null : null;

  const input: repo.UpsertItemInput = {
    kind,
    title: book.title,
    authors,
    series,
    seriesIndex: book.series_index ?? null,
    publisher,
    publishedYear,
    language,
    isbn: isbn ? isbn.replace(/[^0-9Xx]/g, '') || null : null,
    asin,
    description: cleanDescriptionText(description),
    tags,
    rating: ratingRaw != null ? Math.round((ratingRaw / 2) * 10) / 10 : null, // Calibre 0..10 → 0..5
  };

  // Existing item? Match by any of this book's file paths already in the catalog.
  let itemId: number | undefined;
  for (const f of files) {
    const existing = repo.findFileByPath(db, f.file);
    if (existing) { itemId = existing.itemId; break; }
  }

  const id = itemId ?? repo.createItem(db, input);
  if (itemId) repo.updateItem(db, id, input);

  // Register files (+ audio metadata for chapters/duration).
  const chapters: { fileId: number | null; index: number; title: string; startSec: number; endSec: number | null }[] = [];
  let timeline = 0;
  let chapterIdx = 0;
  let totalDuration = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const stat = fs.statSync(f.file);
    const hash = await hashFile(f.file);
    let durationSec: number | null = null;

    if (isAudiobook) {
      try {
        const parsed = await parseAudio(f.file);
        durationSec = parsed.durationSec ?? null;
        const fileId = repo.upsertFile(db, {
          itemId: id, path: f.file, relPath: path.relative(calibreDir, f.file), format: f.format,
          mimeType: mimeForFormat(f.format), sizeBytes: stat.size, durationSec, hash, mtimeMs: stat.mtimeMs,
          trackNo: parsed.trackNo ?? i + 1,
        });
        const fileDur = durationSec ?? 0;
        if (files.length === 1 && parsed.chapters && parsed.chapters.length > 0) {
          parsed.chapters.forEach((c, ci) => {
            const next = parsed.chapters![ci + 1];
            chapters.push({
              fileId, index: chapterIdx++, title: c.title,
              startSec: timeline + c.startSec,
              endSec: next ? timeline + next.startSec : fileDur ? timeline + fileDur : null,
            });
          });
        } else {
          chapters.push({
            fileId, index: chapterIdx++, title: parsed.trackTitle?.trim() || `Część ${i + 1}`,
            startSec: timeline, endSec: fileDur ? timeline + fileDur : null,
          });
        }
        timeline += fileDur;
        totalDuration += fileDur;
        continue;
      } catch {
        /* fall through to plain registration */
      }
    }

    repo.upsertFile(db, {
      itemId: id, path: f.file, relPath: path.relative(calibreDir, f.file), format: f.format,
      mimeType: mimeForFormat(f.format), sizeBytes: stat.size, durationSec, hash, mtimeMs: stat.mtimeMs,
      trackNo: isAudiobook ? i + 1 : null,
    });
  }

  if (isAudiobook) {
    repo.replaceChapters(db, id, chapters);
    if (totalDuration > 0) repo.updateItem(db, id, { durationSec: totalDuration });
  } else {
    repo.replaceChapters(db, id, []);
  }

  // Cover from Calibre (cover.jpg in the book folder).
  if (book.has_cover) {
    const coverFile = path.join(bookDir, 'cover.jpg');
    if (fs.existsSync(coverFile)) {
      const name = saveCover(config.coversDir, id, fs.readFileSync(coverFile), 'image/jpeg');
      repo.updateItem(db, id, { coverPath: name });
    }
  }

  return itemId ? 'updated' : 'imported';
}

/** Calibre comments are HTML; strip tags for a plain-text description. */
function cleanDescriptionText(value: string | null): string | null {
  if (!value) return value;
  const text = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
  return text || null;
}
