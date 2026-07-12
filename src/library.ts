export interface Song {
  id: string;
  name: string;
  bpm?: number;
  size: number;
  stemCount: number;
  uploadedAt: string;
  url: string;
}

export interface SongStem {
  id: string;
  name: string;
  fileName: string;
  size: number;
  url: string;
}

export interface SongDetail extends Song {
  stems: SongStem[];
}

export interface SongLibraryData {
  songs: Song[];
  totalBytes: number;
  limits: {
    maxStemBytes: number;
    maxTotalBytes: number;
    maxSongs: number;
    maxStems: number;
  };
}

export async function fetchSongDetail(song: Song): Promise<SongDetail> {
  const response = await fetch(song.url);
  if (!response.ok) throw new Error('선택한 노래 정보를 불러오지 못했습니다.');
  const result = await response.json() as { song: SongDetail };
  return result.song;
}

export async function fetchSongLibrary(signal?: AbortSignal): Promise<SongLibraryData> {
  const response = await fetch('/api/songs', { signal });
  if (!response.ok) throw new Error('노래 목록을 불러오지 못했습니다.');
  return response.json() as Promise<SongLibraryData>;
}

export function basicAuthorization(password: string): string {
  const bytes = new TextEncoder().encode(`admin:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}
