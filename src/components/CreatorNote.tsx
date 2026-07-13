import { useEffect, useRef, useState } from 'react';
import { fetchCreatorNote, saveCreatorNote, type CreatorNote as CreatorNoteData } from '../library';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreatorNote({ open, onClose }: Props) {
  const [note, setNote] = useState<CreatorNoteData | null>(null);
  const [draft, setDraft] = useState('');
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setEditing(false);
    setPassword('');
    setError(null);
    void fetchCreatorNote(controller.signal)
      .then((next) => {
        setNote(next);
        setDraft(next.content);
      })
      .catch((cause) => {
        if ((cause as Error).name !== 'AbortError') setError((cause as Error).message);
      })
      .finally(() => setLoading(false));
    closeRef.current?.focus();
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open, saving]);

  if (!open) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || !draft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const next = await saveCreatorNote(password, draft);
      setNote(next);
      setDraft(next.content);
      setPassword('');
      setEditing(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <section className="creator-modal" role="dialog" aria-modal="true" aria-labelledby="creator-note-title">
        <div className="modal-heading">
          <div>
            <span className="modal-eyebrow">BEHIND THE MIX</span>
            <h2 id="creator-note-title">제작자 코멘트</h2>
          </div>
          <button ref={closeRef} className="modal-close" onClick={onClose} disabled={saving} aria-label="제작자 코멘트 닫기">×</button>
        </div>

        {loading ? (
          <p className="modal-status">코멘트를 불러오는 중…</p>
        ) : (
          <>
            <div className={`creator-note-body${note?.content ? '' : ' empty'}`}>
              {note?.content || '아직 작성된 제작자 코멘트가 없습니다.'}
            </div>
            {note?.updatedAt && <p className="note-updated">마지막 수정 {formatDate(note.updatedAt)}</p>}
          </>
        )}

        {error && <div className="inline-error">{error}</div>}

        {editing ? (
          <form className="creator-note-form" onSubmit={(event) => void save(event)}>
            <label>
              코멘트 내용
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={5000} rows={9} required />
              <span className="field-count">{draft.length} / 5000</span>
            </label>
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
            <div className="form-actions">
              <button type="button" className="btn secondary" onClick={() => {
                setEditing(false);
                setDraft(note?.content || '');
                setPassword('');
                setError(null);
              }} disabled={saving}>취소</button>
              <button className="btn creator-save" disabled={saving || !password || !draft.trim()}>
                {saving ? '저장 중…' : '코멘트 저장'}
              </button>
            </div>
          </form>
        ) : (
          <button className="btn creator-edit" onClick={() => setEditing(true)} disabled={loading}>관리자 편집</button>
        )}
      </section>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
