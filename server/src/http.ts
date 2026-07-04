import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { Database } from './db.js';
import type { Config } from './config.js';
import * as repo from './repo.js';
import { scanLibrary } from './scanner.js';
import { epubManifest } from './formats/epub.js';
import { readZip } from './formats/zip.js';
import { buildOpds } from './opds.js';
import type { ScanResult, MediaKind } from './types.js';
import { log } from './logger.js';

interface ScanState {
  running: boolean;
  startedAt: string | null;
  lastResult: ScanResult | null;
  lastError: string | null;
}

export function createApp(db: Database, config: Config): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const scanState: ScanState = { running: false, startedAt: null, lastResult: null, lastError: null };

  // Unauthenticated liveness probe (used by Docker HEALTHCHECK / load balancers).
  app.get('/healthz', (_req, res) => res.json({ ok: true, name: 'Bibliotekarz', version: '1.0.0' }));

  // --- auth ---
  const auth = (req: Request, res: Response, next: NextFunction) => {
    if (!config.authToken) return next();
    const header = req.header('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = bearer ?? (req.query.token as string | undefined);
    if (token === config.authToken) return next();
    res.status(401).json({ error: 'Brak autoryzacji' });
  };

  const api = express.Router();
  api.use(auth);

  // --- health & stats ---
  api.get('/health', (_req, res) => res.json({ ok: true, name: 'Bibliotekarz', version: '1.0.0' }));
  api.get('/stats', (_req, res) => res.json(repo.stats(db)));

  // --- items ---
  api.get('/items', (req, res) => {
    const q = req.query;
    const result = repo.listItems(db, {
      kind: parseKind(q.kind),
      search: str(q.search),
      author: str(q.author),
      series: str(q.series),
      tag: str(q.tag),
      collectionId: num(q.collection),
      status: str(q.status) as never,
      sort: str(q.sort) as never,
      order: str(q.order) as never,
      limit: num(q.limit),
      offset: num(q.offset),
    });
    res.json(result);
  });

  api.get('/items/:id', (req, res) => {
    const item = repo.getItem(db, Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json({ ...item, collections: repo.collectionsForItem(db, item.id) });
  });

  api.patch('/items/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!repo.getItem(db, id)) return res.status(404).json({ error: 'Nie znaleziono' });
    const b = req.body ?? {};
    repo.updateItem(db, id, {
      title: b.title, subtitle: b.subtitle, authors: b.authors, narrators: b.narrators,
      series: b.series, seriesIndex: b.seriesIndex, publisher: b.publisher, publishedYear: b.publishedYear,
      language: b.language, isbn: b.isbn, asin: b.asin, description: b.description, tags: b.tags, rating: b.rating,
    });
    res.json(repo.getItem(db, id));
  });

  api.delete('/items/:id', (req, res) => {
    repo.deleteItem(db, Number(req.params.id));
    res.json({ ok: true });
  });

  api.get('/items/:id/cover', (req, res) => {
    const item = repo.getItem(db, Number(req.params.id));
    if (!item?.coverPath) return res.status(404).end();
    const p = path.join(config.coversDir, item.coverPath);
    if (!fs.existsSync(p)) return res.status(404).end();
    const ext = path.extname(p).slice(1).toLowerCase();
    res.setHeader('Content-Type', `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(p).pipe(res);
  });

  // --- downloads & streaming ---
  api.get('/items/:id/download', (req, res) => serveFile(db, req, res, true));
  api.get('/items/:id/stream', (req, res) => serveFile(db, req, res, false));

  // --- ebook reader (epub) ---
  api.get('/items/:id/manifest', (req, res) => {
    const item = repo.getItem(db, Number(req.params.id));
    const epub = item?.files.find((f) => f.format === 'epub');
    if (!epub) return res.status(404).json({ error: 'Brak pliku EPUB' });
    try {
      const manifest = epubManifest(epub.path);
      res.json({ fileId: epub.id, ...manifest });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  api.get('/items/:id/resource', (req, res) => {
    const item = repo.getItem(db, Number(req.params.id));
    const epub = item?.files.find((f) => f.format === 'epub');
    const href = str(req.query.href);
    if (!epub || !href) return res.status(404).end();
    try {
      const entries = readZip(epub.path);
      const data = entries[href];
      if (!data) return res.status(404).end();
      res.setHeader('Content-Type', resourceMime(href));
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.end(Buffer.from(data));
    } catch {
      res.status(500).end();
    }
  });

  // --- progress ---
  api.get('/items/:id/progress', (req, res) => res.json(repo.getProgress(db, Number(req.params.id))));
  api.put('/items/:id/progress', (req, res) => {
    const id = Number(req.params.id);
    if (!repo.getItem(db, id)) return res.status(404).json({ error: 'Nie znaleziono' });
    const b = req.body ?? {};
    res.json(repo.setProgress(db, id, {
      positionSec: b.positionSec, locator: b.locator, progressPct: b.progressPct, status: b.status,
    }));
  });

  // --- browse facets ---
  api.get('/authors', (_req, res) => res.json(repo.listAuthors(db)));
  api.get('/series', (_req, res) => res.json(repo.listSeries(db)));
  api.get('/tags', (_req, res) => res.json(repo.listTags(db)));

  // --- collections ---
  api.get('/collections', (_req, res) => res.json(repo.listCollections(db)));
  api.post('/collections', (req, res) => {
    const name = str(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Nazwa jest wymagana' });
    res.status(201).json(repo.createCollection(db, name, str(req.body?.description)));
  });
  api.delete('/collections/:id', (req, res) => {
    repo.deleteCollection(db, Number(req.params.id));
    res.json({ ok: true });
  });
  api.post('/collections/:id/items', (req, res) => {
    const itemId = num(req.body?.itemId);
    if (!itemId) return res.status(400).json({ error: 'itemId jest wymagany' });
    repo.setCollectionMembership(db, Number(req.params.id), itemId, req.body?.member !== false);
    res.json({ ok: true });
  });

  // --- scanning ---
  api.get('/scan/status', (_req, res) => res.json(scanState));
  api.post('/scan', (_req, res) => {
    if (scanState.running) return res.status(409).json({ error: 'Skanowanie już trwa', ...scanState });
    scanState.running = true;
    scanState.startedAt = new Date().toISOString();
    scanState.lastError = null;
    scanLibrary(db, config)
      .then((result) => {
        scanState.lastResult = result;
        log.info(`Skan zakończony: +${result.addedItems} ~${result.updatedItems} -${result.removedItems} (${result.durationMs}ms)`);
      })
      .catch((err) => {
        scanState.lastError = (err as Error).message;
        log.error('Skan nie powiódł się:', err);
      })
      .finally(() => {
        scanState.running = false;
      });
    res.status(202).json({ started: true });
  });

  app.use('/api', api);

  // --- OPDS catalog (also token-guarded) ---
  app.use('/opds', auth, (req, res) => {
    const base = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
    const xml = buildOpds(db, req.path, base, config.authToken ? str(req.query.token) : undefined);
    if (!xml) return res.status(404).end();
    res.setHeader('Content-Type', 'application/atom+xml;profile=opds-catalog;charset=utf-8');
    res.send(xml);
  });

  // --- static web app + SPA fallback ---
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/opds')) return next();
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) =>
      res.type('html').send('<h1>Bibliotekarz API</h1><p>Interfejs webowy nie został zbudowany. Uruchom <code>npm run build:web</code>.</p>'),
    );
  }

  return app;
}

// ---------- helpers ----------

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length ? v : undefined;
}
function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && v != null && v !== '' ? n : undefined;
}
function parseKind(v: unknown): MediaKind | undefined {
  return v === 'ebook' || v === 'audiobook' ? v : undefined;
}

function serveFile(db: Database, req: Request, res: Response, asAttachment: boolean): void {
  const item = repo.getItem(db, Number(req.params.id));
  if (!item) {
    res.status(404).end();
    return;
  }
  const fileId = num(req.query.fileId);
  const file = fileId ? item.files.find((f) => f.id === fileId) : item.files[0];
  if (!file || !fs.existsSync(file.path)) {
    res.status(404).end();
    return;
  }
  const stat = fs.statSync(file.path);
  const total = stat.size;
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  if (asAttachment) {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(file.path))}"`);
  }

  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match[2] ? Number.parseInt(match[2], 10) : total - 1;
      if (start >= total || end >= total || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', end - start + 1);
      fs.createReadStream(file.path, { start, end }).pipe(res);
      return;
    }
  }
  res.setHeader('Content-Length', total);
  fs.createReadStream(file.path).pipe(res);
}

function resourceMime(href: string): string {
  const ext = path.extname(href).slice(1).toLowerCase();
  const map: Record<string, string> = {
    xhtml: 'application/xhtml+xml', html: 'text/html', htm: 'text/html',
    css: 'text/css', js: 'application/javascript',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp',
    ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
    ncx: 'application/x-dtbncx+xml', opf: 'application/oebps-package+xml', xml: 'application/xml',
  };
  return map[ext] ?? 'application/octet-stream';
}
