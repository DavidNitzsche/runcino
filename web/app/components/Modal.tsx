/**
 * Modal system · ModalOverlay · Modal · ModalHeader · ModalBody · ModalFooter ·
 * ModalEyebrow · ModalClose
 *
 * The canonical overlay/modal pattern from the May 2026 mockups
 * (_template-edit, _template-action, _template-confirm).
 *
 * Composition:
 *   <ModalOverlay onClose={...}>
 *     <Modal size="default">
 *       <ModalHeader eyebrow="EDIT" title="A-RACE GOAL" onClose={...} />
 *       <ModalBody>...form fields...</ModalBody>
 *       <ModalFooter>
 *         <button className="btn-flat btn-secondary">CANCEL</button>
 *         <button className="btn-flat btn-primary">SAVE</button>
 *       </ModalFooter>
 *     </Modal>
 *   </ModalOverlay>
 *
 * No focus-trap, no scroll-lock — those are caller responsibilities (or
 * a future enhancement). The structure here matches the mockup CSS exactly.
 */

'use client';

import { useEffect, type ReactNode, type MouseEvent } from 'react';

export interface ModalOverlayProps {
  children: ReactNode;
  /** Called when the backdrop is clicked or Escape is pressed. */
  onClose?: () => void;
}

export function ModalOverlay({ children, onClose }: ModalOverlayProps) {
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && onClose) onClose();
  };

  return (
    <div className="overlay" onClick={handleBackdrop} role="dialog" aria-modal="true">
      {children}
    </div>
  );
}

export type ModalSize = 'narrow' | 'default' | 'wide';

export interface ModalProps {
  children: ReactNode;
  size?: ModalSize;
}

export function Modal({ children, size = 'default' }: ModalProps) {
  const sizeClass =
    size === 'narrow' ? ' modal--narrow' : size === 'wide' ? ' modal--wide' : '';
  return <div className={`modal${sizeClass}`}>{children}</div>;
}

export interface ModalHeaderProps {
  /** Optional uppercase eyebrow above the title. */
  eyebrow?: ReactNode;
  /** The main title — uppercase display font. */
  title: ReactNode;
  /** When provided, renders an × close button on the right. */
  onClose?: () => void;
  /** Optional custom right-side content (renders instead of the × button). */
  right?: ReactNode;
}

export function ModalHeader({ eyebrow, title, onClose, right }: ModalHeaderProps) {
  return (
    <div className="modal-h">
      <div>
        {eyebrow !== undefined && <div className="modal-eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
      </div>
      {right ?? (onClose && <ModalClose onClose={onClose} />)}
    </div>
  );
}

export interface ModalEyebrowProps {
  children: ReactNode;
}
export function ModalEyebrow({ children }: ModalEyebrowProps) {
  return <div className="modal-eyebrow">{children}</div>;
}

export interface ModalCloseProps {
  onClose: () => void;
}
export function ModalClose({ onClose }: ModalCloseProps) {
  return (
    <button
      type="button"
      className="modal-close"
      onClick={onClose}
      aria-label="Close"
    >
      ×
    </button>
  );
}

export interface ModalBodyProps {
  children: ReactNode;
}
export function ModalBody({ children }: ModalBodyProps) {
  return <div className="modal-body">{children}</div>;
}

export interface ModalFooterProps {
  children: ReactNode;
  /** When true, footer is justify-between (foot-meta on left, buttons on right). */
  split?: boolean;
}
export function ModalFooter({ children, split }: ModalFooterProps) {
  return <div className={`modal-foot${split ? ' split' : ''}`}>{children}</div>;
}
