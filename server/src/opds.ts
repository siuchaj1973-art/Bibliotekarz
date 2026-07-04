import type { Database } from './db.js';
import * as repo from './repo.js';
import type { Item } from './types.js';

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
}

function tokenQuery(token: string | undefined, sep = '?'): string {
  return token ? `${sep}token=${encodeURIComponent(token)}` : '';
}

function feedHeader(id: string, title: string, base: string, token?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${esc(id)}</id>
  <title>${esc(title)}</title>
  <updated>${new Date().toISOString()}</updated>
  <author><name>Bibliotekarz</name></author>
  <link rel="self" href="${esc(base)}${esc(id)}${tokenQuery(token)}" type="application/atom+xml;profile=opds-catalog"/>
  <link rel="start" href="${esc(base)}/opds${tokenQuery(token)}" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>`;
}

function navEntry(title: string, href: string, base: string, description: string, token?: string): string {
  return `
  <entry>
    <title>${esc(title)}</title>
    <id>${esc(base + href)}</id>
    <updated>${new Date().toISOString()}</updated>
    <content type="text">${esc(description)}</content>
    <link rel="subsection" href="${esc(base)}${esc(href)}${tokenQuery(token)}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  </entry>`;
}

function acquisitionEntry(item: Item, base: string, token?: string): string {
  const authors = item.authors.map((a) => `<author><name>${esc(a)}</name></author>`).join('');
  const links = item.files
    .map(
      (f) =>
        `<link rel="http://opds-spec.org/acquisition" href="${esc(base)}/api/items/${item.id}/download?fileId=${f.id}${tokenQuery(token, '&')}" type="${esc(f.mimeType)}"/>`,
    )
    .join('');
  const cover = item.coverPath
    ? `<link rel="http://opds-spec.org/image" href="${esc(base)}/api/items/${item.id}/cover${tokenQuery(token)}" type="image/jpeg"/>
       <link rel="http://opds-spec.org/image/thumbnail" href="${esc(base)}/api/items/${item.id}/cover${tokenQuery(token)}" type="image/jpeg"/>`
    : '';
  const series = item.series ? ` (${esc(item.series)}${item.seriesIndex != null ? ` #${item.seriesIndex}` : ''})` : '';
  return `
  <entry>
    <title>${esc(item.title)}${series}</title>
    <id>urn:bibliotekarz:item:${item.id}</id>
    <updated>${esc(item.updatedAt)}</updated>
    ${authors}
    ${item.description ? `<summary type="text">${esc(item.description.slice(0, 800))}</summary>` : ''}
    ${item.narrators.length ? `<content type="text">Lektor: ${esc(item.narrators.join(', '))}</content>` : ''}
    ${cover}
    ${links}
  </entry>`;
}

export function buildOpds(db: Database, pathname: string, base: string, token?: string): string | null {
  const clean = pathname.replace(/\/$/, '') || '/';

  if (clean === '/' || clean === '') {
    let xml = feedHeader('/opds', 'Bibliotekarz — katalog', base, token).replace(
      'kind=navigation"/>',
      'kind=navigation"/>\n  <link rel="up" href="' + esc(base) + '/opds' + tokenQuery(token) + '" type="application/atom+xml"/>',
    );
    xml += navEntry('E-booki', '/opds/ebooks', base, 'Wszystkie e-booki', token);
    xml += navEntry('Audiobooki', '/opds/audiobooks', base, 'Wszystkie audiobooki', token);
    xml += navEntry('Ostatnio dodane', '/opds/recent', base, 'Najnowsze pozycje', token);
    xml += '\n</feed>';
    return xml;
  }

  const feeds: Record<string, { title: string; query: repo.ListQuery }> = {
    '/ebooks': { title: 'E-booki', query: { kind: 'ebook', sort: 'author', limit: 500 } },
    '/audiobooks': { title: 'Audiobooki', query: { kind: 'audiobook', sort: 'author', limit: 500 } },
    '/recent': { title: 'Ostatnio dodane', query: { sort: 'added', order: 'desc', limit: 100 } },
  };
  const conf = feeds[clean];
  if (!conf) return null;

  const { items } = repo.listItems(db, conf.query);
  let xml = feedHeader('/opds' + clean, `Bibliotekarz — ${conf.title}`, base, token);
  for (const summary of items) {
    const full = repo.getItem(db, summary.id);
    if (full) xml += acquisitionEntry(full, base, token);
  }
  xml += '\n</feed>';
  return xml;
}
