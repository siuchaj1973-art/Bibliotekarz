import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type ItemQuery } from '../api';
import { ItemCard, Spinner, Empty, useAsync } from '../components/common';
import type { MediaKind } from '../types';

const SORTS: { value: string; label: string }[] = [
  { value: 'title', label: 'Tytuł' },
  { value: 'author', label: 'Autor' },
  { value: 'added', label: 'Data dodania' },
  { value: 'year', label: 'Rok wydania' },
  { value: 'rating', label: 'Ocena' },
  { value: 'series', label: 'Seria' },
];

export function LibraryPage({ kind, status, title }: { kind?: MediaKind; status?: string; title: string }) {
  const [params, setParams] = useSearchParams();
  const [sort, setSort] = useState('title');
  const [order, setOrder] = useState('asc');
  const [page, setPage] = useState(0);
  const pageSize = 60;

  const search = params.get('search') ?? undefined;
  const author = params.get('author') ?? undefined;
  const series = params.get('series') ?? undefined;
  const tag = params.get('tag') ?? undefined;
  const collection = params.get('collection') ? Number(params.get('collection')) : undefined;

  const query: ItemQuery = {
    kind, status, search, author, series, tag, collection,
    sort: status === 'reading' ? 'added' : sort,
    order: status === 'reading' ? 'desc' : order,
    limit: pageSize, offset: page * pageSize,
  };

  const { data, loading, error } = useAsync(() => api.listItems(query), [
    kind, status, search, author, series, tag, collection, sort, order, page,
  ]);

  const activeFilters: { key: string; label: string }[] = [];
  if (search) activeFilters.push({ key: 'search', label: `„${search}"` });
  if (author) activeFilters.push({ key: 'author', label: author });
  if (series) activeFilters.push({ key: 'series', label: `Seria: ${series}` });
  if (tag) activeFilters.push({ key: 'tag', label: `Tag: ${tag}` });

  const clearFilter = (key: string) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    setParams(next);
    setPage(0);
  };

  const heading = author || series || (search ? `Wyniki: „${search}"` : title);
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="filters">
        <h1 style={{ fontSize: 22, margin: 0 }}>{heading}</h1>
        {total > 0 && <span style={{ color: 'var(--text-faint)' }}>{total}</span>}
        <div className="spacer" />
        {activeFilters.map((f) => (
          <span key={f.key} className="chip active">
            {f.label}
            <button onClick={() => clearFilter(f.key)}>✕</button>
          </span>
        ))}
        {status !== 'reading' && (
          <>
            <select className="control" style={{ width: 'auto' }} value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button className="btn sm" onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}>
              {order === 'asc' ? '↑ A–Z' : '↓ Z–A'}
            </button>
          </>
        )}
      </div>

      {error && <div className="banner">Błąd: {error}</div>}
      {loading && !data ? (
        <Spinner />
      ) : !data || data.items.length === 0 ? (
        <Empty icon="📭" title="Brak pozycji" hint="Dodaj pliki do folderu biblioteki i kliknij „Skanuj”." />
      ) : (
        <>
          <div className="grid">
            {data.items.map((it) => <ItemCard key={it.id} item={it} />)}
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 30, alignItems: 'center' }}>
              <button className="btn sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Poprzednia</button>
              <span style={{ color: 'var(--text-dim)' }}>{page + 1} / {totalPages}</span>
              <button className="btn sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Następna →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
