/**
 * ConfirmDialog, destructive-action confirmation modal.
 *
 * Composes the Modal primitives (ModalOverlay/Modal/ModalHeader/etc.) into
 * the canonical pattern from designs/_template-confirm-2026-05-09.html:
 * narrow modal · warn-color eyebrow · headline question · optional
 * descriptive body · optional summary block · Cancel + danger buttons.
 *
 * Usage:
 *   <ConfirmDialog
 *     open={showConfirm}
 *     eyebrow="DELETE"
 *     title={`Delete ${race.name}?`}
 *     body="The race plan, GPX, and any logged result will be removed."
 *     confirmLabel="Delete race"
 *     onConfirm={async () => { await deleteRace(); }}
 *     onCancel={() => setShowConfirm(false)}
 *   />
 *
 * Replaces `window.confirm()`, same blocking intent, no OS chrome,
 * matches the locked design system.
 */

'use client';

import { useState, type ReactNode } from 'react';
import {
  ModalOverlay,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  /** Short uppercase label above the title (e.g. "DELETE", "RETIRE"). */
  eyebrow: string;
  /** Headline question, typically "Delete <thing>?". */
  title: ReactNode;
  /** Description of what the action does. */
  body?: ReactNode;
  /** Optional summary block (key/value grid) rendered above the buttons. */
  summary?: ReactNode;
  /** Button label for the destructive action. Default: "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Default: "Cancel". */
  cancelLabel?: string;
  /** Called on confirm. May be async, the button is disabled while pending. */
  onConfirm: () => void | Promise<void>;
  /** Called on cancel (× button, Escape, or backdrop click). */
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  eyebrow,
  title,
  body,
  summary,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  if (!open) return null;

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  };

  return (
    <ModalOverlay onClose={pending ? undefined : onCancel}>
      <Modal size="narrow">
        <ModalHeader
          eyebrow={<span style={{ color: 'var(--warn)' }}>{eyebrow}</span>}
          title={title}
          onClose={pending ? undefined : onCancel}
        />
        <ModalBody>
          {body !== undefined && (
            <div className="t-body" style={{ color: 'var(--t1)' }}>{body}</div>
          )}
          {summary !== undefined && (
            <div style={{
              padding: '14px 16px',
              background: 'var(--l2)',
              borderRadius: 8,
              marginTop: body !== undefined ? 16 : 0,
            }}>{summary}</div>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? 'Working…' : confirmLabel}
          </button>
        </ModalFooter>
      </Modal>
    </ModalOverlay>
  );
}
