/**
 * React binding for the imperative AudioEngine.
 *
 * One engine instance for the app. Components read its immutable snapshot via
 * useSyncExternalStore (the idiomatic React 18 way to subscribe to an external
 * mutable store) and call engine methods to mutate it.
 */

import { useSyncExternalStore } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import type { EngineState } from '../audio/types';

export const engine = new AudioEngine();

// Expose the engine for debugging and automated verification, e.g.
// `window.__mmEngine.getDebugSchedule()` to check phase alignment.
if (typeof window !== 'undefined') {
  (window as unknown as { __mmEngine: AudioEngine }).__mmEngine = engine;
}

export function useEngineState(): EngineState {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}
