/**
 * Offline mixdown + WAV encoding for the "export mix" feature.
 *
 * Renders through an OfflineAudioContext honouring the current effective gains
 * (solo/mute/volume already resolved by the engine) and master volume, so the
 * exported file matches what you hear. Because every source starts at 0 on the
 * offline context's single clock, the export is phase-aligned by the same
 * principle as live playback.
 */

import { createLimiter } from './limiter';

export interface MixdownData {
  sampleRate: number;
  lengthSamples: number;
  masterVolume: number;
  tracks: { buffer: AudioBuffer; gain: number }[];
}

export async function renderMix(data: MixdownData): Promise<AudioBuffer> {
  const length = Math.max(1, data.lengthSamples);
  const oac = new OfflineAudioContext(2, length, data.sampleRate);

  const master = oac.createGain();
  master.gain.value = data.masterVolume;
  // Same limiter as live playback so the export matches what you hear.
  const limiter = createLimiter(oac);
  master.connect(limiter);
  limiter.connect(oac.destination);

  for (const t of data.tracks) {
    if (t.gain <= 0) continue; // silent track — skip
    const src = oac.createBufferSource();
    src.buffer = t.buffer;
    const g = oac.createGain();
    g.gain.value = t.gain;
    src.connect(g);
    g.connect(master);
    src.start(0);
  }

  return oac.startRendering();
}

/** Encode an AudioBuffer as a 16-bit PCM WAV blob. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels, clamp, and convert to 16-bit signed.
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = channels[c][i];
      s = Math.max(-1, Math.min(1, s));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
