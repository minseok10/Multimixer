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

export interface CreatorNote {
  content: string;
  updatedAt: string | null;
}

export interface SongComment {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchSongDetailById(songId: string): Promise<SongDetail> {
  const response = await fetch(`/api/songs/${encodeURIComponent(songId)}`);
  const result = await response.json() as { song?: SongDetail; error?: string };
  if (!response.ok || !result.song) throw new Error(result.error || '선택한 노래 정보를 불러오지 못했습니다.');
  return result.song;
}

export async function fetchSongLibrary(signal?: AbortSignal): Promise<SongLibraryData> {
  const response = await fetch('/api/songs', { signal });
  if (!response.ok) throw new Error('노래 목록을 불러오지 못했습니다.');
  return response.json() as Promise<SongLibraryData>;
}

export async function updateSongMetadata(password: string, songId: string, name: string, bpm: number): Promise<Song> {
  const response = await fetch(`/api/admin/songs/${encodeURIComponent(songId)}`, {
    method: 'PATCH',
    headers: { Authorization: basicAuthorization(password), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, bpm }),
  });
  const result = await response.json() as { song?: Song; error?: string };
  if (!response.ok || !result.song) throw new Error(result.error || '노래 정보를 수정하지 못했습니다.');
  return result.song;
}

export async function fetchCreatorNote(signal?: AbortSignal): Promise<CreatorNote> {
  const response = await fetch('/api/creator-note', { signal });
  const result = await response.json() as { note?: CreatorNote; error?: string };
  if (!response.ok || !result.note) throw new Error(result.error || '제작자 코멘트를 불러오지 못했습니다.');
  return result.note;
}

export async function saveCreatorNote(password: string, content: string): Promise<CreatorNote> {
  const response = await fetch('/api/creator-note', {
    method: 'PUT',
    headers: { Authorization: basicAuthorization(password), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  const result = await response.json() as { note?: CreatorNote; error?: string };
  if (!response.ok || !result.note) throw new Error(result.error || '제작자 코멘트를 저장하지 못했습니다.');
  return result.note;
}

export async function fetchSongComments(songId: string, signal?: AbortSignal): Promise<{ comments: SongComment[]; limit: number }> {
  const response = await fetch(`/api/songs/${encodeURIComponent(songId)}/comments`, { signal });
  const result = await response.json() as { comments?: SongComment[]; limit?: number; error?: string };
  if (!response.ok || !result.comments || typeof result.limit !== 'number') {
    throw new Error(result.error || '댓글을 불러오지 못했습니다.');
  }
  return { comments: result.comments, limit: result.limit };
}

export async function createSongComment(songId: string, content: string): Promise<SongComment> {
  const response = await fetch(`/api/songs/${encodeURIComponent(songId)}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
  });
  return readCommentResponse(response, '댓글을 작성하지 못했습니다.');
}

export async function updateSongComment(songId: string, commentId: string, content: string): Promise<SongComment> {
  const response = await fetch(`/api/songs/${encodeURIComponent(songId)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
  });
  return readCommentResponse(response, '댓글을 수정하지 못했습니다.');
}

export async function deleteSongComment(songId: string, commentId: string): Promise<void> {
  const response = await fetch(`/api/songs/${encodeURIComponent(songId)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || '댓글을 삭제하지 못했습니다.');
}

async function readCommentResponse(response: Response, fallback: string): Promise<SongComment> {
  const result = await response.json() as { comment?: SongComment; error?: string };
  if (!response.ok || !result.comment) throw new Error(result.error || fallback);
  return result.comment;
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
