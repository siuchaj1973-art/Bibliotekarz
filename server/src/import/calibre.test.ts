import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDatabase } from '../db.js';
import * as repo from '../repo.js';
import { importCalibreLibrary } from './calibre.js';
import type { Config } from '../config.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => any };

const CALIBRE_SCHEMA = `
CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, sort TEXT, pubdate TEXT, series_index REAL, isbn TEXT, path TEXT, has_cover INT);
CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT, sort TEXT);
CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY, book INT, author INT);
CREATE TABLE series (id INTEGER PRIMARY KEY, name TEXT, sort TEXT);
CREATE TABLE books_series_link (id INTEGER PRIMARY KEY, book INT, series INT);
CREATE TABLE publishers (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE books_publishers_link (id INTEGER PRIMARY KEY, book INT, publisher INT);
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE books_tags_link (id INTEGER PRIMARY KEY, book INT, tag INT);
CREATE TABLE languages (id INTEGER PRIMARY KEY, lang_code TEXT);
CREATE TABLE books_languages_link (id INTEGER PRIMARY KEY, book INT, lang_code INT);
CREATE TABLE comments (id INTEGER PRIMARY KEY, book INT, text TEXT);
CREATE TABLE ratings (id INTEGER PRIMARY KEY, rating INT);
CREATE TABLE books_ratings_link (id INTEGER PRIMARY KEY, book INT, rating INT);
CREATE TABLE identifiers (id INTEGER PRIMARY KEY, book INT, type TEXT, val TEXT);
CREATE TABLE data (id INTEGER PRIMARY KEY, book INT, format TEXT, name TEXT);
`;

function buildCalibreLibrary(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calibre-'));
  const cal = new DatabaseSync(path.join(dir, 'metadata.db'));
  cal.exec(CALIBRE_SCHEMA);

  // Book 1: ebook
  cal.exec(`INSERT INTO books VALUES (1,'The Hobbit','Hobbit, The','1937-01-01',1,'9780261103283','Tolkien/Hobbit (1)',1);`);
  cal.exec(`INSERT INTO authors VALUES (1,'J.R.R. Tolkien','Tolkien, J.R.R.');`);
  cal.exec(`INSERT INTO books_authors_link VALUES (1,1,1);`);
  cal.exec(`INSERT INTO series VALUES (1,'Middle-earth','Middle-earth');`);
  cal.exec(`INSERT INTO books_series_link VALUES (1,1,1);`);
  cal.exec(`INSERT INTO publishers VALUES (1,'Allen & Unwin');`);
  cal.exec(`INSERT INTO books_publishers_link VALUES (1,1,1);`);
  cal.exec(`INSERT INTO tags VALUES (1,'Fantasy'),(2,'Classic');`);
  cal.exec(`INSERT INTO books_tags_link VALUES (1,1,1),(2,1,2);`);
  cal.exec(`INSERT INTO languages VALUES (1,'eng');`);
  cal.exec(`INSERT INTO books_languages_link VALUES (1,1,1);`);
  cal.exec(`INSERT INTO comments VALUES (1,1,'<p>A hobbit goes on an <b>adventure</b>.</p>');`);
  cal.exec(`INSERT INTO ratings VALUES (1,8);`);
  cal.exec(`INSERT INTO books_ratings_link VALUES (1,1,1);`);
  cal.exec(`INSERT INTO identifiers VALUES (1,1,'amazon','B000XYZ');`);
  cal.exec(`INSERT INTO data VALUES (1,1,'EPUB','hobbit');`);

  // Book 2: audiobook (mp3) — no valid audio, import must still register it
  cal.exec(`INSERT INTO books VALUES (2,'Dune','Dune',NULL,NULL,NULL,'Herbert/Dune (2)',0);`);
  cal.exec(`INSERT INTO authors VALUES (2,'Frank Herbert','Herbert, Frank');`);
  cal.exec(`INSERT INTO books_authors_link VALUES (3,2,2);`);
  cal.exec(`INSERT INTO data VALUES (2,2,'MP3','dune');`);
  cal.close();

  // Physical files
  const hobbitDir = path.join(dir, 'Tolkien/Hobbit (1)');
  fs.mkdirSync(hobbitDir, { recursive: true });
  fs.writeFileSync(path.join(hobbitDir, 'hobbit.epub'), 'dummy-epub-bytes');
  fs.writeFileSync(path.join(hobbitDir, 'cover.jpg'), Buffer.from('ffd8ffe0', 'hex')); // jpeg magic
  const duneDir = path.join(dir, 'Herbert/Dune (2)');
  fs.mkdirSync(duneDir, { recursive: true });
  fs.writeFileSync(path.join(duneDir, 'dune.mp3'), Buffer.alloc(64));

  return dir;
}

function makeConfig(calibreDir: string): Config {
  const coversDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covers-'));
  return {
    port: 0, libraryDir: calibreDir, dataDir: coversDir, dbPath: ':memory:',
    coversDir, publicBaseUrl: '', authToken: '', logLevel: 'error', webDist: '', scanOnStart: false,
  };
}

test('importCalibreLibrary maps metadata, files and cover', async () => {
  const calibreDir = buildCalibreLibrary();
  const config = makeConfig(calibreDir);
  const db = openDatabase(':memory:');

  const result = await importCalibreLibrary(db, config, calibreDir);
  assert.equal(result.booksInLibrary, 2);
  assert.equal(result.imported, 2);
  assert.equal(result.skippedNoFiles, 0);

  const { items } = repo.listItems(db, {});
  assert.equal(items.length, 2);

  const hobbit = repo.getItem(db, items.find((i) => i.title === 'The Hobbit')!.id)!;
  assert.equal(hobbit.kind, 'ebook');
  assert.deepEqual(hobbit.authors, ['J.R.R. Tolkien']);
  assert.equal(hobbit.series, 'Middle-earth');
  assert.equal(hobbit.seriesIndex, 1);
  assert.equal(hobbit.publisher, 'Allen & Unwin');
  assert.equal(hobbit.publishedYear, 1937);
  assert.equal(hobbit.language, 'eng');
  assert.equal(hobbit.isbn, '9780261103283');
  assert.equal(hobbit.asin, 'B000XYZ');
  assert.equal(hobbit.rating, 4); // Calibre 8/10 → 4/5
  assert.deepEqual(hobbit.tags.sort(), ['Classic', 'Fantasy']);
  assert.equal(hobbit.description, 'A hobbit goes on an adventure.'); // HTML stripped
  assert.equal(hobbit.files.length, 1);
  assert.equal(hobbit.files[0].format, 'epub');
  assert.ok(hobbit.coverPath, 'cover imported');

  const dune = repo.getItem(db, items.find((i) => i.title === 'Dune')!.id)!;
  assert.equal(dune.kind, 'audiobook');
  assert.equal(dune.files.length, 1);
  assert.equal(dune.files[0].format, 'mp3');

  // Re-import is idempotent (updates, not duplicates).
  const again = await importCalibreLibrary(db, config, calibreDir);
  assert.equal(again.imported, 0);
  assert.equal(again.updated, 2);
  assert.equal(repo.listItems(db, {}).items.length, 2);

  db.close();
});
