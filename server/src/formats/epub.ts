import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { readZip, decodeText, type ZipEntries } from './zip.js';
import type { ParsedMedia } from '../types.js';
import { parseYear } from '../util.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false,
  trimValues: true,
});

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'string') return node.trim() || undefined;
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    const t = (node as Record<string, unknown>)['#text'];
    return t != null ? String(t).trim() || undefined : undefined;
  }
  return undefined;
}

/** POSIX-join a href relative to the OPF directory, normalised for zip lookup. */
function resolveHref(opfDir: string, href: string): string {
  const decoded = decodeURIComponent(href);
  const joined = opfDir ? `${opfDir}/${decoded}` : decoded;
  return path.posix.normalize(joined);
}

export interface EpubManifest {
  opfDir: string;
  spine: { id: string; href: string; mediaType: string }[];
  toc: { title: string; href: string }[];
  resources: Record<string, { href: string; mediaType: string }>; // by manifest id
}

interface OpfDoc {
  metadata: Record<string, unknown>;
  manifestItems: { id: string; href: string; mediaType: string; properties: string }[];
  spineIdrefs: string[];
  opfDir: string;
  ncxHref?: string;
  navHref?: string;
}

function findOpfPath(entries: ZipEntries): string {
  const container = entries['META-INF/container.xml'];
  if (!container) throw new Error('Nieprawidłowy plik EPUB: brak META-INF/container.xml');
  const doc = parser.parse(decodeText(container));
  const rootfile = doc?.container?.rootfiles?.rootfile;
  const full = toArray(rootfile)[0]?.['@_full-path'];
  if (!full) throw new Error('Nieprawidłowy plik EPUB: brak rootfile w container.xml');
  return String(full);
}

function parseOpf(entries: ZipEntries): OpfDoc {
  const opfPath = findOpfPath(entries);
  const opfRaw = entries[opfPath];
  if (!opfRaw) throw new Error(`Nie znaleziono OPF: ${opfPath}`);
  const opfDir = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath);
  const doc = parser.parse(decodeText(opfRaw));
  const pkg = doc.package ?? {};
  const metadata = pkg.metadata ?? {};

  const manifestItems = toArray(pkg.manifest?.item).map((it: Record<string, string>) => ({
    id: String(it['@_id'] ?? ''),
    href: String(it['@_href'] ?? ''),
    mediaType: String(it['@_media-type'] ?? ''),
    properties: String(it['@_properties'] ?? ''),
  }));
  const spineIdrefs = toArray(pkg.spine?.itemref).map((ref: Record<string, string>) => String(ref['@_idref'] ?? ''));
  const spineToc = pkg.spine?.['@_toc'];

  let ncxHref: string | undefined;
  const navItem = manifestItems.find((m) => m.properties.split(/\s+/).includes('nav'));
  const navHref = navItem ? resolveHref(opfDir, navItem.href) : undefined;
  if (spineToc) {
    const ncxItem = manifestItems.find((m) => m.id === spineToc);
    if (ncxItem) ncxHref = resolveHref(opfDir, ncxItem.href);
  }
  if (!ncxHref) {
    const ncxItem = manifestItems.find((m) => m.mediaType === 'application/x-dtbncx+xml');
    if (ncxItem) ncxHref = resolveHref(opfDir, ncxItem.href);
  }

  return { metadata, manifestItems, spineIdrefs, opfDir, ncxHref, navHref };
}

function creatorsByRole(metadata: Record<string, unknown>, wantedRole: string | null): string[] {
  const creators = toArray(metadata.creator);
  const names: string[] = [];
  for (const c of creators) {
    const name = textOf(c);
    if (!name) continue;
    const role = typeof c === 'object' && c ? (c as Record<string, string>)['@_role'] : undefined;
    if (wantedRole === null || role === wantedRole || (wantedRole === 'aut' && !role)) {
      names.push(name);
    }
  }
  return names;
}

function extractSeries(metadata: Record<string, unknown>): { series?: string; index?: number } {
  const metas = toArray(metadata.meta) as Record<string, string>[];
  let series: string | undefined;
  let index: number | undefined;
  for (const m of metas) {
    const name = m['@_name'];
    const prop = m['@_property'];
    if (name === 'calibre:series') series = m['@_content'];
    else if (name === 'calibre:series_index') index = Number.parseFloat(m['@_content']);
    else if (prop === 'belongs-to-collection') series = textOf(m) ?? series;
    else if (prop === 'group-position') index = Number.parseFloat(textOf(m) ?? '');
  }
  return { series, index: Number.isFinite(index) ? index : undefined };
}

