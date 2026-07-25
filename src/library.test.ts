import { describe, expect, it } from 'vitest';
import {
  formatMixerSongTitle,
  groupSongsByFolder,
  resolveSongFolderName,
  type Song,
  type SongFolder,
} from './library';

const folders: SongFolder[] = [
  { id: 'folder-a', name: '공연 준비', createdAt: '2026-07-01T00:00:00.000Z' },
  { id: 'folder-b', name: '연습곡', createdAt: '2026-07-02T00:00:00.000Z' },
];

function song(id: string, folderId?: string): Song {
  return {
    id,
    name: id,
    ...(folderId ? { folderId } : {}),
    size: 100,
    stemCount: 4,
    uploadedAt: '2026-07-01T00:00:00.000Z',
    url: `/api/songs/${id}`,
  };
}

describe('groupSongsByFolder', () => {
  it('keeps configured folders in order and puts legacy or orphaned songs in 미분류', () => {
    const groups = groupSongsByFolder([
      song('one', 'folder-b'),
      song('two'),
      song('three', 'missing-folder'),
    ], folders);

    expect(groups.map(({ key, name }) => ({ key, name }))).toEqual([
      { key: 'folder-a', name: '공연 준비' },
      { key: 'folder-b', name: '연습곡' },
      { key: 'unfiled', name: '미분류' },
    ]);
    expect(groups[0].songs).toEqual([]);
    expect(groups[1].songs.map(({ id }) => id)).toEqual(['one']);
    expect(groups[2].songs.map(({ id }) => id)).toEqual(['two', 'three']);
  });

  it('omits 미분류 when every song belongs to a known folder', () => {
    const groups = groupSongsByFolder([song('one', 'folder-a')], folders);
    expect(groups.map(({ key }) => key)).toEqual(['folder-a', 'folder-b']);
  });
});

describe('mixer song title', () => {
  it('shows the folder name before the song name', () => {
    expect(formatMixerSongTitle({ name: '여름밤', folderName: '공연 준비' })).toBe('공연 준비/여름밤');
  });

  it('uses 미분류 for legacy and orphaned songs', () => {
    expect(resolveSongFolderName(song('legacy'), folders)).toBe('미분류');
    expect(resolveSongFolderName(song('orphaned', 'missing-folder'), folders)).toBe('미분류');
    expect(formatMixerSongTitle({ name: 'legacy' })).toBe('미분류/legacy');
  });
});
