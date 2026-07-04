import type { Database } from './db.js';
import { transaction } from './db.js';
import type { Item, MediaFile, Chapter, Progress, Collection, MediaKind } from './types.js';
import { makeSortTitle, makePersonSort, nowIso } from './util.js';

const SEP = '␟'; // unit separator, safe as a group_concat delimiter

// ---------- people / tags ----------

function getOrCreatePerson(db: Database, name: string): number {
  const clean = name.trim();
  const existing = db.prepare('SELECT id FROM people WHERE name = ?').get<{ id: number }>(clean);
  if (existing) return existing.id;
  const res = db.prepare('INSERT INTO people (name, sort) VALUES (?, ?)').run(clean, makePersonSort(clean));
  return Number(res.lastInsertRowid);
}

function getOrCreateTag(db: Database, name: string): number {
  const clean = name.trim();
  const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get<{ id: number }>(clean);
  if (existing) return existing.id;
  const res = db.prepare('INSERT INTO tags (name) VALUES (?)').run(clean);
  return Number(res.lastInsertRowid);
}

function setPeople(db: Database, itemId: number, names: string[], role: 'author' | 'narrator'): void {
  db.prepare('DELETE FROM item_people WHERE item_id = ? AND role = ?').run(itemId, role);
  const stmt = db.prepare('INSERT OR IGNORE INTO item_people (item_id, person_id, role, position) VALUES (?, ?, ?, ?)');
  names.map((n) => n.trim()).filter(Boolean).forEach((name, i) => {
    stmt.run(itemId, getOrCreatePerson(db, name), role, i);
  });
}

function setTags(db: Database, itemId: number, tags: string[]): void {
  db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(itemId);
  const stmt = db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)');
  for (const t of tags.map((x) => x.trim()).filter(Boolean)) stmt.run(itemId, getOrCreateTag(db, t));
}

// ---------- FTS ----------

