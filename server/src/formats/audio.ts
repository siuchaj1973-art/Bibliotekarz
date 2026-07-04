import fs from 'node:fs';
import { parseFile } from 'music-metadata';
import type { ParsedMedia } from '../types.js';
import { parseYear } from '../util.js';

function firstString(v: unknown): string | undefined {
  if (Array.isArray(v)) return firstString(v[0]);
  if (typeof v === 'string') return v.trim() || undefined;
  if (v && typeof v === 'object' && 'text' in (v as Record<string, unknown>)) {
    return firstString((v as Record<string, unknown>).text);
  }
  return undefined;
}

function allStrings(v: unknown): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => firstString(x)).filter((s): s is string => !!s);
}

export async function parseAudio(filePath: string): Promise<ParsedMedia> {
  const meta = await parseFile(filePath, { duration: true });
  const common = meta.common;
  const format = meta.format;

  const bookTitle = firstString(common.album) ?? firstString(common.title);
  const authors = allStrings(common.albumartist ?? common.artists ?? common.artist);
  const narrators = allStrings(common.composer);
  const genres = allStrings(common.genre);

  const result: ParsedMedia = {
    kind: 'audiobook',
    title: bookTitle,
    trackTitle: firstString(common.title),
    albumTitle: firstString(common.album),
    authors,
    narrators,
    tags: genres,
    publishedYear: parseYear(common.year ?? common.date ?? common.originaldate),
    language: firstString((common as unknown as Record<string, unknown>).language),
    durationSec: format.duration != null ? Math.round(format.duration) : undefined,
    trackNo: common.track?.no ?? undefined,
    description: firstString(common.comment),
  };

  // Series / series index sometimes ride in movement tags (MVNM/MVIN).
  const movement = firstString((common as unknown as Record<string, unknown>).movement);
  if (movement) {
    result.series = movement;
    const idx = (common as unknown as Record<string, unknown>).movementIndex as { no?: number } | undefined;
    if (idx?.no != null) result.seriesIndex = idx.no;
  }

  const picture = common.picture?.[0];
  if (picture?.data) {
    result.cover = { data: Buffer.from(picture.data), mimeType: picture.format || 'image/jpeg' };
  }

  // Embedded chapters: prefer parser-provided, fall back to Nero 'chpl' atom.
  const parserChapters = (common as unknown as Record<string, unknown>).chapters as
    | { start?: number; startTime?: number; title?: string; sampleOffset?: number }[]
    | undefined;
  if (Array.isArray(parserChapters) && parserChapters.length > 0) {
    result.chapters = parserChapters.map((c, i) => ({
      title: c.title?.trim() || `Rozdział ${i + 1}`,
      startSec: c.start != null ? c.start : c.startTime != null ? c.startTime : 0,
    }));
  } else {
    try {
      const nero = readNeroChapters(filePath);
      if (nero.length) result.chapters = nero;
    } catch {
      /* embedded chapters are optional */
    }
  }

  return result;
}

/**
 * Best-effort reader for Nero-style MP4 chapters (moov > udta > chpl), the most
 * common embedded-chapter format for .m4b audiobooks. Returns [] if absent.
 */
function readNeroChapters(filePath: string): { title: string; startSec: number }[] {
  const fd = fs.openSync(filePath, 'r');
  try {
    const chpl = findBox(fd, ['moov', 'udta', 'chpl']);
    if (!chpl) return [];
    const buf = Buffer.alloc(chpl.size);
    fs.readSync(fd, buf, 0, chpl.size, chpl.dataStart);
    // version(1) flags(3) reserved(1) count(1) then entries: start(u64, 100ns) len(1) title
    let off = 5;
    const count = buf.readUInt8(off);
    off += 1;
    const chapters: { title: string; startSec: number }[] = [];
    for (let i = 0; i < count && off + 9 <= buf.length; i++) {
      const start100ns = Number(buf.readBigUInt64BE(off));
      off += 8;
      const len = buf.readUInt8(off);
      off += 1;
      if (off + len > buf.length) break;
      const title = buf.toString('utf8', off, off + len).trim();
      off += len;
      chapters.push({ title: title || `Rozdział ${i + 1}`, startSec: start100ns / 1e7 });
    }
    return chapters;
  } finally {
    fs.closeSync(fd);
  }
}

interface BoxLoc {
  dataStart: number;
  size: number;
}

/** Walk the MP4 box tree following `pathBoxes`, returning the innermost box body. */
function findBox(fd: number, pathBoxes: string[]): BoxLoc | null {
  const stat = fs.fstatSync(fd);
  let searchStart = 0;
  let searchEnd = stat.size;
  let found: BoxLoc | null = null;

  for (const wanted of pathBoxes) {
    found = scanBoxes(fd, searchStart, searchEnd, wanted);
    if (!found) return null;
    searchStart = found.dataStart;
    searchEnd = found.dataStart + found.size;
  }
  return found;
}

function scanBoxes(fd: number, start: number, end: number, wanted: string): BoxLoc | null {
  let pos = start;
  const header = Buffer.alloc(16);
  while (pos + 8 <= end) {
    fs.readSync(fd, header, 0, 16, pos);
    let size = header.readUInt32BE(0);
    const type = header.toString('ascii', 4, 8);
    let headerLen = 8;
    if (size === 1) {
      size = Number(header.readBigUInt64BE(8));
      headerLen = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < headerLen || pos + size > end + 8) break;
    if (type === wanted) {
      return { dataStart: pos + headerLen, size: size - headerLen };
    }
    pos += size;
  }
  return null;
}
