import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { parseEpub, epubManifest } from './epub.js';

function buildEpub(): string {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">urn:isbn:9780261103283</dc:identifier>
    <dc:title>The Hobbit</dc:title>
    <dc:creator opf:role="aut">J.R.R. Tolkien</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Allen &amp; Unwin</dc:publisher>
    <dc:date>1937-01-01</dc:date>
    <dc:subject>Fantasy</dc:subject>
    <meta name="calibre:series" content="Middle-earth"/>
    <meta name="calibre:series_index" content="1"/>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c0" href="ch0.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c0"/>
    <itemref idref="c1"/>
  </spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>TOC</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="ch0.xhtml">Chapter One</a></li>
<li><a href="ch1.xhtml">Chapter Two</a></li>
</ol></nav></body></html>`;

  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/cover.png': new Uint8Array(png),
    'OEBPS/ch0.xhtml': strToU8('<html><body><h1>Chapter One</h1></body></html>'),
    'OEBPS/ch1.xhtml': strToU8('<html><body><h1>Chapter Two</h1></body></html>'),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biblio-epub-'));
  const file = path.join(dir, 'hobbit.epub');
  fs.writeFileSync(file, zipSync(files));
  return file;
}

test('parseEpub extracts Dublin Core + Calibre metadata and cover', () => {
  const file = buildEpub();
  const meta = parseEpub(file);
  assert.equal(meta.kind, 'ebook');
  assert.equal(meta.title, 'The Hobbit');
  assert.deepEqual(meta.authors, ['J.R.R. Tolkien']);
  assert.equal(meta.series, 'Middle-earth');
  assert.equal(meta.seriesIndex, 1);
  assert.equal(meta.language, 'en');
  assert.equal(meta.publisher, 'Allen & Unwin');
  assert.equal(meta.publishedYear, 1937);
  assert.equal(meta.isbn, '9780261103283');
  assert.deepEqual(meta.tags, ['Fantasy']);
  assert.ok(meta.cover && meta.cover.data.length > 0);
  assert.equal(meta.cover?.mimeType, 'image/png');
});

test('epubManifest returns ordered spine and TOC', () => {
  const file = buildEpub();
  const m = epubManifest(file);
  assert.equal(m.spine.length, 2);
  assert.equal(m.spine[0].href, 'OEBPS/ch0.xhtml');
  assert.equal(m.spine[1].href, 'OEBPS/ch1.xhtml');
  assert.deepEqual(m.toc.map((t) => t.title), ['Chapter One', 'Chapter Two']);
  assert.equal(m.toc[0].href, 'OEBPS/ch0.xhtml');
});
