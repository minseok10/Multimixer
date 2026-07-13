import { useCallback, useEffect, useRef, useState } from 'react';
import {
  basicAuthorization,
  fetchSongLibrary,
  formatBytes,
  updateSongMetadata,
  type Song,
  type SongLibraryData,
} from '../library';

interface Props {
  busy: boolean;
  onSelectSong: (song: Song) => void;
  onCustomUpload: () => void;
}

export function SongLibrary({ busy, onSelectSong, onCustomUpload }: Props) {
  const [data, setData] = useState<SongLibraryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [songBpm, setSongBpm] = useState('120');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [editName, setEditName] = useState('');
  const [editBpm, setEditBpm] = useState('120');
  const inputRef = useRef<HTMLInputElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setError(null);
      setData(await fetchSongLibrary(signal));
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') {
        setError((cause as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!editingSong) return;
    const frame = requestAnimationFrame(() => editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [editingSong]);

  const chooseFiles = (next: File[]) => {
    setFiles(next);
    if (next[0] && !displayName.trim()) {
      setDisplayName(next[0].name.replace(/\.[^.]+$/, '').replace(/[-_ ]?(drums?|bass|vocals?|guitars?|keys?)$/i, ''));
    }
  };

  const toggleAdmin = () => {
    if (adminOpen) {
      setPassword('');
      setDisplayName('');
      setSongBpm('120');
      setFiles([]);
      setUploadProgress('');
      setEditingSong(null);
      if (inputRef.current) inputRef.current.value = '';
    }
    setAdminOpen((open) => !open);
  };

  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    const bpm = Number(songBpm);
    if (files.length < 2 || !password || !displayName.trim() || !Number.isInteger(bpm) || bpm < 20 || bpm > 300) return;
    setUploading(true);
    setError(null);
    const authorization = basicAuthorization(password);
    let songId: string | null = null;
    try {
      setUploadProgress('노래 묶음 준비 중…');
      const createResponse = await fetch('/api/admin/songs', {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: displayName.trim(), bpm }),
      });
      const createResult = await createResponse.json() as { song?: { id: string }; error?: string };
      if (!createResponse.ok || !createResult.song) throw new Error(createResult.error || '노래 묶음을 만들지 못했습니다.');
      songId = createResult.song.id;

      for (const [index, file] of files.entries()) {
        setUploadProgress(`스템 업로드 ${index + 1}/${files.length} · ${file.name}`);
        const params = new URLSearchParams({ filename: file.name, name: file.name.replace(/\.[^.]+$/, '') });
        const response = await fetch(`/api/admin/songs/${encodeURIComponent(songId)}/stems/${index}?${params}`, {
          method: 'PUT',
          headers: { Authorization: authorization, 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error || `${file.name} 업로드에 실패했습니다.`);
      }

      setUploadProgress('노래 공개 처리 중…');
      const completeResponse = await fetch(`/api/admin/songs/${encodeURIComponent(songId)}/complete`, {
        method: 'POST', headers: { Authorization: authorization },
      });
      const completeResult = await completeResponse.json() as { error?: string };
      if (!completeResponse.ok) throw new Error(completeResult.error || '노래 업로드를 완료하지 못했습니다.');
      songId = null;
      setDisplayName('');
      setSongBpm('120');
      setFiles([]);
      setPassword('');
      setUploadProgress('');
      if (inputRef.current) inputRef.current.value = '';
      await load();
    } catch (cause) {
      if (songId) {
        await fetch(`/api/admin/songs/${encodeURIComponent(songId)}`, {
          method: 'DELETE', headers: { Authorization: authorization },
        }).catch(() => undefined);
      }
      setError((cause as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (song: Song) => {
    if (!password) {
      setError('삭제하려면 관리자 비밀번호를 입력하세요.');
      setAdminOpen(true);
      return;
    }
    if (!window.confirm(`“${song.name}”을 삭제할까요?`)) return;
    setUploading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/songs/${encodeURIComponent(song.id)}`, {
        method: 'DELETE',
        headers: { Authorization: basicAuthorization(password) },
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '삭제에 실패했습니다.');
      if (editingSong?.id === song.id) setEditingSong(null);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const beginEdit = (song: Song) => {
    setEditingSong(song);
    setEditName(song.name);
    setEditBpm(String(song.bpm ?? 120));
    setError(null);
  };

  const saveMetadata = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingSong) return;
    const bpm = Number(editBpm);
    if (!password || !editName.trim() || !Number.isInteger(bpm) || bpm < 20 || bpm > 300) return;
    setUploading(true);
    setError(null);
    try {
      await updateSongMetadata(password, editingSong.id, editName.trim(), bpm);
      setEditingSong(null);
      setEditName('');
      setEditBpm('120');
      setPassword('');
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="library">
      <div className="library-heading">
        <div>
          <h2>노래 선택</h2>
          <p>미리 준비된 노래를 선택하거나 내 파일로 믹서를 시작하세요.</p>
        </div>
        <button className="btn secondary" onClick={toggleAdmin}>
          {adminOpen ? '관리 닫기' : '노래 관리'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="song-grid" aria-busy={!data || busy}>
        {data?.songs.map((song, index) => (
          <article key={song.id} className="song-card">
            <button
              className="song-select"
              onClick={() => onSelectSong(song)}
              disabled={busy || uploading}
            >
              <span className="song-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="song-name">{song.name}</span>
              <span className="song-meta">{song.stemCount} stems · {song.bpm ? `${song.bpm} BPM · ` : ''}{formatBytes(song.size)}</span>
            </button>
            {adminOpen && (
              <div className="song-admin-actions">
                <button
                  className="song-edit"
                  onClick={() => beginEdit(song)}
                  disabled={uploading}
                  aria-label={`${song.name} 정보 수정`}
                >
                  수정
                </button>
                <button
                  className="song-delete"
                  onClick={() => void remove(song)}
                  disabled={uploading}
                  aria-label={`${song.name} 삭제`}
                >
                  삭제
                </button>
              </div>
            )}
          </article>
        ))}

        <button className="song-card custom-song" onClick={onCustomUpload} disabled={busy}>
          <span className="custom-plus">＋</span>
          <span className="song-name">Custom Upload</span>
          <span className="song-meta">내 오디오 파일 사용</span>
        </button>
      </div>

      {data && (
        <div className="storage-summary">
          <span>R2 음악 저장소 {formatBytes(data.totalBytes)} / {formatBytes(data.limits.maxTotalBytes)}</span>
          <span>스템당 최대 {formatBytes(data.limits.maxStemBytes)} · 곡당 최대 {data.limits.maxStems}스템 · 최대 {data.limits.maxSongs}곡</span>
        </div>
      )}

      {adminOpen && data && editingSong && (
        <form ref={editFormRef} className="admin-song-edit" onSubmit={(event) => void saveMetadata(event)}>
          <div className="admin-upload-heading">
            <div>
              <h3>노래 정보 수정</h3>
              <p>스템은 그대로 두고 표시 제목과 BPM만 R2 manifest에서 수정합니다.</p>
            </div>
          </div>
          <label>
            관리자 비밀번호
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              maxLength={256}
              required
            />
          </label>
          <label>
            표시할 노래 제목
            <input type="text" value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={120} required />
          </label>
          <label>
            BPM
            <input
              type="number"
              value={editBpm}
              onChange={(event) => setEditBpm(event.target.value)}
              min={20}
              max={300}
              step={1}
              inputMode="numeric"
              required
            />
          </label>
          <div className="admin-edit-actions">
            <button type="button" className="btn secondary" onClick={() => {
              setEditingSong(null);
              setPassword('');
            }} disabled={uploading}>취소</button>
            <button className="btn" disabled={!password || !editName.trim() || !Number.isInteger(Number(editBpm)) || Number(editBpm) < 20 || Number(editBpm) > 300 || uploading}>
              {uploading ? '수정 중…' : '제목과 BPM 저장'}
            </button>
          </div>
        </form>
      )}

      {adminOpen && data && !editingSong && (
        <form className="admin-upload" onSubmit={(event) => void upload(event)}>
          <div className="admin-upload-heading">
            <div>
              <h3>관리자 노래 업로드</h3>
              <p>비밀번호는 업로드 요청에만 사용되며 브라우저에 저장하지 않습니다.</p>
            </div>
          </div>
          <label>
            관리자 비밀번호
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              maxLength={256}
              required
            />
          </label>
          <label>
            표시할 노래 이름
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label>
            BPM
            <input
              type="number"
              value={songBpm}
              onChange={(event) => setSongBpm(event.target.value)}
              min={20}
              max={300}
              step={1}
              inputMode="numeric"
              required
            />
          </label>
          <label>
            스템 파일 (2~{data.limits.maxStems}개, WAV 4개 동시 선택 가능)
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac"
              onChange={(event) => chooseFiles(Array.from(event.target.files ?? []).slice(0, data.limits.maxStems))}
              required
            />
          </label>
          {files.length > 0 && <p>선택된 스템: {files.length}개 · 총 {formatBytes(files.reduce((sum, file) => sum + file.size, 0))}</p>}
          <button className="btn" disabled={files.length < 2 || !password || !displayName.trim() || !Number.isInteger(Number(songBpm)) || Number(songBpm) < 20 || Number(songBpm) > 300 || uploading}>
            {uploading ? uploadProgress || '업로드 중…' : `${files.length || ''}개 스템을 R2에 업로드`}
          </button>
        </form>
      )}
    </main>
  );
}
