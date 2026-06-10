'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SetPasswordForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password') ?? '');
    const confirm = String(fd.get('confirm') ?? '');
    if (password.length < 6) { setError('At least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords don’t match.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const j = await r.json().catch(() => ({} as { error?: string; redirect?: string }));
      if (!r.ok) { setError(j.error ?? `failed (HTTP ${r.status})`); return; }
      router.replace(j.redirect ?? '/today');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={onSubmit} data-test="set-password-form">
      <input className="email-input" name="password" type="password" placeholder="New password" autoComplete="new-password" required minLength={6} autoFocus />
      <input className="email-input" name="confirm" type="password" placeholder="Again, to be sure" autoComplete="new-password" required minLength={6} />
      <button type="submit" className="submit" disabled={busy} data-test="set-password-submit">
        {busy ? 'Saving…' : 'Set password'}
      </button>
      {error && <div role="alert" className="err">{error}</div>}
    </form>
  );
}
