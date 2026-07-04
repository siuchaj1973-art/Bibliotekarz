import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Item } from '../types';
import { api } from '../api';
import { formatDuration, initials } from '../util';

export function Cover({ item, className }: { item: Item; className?: string }) {
  const [err, setErr] = useState(false);
  const url = api.coverUrl(item);
  return (
    <div className={`cover-wrap ${className ?? ''}`}>
      {url && !err ? (
        <img src={url} alt={item.title} loading="lazy" onError={() => setErr(true)} />
      ) : (
        <div className="cover-fallback">
          <div className="big">{initials(item.title)}</div>
          <div className="fb-title">{item.title}</div>
        </div>
      )}
      <div className={`kind-badge ${item.kind === 'audiobook' ? 'audio' : ''}`}>
        {item.kind === 'audiobook' ? '🎧 Audio' : '📖 E-book'}
      </div>
      {item.progress && item.progress.progressPct > 0 && item.progress.progressPct < 100 && (
        <div className="progress-ring">{item.progress.progressPct}%</div>
      )}
      {item.progress?.status === 'finished' && <div className="progress-ring" style={{ color: 'var(--green)' }}>✓</div>}
    </div>
  );
}

export function ItemCard({ item }: { item: Item }) {
  const sub =
    item.kind === 'audiobook' && item.durationSec
      ? `${item.authors[0] ?? 'Nieznany'} · ${formatDuration(item.durationSec)}`
      : item.authors[0] ?? 'Nieznany autor';
  return (
    <Link to={`/item/${item.id}`} className="card">
      <Cover item={item} />
      <div>
        <div className="card-title">{item.title}</div>
        <div className="card-sub">{sub}</div>
        {item.series && <div className="card-sub" style={{ color: 'var(--text-faint)' }}>{item.series}{item.seriesIndex != null ? ` #${item.seriesIndex}` : ''}</div>}
        {item.progress && item.progress.progressPct > 0 && item.progress.progressPct < 100 && (
          <div className="card-progress"><div style={{ width: `${item.progress.progressPct}%` }} /></div>
        )}
      </div>
    </Link>
  );
}

export function Stars({ value, onChange }: { value: number | null; onChange?: (v: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value ?? 0;
  return (
    <div className={`stars ${onChange ? '' : 'readonly'}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`star ${n <= display ? 'filled' : ''}`}
          onMouseEnter={() => onChange && setHover(n)}
          onMouseLeave={() => onChange && setHover(null)}
          onClick={() => onChange?.(n === value ? 0 : n)}
        >
          ★
        </span>
      ))}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" />;
}

export function Empty({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div style={{ fontSize: 17, color: 'var(--text-dim)' }}>{title}</div>
      {hint && <div style={{ marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Small async data hook with loading / error / reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fnRef.current()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}
