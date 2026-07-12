/**
 * Level meters. Peaks are polled from the engine inside a requestAnimationFrame
 * loop and written straight to the DOM (bar width/color) — never through React
 * state — so metering doesn't re-render the mixer.
 *
 * The master meter also shows the limiter's gain reduction (how hard it's
 * working to tame a hot sum) and latches a CLIP light if the true output ever
 * reaches 0 dBFS.
 */

import { useEffect, useRef } from 'react';
import { engine } from '../state/useEngine';

const MIN_DB = -60;

/** Map a linear peak to a 0..1 bar fraction on a dBFS scale (−60..0). */
function levelToFraction(peak: number): number {
  if (peak <= 0) return 0;
  const db = 20 * Math.log10(peak);
  if (db <= MIN_DB) return 0;
  if (db >= 0) return 1;
  return (db - MIN_DB) / -MIN_DB;
}

/** Green / yellow / red by proximity to 0 dBFS. */
function colorFor(peak: number): string {
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  if (db >= -1) return '#f87171';
  if (db >= -6) return '#fbbf24';
  return '#34d399';
}

const HOLD_DECAY = 0.9; // peak-hold decay per frame

interface MeterProps {
  getLevel: () => number;
  active: boolean;
}

/** A single post-gain level bar (used per track). */
export function Meter({ getLevel, active }: MeterProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    if (!active) {
      bar.style.width = '0%';
      return;
    }
    let raf = 0;
    let hold = 0;
    const render = () => {
      const peak = getLevel();
      hold = Math.max(peak, hold * HOLD_DECAY);
      bar.style.width = `${levelToFraction(hold) * 100}%`;
      bar.style.background = colorFor(hold);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [active, getLevel]);

  return (
    <div className="meter">
      <div ref={barRef} className="meter-bar" />
    </div>
  );
}

const GR_RANGE_DB = 12; // gain-reduction bar full scale

/** Master output level + limiter gain reduction + clip latch. */
export function MasterMeter({ active }: { active: boolean }) {
  const barRef = useRef<HTMLDivElement>(null);
  const grRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLButtonElement>(null);
  const clipAt = useRef(0);

  useEffect(() => {
    const bar = barRef.current;
    const gr = grRef.current;
    const clip = clipRef.current;
    if (!bar || !gr || !clip) return;
    if (!active) {
      bar.style.width = '0%';
      gr.style.width = '0%';
      return;
    }
    let raf = 0;
    let hold = 0;
    const render = () => {
      const peak = engine.getMasterLevel();
      hold = Math.max(peak, hold * HOLD_DECAY);
      bar.style.width = `${levelToFraction(hold) * 100}%`;
      bar.style.background = colorFor(hold);

      const reduction = -engine.getReduction(); // dB, >= 0
      gr.style.width = `${Math.min(100, (reduction / GR_RANGE_DB) * 100)}%`;

      if (peak >= 0.999) clipAt.current = performance.now();
      clip.classList.toggle('lit', performance.now() - clipAt.current < 1500);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div className="master-meter">
      <div className="master-meter-bars">
        <div className="meter out">
          <div ref={barRef} className="meter-bar" />
        </div>
        <div className="meter gr" title="리미터 게인 리덕션 (합산이 셀수록 커짐)">
          <div ref={grRef} className="meter-bar gr-bar" />
        </div>
      </div>
      <button
        ref={clipRef}
        className="clip-led"
        title="클립 감지 (클릭하면 리셋)"
        onClick={() => {
          clipAt.current = 0;
          clipRef.current?.classList.remove('lit');
        }}
      >
        CLIP
      </button>
    </div>
  );
}
