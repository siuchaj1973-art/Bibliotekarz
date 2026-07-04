import { Link } from 'react-router-dom';
import { api } from '../api';
import { Spinner, Empty, useAsync } from '../components/common';

export function BrowsePage({ kind }: { kind: 'authors' | 'series' }) {
  const { data, loading } = useAsync(() => (kind === 'authors' ? api.authors() : api.series()), [kind]);
  const title = kind === 'authors' ? 'Autorzy' : 'Serie';
  const param = kind === 'authors' ? 'author' : 'series';
  const icon = kind === 'authors' ? '✍' : '≣';

  if (loading) return <Spinner />;
  if (!data || data.length === 0) return <Empty icon={icon} title={`Brak: ${title.toLowerCase()}`} />;

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>{title} <span style={{ color: 'var(--text-faint)', fontSize: 16 }}>{data.length}</span></h1>
      <div className="list-rows">
        {data.map((f) => (
          <Link key={f.name} to={`/?${param}=${encodeURIComponent(f.name)}`} className="list-row">
            <span className="icon" style={{ color: 'var(--text-faint)' }}>{icon}</span>
            <span className="lr-title">{f.name}</span>
            <span className="lr-count">{f.count} {f.count === 1 ? 'pozycja' : 'pozycji'}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
