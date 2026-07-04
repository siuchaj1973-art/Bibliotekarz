import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlayer } from './PlayerContext';
import { api } from '../api';
import { formatClock, initials } from '../util';

const RATES = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2];
const SLEEP_OPTIONS = [15, 30, 45, 60];

export function PlayerBar() {
  const p = usePlayer();
  const [showRate, setShowRate] = useState(false);
  const [showSleep, setShowSleep] = useState(false);

  if (!p.item) return null;
  const item = p.item;
  const cover = api.coverUrl(item);
  const chapter = item.chapters[p.currentChapterIndex];

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    p.seekTo(ratio * p.duration);
  };

  return (
    <div className="player-bar">
      <div className="player-now">
        {cover ? <img src={cover} alt="" /> : <div className="mini-fallback">{initials(item.title)}</div>}
        <div className="pt">
          <Link to={`/item/${item.id}`} className="t">{item.title}</Link>
          <div className="c">{chapter ? chapter.title : item.authors.join(', ')}</div>
        </div>
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button title="Poprzedni rozdział" onClick={() => p.playChapter(Math.max(0, p.currentChapterIndex - 1))}>⏮</button>
          <button title="Cofnij 15s" onClick={() => p.skip(-15)}>⟲</button>
          <button className="play" onClick={p.toggle}>{p.isPlaying ? '❚❚' : '▶'}</button>
          <button title="Do przodu 30s" onClick={() => p.skip(30)}>⟳</button>
          <button title="Następny rozdział" onClick={() => p.playChapter(Math.min(item.chapters.length - 1, p.currentChapterIndex + 1))}>⏭</button>
        </div>
        <div className="player-seek">
          <span>{formatClock(p.globalTime)}</span>
          <div className="seek-track" onClick={onSeek}>
            <div className="seek-fill" style={{ width: `${p.duration ? (p.globalTime / p.duration) * 100 : 0}%` }} />
          </div>
          <span>{formatClock(p.duration)}</span>
        </div>
      </div>

      <div className="player-right">
        <div style={{ position: 'relative' }}>
          <button className="btn sm speed-btn" onClick={() => { setShowRate((v) => !v); setShowSleep(false); }}>
            {p.rate}×
          </button>
          {showRate && (
            <div className="pop">
              {RATES.map((r) => (
                <button key={r} className={r === p.rate ? 'active' : ''} onClick={() => { p.setRate(r); setShowRate(false); }}>
                  {r}×
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button className="btn sm" title="Timer snu" onClick={() => { setShowSleep((v) => !v); setShowRate(false); }}>
            {p.sleepRemaining != null ? formatClock(p.sleepRemaining) : '☾'}
          </button>
          {showSleep && (
            <div className="pop">
              {SLEEP_OPTIONS.map((m) => (
                <button key={m} onClick={() => { p.setSleep(m); setShowSleep(false); }}>{m} min</button>
              ))}
              <button onClick={() => { p.setSleep(null); setShowSleep(false); }}>Wyłącz</button>
            </div>
          )}
        </div>
        <button className="btn sm ghost" title="Zamknij" onClick={p.close}>✕</button>
      </div>
    </div>
  );
}
