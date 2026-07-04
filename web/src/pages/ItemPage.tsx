import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Cover, Stars, Spinner, Empty, Modal, useAsync } from '../components/common';
import { usePlayer } from '../player/PlayerContext';
import { formatClock, formatDuration, formatBytes } from '../util';
import type { Item } from '../types';

export function ItemPage() {
  const { id } = useParams();
  const itemId = Number(id);
  const navigate = useNavigate();
  const player = usePlayer();
  const { data: item, loading, error, reload } = useAsync(() => api.getItem(itemId), [itemId]);
  const [editing, setEditing] = useState(false);
  const [managingCollections, setManagingCollections] = useState(false);

  if (loading) return <Spinner />;
  if (error || !item) return <Empty icon="⚠" title="Nie znaleziono pozycji" hint={error ?? undefined} />;

  const isAudio = item.kind === 'audiobook';
  const readableEbook = item.files.some((f) => f.format === 'epub' || f.format === 'pdf');

  const markStatus = (status: 'unread' | 'reading' | 'finished') =>
    api.setProgress(item.id, { status, progressPct: status === 'finished' ? 100 : status === 'unread' ? 0 : item.progress?.progressPct ?? 0 }).then(reload);

  const remove = () => {
    if (confirm(`Usunąć „${item.title}" z katalogu? (pliki na dysku pozostaną)`)) {
      api.deleteItem(item.id).then(() => navigate(-1));
    }
  };

  const rate = (v: number) => api.updateItem(item.id, { rating: v || null }).then(reload);

  return (
    <div className="detail">
      <div className="cover-col">
        <Cover item={item} />
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isAudio ? (
            <button className="btn primary" onClick={() => player.play(item)}>
              ▶ {item.progress?.positionSec ? 'Wznów' : 'Słuchaj'}
            </button>
          ) : readableEbook ? (
            <Link className="btn primary" to={`/item/${item.id}/read`}>📖 Czytaj</Link>
          ) : null}
          <a className="btn" href={api.downloadUrl(item.id, item.files[0]?.id)} download>⭳ Pobierz</a>
        </div>
        <div style={{ marginTop: 14 }}>
          <Stars value={item.rating} onChange={rate} />
        </div>
      </div>

      <div>
        <h1>{item.title}</h1>
        {item.subtitle && <div className="subtitle">{item.subtitle}</div>}
        <div className="byline">
          {item.authors.map((a, i) => (
            <span key={a}>
              {i > 0 && ', '}
              <Link to={`/?author=${encodeURIComponent(a)}`}>{a}</Link>
            </span>
          ))}
          {item.authors.length === 0 && 'Nieznany autor'}
        </div>

        <div className="action-row">
          <button className="btn" onClick={() => setEditing(true)}>✎ Edytuj metadane</button>
          <button className="btn" onClick={() => setManagingCollections(true)}>📚 Kolekcje</button>
          {item.progress?.status !== 'finished'
            ? <button className="btn" onClick={() => markStatus('finished')}>✓ Oznacz jako ukończone</button>
            : <button className="btn" onClick={() => markStatus('reading')}>↺ Czytam ponownie</button>}
          <button className="btn danger" onClick={remove}>🗑 Usuń</button>
        </div>

        <div className="meta-grid">
          {item.series && <Meta label="Seria" value={<Link to={`/?series=${encodeURIComponent(item.series)}`}>{item.series}{item.seriesIndex != null ? ` #${item.seriesIndex}` : ''}</Link>} />}
          {item.narrators.length > 0 && <Meta label="Lektor" value={item.narrators.join(', ')} />}
          {item.publishedYear && <Meta label="Rok" value={item.publishedYear} />}
          {item.publisher && <Meta label="Wydawca" value={item.publisher} />}
          {item.language && <Meta label="Język" value={item.language} />}
          {isAudio && item.durationSec && <Meta label="Czas trwania" value={formatDuration(item.durationSec)} />}
          {item.isbn && <Meta label="ISBN" value={item.isbn} />}
          <Meta label="Format" value={[...new Set(item.files.map((f) => f.format.toUpperCase()))].join(', ')} />
          <Meta label="Dodano" value={new Date(item.addedAt).toLocaleDateString('pl-PL')} />
        </div>

        {item.tags.length > 0 && (
          <div className="tag-row">
            {item.tags.map((t) => <Link key={t} className="tag" to={`/?tag=${encodeURIComponent(t)}`}>{t}</Link>)}
          </div>
        )}

        {item.description && <p className="description">{item.description}</p>}

        {isAudio && item.chapters.length > 0 && (
          <>
            <div className="section-title">🎧 Rozdziały <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>({item.chapters.length})</span></div>
            <div className="chapter-list">
              {item.chapters.map((ch) => (
                <div
                  key={ch.id}
                  className={`chapter-row ${player.item?.id === item.id && player.currentChapterIndex === ch.index ? 'playing' : ''}`}
                  onClick={() => (player.item?.id === item.id ? player.playChapter(ch.index) : player.play(item, ch.startSec))}
                >
                  <span className="idx">{ch.index + 1}</span>
                  <span className="ch-title">{ch.title}</span>
                  <span className="ch-time">{formatClock(ch.startSec)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="section-title">📁 Pliki</div>
        <div className="chapter-list">
          {item.files.map((f) => (
            <div key={f.id} className="chapter-row" style={{ cursor: 'default' }}>
              <span className="ch-title">{f.relPath}</span>
              <span className="ch-time">{f.format.toUpperCase()} · {formatBytes(f.sizeBytes)}{f.durationSec ? ` · ${formatClock(f.durationSec)}` : ''}</span>
              <a className="btn sm ghost" href={api.downloadUrl(item.id, f.id)} download>⭳</a>
            </div>
          ))}
        </div>
      </div>

      {editing && <EditModal item={item} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {managingCollections && <CollectionsModal item={item} onClose={() => setManagingCollections(false)} onChanged={reload} />}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="meta-item">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function EditModal({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: item.title,
    subtitle: item.subtitle ?? '',
    authors: item.authors.join(', '),
    narrators: item.narrators.join(', '),
    series: item.series ?? '',
    seriesIndex: item.seriesIndex?.toString() ?? '',
    publisher: item.publisher ?? '',
    publishedYear: item.publishedYear?.toString() ?? '',
    language: item.language ?? '',
    isbn: item.isbn ?? '',
    tags: item.tags.join(', '),
    description: item.description ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const save = () => {
    setSaving(true);
    const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    api.updateItem(item.id, {
      title: form.title.trim() || item.title,
      subtitle: form.subtitle.trim() || null,
      authors: splitList(form.authors),
      narrators: splitList(form.narrators),
      series: form.series.trim() || null,
      seriesIndex: form.seriesIndex ? Number(form.seriesIndex) : null,
      publisher: form.publisher.trim() || null,
      publishedYear: form.publishedYear ? Number(form.publishedYear) : null,
      language: form.language.trim() || null,
      isbn: form.isbn.trim() || null,
      tags: splitList(form.tags),
      description: form.description.trim() || null,
    }).then(onSaved).finally(() => setSaving(false));
  };

  return (
    <Modal
      title="Edytuj metadane"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Zapisywanie…' : 'Zapisz'}</button>
      </>}
    >
      <Field label="Tytuł"><input className="control" value={form.title} onChange={set('title')} /></Field>
      <Field label="Podtytuł"><input className="control" value={form.subtitle} onChange={set('subtitle')} /></Field>
      <Field label="Autorzy (oddziel przecinkami)"><input className="control" value={form.authors} onChange={set('authors')} /></Field>
      {item.kind === 'audiobook' && <Field label="Lektorzy (oddziel przecinkami)"><input className="control" value={form.narrators} onChange={set('narrators')} /></Field>}
      <div className="field-row">
        <Field label="Seria"><input className="control" value={form.series} onChange={set('series')} /></Field>
        <Field label="Numer w serii"><input className="control" value={form.seriesIndex} onChange={set('seriesIndex')} /></Field>
      </div>
      <div className="field-row">
        <Field label="Wydawca"><input className="control" value={form.publisher} onChange={set('publisher')} /></Field>
        <Field label="Rok"><input className="control" value={form.publishedYear} onChange={set('publishedYear')} /></Field>
      </div>
      <div className="field-row">
        <Field label="Język"><input className="control" value={form.language} onChange={set('language')} /></Field>
        <Field label="ISBN"><input className="control" value={form.isbn} onChange={set('isbn')} /></Field>
      </div>
      <Field label="Tagi (oddziel przecinkami)"><input className="control" value={form.tags} onChange={set('tags')} /></Field>
      <Field label="Opis"><textarea className="control" rows={5} value={form.description} onChange={set('description')} /></Field>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function CollectionsModal({ item, onClose, onChanged }: { item: Item; onClose: () => void; onChanged: () => void }) {
  const { data: collections, reload } = useAsync(() => api.collections(), []);
  const [memberOf, setMemberOf] = useState<Set<number>>(new Set(item.collections ?? []));
  const [newName, setNewName] = useState('');

  const toggle = (cid: number) => {
    const member = !memberOf.has(cid);
    const next = new Set(memberOf);
    member ? next.add(cid) : next.delete(cid);
    setMemberOf(next);
    api.setMembership(cid, item.id, member).then(onChanged);
  };

  const create = () => {
    if (!newName.trim()) return;
    api.createCollection(newName.trim()).then((c) => {
      setNewName('');
      reload();
      toggle(c.id);
    });
  };

  return (
    <Modal title="Zarządzaj kolekcjami" onClose={onClose} footer={<button className="btn" onClick={onClose}>Gotowe</button>}>
      <div className="list-rows">
        {collections?.map((c) => (
          <label key={c.id} className="list-row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={memberOf.has(c.id)} onChange={() => toggle(c.id)} />
            <span className="lr-title">{c.name}</span>
            <span className="lr-count">{c.itemCount}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input className="control" placeholder="Nowa kolekcja…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button className="btn primary" onClick={create}>Dodaj</button>
      </div>
    </Modal>
  );
}