function rebuildFts(db: Database, itemId: number): void {
  db.prepare('DELETE FROM items_fts WHERE rowid = ?').run(itemId);
  const row = db.prepare('SELECT title, series, description FROM items WHERE id = ?').get<{
    title: string;
    series: string | null;
    description: string | null;
  }>(itemId);
  if (!row) return;
  const authors = db
    .prepare("SELECT p.name FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ? AND ip.role = 'author'")
    .all<{ name: string }>(itemId)
    .map((r) => r.name)
    .join(' ');
  const narrators = db
    .prepare("SELECT p.name FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ? AND ip.role = 'narrator'")
    .all<{ name: string }>(itemId)
    .map((r) => r.name)
    .join(' ');
  const tags = db
    .prepare('SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ?')
    .all<{ name: string }>(itemId)
    .map((r) => r.name)
    .join(' ');
  db.prepare(
    'INSERT INTO items_fts (rowid, title, authors, narrators, series, tags, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(itemId, row.title, authors, narrators, row.series ?? '', tags, row.description ?? '');
}

// ---------- items ----------

export interface UpsertItemInput {
  kind: MediaKind;
  title: string;
  subtitle?: string | null;
  authors?: string[];
  narrators?: string[];
  series?: string | null;
  seriesIndex?: number | null;
  publisher?: string | null;
  publishedYear?: number | null;
  language?: string | null;
  isbn?: string | null;
  asin?: string | null;
  description?: string | null;
  tags?: string[];
  rating?: number | null;
  coverPath?: string | null;
  durationSec?: number | null;
}

export function createItem(db: Database, input: UpsertItemInput): number {
  return transaction(db, () => {
    const ts = nowIso();
    const res = db
      .prepare(
        `INSERT INTO items (kind, title, sort_title, subtitle, series, series_index, publisher,
           published_year, language, isbn, asin, description, rating, cover_path, duration_sec, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.kind,
        input.title,
        makeSortTitle(input.title),
        input.subtitle ?? null,
        input.series ?? null,
        input.seriesIndex ?? null,
        input.publisher ?? null,
        input.publishedYear ?? null,
        input.language ?? null,
        input.isbn ?? null,
        input.asin ?? null,
        input.description ?? null,
        input.rating ?? null,
        input.coverPath ?? null,
        input.durationSec ?? null,
        ts,
        ts,
      );
    const id = Number(res.lastInsertRowid);
    setPeople(db, id, input.authors ?? [], 'author');
    setPeople(db, id, input.narrators ?? [], 'narrator');
    setTags(db, id, input.tags ?? []);
    rebuildFts(db, id);
    return id;
  });
}

export function updateItem(db: Database, id: number, patch: Partial<UpsertItemInput>): void {
  transaction(db, () => {
    const current = db.prepare('SELECT * FROM items WHERE id = ?').get<Record<string, unknown>>(id);
    if (!current) throw new Error(`Nie znaleziono pozycji ${id}`);

    const fields: Record<string, unknown> = {
      title: patch.title ?? current.title,
      sort_title: patch.title != null ? makeSortTitle(patch.title) : current.sort_title,
      subtitle: patch.subtitle !== undefined ? patch.subtitle : current.subtitle,
      series: patch.series !== undefined ? patch.series : current.series,
      series_index: patch.seriesIndex !== undefined ? patch.seriesIndex : current.series_index,
      publisher: patch.publisher !== undefined ? patch.publisher : current.publisher,
      published_year: patch.publishedYear !== undefined ? patch.publishedYear : current.published_year,
      language: patch.language !== undefined ? patch.language : current.language,
      isbn: patch.isbn !== undefined ? patch.isbn : current.isbn,
      asin: patch.asin !== undefined ? patch.asin : current.asin,
      description: patch.description !== undefined ? patch.description : current.description,
      rating: patch.rating !== undefined ? patch.rating : current.rating,
      cover_path: patch.coverPath !== undefined ? patch.coverPath : current.cover_path,
      duration_sec: patch.durationSec !== undefined ? patch.durationSec : current.duration_sec,
    };
    db.prepare(
      `UPDATE items SET title=?, sort_title=?, subtitle=?, series=?, series_index=?, publisher=?,
        published_year=?, language=?, isbn=?, asin=?, description=?, rating=?, cover_path=?, duration_sec=?, updated_at=?
       WHERE id=?`,
    ).run(
      fields.title, fields.sort_title, fields.subtitle, fields.series, fields.series_index, fields.publisher,
      fields.published_year, fields.language, fields.isbn, fields.asin, fields.description, fields.rating,
      fields.cover_path, fields.duration_sec, nowIso(), id,
    );
    if (patch.authors) setPeople(db, id, patch.authors, 'author');
    if (patch.narrators) setPeople(db, id, patch.narrators, 'narrator');
    if (patch.tags) setTags(db, id, patch.tags);
    rebuildFts(db, id);
  });
}

export function deleteItem(db: Database, id: number): void {
  transaction(db, () => {
    db.prepare('DELETE FROM items_fts WHERE rowid = ?').run(id);
    db.prepare('DELETE FROM items WHERE id = ?').run(id);
  });
}

// ---------- media files & chapters ----------

export function upsertFile(db: Database, file: Omit<MediaFile, 'id'>): number {
  const existing = db.prepare('SELECT id FROM media_files WHERE path = ?').get<{ id: number }>(file.path);
  if (existing) {
    db.prepare(
      `UPDATE media_files SET item_id=?, rel_path=?, format=?, mime_type=?, size_bytes=?, duration_sec=?, hash=?, mtime_ms=?, track_no=? WHERE id=?`,
    ).run(file.itemId, file.relPath, file.format, file.mimeType, file.sizeBytes, file.durationSec, file.hash, file.mtimeMs, file.trackNo, existing.id);
    return existing.id;
  }
  const res = db
    .prepare(
      `INSERT INTO media_files (item_id, path, rel_path, format, mime_type, size_bytes, duration_sec, hash, mtime_ms, track_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(file.itemId, file.path, file.relPath, file.format, file.mimeType, file.sizeBytes, file.durationSec, file.hash, file.mtimeMs, file.trackNo);
  return Number(res.lastInsertRowid);
}

export function replaceChapters(db: Database, itemId: number, chapters: Omit<Chapter, 'id' | 'itemId'>[]): void {
  db.prepare('DELETE FROM chapters WHERE item_id = ?').run(itemId);
  const stmt = db.prepare('INSERT INTO chapters (item_id, file_id, idx, title, start_sec, end_sec) VALUES (?, ?, ?, ?, ?, ?)');
  for (const c of chapters) stmt.run(itemId, c.fileId, c.index, c.title, c.startSec, c.endSec);
}

export function findFileByPath(db: Database, path: string): (MediaFile & { itemId: number }) | undefined {
  const row = db.prepare('SELECT * FROM media_files WHERE path = ?').get<Record<string, unknown>>(path);
  return row ? mapFileRow(row) : undefined;
}

export function allFilePaths(db: Database): Set<string> {
  return new Set(db.prepare('SELECT path FROM media_files').all<{ path: string }>().map((r) => r.path));
}

export function deleteFilesUnder(db: Database, paths: string[]): number[] {
  const affected: number[] = [];
  const findItem = db.prepare('SELECT item_id FROM media_files WHERE path = ?');
  const del = db.prepare('DELETE FROM media_files WHERE path = ?');
  for (const p of paths) {
    const row = findItem.get<{ item_id: number }>(p);
    if (row) affected.push(row.item_id);
    del.run(p);
  }
  // Drop items that now have no files.
  const orphaned = db
    .prepare('SELECT id FROM items i WHERE NOT EXISTS (SELECT 1 FROM media_files f WHERE f.item_id = i.id)')
    .all<{ id: number }>()
    .map((r) => r.id);
  for (const id of orphaned) deleteItem(db, id);
  return orphaned;
}

// ---------- row mapping ----------

function splitConcat(v: unknown): string[] {
  if (typeof v !== 'string' || v.length === 0) return [];
  return v.split(SEP).filter(Boolean);
}

function mapFileRow(r: Record<string, unknown>): MediaFile & { itemId: number } {
  return {
    id: Number(r.id),
    itemId: Number(r.item_id),
    path: String(r.path),
    relPath: String(r.rel_path),
    format: String(r.format),
    mimeType: String(r.mime_type),
    sizeBytes: Number(r.size_bytes),
    durationSec: r.duration_sec != null ? Number(r.duration_sec) : null,
    hash: String(r.hash),
    mtimeMs: Number(r.mtime_ms),
    trackNo: r.track_no != null ? Number(r.track_no) : null,
  };
}

function mapProgressRow(r: Record<string, unknown> | undefined): Progress | null {
  if (!r || r.item_id == null) return null;
  return {
    itemId: Number(r.item_id),
    positionSec: r.position_sec != null ? Number(r.position_sec) : null,
    locator: (r.locator as string) ?? null,
    progressPct: Number(r.progress_pct ?? 0),
    status: (r.status as Progress['status']) ?? 'unread',
    finishedAt: (r.finished_at as string) ?? null,
    updatedAt: String(r.updated_at ?? nowIso()),
  };
}

function mapItemRow(r: Record<string, unknown>): Item {
  return {
    id: Number(r.id),
    kind: r.kind as MediaKind,
    title: String(r.title),
    sortTitle: String(r.sort_title),
    subtitle: (r.subtitle as string) ?? null,
    authors: splitConcat(r.authors),
    narrators: splitConcat(r.narrators),
    series: (r.series as string) ?? null,
    seriesIndex: r.series_index != null ? Number(r.series_index) : null,
    publisher: (r.publisher as string) ?? null,
    publishedYear: r.published_year != null ? Number(r.published_year) : null,
    language: (r.language as string) ?? null,
    isbn: (r.isbn as string) ?? null,
    asin: (r.asin as string) ?? null,
    description: (r.description as string) ?? null,
    tags: splitConcat(r.tags),
    rating: r.rating != null ? Number(r.rating) : null,
    coverPath: (r.cover_path as string) ?? null,
    durationSec: r.duration_sec != null ? Number(r.duration_sec) : null,
    addedAt: String(r.added_at),
    updatedAt: String(r.updated_at),
    files: [],
    chapters: [],
    progress: mapProgressRow({
      item_id: r.p_item_id,
      position_sec: r.p_position_sec,
      locator: r.p_locator,
      progress_pct: r.p_progress_pct,
      status: r.p_status,
      finished_at: r.p_finished_at,
      updated_at: r.p_updated_at,
    }),
  };
}

const SELECT_ITEM = `
  SELECT i.*,
    (SELECT group_concat(p.name, '${SEP}') FROM item_people ip JOIN people p ON p.id = ip.person_id
       WHERE ip.item_id = i.id AND ip.role = 'author' ORDER BY ip.position) AS authors,
    (SELECT group_concat(p.name, '${SEP}') FROM item_people ip JOIN people p ON p.id = ip.person_id
       WHERE ip.item_id = i.id AND ip.role = 'narrator' ORDER BY ip.position) AS narrators,
    (SELECT group_concat(t.name, '${SEP}') FROM item_tags it JOIN tags t ON t.id = it.tag_id
       WHERE it.item_id = i.id) AS tags,
    pr.item_id AS p_item_id, pr.position_sec AS p_position_sec, pr.locator AS p_locator,
    pr.progress_pct AS p_progress_pct, pr.status AS p_status, pr.finished_at AS p_finished_at,
    pr.updated_at AS p_updated_at
  FROM items i
  LEFT JOIN progress pr ON pr.item_id = i.id
`;

export function getItem(db: Database, id: number): Item | null {
  const row = db.prepare(`${SELECT_ITEM} WHERE i.id = ?`).get<Record<string, unknown>>(id);
  if (!row) return null;
  const item = mapItemRow(row);
  item.files = db
    .prepare('SELECT * FROM media_files WHERE item_id = ? ORDER BY COALESCE(track_no, 0), path')
    .all<Record<string, unknown>>(id)
    .map(mapFileRow);
  item.chapters = db
    .prepare('SELECT * FROM chapters WHERE item_id = ? ORDER BY idx')
    .all<Record<string, unknown>>(id)
    .map((c) => ({
      id: Number(c.id),
      itemId: Number(c.item_id),
      fileId: c.file_id != null ? Number(c.file_id) : null,
      index: Number(c.idx),
      title: String(c.title),
      startSec: Number(c.start_sec),
      endSec: c.end_sec != null ? Number(c.end_sec) : null,
    }));
  return item;
}

export interface ListQuery {
  kind?: MediaKind;
  search?: string;
  author?: string;
  series?: string;
  tag?: string;
  collectionId?: number;
  status?: Progress['status'];
  sort?: 'title' | 'added' | 'year' | 'rating' | 'series' | 'author';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export function listItems(db: Database, q: ListQuery): { items: Item[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (q.kind) {
    where.push('i.kind = ?');
    params.push(q.kind);
  }
  if (q.search && q.search.trim()) {
    where.push('i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)');
    params.push(ftsQuery(q.search));
  }
  if (q.author) {
    where.push(`i.id IN (SELECT ip.item_id FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE p.name = ?)`);
    params.push(q.author);
  }
  if (q.series) {
    where.push('i.series = ?');
    params.push(q.series);
  }
  if (q.tag) {
    where.push('i.id IN (SELECT it.item_id FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name = ?)');
    params.push(q.tag);
  }
  if (q.collectionId) {
    where.push('i.id IN (SELECT item_id FROM collection_items WHERE collection_id = ?)');
    params.push(q.collectionId);
  }
  if (q.status) {
    if (q.status === 'unread') where.push("(pr.status IS NULL OR pr.status = 'unread')");
    else where.push('pr.status = ?'), params.push(q.status);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sortCol =
    {
      title: 'i.sort_title',
      added: 'i.added_at',
      year: 'i.published_year',
      rating: 'i.rating',
      series: 'i.series, i.series_index',
      author: '(SELECT p.sort FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = i.id AND ip.role = \'author\' ORDER BY ip.position LIMIT 1)',
    }[q.sort ?? 'title'] ?? 'i.sort_title';
  const order = q.order === 'desc' ? 'DESC' : 'ASC';

  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS c FROM items i LEFT JOIN progress pr ON pr.item_id = i.id ${whereSql}`).get<{ c: number }>(...params))?.c ?? 0,
  );

  const limit = Math.min(Math.max(q.limit ?? 60, 1), 500);
  const offset = Math.max(q.offset ?? 0, 0);
  const rows = db
    .prepare(`${SELECT_ITEM} ${whereSql} ORDER BY ${sortCol} ${order}, i.sort_title ASC LIMIT ? OFFSET ?`)
    .all<Record<string, unknown>>(...params, limit, offset);

  return { items: rows.map(mapItemRow), total };
}

/** Turn free text into a forgiving FTS5 prefix query. */
function ftsQuery(text: string): string {
  const terms = text
    .toLowerCase()
    .replace(/["*:()]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (!terms.length) return '""';
  return terms.map((t) => `"${t}"*`).join(' AND ');
}

// ---------- facets / browse ----------

export function listAuthors(db: Database): { name: string; count: number }[] {
  return db
    .prepare(
      `SELECT p.name AS name, COUNT(DISTINCT ip.item_id) AS count
       FROM people p JOIN item_people ip ON ip.person_id = p.id AND ip.role = 'author'
       GROUP BY p.id ORDER BY p.sort`,
    )
    .all<{ name: string; count: number }>();
}

export function listSeries(db: Database): { name: string; count: number }[] {
  return db
    .prepare(
      `SELECT series AS name, COUNT(*) AS count FROM items WHERE series IS NOT NULL AND series <> ''
       GROUP BY series ORDER BY series`,
    )
    .all<{ name: string; count: number }>();
}

export function listTags(db: Database): { name: string; count: number }[] {
  return db
    .prepare(
      `SELECT t.name AS name, COUNT(*) AS count FROM tags t JOIN item_tags it ON it.tag_id = t.id
       GROUP BY t.id ORDER BY count DESC, t.name`,
    )
    .all<{ name: string; count: number }>();
}

export function stats(db: Database): Record<string, number> {
  const one = (sql: string, ...p: unknown[]) => Number((db.prepare(sql).get<{ c: number }>(...p))?.c ?? 0);
  return {
    ebooks: one("SELECT COUNT(*) AS c FROM items WHERE kind = 'ebook'"),
    audiobooks: one("SELECT COUNT(*) AS c FROM items WHERE kind = 'audiobook'"),
    authors: one("SELECT COUNT(DISTINCT person_id) AS c FROM item_people WHERE role = 'author'"),
    series: one("SELECT COUNT(DISTINCT series) AS c FROM items WHERE series IS NOT NULL AND series <> ''"),
    reading: one("SELECT COUNT(*) AS c FROM progress WHERE status = 'reading'"),
    finished: one("SELECT COUNT(*) AS c FROM progress WHERE status = 'finished'"),
    files: one('SELECT COUNT(*) AS c FROM media_files'),
    audioSeconds: Number((db.prepare("SELECT COALESCE(SUM(duration_sec),0) AS c FROM items WHERE kind='audiobook'").get<{ c: number }>())?.c ?? 0),
  };
}

// ---------- progress ----------

export function getProgress(db: Database, itemId: number): Progress | null {
  return mapProgressRow(db.prepare('SELECT * FROM progress WHERE item_id = ?').get<Record<string, unknown>>(itemId));
}

export function setProgress(
  db: Database,
  itemId: number,
  patch: { positionSec?: number | null; locator?: string | null; progressPct?: number; status?: Progress['status'] },
): Progress {
  const existing = getProgress(db, itemId);
  const status = patch.status ?? (existing?.status && existing.status !== 'unread' ? existing.status : 'reading');
  const finishedAt = status === 'finished' ? existing?.finishedAt ?? nowIso() : null;
  const progressPct = patch.progressPct ?? (status === 'finished' ? 100 : existing?.progressPct ?? 0);
  db.prepare(
    `INSERT INTO progress (item_id, position_sec, locator, progress_pct, status, finished_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       position_sec = COALESCE(excluded.position_sec, progress.position_sec),
       locator = COALESCE(excluded.locator, progress.locator),
       progress_pct = excluded.progress_pct,
       status = excluded.status,
       finished_at = excluded.finished_at,
       updated_at = excluded.updated_at`,
  ).run(
    itemId,
    patch.positionSec ?? existing?.positionSec ?? null,
    patch.locator ?? existing?.locator ?? null,
    progressPct,
    status,
    finishedAt,
    nowIso(),
  );
  return getProgress(db, itemId)!;
}

// ---------- collections ----------

export function listCollections(db: Database): Collection[] {
  return db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
       FROM collections c ORDER BY c.name`,
    )
    .all<Record<string, unknown>>()
    .map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      description: (r.description as string) ?? null,
      kind: (r.kind as Collection['kind']) ?? 'shelf',
      rules: (r.rules as string) ?? null,
      createdAt: String(r.created_at),
      itemCount: Number(r.item_count ?? 0),
    }));
}

export function createCollection(db: Database, name: string, description?: string): Collection {
  const res = db
    .prepare("INSERT INTO collections (name, description, kind, created_at) VALUES (?, ?, 'shelf', ?)")
    .run(name.trim(), description ?? null, nowIso());
  return listCollections(db).find((c) => c.id === Number(res.lastInsertRowid))!;
}

export function deleteCollection(db: Database, id: number): void {
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
}

export function setCollectionMembership(db: Database, collectionId: number, itemId: number, member: boolean): void {
  if (member) {
    const max = Number(
      (db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM collection_items WHERE collection_id = ?').get<{ m: number }>(collectionId))?.m ?? 0,
    );
    db.prepare('INSERT OR IGNORE INTO collection_items (collection_id, item_id, position) VALUES (?, ?, ?)').run(collectionId, itemId, max + 1);
  } else {
    db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?').run(collectionId, itemId);
  }
}

export function collectionsForItem(db: Database, itemId: number): number[] {
  return db.prepare('SELECT collection_id FROM collection_items WHERE item_id = ?').all<{ collection_id: number }>(itemId).map((r) => r.collection_id);
}
