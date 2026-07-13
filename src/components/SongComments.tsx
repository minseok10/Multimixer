import { useEffect, useState } from 'react';
import {
  createSongComment,
  deleteSongComment,
  fetchSongComments,
  updateSongComment,
  type Song,
  type SongComment,
} from '../library';

interface Props {
  song: Song;
}

export function SongComments({ song }: Props) {
  const [comments, setComments] = useState<SongComment[]>([]);
  const [limit, setLimit] = useState(100);
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchSongComments(song.id, controller.signal)
      .then((result) => {
        setComments(result.comments);
        setLimit(result.limit);
      })
      .catch((cause) => {
        if ((cause as Error).name !== 'AbortError') setError((cause as Error).message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [song.id]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const comment = await createSongComment(song.id, content);
      setComments((current) => [...current, comment]);
      setContent('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const update = async (event: React.FormEvent, commentId: string) => {
    event.preventDefault();
    if (!editContent.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSongComment(song.id, commentId, editContent);
      setComments((current) => current.map((comment) => comment.id === commentId ? updated : comment));
      setEditingId(null);
      setEditContent('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (comment: SongComment) => {
    if (!window.confirm('이 댓글을 삭제할까요? 누구나 삭제할 수 있으며 되돌릴 수 없습니다.')) return;
    setSaving(true);
    setError(null);
    try {
      await deleteSongComment(song.id, comment.id);
      setComments((current) => current.filter(({ id }) => id !== comment.id));
      if (editingId === comment.id) setEditingId(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="comments" aria-labelledby="comments-title">
      <div className="comments-heading">
        <div>
          <span className="comments-kicker">{song.name}</span>
          <h2 id="comments-title">댓글 <span>{comments.length}</span></h2>
        </div>
        <p>익명 · 답글 없음 · 누구나 수정 및 삭제 가능</p>
      </div>

      <form className="comment-compose" onSubmit={(event) => void create(event)}>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="이 곡과 믹스에 대한 코멘트를 남겨보세요."
          maxLength={1000}
          rows={3}
          aria-label="새 댓글"
          disabled={saving || comments.length >= limit}
        />
        <div className="comment-compose-footer">
          <span>{content.length} / 1000</span>
          <button className="btn" disabled={saving || !content.trim() || comments.length >= limit}>
            {saving ? '처리 중…' : '댓글 남기기'}
          </button>
        </div>
      </form>

      {error && <div className="inline-error">{error}</div>}
      {loading && <p className="comments-empty">댓글을 불러오는 중…</p>}
      {!loading && comments.length === 0 && <p className="comments-empty">첫 번째 익명 댓글을 남겨보세요.</p>}

      <div className="comment-list">
        {comments.map((comment) => (
          <article key={comment.id} className="comment-item">
            {editingId === comment.id ? (
              <form onSubmit={(event) => void update(event, comment.id)}>
                <textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} maxLength={1000} rows={3} aria-label="댓글 수정" />
                <div className="comment-edit-actions">
                  <span>{editContent.length} / 1000</span>
                  <button type="button" className="text-button" onClick={() => setEditingId(null)} disabled={saving}>취소</button>
                  <button className="text-button primary" disabled={saving || !editContent.trim()}>저장</button>
                </div>
              </form>
            ) : (
              <>
                <p>{comment.content}</p>
                <footer>
                  <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
                  {comment.updatedAt !== comment.createdAt && <span>수정됨</span>}
                  <div className="comment-actions">
                    <button className="text-button" onClick={() => {
                      setEditingId(comment.id);
                      setEditContent(comment.content);
                    }} disabled={saving}>수정</button>
                    <button className="text-button danger" onClick={() => void remove(comment)} disabled={saving}>삭제</button>
                  </div>
                </footer>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
