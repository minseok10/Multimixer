const SONG_ROUTE = /^\/songs\/([0-9a-f-]{36})\/?$/;

export function songPath(songId: string): string {
  return `/songs/${encodeURIComponent(songId)}`;
}

export function songIdFromPath(pathname: string): string | null {
  return pathname.match(SONG_ROUTE)?.[1] ?? null;
}
