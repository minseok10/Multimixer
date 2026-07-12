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
import { buildDemoStems } from './audio/demoStems';
import { renderMix, encodeWav } from './audio/mixdown';
import { readBpm } from './audio/readBpm';
import type { LoopRegion } from './audio/types';

export default function App() {
  const state = useEngineState();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTracks = state.tracks.length > 0;
  // While playing the playhead is driven by rAF, so this sentinel keeps track
  // rows from re-rendering; while paused it carries the real position.
  const pausedPosition = state.isPlaying ? -1 : engine.currentTime;

  const onPlayPause = useCallback(() => {
    if (engine.isPlaying) engine.pause();
    else void engine.play();
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
    engine.setLoopEnabled(true);
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
        <h1>Multimixer</h1>
        <p className="tagline">
          단일 오디오 클럭으로 모든 트랙을 샘플 단위 동기 재생 — 드리프트·위상 어긋남 없음
        </p>
      </header>

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
      />
    </div>
  );
}
