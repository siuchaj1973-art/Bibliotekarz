import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Minimal typing for the built-in node:sqlite module so we don't depend on a
// specific @types/node version shipping its declarations.
export interface RunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}
export interface Statement {
  run(...params: unknown[]): RunResult;
  get<T = Record<string, unknown>>(...params: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(...params: unknown[]): T[];
}
export interface RawDatabase {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => RawDatabase;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK (kind IN ('ebook','audiobook')),
  title         TEXT NOT NULL,
  sort_title    TEXT NOT NULL,
  subtitle      TEXT,
  series        TEXT,
  series_index  REAL,
  publisher     TEXT,
  published_year INTEGER,
  language      TEXT,
  isbn          TEXT,
  asin          TEXT,
  description   TEXT,
  rating        REAL,
  cover_path    TEXT,
  duration_sec  REAL,
  added_at      TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
CREATE INDEX IF NOT EXISTS idx_items_series ON items(series);
CREATE INDEX IF NOT EXISTS idx_items_sort ON items(sort_title);

CREATE TABLE IF NOT EXISTS people (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_people (
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('author','narrator')),
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, person_id, role)
);
CREATE INDEX IF NOT EXISTS idx_item_people_person ON item_people(person_id, role);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS item_tags (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS media_files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  path         TEXT NOT NULL UNIQUE,
  rel_path     TEXT NOT NULL,
  format       TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  duration_sec REAL,
  hash         TEXT NOT NULL,
  mtime_ms     REAL NOT NULL,
  track_no     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_media_item ON media_files(item_id);
CREATE INDEX IF NOT EXISTS idx_media_hash ON media_files(hash);

CREATE TABLE IF NOT EXISTS chapters (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  file_id   INTEGER REFERENCES media_files(id) ON DELETE CASCADE,
  idx       INTEGER NOT NULL,
  title     TEXT NOT NULL,
  start_sec REAL NOT NULL,
  end_sec   REAL
);
CREATE INDEX IF NOT EXISTS idx_chapters_item ON chapters(item_id);

CREATE TABLE IF NOT EXISTS progress (
  item_id      INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  position_sec REAL,
  locator      TEXT,
  progress_pct REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','reading','finished')),
  finished_at  TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  kind        TEXT NOT NULL DEFAULT 'shelf' CHECK (kind IN ('shelf','smart')),
  rules       TEXT,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, item_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title, authors, narrators, series, tags, description,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

export type Database = RawDatabase;

export function openDatabase(dbPath: string): Database {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  return db;
}

/** Open an existing SQLite database read-only (e.g. a Calibre metadata.db). */
export function openReadonly(dbPath: string): Database {
  return new DatabaseSync(dbPath, { readOnly: true });
}

/** Run a function inside a transaction, rolling back on error. */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
