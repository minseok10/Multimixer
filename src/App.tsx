/**
 * Multimixer — multitrack player.
 *
 * App wires the engine snapshot to the UI. All engine mutations go through
 * stable callbacks (the engine is a singleton, current values are read from its
 * snapshot at call time) so memoized track rows don't re-render needlessly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { engine, useEngineState } from './state/useEngine';
import { Transport } from './components/Transport';
import { TrackRow } from './components/TrackRow';
import { DropZone } from './components/DropZone';
import { SongLibrary } from './components/SongLibrary';
import { CreatorNote } from './components/CreatorNote';
import { SongComments } from './components/SongComments';
import { buildDemoStems } from './audio/demoStems';
import { renderMix, encodeWav } from './audio/mixdown';
import { readBpm } from './audio/readBpm';
import type { LoopRegion } from './audio/types';
import { fetchSongDetailById, type Song } from './library';
import { songIdFromPath, songPath } from './routes';

export default function App() {
  const state = useEngineState();
  const initialSongId = useRef(songIdFromPath(window.location.pathname));
  const initialRouteHandled = useRef(false);
  const songLoadSequence = useRef(0);
  const [loading, setLoading] = useState(Boolean(initialSongId.current));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'library' | 'mixer'>(initialSongId.current ? 'mixer' : 'library');
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [creatorNoteOpen, setCreatorNoteOpen] = useState(false);

  const hasTracks = state.tracks.length > 0;
  // While playing the playhead is driven by rAF, so this sentinel keeps track
  // rows from re-rendering; while paused it carries the real position.
  const pausedPosition = state.isPlaying ? -1 : engine.currentTime;

  const onPlayPause = useCallback(async () => {
    if (engine.isPlaying) engine.pause();
    else {
      try {
        setError(null);
        await engine.play();
      } catch (e) {
        setError(`재생 실패: ${(e as Error).message}`);
      }
    }
  }, []);
  const onStop = useCallback(() => engine.stop(), []);
  const onVolume = useCallback((id: string, v: number) => engine.setVolume(id, v), []);
  const onMute = useCallback((id: string) => engine.toggleMute(id), []);
  const onSolo = useCallback((id: string) => engine.toggleSolo(id), []);
  const onRemove = useCallback((id: string) => engine.removeTrack(id), []);

  const onSeek = useCallback((fraction: number) => {
    engine.seek(fraction * engine.getSnapshot().duration);
  }, []);
  const onSetLoop = useCallback((region: LoopRegion) => {
    engine.setLoop(region);
  }, []);
  const onToggleLoop = useCallback(() => {
    engine.setLoopEnabled(!engine.getSnapshot().loopEnabled);
  }, []);
  const onClearLoop = useCallback(() => {
    engine.setLoop(null);
    engine.setLoopEnabled(false);
  }, []);
  const onMasterVolume = useCallback((v: number) => engine.setMasterVolume(v), []);

  // BPM: keep the slider snappy locally, but debounce the engine update so a
  // drag doesn't rebuild the full-timeline click buffer on every tick.
  const [bpm, setBpm] = useState(state.metronomeBpm);
  useEffect(() => setBpm(state.metronomeBpm), [state.metronomeBpm]);
  const bpmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onMetronomeBpm = useCallback((v: number) => {
    setBpm(v);
    clearTimeout(bpmTimer.current);
    bpmTimer.current = setTimeout(() => engine.setMetronomeBpm(v), 150);
  }, []);
  const onMetronomeToggle = useCallback(() => {
    engine.setMetronomeEnabled(!engine.getSnapshot().metronomeEnabled);
  }, []);
  const onMetronomeVolume = useCallback((v: number) => engine.setMetronomeVolume(v), []);

  const loadSongById = useCallback(async (songId: string, resumeFromGesture: boolean, navigate: boolean) => {
    const sequence = ++songLoadSequence.current;
    setError(null);
    setLoading(true);
    setView('mixer');
    if (navigate) window.history.pushState({ songId }, '', songPath(songId));
    try {
      // A clicked song primes iOS audio immediately. Direct URLs decode while
      // suspended and resume later from the user's play gesture.
      if (resumeFromGesture) await engine.resume();
      const detail = await fetchSongDetailById(songId);
      if (sequence !== songLoadSequence.current) return;
      setSelectedSong(detail);
      const downloaded = await Promise.all(detail.stems.map(async (stem) => {
        const response = await fetch(stem.url);
        if (!response.ok) throw new Error(`${stem.name} 스템을 내려받지 못했습니다.`);
        return { stem, data: await response.arrayBuffer() };
      }));
      const decoded = await engine.decodeFiles(downloaded.map(({ stem, data }) => ({ name: stem.name, data })));
      if (sequence !== songLoadSequence.current) return;
      engine.clear();
      for (const { name, buffer } of decoded) engine.addTrackBuffer(name, buffer);
      if (detail.bpm) engine.setMetronomeBpm(detail.bpm, true);
      setView('mixer');
    } catch (e) {
      if (sequence !== songLoadSequence.current) return;
      engine.clear();
      setSelectedSong(null);
      setView('library');
      setError(`노래 로드 실패: ${(e as Error).message}`);
      if (songIdFromPath(window.location.pathname) === songId) {
        window.history.replaceState(null, '', '/');
      }
    } finally {
      if (sequence === songLoadSequence.current) setLoading(false);
    }
  }, []);

  const onSelectSong = useCallback(async (song: Song) => {
    await loadSongById(song.id, true, true);
  }, [loadSongById]);

  const showLibrary = useCallback((navigate: boolean) => {
    songLoadSequence.current++;
    engine.clear();
    setLoading(false);
    setError(null);
    setSelectedSong(null);
    setView('library');
    if (navigate && window.location.pathname !== '/') window.history.pushState(null, '', '/');
  }, []);

  useEffect(() => {
    const applyCurrentRoute = () => {
      const songId = songIdFromPath(window.location.pathname);
      if (songId) void loadSongById(songId, false, false);
      else {
        if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
        showLibrary(false);
      }
    };
    if (!initialRouteHandled.current) {
      initialRouteHandled.current = true;
      if (initialSongId.current) void loadSongById(initialSongId.current, false, false);
      else if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
    }
    window.addEventListener('popstate', applyCurrentRoute);
    return () => window.removeEventListener('popstate', applyCurrentRoute);
  }, [loadSongById, showLibrary]);

  useEffect(() => {
    document.title = selectedSong ? `${selectedSong.name} — Multimixer` : 'Multimixer — 멀티트랙 재생기';
  }, [selectedSong]);

  const onCustomUpload = useCallback(() => {
    songLoadSequence.current++;
    engine.clear();
    setError(null);
    setSelectedSong(null);
    setView('mixer');
    if (window.location.pathname !== '/') window.history.pushState(null, '', '/');
  }, []);

  const onBackToLibrary = useCallback(() => {
    showLibrary(true);
  }, [showLibrary]);

  const closeCreatorNote = useCallback(() => setCreatorNoteOpen(false), []);

  const onLoadDemo = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      await engine.resume();
      const stems = buildDemoStems(engine.sampleRate);
      for (const s of stems) engine.addTrackBuffer(s.name, s.buffer);
    } catch (e) {
      setError(`데모 로드 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const onFiles = useCallback(async (files: File[]) => {
    setError(null);
    setLoading(true);
    try {
      await engine.resume();
      for (const f of files) {
        const buf = await f.arrayBuffer();
        await engine.loadFile(f.name.replace(/\.[^.]+$/, ''), buf);
      }
      // If any file carries a BPM tag, adopt it for the metronome.
      for (const f of files) {
        const detected = await readBpm(f);
        if (detected) {
          engine.setMetronomeBpm(detected, true);
          break;
        }
      }
    } catch (e) {
      setError(`파일 로드 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      const data = engine.getExportData();
      const mix = await renderMix(data);
      const blob = encodeWav(mix);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'multimixer-mix.wav';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`내보내기 실패: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-row">
          <h1>Multimixer</h1>
          {view === 'mixer' && (
            <button className="back-library" onClick={onBackToLibrary}>← 노래 선택</button>
          )}
        </div>
        <div className="tagline-row">
          <p className="tagline">
            단일 오디오 클럭으로 모든 트랙을 샘플 단위 동기 재생 — 드리프트·위상 어긋남 없음
          </p>
          <div className="header-links">
            <a className="github-link" href="https://github.com/minseok10/Multimixer" target="_blank" rel="noreferrer">
              <GithubIcon />
              <span>minseok10/Multimixer</span>
            </a>
            <button className="creator-note-trigger" onClick={() => setCreatorNoteOpen(true)}>
              제작자 코멘트
            </button>
          </div>
        </div>
      </header>

      {view === 'library' ? (
        <>
          {error && <div className="error-banner">{error}</div>}
          <SongLibrary busy={loading} onSelectSong={onSelectSong} onCustomUpload={onCustomUpload} />
        </>
      ) : (
        <>

      {selectedSong && (
        <section className="mixer-song-heading" aria-labelledby="mixer-song-title">
          <div>
            <span>NOW MIXING</span>
            <h2 id="mixer-song-title">{selectedSong.name}</h2>
          </div>
          {selectedSong.bpm && <strong>{selectedSong.bpm} BPM</strong>}
        </section>
      )}

      {loading && !hasTracks && <div className="mixer-loading">노래의 스템을 준비하는 중…</div>}

      <Transport
        isPlaying={state.isPlaying}
        duration={state.duration}
        pausedPosition={pausedPosition}
        masterVolume={state.masterVolume}
        loop={state.loop}
        loopEnabled={state.loopEnabled}
        hasTracks={hasTracks}
        exporting={exporting}
        metronomeEnabled={state.metronomeEnabled}
        metronomeBpm={bpm}
        metronomeVolume={state.metronomeVolume}
        metronomeBpmFromFile={state.metronomeBpmFromFile}
        onPlayPause={onPlayPause}
        onStop={onStop}
        onToggleLoop={onToggleLoop}
        onClearLoop={onClearLoop}
        onMasterVolume={onMasterVolume}
        onExport={onExport}
        onMetronomeToggle={onMetronomeToggle}
        onMetronomeBpm={onMetronomeBpm}
        onMetronomeVolume={onMetronomeVolume}
      />

      {error && <div className="error-banner">{error}</div>}

      <main className="tracks">
        {state.tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            duration={state.duration}
            isPlaying={state.isPlaying}
            pausedPosition={pausedPosition}
            loop={state.loop}
            loopEnabled={state.loopEnabled}
            onVolume={onVolume}
            onMute={onMute}
            onSolo={onSolo}
            onRemove={onRemove}
            onSeek={onSeek}
            onSetLoop={onSetLoop}
          />
        ))}
      </main>

      <DropZone
        onFiles={onFiles}
        onLoadDemo={onLoadDemo}
        loading={loading}
        compact={hasTracks}
        showDemo={!selectedSong}
      />

      {selectedSong && <SongComments song={selectedSong} />}
        </>
      )}

      <CreatorNote open={creatorNoteOpen} onClose={closeCreatorNote} />
    </div>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 .7A11.3 11.3 0 0 0 8.4 22.8c.6.1.8-.3.8-.6v-2.1c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6A4.7 4.7 0 0 1 5.7 7.5c-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.4 1.2a11.7 11.7 0 0 1 6.2 0c2.4-1.6 3.4-1.2 3.4-1.2.6 1.7.2 3 .1 3.3a4.7 4.7 0 0 1 1.2 3.2c0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.3 11.3 0 0 0 12 .7Z" />
    </svg>
  );
}
