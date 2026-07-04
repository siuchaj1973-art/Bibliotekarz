import fs from 'node:fs';
import { unzipSync } from 'fflate';

export type ZipEntries = Record<string, Uint8Array>;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  entries: ZipEntries;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHE = 8;

/**
 * Read a zip file into memory, caching by path+mtime. EPUB/CBZ files are small
 * enough that keeping a few decoded archives around keeps the reader snappy.
 */
export function readZip(filePath: string): ZipEntries {
  const stat = fs.statSync(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.entries;
  }
  const buf = fs.readFileSync(filePath);
  const entries = unzipSync(new Uint8Array(buf));
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, entries });
  return entries;
}

export function decodeText(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data);
}
