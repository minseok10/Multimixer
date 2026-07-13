import { describe, expect, it } from 'vitest';
import { songIdFromPath, songPath } from './routes';

const id = '123e4567-e89b-12d3-a456-426614174000';

describe('song routes', () => {
  it('creates a stable song URL', () => {
    expect(songPath(id)).toBe(`/songs/${id}`);
  });

  it('reads direct and trailing-slash song URLs', () => {
    expect(songIdFromPath(`/songs/${id}`)).toBe(id);
    expect(songIdFromPath(`/songs/${id}/`)).toBe(id);
  });

  it('keeps the library and invalid routes separate', () => {
    expect(songIdFromPath('/')).toBeNull();
    expect(songIdFromPath('/songs/not-a-song')).toBeNull();
    expect(songIdFromPath(`/songs/${id}/comments`)).toBeNull();
  });
});
