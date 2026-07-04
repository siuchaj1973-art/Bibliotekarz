import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ARTICLES = ['the ', 'a ', 'an ', 'die ', 'der ', 'das ', 'le ', 'la ', 'les '];

/** Build a case/diacritic-insensitive sort key, dropping a leading article. */
export function makeSortTitle(title: string): string {
  let t = title.trim().toLowerCase();
  for (const a of ARTICLES) {
    if (t.startsWith(a)) {
      t = t.slice(a.length);
      break;
    }
  }
  return t;
}

/** "Firstname Lastname" -> "Lastname, Firstname" for author sorting. */
export function makePersonSort(name: string): string {
  const clean = name.trim();
  if (clean.includes(',')) return clean.toLowerCase();
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return clean.toLowerCase();
  const last = parts.pop()!;
  return `${last}, ${parts.join(' ')}`.toLowerCase();
}

export const EBOOK_FORMATS = new Set(['epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'cbz', 'cbr', 'djvu', 'txt']);
export const AUDIO_FORMATS = new Set(['m4b', 'm4a', 'mp3', 'ogg', 'oga', 'opus', 'flac', 'aac', 'wav']);

const MIME: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  azw: 'application/vnd.amazon.ebook',
  azw3: 'application/vnd.amazon.ebook',
  fb2: 'application/x-fictionbook+xml',
  cbz: 'application/vnd.comicbook+zip',
  cbr: 'application/vnd.comicbook-rar',
  djvu: 'image/vnd.djvu',
  txt: 'text/plain',
  m4b: 'audio/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  aac: 'audio/aac',
  wav: 'audio/wav',
};

export function mimeForFormat(format: string): string {
  return MIME[format] ?? 'application/octet-stream';
}

export function formatOf(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

export function kindForFormat(format: string): 'ebook' | 'audiobook' | null {
  if (AUDIO_FORMATS.has(format)) return 'audiobook';
  if (EBOOK_FORMATS.has(format)) return 'ebook';
  return null;
}

/** SHA-1 of file contents, streamed so large audiobooks don't load into memory. */
export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Human title fallback from a filename: "the_hobbit.epub" -> "The Hobbit". */
export function titleFromFilename(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  const cleaned = base.replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseYear(value: unknown): number | undefined {
  if (value == null) return undefined;
  const m = String(value).match(/(\d{4})/);
  if (!m) return undefined;
  const y = Number.parseInt(m[1], 10);
  return y >= 100 && y <= 3000 ? y : undefined;
}
