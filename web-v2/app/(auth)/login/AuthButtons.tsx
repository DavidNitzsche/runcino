'use client';

/**
 * AuthButtons · Client island of the /login Server Component.
 *
 * Apple is the only working path · the button bootstraps Apple's web
 * JS SDK lazily (so the static HTML stays light), calls AppleID.auth
 * signIn, and POSTs the identity token to /api/auth/apple. On success
 * the server sets the faff_session cookie and the client navigates to
 * /today (or /onboarding if the runner hasn't claimed an account yet).
 *
 * Google + email are visual-fidelity placeholders. onClick fires a
 * "Coming soon" toast so the buttons feel polished instead of broken,
 * but no fetch is issued and no new auth routes get built in this PR.
 * Future work owns wiring those two paths.
 */
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Phase = 'idle' | 'apple-loading' | 'apple-signing' | 'apple-error' | 'apple-ok' | 'email-form' | 'email-signing' | 'email-error' | 'email-ok';

declare global {
  interface Window {
    AppleID?: {
      auth: {
        init: (opts: {
          clientId: string;
          scope?: string;
          redirectURI: string;
          state?: string;
          usePopup?: boolean;
        }) => void;
        signIn: () => Promise<{
          authorization: { code: string; id_token: string; state?: string };
          user?: { email?: string; name?: { firstName?: string; lastName?: string } };
        }>;
      };
    };
  }
}

const APPLE_SDK_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

