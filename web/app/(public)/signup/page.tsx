'use client';

/**
 * /signup — email + password signup form.
 *
 * On submit: POST /api/auth/signup → if success, cookie is set + we
 * navigate to /onboarding. Errors render inline.
 *
 * Live password rules (8+, uppercase, number, symbol) update as user
 * types. Server enforces 8+ minimum independently.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import '../public.css';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);

  const checks = {
    length: password.length >= 8,
    upper:  /[A-Z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!checks.length) { setError('Password must be at least 8 characters'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Signup failed');
        setBusy(false);
        return;
      }
      router.push('/onboarding');
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
          <div className="faff-eyebrow">Sign up</div>
          <h1 className="faff-auth-title">Create your account</h1>
          <p className="faff-auth-sub">Free forever. No credit card. Onboarding takes under 2 minutes.</p>

          <form onSubmit={onSubmit} autoComplete="off">
            {error && <div className="faff-form-error">{error}</div>}

            <div className="faff-form-row">
              <label className="faff-form-label" htmlFor="signup-name">Name</label>
              <input className="faff-form-input" id="signup-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="faff-form-row">
              <label className="faff-form-label" htmlFor="signup-email">Email</label>
              <input className="faff-form-input" id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <div className="faff-form-row">
              <label className="faff-form-label" htmlFor="signup-password">Password</label>
              <div className="faff-password-wrap">
                <input
                  className="faff-form-input"
                  id="signup-password"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <button type="button" className="faff-password-toggle" onClick={() => setShowPwd((v) => !v)}>
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="faff-password-rules">
                <div className={`faff-password-rule ${checks.length ? 'met' : ''}`}>8+ characters</div>
                <div className={`faff-password-rule ${checks.upper  ? 'met' : ''}`}>Uppercase letter</div>
                <div className={`faff-password-rule ${checks.number ? 'met' : ''}`}>Number</div>
                <div className={`faff-password-rule ${checks.symbol ? 'met' : ''}`}>Symbol</div>
              </div>
            </div>

            <button className="faff-btn-submit" type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create account →'}
            </button>

            <div className="faff-auth-meta">
              By signing up you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.
            </div>
          </form>

          <div className="faff-auth-divider">Already a member?</div>
          <div className="faff-auth-bottom">Have an account? <Link href="/login">Sign in →</Link></div>
        </div>
      </div>
    </div>
  );
}
