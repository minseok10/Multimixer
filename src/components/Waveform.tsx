/**
 * Waveform lane: a static canvas of the precomputed peaks, an overlaid loop
 * region, and a playhead.
 *
 * The playhead reads engine.currentTime directly inside a requestAnimationFrame
 * loop and moves a DOM element via transform — it never pushes per-frame state
 * into React, so the rest of the mixer doesn't re-render while playing. Because
 * the position comes from the audio clock, the playhead can't disagree with what
 * you hear.
 *
 * Pointer interaction: a click seeks, a horizontal drag sets a loop region.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { engine } from '../state/useEngine';
import type { LoopRegion, Peaks } from '../audio/types';

interface Props {
  peaks: Peaks;
  duration: number;
  isPlaying: boolean;
  /** Position to show while not playing; ignored while playing. */
  pausedPosition: number;
  loop: LoopRegion | null;
  loopEnabled: boolean;
  onSeek: (fraction: number) => void;
  onSetLoop: (region: LoopRegion) => void;
}

const LANE_HEIGHT = 72;
const DRAG_THRESHOLD = 4;

function WaveformImpl({
  peaks,
  duration,
  isPlaying,
  pausedPosition,
  loop,
  loopEnabled,
  onSeek,
  onSetLoop,
}: Props) {
  const laneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);
  const drag = useRef<{ startX: number; moved: boolean } | null>(null);

  // Track lane width for HiDPI-correct drawing.
  useEffect(() => {
    const lane = laneRef.current;
    if (!lane) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(lane);
    setWidth(lane.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const redraw = () => setThemeVersion((version) => version + 1);
    media.addEventListener('change', redraw);
    return () => media.removeEventListener('change', redraw);
  }, []);

  // Draw the static waveform whenever peaks or size change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(LANE_HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const styles = getComputedStyle(document.documentElement);
    drawWaveform(
      ctx,
      peaks,
      width,
      LANE_HEIGHT,
      styles.getPropertyValue('--waveform-center').trim() || 'rgba(255,255,255,0.12)',
      styles.getPropertyValue('--waveform').trim() || '#5eead4',
    );
  }, [peaks, themeVersion, width]);

  // Position the playhead: rAF while playing, single placement while paused.
  useEffect(() => {
    const el = playheadRef.current;
    if (!el) return;
    const place = (pos: number) => {
      const x = duration > 0 ? (pos / duration) * width : 0;
      el.style.transform = `translateX(${x}px)`;
    };
    if (isPlaying) {
      let raf = 0;
      const tick = () => {
        place(engine.currentTime);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    place(pausedPosition);
  }, [isPlaying, pausedPosition, width, duration]);

  const xToFraction = (clientX: number): number => {
    const rect = laneRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const x = e.clientX;
    drag.current = { startX: x, moved: false };
    setSel(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    if (Math.abs(e.clientX - drag.current.startX) > DRAG_THRESHOLD) {
      drag.current.moved = true;
      setSel({ a: xToFraction(drag.current.startX), b: xToFraction(e.clientX) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      onSeek(xToFraction(e.clientX));
    } else {
      const a = xToFraction(d.startX);
      const b = xToFraction(e.clientX);
      const start = Math.min(a, b) * duration;
      const end = Math.max(a, b) * duration;
      if (end - start > 0.01) onSetLoop({ start, end });
    }
    setSel(null);
  };

  const loopStyle = loop
    ? {
        left: `${(loop.start / duration) * 100}%`,
        width: `${((loop.end - loop.start) / duration) * 100}%`,
      }
    : undefined;

  const selStyle = sel
    ? {
        left: `${Math.min(sel.a, sel.b) * 100}%`,
        width: `${Math.abs(sel.b - sel.a) * 100}%`,
      }
    : undefined;

  return (
    <div
      ref={laneRef}
      className="waveform-lane"
      style={{ height: LANE_HEIGHT }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <canvas ref={canvasRef} className="waveform-canvas" />
      {loop && (
        <div
          className={`loop-region${loopEnabled ? ' active' : ''}`}
          style={loopStyle}
        />
      )}
      {sel && <div className="loop-region selecting" style={selStyle} />}
      <div ref={playheadRef} className="playhead" />
    </div>
  );
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: Peaks,
  width: number,
  height: number,
  centerColor: string,
  waveformColor: string,
) {
  ctx.clearRect(0, 0, width, height);
  const mid = height / 2;
  const amp = height / 2 - 2;

  // Center line.
  ctx.strokeStyle = centerColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();

  ctx.strokeStyle = waveformColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    const bucket = Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length));
    const yMax = mid - peaks.max[bucket] * amp;
    const yMin = mid - peaks.min[bucket] * amp;
    ctx.moveTo(x + 0.5, yMax);
    ctx.lineTo(x + 0.5, yMin);
  }
  ctx.stroke();
}

export const Waveform = memo(WaveformImpl);
