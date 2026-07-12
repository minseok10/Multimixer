/**
 * One mixer channel: name + fader + mute/solo/remove on the left, waveform lane
 * on the right. Memoized on its TrackState so faders on other tracks (or the
 * playhead) don't re-render it.
 */

import { memo, useCallback } from 'react';
import { Waveform } from './Waveform';
import { Meter } from './Meter';
import { engine } from '../state/useEngine';
import type { LoopRegion, TrackState } from '../audio/types';

interface Props {
  track: TrackState;
  duration: number;
  isPlaying: boolean;
  pausedPosition: number;
  loop: LoopRegion | null;
  loopEnabled: boolean;
  onVolume: (id: string, v: number) => void;
  onMute: (id: string) => void;
  onSolo: (id: string) => void;
  onRemove: (id: string) => void;
  onSeek: (fraction: number) => void;
  onSetLoop: (region: LoopRegion) => void;
}

function TrackRowImpl({
  track,
  duration,
  isPlaying,
  pausedPosition,
  loop,
  loopEnabled,
  onVolume,
  onMute,
  onSolo,
  onRemove,
  onSeek,
  onSetLoop,
}: Props) {
  const getLevel = useCallback(() => engine.getTrackLevel(track.id), [track.id]);
  return (
    <div className="track-row">
      <div className="track-controls">
        <div className="track-header">
          <span className="track-name" title={track.name}>
            {track.name}
          </span>
          <button
            className="icon-btn remove"
            title="트랙 제거"
            onClick={() => onRemove(track.id)}
          >
            ✕
          </button>
        </div>
        <div className="track-buttons">
          <button
            className={`toggle mute${track.muted ? ' on' : ''}`}
            onClick={() => onMute(track.id)}
          >
            M
          </button>
          <button
            className={`toggle solo${track.soloed ? ' on' : ''}`}
            onClick={() => onSolo(track.id)}
          >
            S
          </button>
          <input
            className="volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={track.volume}
            onChange={(e) => onVolume(track.id, Number(e.target.value))}
            aria-label={`${track.name} 볼륨`}
          />
          <span className="volume-value">{Math.round(track.volume * 100)}</span>
        </div>
        <Meter getLevel={getLevel} active={isPlaying} />
      </div>
      <Waveform
        peaks={track.peaks}
        duration={duration}
        isPlaying={isPlaying}
        pausedPosition={pausedPosition}
        loop={loop}
        loopEnabled={loopEnabled}
        onSeek={onSeek}
        onSetLoop={onSetLoop}
      />
    </div>
  );
}

export const TrackRow = memo(TrackRowImpl);
