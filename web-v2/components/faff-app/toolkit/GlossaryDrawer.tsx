'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY } from '@/lib/glossary';

export function useGlossaryDrawer() {
  const [termKey, setTermKey] = React.useState<string | null>(null);

  const openTerm = React.useCallback((key: string) => setTermKey(key), []);
  const close = React.useCallback(() => setTermKey(null), []);

  const drawerEl = <GlossaryDrawer termKey={termKey} onClose={close} />;

  return { openTerm, drawerEl };
}

function GlossaryDrawer({ termKey, onClose }: { termKey: string | null; onClose: () => void }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const open = termKey !== null;
  const entry = termKey ? GLOSSARY[termKey] : null;

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        className={`fa-gloss-overlay${open ? ' open' : ''}`}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        className={`fa-gloss-sheet${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={entry?.term ?? 'Definition'}
      >
        <div className="fa-gloss-grab"><div className="bar" /></div>
        {entry ? (
          <>
            <div className="fa-gloss-term">{entry.term}</div>
            <p className="fa-gloss-def">{entry.def}</p>
            {entry.cite ? <div className="fa-gloss-cite">{entry.cite}</div> : null}
          </>
        ) : null}
        <button type="button" className="fa-gloss-close" onClick={onClose}>
          Done
        </button>
      </div>
    </>,
    document.body,
  );
}
