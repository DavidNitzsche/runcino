'use client';

/**
 * Tiny client island for the "Sign out" link on /pending and /admin.
 *
 * POSTs to /api/auth/logout (which clears the cookie + session row),
 * then navigates to /landing. We can't use a plain <Link> because we
 * need to hit the API first; a raw <form> would render JSON in the tab.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutLink({ className, label = 'Sign out' }: { className?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors — we still want to bounce them out client-side.
    }
    router.push('/landing');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', padding: 0, color: 'inherit' }}
      disabled={busy}
    >
      {label}
    </button>
  );
}
