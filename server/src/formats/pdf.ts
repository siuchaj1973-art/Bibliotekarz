import fs from 'node:fs';
import type { ParsedMedia } from '../types.js';

/**
 * Lightweight PDF metadata reader. Pulls Title/Author/Subject/Keywords from the
 * document Info dictionary (and XMP as a fallback) without a full PDF engine.
 */
export function parsePdf(filePath: string): ParsedMedia {
  const buf = fs.readFileSync(filePath);
  const text = buf.toString('latin1');

  const result: ParsedMedia = { kind: 'ebook' };

  const title = readInfoField(text, 'Title') ?? readXmp(text, 'title');
  const author = readInfoField(text, 'Author') ?? readXmp(text, 'creator');
  const subject = readInfoField(text, 'Subject') ?? readXmp(text, 'description');
  const keywords = readInfoField(text, 'Keywords');

  if (title) result.title = title;
  if (author) result.authors = splitAuthors(author);
  if (subject) result.description = subject;
  if (keywords) result.tags = keywords.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);

  return result;
}

function splitAuthors(value: string): string[] {
  return value
    .split(/\s*(?:,|;|&|\band\b|\bi\b)\s*/i)
    .map((a) => a.trim())
    .filter((a) => a.length > 1);
}

function readInfoField(text: string, field: string): string | undefined {
  const re = new RegExp(`/${field}\\s*(\\(|<)`, 'g');
  let match: RegExpExecArray | null;
  let best: string | undefined;
  while ((match = re.exec(text))) {
    const start = match.index + match[0].length - 1;
    const value = match[1] === '(' ? readLiteralString(text, start) : readHexString(text, start);
    if (value && value.trim() && (!best || value.length > best.length)) best = value.trim();
  }
  return best;
}

function readLiteralString(text: string, openParen: number): string | undefined {
  let depth = 0;
  let out = '';
  for (let i = openParen; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
      out += map[next] ?? next;
      i++;
      continue;
    }
    if (ch === '(') {
      depth++;
      if (depth === 1) continue;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return decodePdfText(out);
    }
    out += ch;
  }
  return undefined;
}

function readHexString(text: string, openBracket: number): string | undefined {
  const close = text.indexOf('>', openBracket);
  if (close === -1) return undefined;
  const hex = text.slice(openBracket + 1, close).replace(/\s+/g, '');
  const bytes = Buffer.from(hex, 'hex');
  return decodeBom(bytes);
}

function decodePdfText(s: string): string {
  const bytes = Buffer.from(s, 'latin1');
  return decodeBom(bytes);
}

function decodeBom(bytes: Buffer): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  return bytes.toString('latin1');
}

function readXmp(text: string, tag: string): string | undefined {
  const dc = new RegExp(`<dc:${tag}>[\\s\\S]*?<rdf:li[^>]*>([\\s\\S]*?)</rdf:li>`, 'i').exec(text);
  if (dc) return stripTags(dc[1]);
  const simple = new RegExp(`<dc:${tag}>([\\s\\S]*?)</dc:${tag}>`, 'i').exec(text);
  if (simple) return stripTags(simple[1]);
  return undefined;
}

function stripTags(s: string): string | undefined {
  const clean = s.replace(/<[^>]+>/g, '').trim();
  return clean || undefined;
}
