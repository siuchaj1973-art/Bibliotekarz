import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Spinner, Empty, useAsync, ItemCard } from '../components/common';

export function CollectionsPage() {
  const [params, setParams] = useSearchParams();
  const activeId = params.get('collection') ? Number(params.get('collection')) : null;
  const { data: collections, loading, reload } = useAsync(() => api.collections(), []);
  const [newName, setNewName] = useState('');

  const items = useAsync(
    () => (activeId ? api.listItems({ collection: activeId, limit: 200 }) : Promise.resolve(null)),
    [activeId],
  );

  const create = () => {
    if (!newName.trim()) return;
    api.createCollection(newName.trim()).then(() => { setNewName(''); reload(); });
  };
  const remove = (id: number) => {
    if (confirm('Usunąć tę kolekcję? (pozycje pozostaną w bibliotece)')) {
      api.deleteCollection(id).then(() => { setParams({}); reload(); });
    }
  };

  if (loading) return <Spinner />;

  if (activeId) {
    const col = collections?.find((c) => c.id === activeId);
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <Link to="/collections" className="btn sm">← Kolekcje</Link>
          <h1 style={{ fontSize: 22, margin: 0 }}>{col?.name ?? 'Kolekcja'}</h1>
        </div>
        {items.loading ? <Spinner /> : !items.data || items.data.items.length === 0
          ? <Empty icon="📚" title="Pusta kolekcja" hint="Dodaj pozycje z ich strony szczegółów." />
          : <div className="grid">{items.data.items.map((it) => <ItemCard key={it.id} item={it} />)}</div>}
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Kolekcje</h1>
      <div style={{ display: 'flex', gap: 10, maxWidth: 460, marginBottom: 22 }}>
        <input className="control" placeholder="Nazwa nowej kolekcji…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button className="btn primary" onClick={create}>Utwórz</button>
      </div>
      {!collections || collections.length === 0 ? (
        <Empty icon="📚" title="Brak kolekcji" hint="Utwórz półkę, aby grupować książki wedle uznania." />
      ) : (
        <div className="list-rows">
          {collections.map((c) => (
            <div key={c.id} className="list-row">
              <Link to={`/collections?collection=${c.id}`} className="lr-title" style={{ color: 'var(--text)' }}>📚 {c.name}</Link>
              <span className="lr-count">{c.itemCount}</span>
              <button className="btn sm danger" onClick={() => remove(c.id)}>Usuń</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
