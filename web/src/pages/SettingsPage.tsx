import { useEffect, useState } from 'react';
import { api, getToken, setToken } from '../api';
import { useAsync } from '../components/common';
import { formatDuration } from '../util';
import type { ScanState } from '../types';

export function SettingsPage() {
  const { data: stats, reload: reloadStats } = useAsync(() => api.stats(), []);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [token, setTokenInput] = useState(getToken());
  const [polling, setPolling] = useState(false);
  const [calibrePath, setCalibrePath] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const runImport = async () => {
    if (!calibrePath.trim()) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const r = await api.importCalibre(calibrePath.trim());
      setImportMsg({
        kind: 'ok',
        text: `Zaimportowano ${r.imported}, zaktualizowano ${r.updated} z ${r.booksInLibrary} książek (pominięto bez plików: ${r.skippedNoFiles}${r.errors.length ? `, błędów: ${r.errors.length}` : ''}).`,
      });
      reloadStats();
    } catch (e) {
      setImportMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setImporting(false);
    }
  };

  const refreshScan = () => api.scanStatus().then(setScan).catch(() => {});
  useEffect(() => { refreshScan(); }, []);

  useEffect(() => {
    if (!polling) return;
    const iv = setInterval(async () => {
      const s = await api.scanStatus().catch(() => null);
      if (s) setScan(s);
      if (s && !s.running) { setPolling(false); reloadStats(); }
    }, 1500);
    return () => clearInterval(iv);
  }, [polling]);

  const startScan = async () => {
    await api.scan().catch(() => {});
    setPolling(true);
    refreshScan();
  };

  const opdsUrl = `${location.origin}/opds`;

  const statCards = stats ? [
    { n: stats.ebooks, l: 'E-booki' },
    { n: stats.audiobooks, l: 'Audiobooki' },
    { n: stats.authors, l: 'Autorzy' },
    { n: stats.series, l: 'Serie' },
    { n: stats.reading, l: 'W trakcie' },
    { n: stats.finished, l: 'Ukończone' },
  ] : [];

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Ustawienia</h1>

      <div className="section-title">Biblioteka</div>
      <div className="stat-cards">
        {statCards.map((s) => <div key={s.l} className="stat-card"><div className="n">{s.n}</div><div className="l">{s.l}</div></div>)}
        {stats && <div className="stat-card"><div className="n">{formatDuration(stats.audioSeconds) || '0'}</div><div className="l">Łącznie audio</div></div>}
      </div>

      <div className="section-title">Skanowanie</div>
      <p style={{ color: 'var(--text-dim)' }}>
        Skanowanie odczytuje pliki z folderu biblioteki (skonfigurowanego przez <code>LIBRARY_DIR</code>) i aktualizuje katalog.
        Pliki na dysku nie są modyfikowane.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn primary" onClick={startScan} disabled={scan?.running || polling}>
          {scan?.running || polling ? '⏳ Skanowanie…' : '↻ Skanuj teraz'}
        </button>
        {scan?.lastResult && !scan.running && (
          <span style={{ color: 'var(--text-dim)' }}>
            Ostatnio: +{scan.lastResult.addedItems} nowych, ~{scan.lastResult.updatedItems} zaktualizowanych,
            −{scan.lastResult.removedItems} usuniętych ({(scan.lastResult.durationMs / 1000).toFixed(1)}s)
          </span>
        )}
      </div>
      {scan?.lastError && <div className="banner" style={{ marginTop: 12 }}>Błąd skanowania: {scan.lastError}</div>}
      {scan?.lastResult && scan.lastResult.errors.length > 0 && (
        <div className="banner" style={{ marginTop: 12 }}>
          {scan.lastResult.errors.length} plików z błędami. Pierwszy: {scan.lastResult.errors[0].path}
        </div>
      )}

      <div className="section-title">Import z Calibre</div>
      <p style={{ color: 'var(--text-dim)' }}>
        Podaj ścieżkę do katalogu biblioteki Calibre (zawierającego <code>metadata.db</code>).
        Metadane i okładki Calibre zostaną zaimportowane, a pliki pozostaną w miejscu (nic nie jest kopiowane).
      </p>
      <div style={{ display: 'flex', gap: 10, maxWidth: 560 }}>
        <input className="control" placeholder="/ścieżka/do/Calibre Library" value={calibrePath} onChange={(e) => setCalibrePath(e.target.value)} />
        <button className="btn primary" onClick={runImport} disabled={importing}>{importing ? 'Importowanie…' : 'Importuj'}</button>
      </div>
      {importMsg && <div className={`banner ${importMsg.kind === 'ok' ? 'ok' : ''}`} style={{ marginTop: 12 }}>{importMsg.text}</div>}

      <div className="section-title">Katalog OPDS</div>
      <p style={{ color: 'var(--text-dim)' }}>
        Podłącz zewnętrzne czytniki (KOReader, Moon+ Reader, Librera, Thorium) do tego adresu, aby przeglądać i pobierać książki:
      </p>
      <div className="list-row"><code style={{ flex: 1 }}>{opdsUrl}</code>
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(opdsUrl)}>Kopiuj</button>
      </div>

      <div className="section-title">Dostęp (token)</div>
      <p style={{ color: 'var(--text-dim)' }}>
        Jeśli serwer wymaga tokenu (<code>AUTH_TOKEN</code>), wprowadź go tutaj. Zapisywany lokalnie w przeglądarce.
      </p>
      <div style={{ display: 'flex', gap: 10, maxWidth: 460 }}>
        <input className="control" type="password" placeholder="Token API…" value={token} onChange={(e) => setTokenInput(e.target.value)} />
        <button className="btn primary" onClick={() => { setToken(token); location.reload(); }}>Zapisz</button>
      </div>

      <div className="section-title">O programie</div>
      <p style={{ color: 'var(--text-dim)' }}>
        <strong>Bibliotekarz 1.0</strong> — samodzielny menedżer e-booków i audiobooków.
        Działa lokalnie lub w chmurze. Obsługuje EPUB, PDF, MOBI oraz audiobooki MP3/M4B z rozdziałami.
      </p>
    </div>
  );
}
