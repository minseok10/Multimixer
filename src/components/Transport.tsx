/**
 * Transport bar: play/pause/stop, live time readout, loop toggle/clear, master
 * volume, and mix export. The time readout runs its own rAF so it can tick every
 * frame without re-rendering the mixer.
 */

import { useEffect, useRef } from 'react';
import { engine } from '../state/useEngine';
import { MasterMeter } from './Meter';
import { formatTime } from '../audio/transport';
import type { LoopRegion } from '../audio/types';

interface Props {
  isPlaying: boolean;
  duration: number;
  pausedPosition: number;
  masterVolume: number;
  loop: LoopRegion | null;
  loopEnabled: boolean;
  hasTracks: boolean;
  exporting: boolean;
  metronomeEnabled: boolean;
  metronomeBpm: number;
  metronomeVolume: number;
  metronomeBpmFromFile: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onToggleLoop: () => void;
  onClearLoop: () => void;
  onMasterVolume: (v: number) => void;
  onExport: () => void;
  onMetronomeToggle: () => void;
  onMetronomeBpm: (v: number) => void;
  onMetronomeVolume: (v: number) => void;
}

function TimeReadout({
  isPlaying,
  pausedPosition,
}: {
  isPlaying: boolean;
  pausedPosition: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (t: number) => {
      el.textContent = formatTime(t);
    };
    if (isPlaying) {
      let raf = 0;
      const tick = () => {
        set(engine.currentTime);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    set(pausedPosition);
  }, [isPlaying, pausedPosition]);
  return <span ref={ref} className="time-current">0:00.000</span>;
}

export function Transport({
  isPlaying,
  duration,
  pausedPosition,
  masterVolume,
  loop,
  loopEnabled,
  hasTracks,
  exporting,
  metronomeEnabled,
  metronomeBpm,
  metronomeVolume,
  metronomeBpmFromFile,
  onPlayPause,
  onStop,
  onToggleLoop,
  onClearLoop,
  onMasterVolume,
  onExport,
  onMetronomeToggle,
  onMetronomeBpm,
  onMetronomeVolume,
}: Props) {
  return (
    <div className="transport">
      <div className="transport-buttons">
        <button
          className="play"
          onClick={onPlayPause}
          disabled={!hasTracks}
          title={isPlaying ? '일시정지' : '재생'}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>
        <button className="stop" onClick={onStop} disabled={!hasTracks} title="정지">
          ■
        </button>
      </div>

      <div className="time">
        <TimeReadout isPlaying={isPlaying} pausedPosition={pausedPosition} />
        <span className="time-sep"> / </span>
        <span className="time-total">{formatTime(duration)}</span>
      </div>

      <div className="loop-controls">
        <label className={`loop-toggle${loopEnabled ? ' on' : ''}`}>
          <input
            type="checkbox"
            checked={loopEnabled}
            onChange={onToggleLoop}
            disabled={!loop}
          />
          루프
        </label>
        <span className="loop-info">
          {loop
            ? `${formatTime(loop.start)} – ${formatTime(loop.end)}`
            : '파형을 드래그해 구간 지정'}
        </span>
        {loop && (
          <button className="link-btn" onClick={onClearLoop}>
            해제
          </button>
        )}
      </div>

      <div className="metronome">
        <label className={`metro-toggle${metronomeEnabled ? ' on' : ''}`}>
          <input
            type="checkbox"
            checked={metronomeEnabled}
            onChange={onMetronomeToggle}
            disabled={!hasTracks}
          />
          메트로놈
        </label>
        <input
          className="bpm-number"
          type="number"
          min={20}
          max={300}
          value={metronomeBpm}
          onChange={(e) => onMetronomeBpm(Number(e.target.value))}
          disabled={!hasTracks}
          aria-label="BPM"
        />
        <span className="bpm-unit">BPM</span>
        {metronomeBpmFromFile && (
          <span className="bpm-badge" title="노래에 저장된 BPM">
            저장
          </span>
        )}
        <input
          className="bpm-slider"
          type="range"
          min={20}
          max={300}
          step={1}
          value={metronomeBpm}
          onChange={(e) => onMetronomeBpm(Number(e.target.value))}
          disabled={!hasTracks}
          aria-label="BPM 슬라이더"
        />
        <input
          className="metro-vol"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={metronomeVolume}
          onChange={(e) => onMetronomeVolume(Number(e.target.value))}
          title="메트로놈 볼륨"
          aria-label="메트로놈 볼륨"
        />
      </div>

      <div className="master">
        <label htmlFor="master-vol">마스터</label>
        <input
          id="master-vol"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          onChange={(e) => onMasterVolume(Number(e.target.value))}
        />
        <span className="volume-value">{Math.round(masterVolume * 100)}</span>
        <MasterMeter active={isPlaying} />
      </div>

      <button
        className="export"
        onClick={onExport}
        disabled={!hasTracks || exporting}
        title="현재 믹스를 WAV로 내보내기"
      >
        {exporting ? '내보내는 중…' : '믹스 내보내기'}
      </button>
    </div>
  );
}
