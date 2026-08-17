import { useCallback, useEffect, useRef, useState } from 'react';
import {
  basicAuthorization,
  collectStemRenames,
  createSongFolder,
  deleteSongFolder,
  fetchSongDetailById,
  fetchSongLibrary,
  formatBytes,
  groupSongsByFolder,
  moveSongToFolder,
  renameSongStem,
  updateSongMetadata,
  type Song,
  type SongFolderGroup,
  type SongLibraryData,
  type SongStem,
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
  const [uploadFolderId, setUploadFolderId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [editName, setEditName] = useState('');
  const [editBpm, setEditBpm] = useState('120');
  const [editStems, setEditStems] = useState<SongStem[]>([]);
  const [editStemNames, setEditStemNames] = useState<Record<string, string>>({});
  const [stemsLoading, setStemsLoading] = useState(false);
  const [stemsError, setStemsError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderPassword, setFolderPassword] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [moveTarget, setMoveTarget] = useState<Song | null>(null);
  const [moveFolderId, setMoveFolderId] = useState('');
  const [movePassword, setMovePassword] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Song | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<SongFolderGroup | null>(null);
  const [folderDeletePassword, setFolderDeletePassword] = useState('');
  const [folderDeleteError, setFolderDeleteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);
  const editRequestRef = useRef(0);
  const movePasswordRef = useRef<HTMLInputElement>(null);
  const deletePasswordRef = useRef<HTMLInputElement>(null);
  const folderDeletePasswordRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!moveTarget) return;
    const frame = requestAnimationFrame(() => movePasswordRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !uploading) {
        setMoveTarget(null);
        setMovePassword('');
        setMoveError(null);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [moveTarget, uploading]);

  useEffect(() => {
    if (!deleteTarget) return;
    const frame = requestAnimationFrame(() => deletePasswordRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !uploading) {
        setDeleteTarget(null);
        setDeletePassword('');
        setDeleteError(null);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [deleteTarget, uploading]);

  useEffect(() => {
    if (!folderDeleteTarget) return;
    const frame = requestAnimationFrame(() => folderDeletePasswordRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !uploading) {
        setFolderDeleteTarget(null);
        setFolderDeletePassword('');
        setFolderDeleteError(null);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [folderDeleteTarget, uploading]);

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
      setUploadFolderId('');
      setFiles([]);
      setUploadProgress('');
      closeEdit();
      setFolderName('');
      setFolderPassword('');
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
        body: JSON.stringify({ name: displayName.trim(), bpm, folderId: uploadFolderId || null }),
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
      if (uploadFolderId) {
        setExpandedFolders((current) => new Set(current).add(uploadFolderId));
      } else {
        setExpandedFolders((current) => new Set(current).add('unfiled'));
      }
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

  const requestDelete = (song: Song) => {
    setDeleteTarget(song);
    setDeletePassword('');
    setDeleteError(null);
    setError(null);
  };

  const requestMove = (song: Song) => {
    setMoveTarget(song);
    setMoveFolderId(song.folderId ?? '');
    setMovePassword('');
    setMoveError(null);
    setError(null);
  };

  const closeMove = () => {
    if (uploading) return;
    setMoveTarget(null);
    setMovePassword('');
    setMoveError(null);
  };

  const move = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!moveTarget || !movePassword) return;
    const song = moveTarget;
    setUploading(true);
    setMoveError(null);
    try {
      await moveSongToFolder(movePassword, song.id, moveFolderId || null);
      setExpandedFolders((current) => new Set(current).add(moveFolderId || 'unfiled'));
      setMoveTarget(null);
      setMovePassword('');
      await load();
    } catch (cause) {
      setMoveError((cause as Error).message);
      requestAnimationFrame(() => movePasswordRef.current?.select());
    } finally {
      setUploading(false);
    }
  };

  const closeDelete = () => {
    if (uploading) return;
    setDeleteTarget(null);
    setDeletePassword('');
    setDeleteError(null);
  };

  const remove = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!deleteTarget || !deletePassword) return;
    const song = deleteTarget;
    setUploading(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/admin/songs/${encodeURIComponent(song.id)}`, {
        method: 'DELETE',
        headers: { Authorization: basicAuthorization(deletePassword) },
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '삭제에 실패했습니다.');
      if (editingSong?.id === song.id) closeEdit();
      setDeleteTarget(null);
      setDeletePassword('');
      await load();
    } catch (cause) {
      setDeleteError((cause as Error).message);
      requestAnimationFrame(() => deletePasswordRef.current?.select());
    } finally {
      setUploading(false);
    }
  };

  const closeEdit = () => {
    editRequestRef.current++;
    setEditingSong(null);
    setEditStems([]);
    setEditStemNames({});
    setStemsLoading(false);
    setStemsError(null);
  };

  const beginEdit = async (song: Song) => {
    const request = ++editRequestRef.current;
    setEditingSong(song);
    setEditName(song.name);
    setEditBpm(String(song.bpm ?? 120));
    setEditStems([]);
    setEditStemNames({});
    setStemsError(null);
    setStemsLoading(true);
    setError(null);
    try {
      const detail = await fetchSongDetailById(song.id);
      if (request !== editRequestRef.current) return;
      setEditStems(detail.stems);
      setEditStemNames(Object.fromEntries(detail.stems.map((stem) => [stem.id, stem.name])));
    } catch (cause) {
      if (request !== editRequestRef.current) return;
      setStemsError((cause as Error).message);
    } finally {
      if (request === editRequestRef.current) setStemsLoading(false);
    }
  };

  const stemNamesValid = editStems.every((stem) => (editStemNames[stem.id] ?? '').trim().length > 0);

  const saveMetadata = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingSong) return;
    const bpm = Number(editBpm);
    if (!password || !editName.trim() || !stemNamesValid || !Number.isInteger(bpm) || bpm < 20 || bpm > 300) return;
    setUploading(true);
    setError(null);
    try {
      await updateSongMetadata(password, editingSong.id, editName.trim(), bpm);
      for (const rename of collectStemRenames(editStems, editStemNames)) {
        await renameSongStem(password, editingSong.id, rename.id, rename.name);
      }
      closeEdit();
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

  const addFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!folderPassword || !folderName.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const folder = await createSongFolder(folderPassword, folderName.trim());
      setFolderName('');
      setFolderPassword('');
      setUploadFolderId(folder.id);
      setExpandedFolders((current) => new Set(current).add(folder.id));
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const requestFolderDelete = (folder: SongFolderGroup) => {
    setFolderDeleteTarget(folder);
    setFolderDeletePassword('');
    setFolderDeleteError(null);
    setError(null);
  };

  const closeFolderDelete = () => {
    if (uploading) return;
    setFolderDeleteTarget(null);
    setFolderDeletePassword('');
    setFolderDeleteError(null);
  };

  const removeFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!folderDeleteTarget || !folderDeletePassword) return;
    const folder = folderDeleteTarget;
    setUploading(true);
    setFolderDeleteError(null);
    try {
      const movedSongs = await deleteSongFolder(folderDeletePassword, folder.key);
      if (uploadFolderId === folder.key) setUploadFolderId('');
      setExpandedFolders((current) => {
        const next = new Set(current);
        next.delete(folder.key);
        if (movedSongs > 0) next.add('unfiled');
        return next;
      });
      setFolderDeleteTarget(null);
      setFolderDeletePassword('');
      await load();
    } catch (cause) {
      setFolderDeleteError((cause as Error).message);
      requestAnimationFrame(() => folderDeletePasswordRef.current?.select());
    } finally {
      setUploading(false);
    }
  };

  const toggleFolder = (folderKey: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderKey)) next.delete(folderKey);
      else next.add(folderKey);
      return next;
    });
  };

  const folderGroups = data ? groupSongsByFolder(data.songs, data.folders ?? []) : [];
  const songNumbers = new Map(data?.songs.map((song, index) => [song.id, index + 1]) ?? []);

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

      <div className="song-folders" aria-busy={!data || busy}>
        {folderGroups.map((folder) => {
          const expanded = expandedFolders.has(folder.key);
          const panelId = `folder-${folder.key}`;
          return (
            <section key={folder.key} className={`song-folder${expanded ? ' expanded' : ''}`}>
              <div className="folder-header">
                <button
                  className="folder-toggle"
                  type="button"
                  onClick={() => toggleFolder(folder.key)}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                >
                  <span className="folder-icon" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  <span className="folder-name">{folder.name}</span>
                  <span className="folder-count">{folder.songs.length}곡</span>
                </button>
                {adminOpen && folder.key !== 'unfiled' && (
                  <button
                    className="folder-delete"
                    type="button"
                    onClick={() => requestFolderDelete(folder)}
                    disabled={uploading}
                    aria-label={`${folder.name} 폴더 삭제`}
                  >
                    폴더 삭제
                  </button>
                )}
              </div>
              {expanded && (
                <div id={panelId} className="song-grid folder-song-grid">
                  {folder.songs.map((song) => (
                    <article key={song.id} className="song-card">
                      <button
                        className="song-select"
                        onClick={() => onSelectSong({ ...song, folderName: folder.name })}
                        disabled={busy || uploading}
                      >
                        <span className="song-number">{String(songNumbers.get(song.id) ?? 0).padStart(2, '0')}</span>
                        <span className="song-name">{song.name}</span>
                        <span className="song-meta">{song.stemCount} stems · {song.bpm ? `${song.bpm} BPM · ` : ''}{formatBytes(song.size)}</span>
                      </button>
                      {adminOpen && (
                        <div className="song-admin-actions">
                          <button
                            className="song-move"
                            onClick={() => requestMove(song)}
                            disabled={uploading}
                            aria-label={`${song.name} 폴더 이동`}
                          >
                            이동
                          </button>
                          <button
                            className="song-edit"
                            onClick={() => void beginEdit(song)}
                            disabled={uploading}
                            aria-label={`${song.name} 정보 수정`}
                          >
                            수정
                          </button>
                          <button
                            className="song-delete"
                            onClick={() => requestDelete(song)}
                            disabled={uploading}
                            aria-label={`${song.name} 삭제`}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                  {folder.songs.length === 0 && <p className="empty-folder">아직 이 폴더에 곡이 없습니다.</p>}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="song-grid custom-upload-grid">
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
              <p>폴더와 오디오 파일은 그대로 두고 제목, BPM, 스템 이름을 수정합니다.</p>
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
          <div className="admin-stem-names">
            <h4>스템 이름</h4>
            <p>믹서의 트랙 이름입니다. 업로드한 파일 이름 대신 Guitar, Piano처럼 바꿀 수 있습니다.</p>
            {stemsLoading && <p className="admin-stem-status">스템 목록을 불러오는 중…</p>}
            {stemsError && <div className="inline-error" role="alert">{stemsError}</div>}
            {!stemsLoading && !stemsError && (
              <div className="admin-stem-grid">
                {editStems.map((stem) => (
                  <label key={stem.id}>
                    <span className="admin-stem-file" title={stem.fileName}>{stem.fileName}</span>
                    <input
                      type="text"
                      value={editStemNames[stem.id] ?? ''}
                      onChange={(event) => setEditStemNames((current) => ({ ...current, [stem.id]: event.target.value }))}
                      maxLength={120}
                      required
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="admin-edit-actions">
            <button type="button" className="btn secondary" onClick={() => {
              closeEdit();
              setPassword('');
            }} disabled={uploading}>취소</button>
            <button className="btn" disabled={!password || !editName.trim() || !stemNamesValid || stemsLoading || !Number.isInteger(Number(editBpm)) || Number(editBpm) < 20 || Number(editBpm) > 300 || uploading}>
              {uploading ? '수정 중…' : '노래 정보 저장'}
            </button>
          </div>
        </form>
      )}

      {adminOpen && data && !editingSong && (
        <form className="admin-folder-create" onSubmit={(event) => void addFolder(event)}>
          <div>
            <h3>새 폴더 만들기</h3>
            <p>만든 폴더는 바로 아래 업로드와 기존 곡 수정에서 선택할 수 있습니다.</p>
          </div>
          <label>
            관리자 비밀번호
            <input
              type="password"
              value={folderPassword}
              onChange={(event) => setFolderPassword(event.target.value)}
              autoComplete="current-password"
              maxLength={256}
              required
            />
          </label>
          <label>
            폴더 이름
            <input
              type="text"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              maxLength={80}
              required
            />
          </label>
          <button className="btn" disabled={!folderPassword || !folderName.trim() || uploading}>
            {uploading ? '처리 중…' : '폴더 만들기'}
          </button>
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
            폴더
            <select value={uploadFolderId} onChange={(event) => setUploadFolderId(event.target.value)}>
              <option value="">미분류</option>
              {(data.folders ?? []).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
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

      {moveTarget && data && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeMove()}>
          <form
            className="move-song-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-song-title"
            aria-describedby="move-song-description"
            onSubmit={(event) => void move(event)}
          >
            <div className="modal-heading">
              <div>
                <span className="move-modal-eyebrow">MOVE SONG</span>
                <h2 id="move-song-title">“{moveTarget.name}” 이동</h2>
              </div>
              <button type="button" className="modal-close" onClick={closeMove} disabled={uploading} aria-label="이동 창 닫기">×</button>
            </div>

            <p id="move-song-description" className="move-modal-copy">
              이 노래를 넣을 폴더를 선택하세요.
            </p>

            <label className="move-folder-field">
              이동할 폴더
              <select value={moveFolderId} onChange={(event) => setMoveFolderId(event.target.value)}>
                <option value="">미분류</option>
                {(data.folders ?? []).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </label>

            <label className="move-password-field">
              관리자 비밀번호
              <input
                ref={movePasswordRef}
                type="password"
                value={movePassword}
                onChange={(event) => {
                  setMovePassword(event.target.value);
                  setMoveError(null);
                }}
                autoComplete="current-password"
                maxLength={256}
                required
              />
            </label>

            {moveError && <div className="inline-error" role="alert">{moveError}</div>}

            <div className="move-modal-actions">
              <button type="button" className="btn secondary" onClick={closeMove} disabled={uploading}>취소</button>
              <button className="btn" disabled={!movePassword || uploading}>
                {uploading ? '이동 중…' : '이 폴더로 이동'}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeDelete()}>
          <form
            className="delete-song-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-song-title"
            aria-describedby="delete-song-description"
            onSubmit={(event) => void remove(event)}
          >
            <div className="modal-heading">
              <div>
                <span className="delete-modal-eyebrow">DELETE SONG</span>
                <h2 id="delete-song-title">“{deleteTarget.name}” 삭제</h2>
              </div>
              <button type="button" className="modal-close" onClick={closeDelete} disabled={uploading} aria-label="삭제 창 닫기">×</button>
            </div>

            <p id="delete-song-description" className="delete-modal-copy">
              이 노래와 모든 스템이 저장소에서 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </p>

            <label className="delete-password-field">
              관리자 비밀번호
              <input
                ref={deletePasswordRef}
                type="password"
                value={deletePassword}
                onChange={(event) => {
                  setDeletePassword(event.target.value);
                  setDeleteError(null);
                }}
                autoComplete="current-password"
                maxLength={256}
                required
              />
            </label>

            {deleteError && <div className="inline-error" role="alert">{deleteError}</div>}

            <div className="delete-modal-actions">
              <button type="button" className="btn secondary" onClick={closeDelete} disabled={uploading}>취소</button>
              <button className="btn delete-confirm" disabled={!deletePassword || uploading}>
                {uploading ? '삭제 중…' : '노래 삭제'}
              </button>
            </div>
          </form>
        </div>
      )}

      {folderDeleteTarget && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeFolderDelete()}>
          <form
            className="delete-song-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-folder-title"
            aria-describedby="delete-folder-description"
            onSubmit={(event) => void removeFolder(event)}
          >
            <div className="modal-heading">
              <div>
                <span className="delete-modal-eyebrow">DELETE FOLDER</span>
                <h2 id="delete-folder-title">“{folderDeleteTarget.name}” 폴더 삭제</h2>
              </div>
              <button type="button" className="modal-close" onClick={closeFolderDelete} disabled={uploading} aria-label="폴더 삭제 창 닫기">×</button>
            </div>

            <p id="delete-folder-description" className="delete-modal-copy">
              {folderDeleteTarget.songs.length > 0
                ? `폴더만 삭제되고 안에 있던 ${folderDeleteTarget.songs.length}곡은 미분류로 옮겨집니다. 노래와 스템은 지워지지 않습니다.`
                : '빈 폴더를 삭제합니다. 이 작업은 되돌릴 수 없습니다.'}
            </p>

            <label className="delete-password-field">
              관리자 비밀번호
              <input
                ref={folderDeletePasswordRef}
                type="password"
                value={folderDeletePassword}
                onChange={(event) => {
                  setFolderDeletePassword(event.target.value);
                  setFolderDeleteError(null);
                }}
                autoComplete="current-password"
                maxLength={256}
                required
              />
            </label>

            {folderDeleteError && <div className="inline-error" role="alert">{folderDeleteError}</div>}

            <div className="delete-modal-actions">
              <button type="button" className="btn secondary" onClick={closeFolderDelete} disabled={uploading}>취소</button>
              <button className="btn delete-confirm" disabled={!folderDeletePassword || uploading}>
                {uploading ? '삭제 중…' : '폴더 삭제'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
