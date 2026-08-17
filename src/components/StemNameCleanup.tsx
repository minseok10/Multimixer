import { useEffect, useRef, useState } from 'react';
import {
  fetchSongDetailById,
  fetchSongLibrary,
  planStemCleanup,
  renameSongStem,
  type SongDetail,
  type StemCleanupPlan,
} from '../library';

interface Props {
  disabled: boolean;
  onApplied: () => Promise<void> | void;
}

/**
 * 모든 곡의 스템 이름을 한 번에 "악기 이름만" 남기도록 정리한다.
 * 무엇이 바뀌는지 먼저 전부 보여주고, 확인을 받은 다음에만 요청을 보낸다.
 */
export function StemNameCleanup({ disabled, onApplied }: Props) {
  const [plan, setPlan] = useState<StemCleanupPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const open = plan !== null;
  const busy = loading || applying;

  const close = () => {
    if (applying) return;
    setPlan(null);
    setPassword('');
    setError(null);
    setProgress('');
    setDone(null);
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => passwordRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !applying) {
        setPlan(null);
        setPassword('');
        setError(null);
        setProgress('');
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
  }, [open, applying]);

  const preview = async () => {
    setLoading(true);
    setError(null);
    setDone(null);
    try {
      const library = await fetchSongLibrary();
      const details: SongDetail[] = [];
      for (const song of library.songs) {
        setProgress(`스템 이름 확인 중… ${details.length + 1}/${library.songs.length}`);
        details.push(await fetchSongDetailById(song.id));
      }
      setProgress('');
      setPlan(planStemCleanup(details));
    } catch (cause) {
      setProgress('');
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const apply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!plan || !password) return;
    setApplying(true);
    setError(null);
    let applied = 0;
    try {
      for (const change of plan.changes) {
        setProgress(`적용 중… ${applied + 1}/${plan.changes.length}`);
        await renameSongStem(password, change.songId, change.stemId, change.to);
        applied++;
      }
      setPlan(null);
      setPassword('');
      setProgress('');
      setDone(applied);
      await onApplied();
    } catch (cause) {
      // 앞부분은 이미 반영됐다. 몇 개까지 됐는지 알려주고 다시 열면 남은 것만 잡힌다.
      setError(`${applied}개까지 적용한 뒤 중단됐습니다: ${(cause as Error).message}`);
      setProgress('');
      requestAnimationFrame(() => passwordRef.current?.select());
      await onApplied();
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <div className="admin-tools">
        <div>
          <h3>스템 이름 일괄 정리</h3>
          <p>
            모든 곡의 스템에서 악기 이름만 남깁니다. 예: “Can’t Be Right [68aA_o4yGwo] (Vocals)” → “Vocals”.
            바뀔 내용을 먼저 보여주고 확인을 받은 뒤에 적용합니다.
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={() => void preview()} disabled={disabled || busy}>
          {loading ? progress || '확인 중…' : '변경 내역 보기'}
        </button>
      </div>

      {done !== null && (
        <div className="cleanup-result" role="status">
          스템 이름 {done}개를 정리했습니다.
        </div>
      )}
      {!open && error && <div className="error-banner">{error}</div>}

      {open && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <form
            className="cleanup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cleanup-title"
            aria-describedby="cleanup-summary"
            onSubmit={(event) => void apply(event)}
          >
            <div className="modal-heading">
              <div>
                <span className="move-modal-eyebrow">CLEAN UP STEM NAMES</span>
                <h2 id="cleanup-title">스템 이름 일괄 정리</h2>
              </div>
              <button type="button" className="modal-close" onClick={close} disabled={applying} aria-label="정리 창 닫기">×</button>
            </div>

            <p id="cleanup-summary" className="cleanup-summary">
              {plan.changes.length > 0
                ? `스템 ${plan.changes.length}개의 이름이 바뀝니다.`
                : '바꿀 스템이 없습니다. 이미 모두 정리되어 있습니다.'}
              {plan.skipped.length > 0 && ` 악기 이름을 찾지 못한 ${plan.skipped.length}개는 그대로 둡니다.`}
            </p>

            {plan.changes.length > 0 && (
              <ul className="cleanup-list">
                {plan.changes.map((change) => (
                  <li key={`${change.songId}-${change.stemId}`}>
                    <span className="cleanup-song">{change.songName}</span>
                    <span className="cleanup-from">{change.from}</span>
                    <span className="cleanup-arrow" aria-hidden="true">→</span>
                    <span className="cleanup-to">{change.to}</span>
                    {change.duplicate && <span className="cleanup-warning">같은 이름 중복</span>}
                  </li>
                ))}
              </ul>
            )}

            {plan.skipped.length > 0 && (
              <details className="cleanup-skipped">
                <summary>그대로 두는 스템 {plan.skipped.length}개</summary>
                <ul>
                  {plan.skipped.map((skip) => (
                    <li key={`${skip.songId}-${skip.name}`}>
                      <span className="cleanup-song">{skip.songName}</span>
                      <span className="cleanup-from">{skip.name}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {plan.changes.length > 0 && (
              <label className="cleanup-password-field">
                관리자 비밀번호
                <input
                  ref={passwordRef}
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError(null);
                  }}
                  autoComplete="current-password"
                  maxLength={256}
                  required
                />
              </label>
            )}

            {error && <div className="inline-error" role="alert">{error}</div>}

            <div className="cleanup-actions">
              <button type="button" className="btn secondary" onClick={close} disabled={applying}>
                {plan.changes.length > 0 ? '취소' : '닫기'}
              </button>
              {plan.changes.length > 0 && (
                <button className="btn" disabled={!password || applying}>
                  {applying ? progress || '적용 중…' : `${plan.changes.length}개 이름 바꾸기`}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  );
}
