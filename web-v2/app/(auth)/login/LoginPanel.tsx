'use client';

/**
 * LoginPanel · the entire interactive surface of /login since the
 * 2026-06-10 invite-only directive: "just a log in. either you have
 * one or you dont. You can request access."
 *
 * Modes:
 *   signin        email + password → POST /api/auth/email
 *                 (server may answer redirect:/set-password for temp
 *                 credentials — honored before ?next=)
 *   request       name + email → POST /api/auth/request-access
 *   request-sent  confirmation copy
 *
 * No Apple/Google buttons — those were part of the welcome-page era.
 * The Apple endpoint still serves the iPhone.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'signin' | 'request' | 'request-sent' | 'signup';

export function LoginPanel({ next, openSignup }: {
  next?: string | null;
  /** Sandbox only (ALLOW_OPEN_SIGNUP) · shows a direct create-account
   *  form so test users can be mass-created without the invite dance.
   *  Prod never sets the flag, so this stays invisible there. */
  openSignup?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    if (!email || !password) { setError('Enter your email and password.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({} as { error?: string; redirect?: string }));
      if (!r.ok) { setError(j.error ?? `sign-in failed (HTTP ${r.status})`); return; }
      // Temp credential → set-password comes before any ?next= return.
      const dest = j.redirect === '/set-password' ? '/set-password' : (next || j.redirect || '/today');
      router.replace(dest);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error');
    } finally { setBusy(false); }
  }

  async function onRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const email = String(fd.get('email') ?? '').trim();
    if (!name || !email) { setError('Name and email, that’s it.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/request-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) { setError(j.error ?? `request failed (HTTP ${r.status})`); return; }
      setMode('request-sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error');
    } finally { setBusy(false); }
  }

  if (mode === 'request-sent') {
    return (
      <div className="auth" data-test="request-sent">
        <div className="sent-head">Request received.</div>
        <div className="sent-sub">
          You&rsquo;ll get an email when access is approved, with a temporary
          password for your first sign-in.
        </div>
        <button type="button" className="email-cancel" onClick={() => { setMode('signin'); setError(null); }}>
          ← Back to sign in
        </button>
      </div>
    );
  }

  if (mode === 'signup') {
    return (
      <form
        className="email-form"
        data-test="sandbox-signup-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setBusy(true); setError(null);
          try {
            const r = await fetch('/api/auth/signup', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                name: String(fd.get('name') ?? '').trim(),
                email: String(fd.get('email') ?? '').trim(),
                password: String(fd.get('password') ?? ''),
              }),
            });
            const j = await r.json().catch(() => ({} as { error?: string; redirect?: string }));
            if (!r.ok) { setError(j.error ?? `signup failed (HTTP ${r.status})`); return; }
            router.replace(next || j.redirect || '/onboarding');
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'network error');
          } finally { setBusy(false); }
        }}
      >
        <input className="email-input" name="name" type="text" placeholder="Name" autoComplete="name" required maxLength={80} autoFocus />
        <input className="email-input" name="email" type="email" placeholder="Email" autoComplete="email" required />
        <input className="email-input" name="password" type="password" placeholder="Password" autoComplete="new-password" required minLength={6} />
        <button type="submit" className="gbtn email-submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <button type="button" className="email-cancel" onClick={() => { setMode('signin'); setError(null); }}>
          ← Back to sign in
        </button>
        {error && <div role="alert" className="auth-error">{error}</div>}
      </form>
    );
  }

  if (mode === 'request') {
    return (
      <form className="email-form" onSubmit={onRequest} data-test="request-form">
        <input className="email-input" name="name" type="text" placeholder="Name" autoComplete="name" required maxLength={80} autoFocus />
        <input className="email-input" name="email" type="email" placeholder="Email" autoComplete="email" required />
        <button type="submit" className="gbtn email-submit" disabled={busy} data-test="request-submit">
          {busy ? 'Sending…' : 'Request access'}
        </button>
        <button type="button" className="email-cancel" onClick={() => { setMode('signin'); setError(null); }}>
          ← Back to sign in
        </button>
        {error && <div role="alert" className="auth-error">{error}</div>}
      </form>
    );
  }

  return (
    <form className="email-form" onSubmit={onSignIn} data-test="signin-form">
      <input className="email-input" name="email" type="email" placeholder="Email" autoComplete="email" required autoFocus />
      <input className="email-input" name="password" type="password" placeholder="Password" autoComplete="current-password" required minLength={6} />
      <button type="submit" className="gbtn email-submit" disabled={busy} data-test="signin-submit">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <div className="auth-or">OR</div>
      <button
        type="button"
        className="gbtn request"
        data-test="request-access"
        onClick={() => { setMode('request'); setError(null); }}
      >
        Request access
      </button>
      {openSignup && (
        <button
          type="button"
          className="email-cancel"
          data-test="sandbox-signup"
          onClick={() => { setMode('signup'); setError(null); }}
        >
          SANDBOX · Create account directly
        </button>
      )}
      {error && <div role="alert" className="auth-error">{error}</div>}
    </form>
  );
}