export function AuthButtons({ appleClientId, redirectUri }: { appleClientId: string | null; redirectUri: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  async function ensureAppleSdk(): Promise<NonNullable<typeof window.AppleID>> {
    if (typeof window === 'undefined') throw new Error('window unavailable');
    if (window.AppleID) return window.AppleID;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${APPLE_SDK_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('apple sdk failed to load')), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = APPLE_SDK_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('apple sdk failed to load'));
      document.head.appendChild(s);
    });
    if (!window.AppleID) throw new Error('AppleID global missing after script load');
    return window.AppleID;
  }

  async function onAppleClick() {
    if (!appleClientId) {
      showToast('Apple sign-in is not configured for this environment.');
      return;
    }
    setErrorMsg(null);
    setPhase('apple-loading');
    let AppleID: NonNullable<typeof window.AppleID>;
    try {
      AppleID = await ensureAppleSdk();
    } catch (e) {
      setPhase('apple-error');
      setErrorMsg(e instanceof Error ? e.message : 'apple sdk error');
      return;
    }
    try {
      AppleID.auth.init({
        clientId: appleClientId,
        scope: 'name email',
        redirectURI: redirectUri,
        usePopup: true,
      });
    } catch (e) {
      setPhase('apple-error');
      setErrorMsg(e instanceof Error ? e.message : 'apple init failed');
      return;
    }

    setPhase('apple-signing');
    let response: Awaited<ReturnType<typeof AppleID.auth.signIn>>;
    try {
      response = await AppleID.auth.signIn();
    } catch (e) {
      // User cancelled or popup blocked.
      setPhase('idle');
      setErrorMsg(null);
      return;
    }

    const idToken = response?.authorization?.id_token;
    if (!idToken) {
      setPhase('apple-error');
      setErrorMsg('apple returned no identity token');
      return;
    }

    let server: Response;
    try {
      server = await fetch('/api/auth/apple', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          identity_token: idToken,
          // server falls back to claims.sub when user is missing · safe to omit.
          email: response.user?.email ?? null,
          full_name: response.user?.name
            ? {
                givenName: response.user.name.firstName ?? '',
                familyName: response.user.name.lastName ?? '',
              }
            : undefined,
        }),
      });
    } catch (e) {
      setPhase('apple-error');
      setErrorMsg(e instanceof Error ? e.message : 'network error');
      return;
    }

    if (!server.ok) {
      const body = await server.json().catch(() => ({} as { error?: string }));
      setPhase('apple-error');
      setErrorMsg(body.error ?? `sign-in failed (HTTP ${server.status})`);
      return;
    }

    setPhase('apple-ok');
    // Server already set the faff_session cookie · navigate.
    router.replace('/today');
    router.refresh();
  }

  function onDeferred(kind: 'google') {
    showToast('Coming soon · use Continue with Apple or email for now.');
    void kind;
  }

  function onEmailClick() {
    setErrorMsg(null);
    setPhase('email-form');
  }

  async function onEmailSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const email = String(fd.get('email') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    if (!email || !password) { setErrorMsg('Enter your email and password.'); return; }
    setErrorMsg(null);
    setPhase('email-signing');
    let server: Response;
    try {
      server = await fetch('/api/auth/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch (err) {
      setPhase('email-error');
      setErrorMsg(err instanceof Error ? err.message : 'network error');
      return;
    }
    if (!server.ok) {
      const body = await server.json().catch(() => ({} as { error?: string }));
      setPhase('email-error');
      setErrorMsg(body.error ?? `sign-in failed (HTTP ${server.status})`);
      return;
    }
    let parsed: { ok?: boolean; redirect?: string } = {};
    try { parsed = await server.json(); } catch {}
    setPhase('email-ok');
    router.replace(parsed.redirect ?? '/today');
    router.refresh();
  }

  const busy = phase === 'apple-loading' || phase === 'apple-signing';
  const appleLabel = phase === 'apple-loading' ? 'Loading…'
    : phase === 'apple-signing' ? 'Signing in…'
    : phase === 'apple-ok' ? 'Signed in'
    : 'Continue with Apple';

  return (
    <>
      <div className="auth">
        <button
          className="gbtn apple"
          type="button"
          data-test="signin-apple"
          disabled={busy}
          onClick={onAppleClick}
        >
          <svg viewBox="0 0 24 24" fill="#0b0b0b" aria-hidden="true">
            <path d="M16.4 12.8c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.8.8-3.5 2.1-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.5 2.2 2.6 2.1 1-.04 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.66 1.1-.02 1.8-1 2.5-2 .8-1.2 1.1-2.3 1.1-2.3-.02-.01-2.1-.8-2.1-3.2zM14.2 6.3c.6-.7 1-1.7.9-2.7-.85.04-1.9.57-2.5 1.27-.55.62-1 1.6-.9 2.6.95.07 1.9-.48 2.5-1.17z"/>
          </svg>
          {appleLabel}
        </button>
        <button
          className="gbtn google"
          type="button"
          data-test="signin-google"
          onClick={() => onDeferred('google')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#fff" d="M21.8 12.2c0-.7-.06-1.2-.18-1.8H12v3.3h5.6c-.1.9-.7 2.3-2 3.2l-.02.12 2.9 2.2.2.02c1.85-1.7 2.9-4.2 2.9-7.1z"/>
            <path fill="#fff" d="M12 22c2.6 0 4.8-.86 6.4-2.34l-3.05-2.36c-.8.56-1.9.96-3.35.96-2.56 0-4.73-1.7-5.5-4.04l-.11.01-3 2.3-.04.1C5 19.9 8.24 22 12 22z" opacity=".8"/>
            <path fill="#fff" d="M6.5 14.2c-.2-.6-.32-1.2-.32-1.9s.12-1.3.3-1.9l-.01-.13-3.04-2.36-.1.05A10 10 0 002 12.3c0 1.6.39 3.1 1.07 4.4l3.43-2.5z" opacity=".6"/>
            <path fill="#fff" d="M12 6.4c1.8 0 3 .78 3.7 1.43l2.7-2.64C16.8 3.7 14.6 2.8 12 2.8 8.24 2.8 5 4.9 3.43 7.9l3.42 2.5C7.27 8.1 9.44 6.4 12 6.4z" opacity=".9"/>
          </svg>
          Continue with Google
        </button>
      </div>

      <div className="auth-or">OR</div>

      {phase === 'email-form' || phase === 'email-signing' || phase === 'email-error' ? (
        <form className="email-form" onSubmit={onEmailSubmit} data-test="signin-email-form">
          <input className="email-input" name="email" type="email" placeholder="Email" autoComplete="email" required autoFocus />
          <input className="email-input" name="password" type="password" placeholder="Password" autoComplete="current-password" required minLength={6} />
          <button type="submit" className="gbtn email-submit" disabled={phase === 'email-signing'}>
            {phase === 'email-signing' ? 'Signing in…' : 'Sign in'}
          </button>
          <button type="button" className="email-cancel" onClick={() => { setPhase('idle'); setErrorMsg(null); }}>
            Cancel
          </button>
        </form>
      ) : (
        <button className="gbtn email" type="button" data-test="signin-email" onClick={onEmailClick}>
          Sign in with email
        </button>
      )}

      <div className="gfine">
        By continuing you agree to Faff&rsquo;s <u>Terms</u> &amp; <u>Privacy Policy</u>.
      </div>

      {errorMsg ? (
        <div role="alert" className="auth-error">
          {errorMsg}
        </div>
      ) : null}

      {toast ? (
        <div role="status" className="auth-toast">{toast}</div>
      ) : null}
    </>
  );
}
