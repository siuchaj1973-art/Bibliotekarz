import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSortTitle, makePersonSort, parseYear, kindForFormat, formatOf, titleFromFilename } from './util.js';

test('makeSortTitle drops leading articles and lowercases', () => {
  assert.equal(makeSortTitle('The Hobbit'), 'hobbit');
  assert.equal(makeSortTitle('A Game of Thrones'), 'game of thrones');
  assert.equal(makeSortTitle('Diuna'), 'diuna');
});

test('makePersonSort flips to "Last, First"', () => {
  assert.equal(makePersonSort('J.R.R. Tolkien'), 'tolkien, j.r.r.');
  assert.equal(makePersonSort('Frank Herbert'), 'herbert, frank');
  assert.equal(makePersonSort('Homer'), 'homer');
  assert.equal(makePersonSort('King, Stephen'), 'king, stephen');
});

test('parseYear extracts a 4-digit year', () => {
  assert.equal(parseYear('1937-01-01'), 1937);
  assert.equal(parseYear('2021'), 2021);
  assert.equal(parseYear('brak'), undefined);
  assert.equal(parseYear(undefined), undefined);
});

test('kindForFormat classifies by extension', () => {
  assert.equal(kindForFormat('epub'), 'ebook');
  assert.equal(kindForFormat('m4b'), 'audiobook');
  assert.equal(kindForFormat('mp3'), 'audiobook');
  assert.equal(kindForFormat('pdf'), 'ebook');
  assert.equal(kindForFormat('exe'), null);
});

test('formatOf / titleFromFilename', () => {
  assert.equal(formatOf('/lib/Book.EPUB'), 'epub');
  assert.equal(titleFromFilename('/lib/the_hobbit.epub'), 'The Hobbit');
});
