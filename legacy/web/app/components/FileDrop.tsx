/**
 * FileDrop · custom <input type="file"> replacement
 *
 * The native file-input button paints with OS chrome ("Choose File" gray
 * button, system font, locale-translated label). This is a styled drop zone
 * with a hidden native input under the hood, the file picker dialog itself
 * is OS-controlled and unavoidable, but every pixel inside our page matches.
 *
 *   <FileDrop accept=".gpx" onFile={(content, file) => …} />
 *
 * Emits via:
 *   - onFile(text, file), when readAs is "text" (default)
 *   - onFiles(files), raw FileList access for multi-file flows
 */

'use client';

import { useRef, useState, type DragEvent, type ChangeEvent, type ReactNode } from 'react';

export interface FileDropProps {
  /** Comma-separated extensions or mime types (e.g. ".gpx,.tcx" or "image/*"). */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Label rendered inside the drop zone. */
  label?: ReactNode;
  /** Secondary line, e.g. "GPX up to 10 MB". */
  hint?: ReactNode;
  /** Fires with the first file read as text (FileReader.readAsText). */
  onFile?: (text: string, file: File) => void;
  /** Fires with the raw FileList for callers that need binary or multi-file. */
  onFiles?: (files: FileList) => void;
  /** "text" → call onFile; "none" → only call onFiles. Default "text". */
  readAs?: 'text' | 'none';
  className?: string;
  ariaLabel?: string;
}

export function FileDrop({
  accept,
  multiple,
  disabled,
  label = 'Drop GPX or click to choose',
  hint,
  onFile,
  onFiles,
  readAs = 'text',
  className,
  ariaLabel,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onFiles?.(files);
    setFilename(files[0].name);
    if (readAs === 'text' && onFile) {
      const reader = new FileReader();
      reader.onload = () => {
        onFile(String(reader.result ?? ''), files[0]);
      };
      reader.readAsText(files[0]);
    }
  };

  const triggerPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      triggerPicker();
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    // Reset so the same file can be re-uploaded.
    e.target.value = '';
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : 'File drop zone')}
      aria-disabled={disabled || undefined}
      className={[
        'rc-filedrop',
        dragOver ? 'is-dragover' : '',
        disabled ? 'is-disabled' : '',
        filename ? 'has-file' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={triggerPicker}
      onKeyDown={onKeyDown}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <div className="rc-filedrop-icon" aria-hidden>
        <UploadGlyph />
      </div>
      <div className="rc-filedrop-label">{filename ?? label}</div>
      {hint !== undefined && !filename && <div className="rc-filedrop-hint">{hint}</div>}
      {filename && (
        <button
          type="button"
          className="rc-filedrop-clear"
          onClick={(e) => {
            e.stopPropagation();
            setFilename(null);
          }}
        >
          REPLACE
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={onInputChange}
        style={{ display: 'none' }}
        aria-hidden
        tabIndex={-1}
      />
    </div>
  );
}

function UploadGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M11 3V14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M6 8L11 3L16 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 15V17C3 18.1 3.9 19 5 19H17C18.1 19 19 18.1 19 17V15"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