function findCover(entries: ZipEntries, opf: OpfDoc): { data: Buffer; mimeType: string } | undefined {
  const { manifestItems, opfDir, metadata } = opf;
  // 1) EPUB3 cover-image property.
  let coverItem = manifestItems.find((m) => m.properties.split(/\s+/).includes('cover-image'));
  // 2) EPUB2 <meta name="cover" content="id">.
  if (!coverItem) {
    const metas = toArray(metadata.meta) as Record<string, string>[];
    const coverMeta = metas.find((m) => m['@_name'] === 'cover');
    if (coverMeta) coverItem = manifestItems.find((m) => m.id === coverMeta['@_content']);
  }
  // 3) Heuristic: an image whose id/href mentions "cover".
  if (!coverItem) {
    coverItem = manifestItems.find(
      (m) => m.mediaType.startsWith('image/') && /cover/i.test(m.id + m.href),
    );
  }
  if (!coverItem) return undefined;
  const href = resolveHref(opfDir, coverItem.href);
  const data = entries[href];
  if (!data) return undefined;
  return { data: Buffer.from(data), mimeType: coverItem.mediaType || 'image/jpeg' };
}

export function parseEpub(filePath: string): ParsedMedia {
  const entries = readZip(filePath);
  const opf = parseOpf(entries);
  const md = opf.metadata;

  const authors = creatorsByRole(md, 'aut');
  const identifiers = toArray(md.identifier).map((i) => textOf(i)).filter(Boolean) as string[];
  const isbn = identifiers.find((i) => /\b97[89][\d-]{10,}|\bisbn/i.test(i))?.replace(/[^0-9Xx]/g, '') || undefined;
  const { series, index } = extractSeries(md);

  const tags = toArray(md.subject).map((s) => textOf(s)).filter(Boolean) as string[];

  return {
    kind: 'ebook',
    title: textOf(md.title),
    authors: authors.length ? authors : creatorsByRole(md, null),
    series,
    seriesIndex: index,
    publisher: textOf(md.publisher),
    publishedYear: parseYear(textOf(md.date)),
    language: textOf(md.language),
    isbn: isbn && isbn.length >= 10 ? isbn : undefined,
    description: textOf(md.description),
    tags,
    cover: findCover(entries, opf),
  };
}

/** Build the spine + table of contents for the in-app reader. */
export function epubManifest(filePath: string): EpubManifest {
  const entries = readZip(filePath);
  const opf = parseOpf(entries);
  const byId = new Map(opf.manifestItems.map((m) => [m.id, m]));

  const spine = opf.spineIdrefs
    .map((id) => byId.get(id))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => ({ id: m.id, href: resolveHref(opf.opfDir, m.href), mediaType: m.mediaType }));

  const resources: EpubManifest['resources'] = {};
  for (const m of opf.manifestItems) {
    resources[m.id] = { href: resolveHref(opf.opfDir, m.href), mediaType: m.mediaType };
  }

  const toc = readToc(entries, opf);
  return { opfDir: opf.opfDir, spine, toc, resources };
}

function readToc(entries: ZipEntries, opf: OpfDoc): { title: string; href: string }[] {
  const out: { title: string; href: string }[] = [];
  // EPUB3 nav document
  if (opf.navHref && entries[opf.navHref]) {
    const navDir = path.posix.dirname(opf.navHref);
    const html = decodeText(entries[opf.navHref]);
    const navMatch = html.match(/<nav[^>]*epub:type=["']toc["'][^>]*>([\s\S]*?)<\/nav>/i)
      ?? html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
    const scope = navMatch ? navMatch[1] : html;
    const linkRe = /<a[^>]*href=["']([^"'#]+)(#[^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(scope))) {
      const title = m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (title) out.push({ title, href: path.posix.normalize(`${navDir}/${decodeURIComponent(m[1])}`) });
    }
    if (out.length) return out;
  }
  // EPUB2 NCX
  if (opf.ncxHref && entries[opf.ncxHref]) {
    const ncxDir = path.posix.dirname(opf.ncxHref);
    const doc = parser.parse(decodeText(entries[opf.ncxHref]));
    const navPoints = toArray(doc?.ncx?.navMap?.navPoint);
    const walk = (points: unknown[]) => {
      for (const p of points as Record<string, unknown>[]) {
        const label = textOf((p.navLabel as Record<string, unknown>)?.text);
        const src = (p.content as Record<string, string>)?.['@_src'];
        if (label && src) {
          out.push({
            title: label,
            href: path.posix.normalize(`${ncxDir}/${decodeURIComponent(src.split('#')[0])}`),
          });
        }
        if (p.navPoint) walk(toArray(p.navPoint));
      }
    };
    walk(navPoints);
  }
  return out;
}
