import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Spinner, Empty, useAsync } from '../components/common';
import type { EpubManifest, Item } from '../types';

export function ReaderPage() {
  const { id } = useParams();
  const itemId = Number(id);
  const { data: item, loading } = useAsync(() => api.getItem(itemId), [itemId]);

  if (loading) return <div className="reader"><Spinner /></div>;
  if (!item) return <Empty icon="⚠" title="Nie znaleziono pozycji" />;

  const epub = item.files.find((f) => f.format === 'epub');
  const pdf = item.files.find((f) => f.format === 'pdf');

  if (epub) return <EpubReader item={item} />;
  if (pdf) return <PdfReader item={item} />;
  return <Empty icon="📄" title="Brak obsługiwanego formatu do czytania" hint="Dostępny jest tylko pobierany plik." />;
}

function PdfReader({ item }: { item: Item }) {
  const navigate = useNavigate();
  const pdf = item.files.find((f) => f.format === 'pdf')!;
  return (
    <div className="reader">
      <div className="reader-top">
        <button className="btn sm" onClick={() => navigate(-1)}>← Wróć</button>
        <div className="r-title">{item.title}</div>
      </div>
      <div className="reader-body">
        <iframe title={item.title} src={api.streamUrl(item.id, pdf.id)} />
      </div>
    </div>
  );
}

function resolveHref(base: string, rel: string): string {
  try {
    const u = new URL(rel, `epub:///${base}`);
    return decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  } catch {
    return rel;
  }
}

function EpubReader({ item }: { item: Item }) {
  const navigate = useNavigate();
  const { data: manifest, loading, error } = useAsync(() => api.manifest(item.id), [item.id]);
  const [spineIndex, setSpineIndex] = useState(0);
  const [html, setHtml] = useState<string>('');
  const [tocOpen, setTocOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const restored = useRef(false);

  // Restore last position from progress locator.
  useEffect(() => {
    if (!manifest || restored.current) return;
    restored.current = true;
    try {
      const loc = item.progress?.locator ? JSON.parse(item.progress.locator) : null;
      if (loc?.spineIndex != null && loc.spineIndex < manifest.spine.length) setSpineIndex(loc.spineIndex);
    } catch { /* ignore */ }
  }, [manifest, item.progress]);

  const currentHref = manifest?.spine[spineIndex]?.href;

  // Load & rewrite the current chapter document.
  useEffect(() => {
    if (!manifest || !currentHref) return;
    let alive = true;
    fetch(api.resourceUrl(item.id, currentHref))
      .then((r) => r.text())
      .then((raw) => {
        if (!alive) return;
        setHtml(rewriteDocument(raw, item.id, currentHref));
      })
      .catch(() => alive && setHtml('<p style="padding:2rem">Nie udało się wczytać rozdziału.</p>'));
    return () => { alive = false; };
  }, [manifest, currentHref, item.id]);

  // Persist reading position.
  useEffect(() => {
    if (!manifest) return;
    const pct = Math.round(((spineIndex + 1) / manifest.spine.length) * 100);
    api.setProgress(item.id, {
      locator: JSON.stringify({ spineIndex, href: currentHref }),
      progressPct: pct,
      status: pct >= 99 ? 'finished' : 'reading',
    }).catch(() => {});
  }, [spineIndex, manifest, item.id, currentHref]);

  const go = (delta: number) => {
    if (!manifest) return;
    setSpineIndex((i) => Math.max(0, Math.min(manifest.spine.length - 1, i + delta)));
    iframeRef.current?.contentWindow?.scrollTo(0, 0);
    setTocOpen(false);
  };

  const jumpToHref = (href: string) => {
    if (!manifest) return;
    const clean = href.split('#')[0];
    const idx = manifest.spine.findIndex((s) => s.href === clean || s.href.endsWith(clean));
    if (idx >= 0) { setSpineIndex(idx); setTocOpen(false); }
  };

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') navigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toc = useMemo(() => manifest?.toc ?? [], [manifest]);

  if (loading) return <div className="reader"><Spinner /></div>;
  if (error || !manifest) return <Empty icon="⚠" title="Nie udało się otworzyć EPUB" hint={error ?? undefined} />;

  return (
    <div className="reader">
      <div className="reader-top">
        <button className="btn sm" onClick={() => navigate(-1)}>← Wróć</button>
        <button className="btn sm" onClick={() => setTocOpen((v) => !v)}>☰ Spis treści</button>
        <div className="r-title">{item.title}</div>
        <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>{spineIndex + 1} / {manifest.spine.length}</span>
      </div>
      <div className="reader-body">
        <div className={`reader-toc ${tocOpen ? '' : 'hidden'}`}>
          {toc.length === 0 && <div style={{ padding: 12, color: 'var(--text-faint)' }}>Brak spisu treści</div>}
          {toc.map((t, i) => <a key={i} onClick={() => jumpToHref(t.href)}>{t.title}</a>)}
        </div>
        <div className="reader-frame-wrap">
          <iframe ref={iframeRef} title={item.title} sandbox="allow-same-origin" srcDoc={html} />
          <button className="reader-nav-btn prev" onClick={() => go(-1)} disabled={spineIndex === 0}>‹</button>
          <button className="reader-nav-btn next" onClick={() => go(1)} disabled={spineIndex >= manifest.spine.length - 1}>›</button>
        </div>
      </div>
    </div>
  );
}

const READER_CSS = `
  html,body{margin:0;background:#faf8f3;color:#1a1a1a;}
  body{max-width:42rem;margin:0 auto;padding:3rem 1.6rem 6rem;font-family:Georgia,'Times New Roman',serif;font-size:1.15rem;line-height:1.7;}
  img{max-width:100%;height:auto;}
  a{color:#1155cc;}
  h1,h2,h3{line-height:1.25;}
  @media (prefers-color-scheme: dark){
    html,body{background:#15120e;color:#d9d2c5;}
    a{color:#6fa8ff;}
  }
`;

/** Rewrite relative resource URLs in a chapter document to the API resource endpoint. */
function rewriteDocument(raw: string, itemId: number, chapterHref: string): string {
  const baseDir = chapterHref;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(raw, 'text/html');
  } catch {
    doc = new DOMParser().parseFromString(raw, 'text/html');
  }

  const isExternal = (v: string) => /^([a-z]+:)?\/\//i.test(v) || v.startsWith('data:') || v.startsWith('#') || v.startsWith('mailto:');

  doc.querySelectorAll('[src]').forEach((el) => {
    const v = el.getAttribute('src')!;
    if (!isExternal(v)) el.setAttribute('src', api.resourceUrl(itemId, resolveHref(baseDir, v)));
  });
  doc.querySelectorAll('link[href]').forEach((el) => {
    const v = el.getAttribute('href')!;
    if (!isExternal(v)) el.setAttribute('href', api.resourceUrl(itemId, resolveHref(baseDir, v)));
  });
  // In-document links stay clickable but harmless (sandbox blocks navigation).
  doc.querySelectorAll('a[href]').forEach((el) => {
    const v = el.getAttribute('href')!;
    if (!isExternal(v)) el.setAttribute('href', 'javascript:void(0)');
  });

  const style = doc.createElement('style');
  style.textContent = READER_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);

  return `<!doctype html>` + (doc.documentElement?.outerHTML ?? raw);
}
