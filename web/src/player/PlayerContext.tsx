import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Item } from '../types';
import { api } from '../api';

interface PlayerState {
  item: Item | null;
  isPlaying: boolean;
  globalTime: number; // seconds across the whole audiobook
  duration: number;
  rate: number;
  sleepMinutes: number | null;
  sleepRemaining: number | null;
  currentChapterIndex: number;
}

interface PlayerApi extends PlayerState {
  play: (item: Item, atSec?: number) => void;
  toggle: () => void;
  seekTo: (sec: number) => void;
  skip: (delta: number) => void;
  playChapter: (index: number) => void;
  setRate: (rate: number) => void;
  setSleep: (minutes: number | null) => void;
  close: () => void;
}

const Ctx = createContext<PlayerApi | null>(null);

export function usePlayer(): PlayerApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePlayer poza PlayerProvider');
  return c;
}

function fileOffsets(item: Item): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const f of item.files) {
    offsets.push(acc);
    acc += f.durationSec ?? 0;
  }
  return offsets;
}

function totalDuration(item: Item): number {
  const sum = item.files.reduce((s, f) => s + (f.durationSec ?? 0), 0);
  return sum || item.durationSec || 0;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current && typeof Audio !== 'undefined') audioRef.current = new Audio();

  const offsetsRef = useRef<number[]>([]);
  const fileIndexRef = useRef(0);
  const itemRef = useRef<Item | null>(null);
  const saveTimer = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const [state, setState] = useState<PlayerState>({
    item: null, isPlaying: false, globalTime: 0, duration: 0, rate: 1,
    sleepMinutes: null, sleepRemaining: null, currentChapterIndex: 0,
  });

  const globalTimeNow = (): number => {
    const audio = audioRef.current;
    if (!audio) return 0;
    return (offsetsRef.current[fileIndexRef.current] ?? 0) + audio.currentTime;
  };

  const chapterIndexFor = (sec: number): number => {
    const chapters = itemRef.current?.chapters ?? [];
    let idx = 0;
    for (let i = 0; i < chapters.length; i++) {
      if (sec + 0.4 >= chapters[i].startSec) idx = i;
      else break;
    }
    return idx;
  };

  const saveProgress = (status?: 'reading' | 'finished') => {
    const item = itemRef.current;
    if (!item) return;
    const g = globalTimeNow();
    const dur = totalDuration(item) || 1;
    const pct = Math.min(100, Math.round((g / dur) * 100));
    api.setProgress(item.id, {
      positionSec: g,
      progressPct: pct,
      status: status ?? (pct >= 99 ? 'finished' : 'reading'),
    }).catch(() => {});
  };

  const loadFile = (index: number, offsetWithinFile: number, autoplay: boolean) => {
    const item = itemRef.current;
    const audio = audioRef.current;
    if (!item || !audio || !item.files[index]) return;
    fileIndexRef.current = index;
    audio.src = api.streamUrl(item.id, item.files[index].id);
    audio.playbackRate = stateRef.current.rate;
    const onReady = () => {
      audio.currentTime = Math.max(0, offsetWithinFile);
      if (autoplay) audio.play().catch(() => {});
      audio.removeEventListener('loadedmetadata', onReady);
    };
    audio.addEventListener('loadedmetadata', onReady);
    audio.load();
  };

  const seekTo = (sec: number) => {
    const item = itemRef.current;
    if (!item) return;
    const offsets = offsetsRef.current;
    let idx = 0;
    for (let i = 0; i < offsets.length; i++) if (sec >= offsets[i]) idx = i;
    const within = sec - (offsets[idx] ?? 0);
    if (idx === fileIndexRef.current && audioRef.current) {
      audioRef.current.currentTime = Math.max(0, within);
    } else {
      loadFile(idx, within, stateRef.current.isPlaying || true);
    }
  };

  // Keep a ref mirror of state for use inside audio callbacks.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const play = (item: Item, atSec?: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    itemRef.current = item;
    offsetsRef.current = fileOffsets(item);
    const start = atSec ?? item.progress?.positionSec ?? 0;
    setState((s) => ({ ...s, item, duration: totalDuration(item), globalTime: start, isPlaying: true, currentChapterIndex: chapterIndexFor(start) }));
    // find file
    let idx = 0;
    const offsets = offsetsRef.current;
    for (let i = 0; i < offsets.length; i++) if (start >= offsets[i]) idx = i;
    loadFile(idx, start - (offsets[idx] ?? 0), true);
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !itemRef.current) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

  const skip = (delta: number) => seekTo(Math.max(0, Math.min(globalTimeNow() + delta, stateRef.current.duration)));

  const playChapter = (index: number) => {
    const ch = itemRef.current?.chapters[index];
    if (ch) {
      seekTo(ch.startSec);
      audioRef.current?.play().catch(() => {});
    }
  };

  const setRate = (rate: number) => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
    setState((s) => ({ ...s, rate }));
  };

  const close = () => {
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    saveProgress();
    itemRef.current = null;
    setState((s) => ({ ...s, item: null, isPlaying: false, globalTime: 0 }));
  };

  // Sleep timer
  const sleepDeadline = useRef<number | null>(null);
  const setSleep = (minutes: number | null) => {
    sleepDeadline.current = minutes ? Date.now() + minutes * 60000 : null;
    setState((s) => ({ ...s, sleepMinutes: minutes, sleepRemaining: minutes ? minutes * 60 : null }));
  };

  // Wire up audio element events once.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setState((s) => ({ ...s, isPlaying: true }));
    const onPause = () => { setState((s) => ({ ...s, isPlaying: false })); saveProgress(); };
    const onEnded = () => {
      const item = itemRef.current;
      if (!item) return;
      if (fileIndexRef.current < item.files.length - 1) {
        loadFile(fileIndexRef.current + 1, 0, true);
      } else {
        setState((s) => ({ ...s, isPlaying: false }));
        saveProgress('finished');
      }
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    // Smooth UI tick + periodic save + sleep timer.
    const tick = () => {
      const g = globalTimeNow();
      setState((s) => {
        const ci = chapterIndexFor(g);
        let sleepRemaining = s.sleepRemaining;
        if (sleepDeadline.current) {
          sleepRemaining = Math.max(0, Math.round((sleepDeadline.current - Date.now()) / 1000));
          if (sleepRemaining === 0) {
            audio.pause();
            sleepDeadline.current = null;
            return { ...s, globalTime: g, currentChapterIndex: ci, sleepMinutes: null, sleepRemaining: null };
          }
        }
        if (Math.abs(g - s.globalTime) < 0.15 && ci === s.currentChapterIndex && sleepRemaining === s.sleepRemaining) return s;
        return { ...s, globalTime: g, currentChapterIndex: ci, sleepRemaining };
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    saveTimer.current = window.setInterval(() => { if (!audio.paused) saveProgress(); }, 10000);

    const onUnload = () => saveProgress();
    window.addEventListener('beforeunload', onUnload);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (saveTimer.current) clearInterval(saveTimer.current);
      window.removeEventListener('beforeunload', onUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<PlayerApi>(
    () => ({ ...state, play, toggle, seekTo, skip, playChapter, setRate, setSleep, close }),
    [state],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
