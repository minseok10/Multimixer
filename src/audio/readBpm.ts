/**
 * Best-effort BPM extraction from an uploaded audio file's metadata.
 *
 * decodeAudioData only yields PCM samples, so tempo tags must be parsed
 * separately. music-metadata reads BPM from ID3v2 (TBPM, MP3), MP4 (tmpo),
 * Vorbis comments (FLAC/OGG), and some WAV ACID chunks. Anything missing or
 * unparseable returns null, and the UI falls back to manual BPM.
 */

import { parseBlob } from 'music-metadata';

export async function readBpm(file: File): Promise<number | null> {
  try {
    const metadata = await parseBlob(file, { duration: false });
    const bpm = metadata.common.bpm;
    if (typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0) {
      return Math.round(bpm);
    }
    return null;
  } catch {
    // Corrupt tags, unsupported container, or parser hiccup — stay on manual.
    return null;
  }
}
