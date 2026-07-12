/**
 * Drag-and-drop / file-picker for adding tracks, plus a "load demo" button that
 * synthesizes bundled stems. Shown large when empty, compact once tracks exist.
 */

import { useRef, useState } from 'react';

interface Props {
  onFiles: (files: File[]) => void;
  onLoadDemo: () => void;
  loading: boolean;
  compact: boolean;
}

export function DropZone({ onFiles, onLoadDemo, loading, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list).filter((f) => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(f.name));
    if (files.length) onFiles(files);
  };

  return (
    <div
      className={`dropzone${dragging ? ' dragging' : ''}${compact ? ' compact' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="dropzone-body">
        <p className="dropzone-text">
          {compact
            ? '오디오 파일을 더 끌어다 놓거나 추가하세요'
            : '오디오 파일을 여기에 끌어다 놓으세요 (여러 개 가능)'}
        </p>
        <div className="dropzone-actions">
          <button className="btn" onClick={() => inputRef.current?.click()} disabled={loading}>
            파일 선택
          </button>
          <button className="btn secondary" onClick={onLoadDemo} disabled={loading}>
            {loading ? '로드 중…' : '데모 스템 로드'}
          </button>
        </div>
      </div>
    </div>
  );
}
