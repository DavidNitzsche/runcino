'use client';

/**
 * /login — email + password sign-in.
 *
 * On success: cookie is set, navigate to /overview (or ?next= if set).
 * Server returns generic "Invalid email or password" on bad creds —
 * doesn't leak whether the email is registered.
 *
 * useSearchParams needs a Suspense boundary for static prerendering
 * to work — split the form into LoginInner and wrap below.
 */

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import '../public.css';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="faff-public-body" />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const nextPath = search.get('next') || '/overview';

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        setBusy(false);
        return;
      }
      router.push(nextPath);
    } catch {
      setError('Network error — please try again');
      setBusy(false);
    }
  }

  return (
    <div className="faff-public-body">
      <nav className="faff-pub-nav">
        <div className="faff-pub-nav-inner">
          <Link className="faff-logo" href="/landing">faff.run</Link>
          <Link className="faff-nav-back" href="/landing">← Back home</Link>
        </div>
      </nav>

      <div className="faff-auth-wrap">
        <div className="faff-auth-card">
          <div className="faff-eyebrow">Sign in</div>
          <h1 className="faff-auth-title">Welcome back.</h1>
          <p className="faff-auth-sub">Pick up where you left off. The coach is ready.</p>

          <form onSubmit={onSubmit} autoComplete="on">
            {error && <div className="faff-form-error">{error}</div>}

            <div className="faff-form-row">
              <label className="faff-form-label" htmlFor="login-email">Email</label>
              <input className="faff-form-input" id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>

            <div className="faff-form-row">
              <div className="faff-form-row-header">
                <label className="faff-form-label" htmlFor="login-password">Password</label>
                <a
                  className="faff-forgot-link"
                  href="#"
                  onClick={(e) => { e.preventDefault(); alert('Password reset coming soon — email infra not yet wired. Contact support@faff.run.'); }}
                >Forgot?</a>
              </div>
              <div className="faff-password-wrap">
                <input
                  className="faff-form-input"
                  id="login-password"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button type="button" className="faff-password-toggle" onClick={() => setShowPwd((v) => !v)}>
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="faff-remember-row">
              <input className="faff-remember-checkbox" id="login-remember" type="checkbox" defaultChecked />
              <label className="faff-remember-label" htmlFor="login-remember">Keep me signed in on this device</label>
            </div>

            <button className="faff-btn-submit" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in →'}
            </button>
          </form>

          <div className="faff-auth-divider">New here?</div>
          <div className="faff-auth-bottom">Don&apos;t have an account? <Link href="/signup">Sign up — free →</Link></div>
        </div>
      </div>
    </div>
  );
}
