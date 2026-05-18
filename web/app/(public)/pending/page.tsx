/**
 * /pending — waiting-room page for users whose account is `pending`
 * (or `denied`). Signed-in but gated out of the app.
 *
 * Active users that wander here get bounced to /overview. Signed-out
 * users get bounced to /login (signup is the entry point to pending).
 *
 * The page is intentionally low-pressure — no countdown, no spammy
 * refresh — just "we'll let you in soon." If they refresh after admin
 * approves them, requireActiveUser() will pass and they land on /overview.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { SignOutLink } from './SignOutLink';
import '../public.css';

export const dynamic = 'force-dynamic';

export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.status === 'active') redirect('/overview');

  const isDenied = user.status === 'denied';

  return (
    <div className="faff-public-body">
      <nav className="faff-pub-nav">
        <div className="faff-pub-nav-inner">
          <Link className="faff-logo" href="/landing">faff.run</Link>
          <SignOutLink className="faff-nav-back" />
        </div>
      </nav>

      <div className="faff-auth-wrap">
        <div className="faff-auth-card" style={{ textAlign: 'center' }}>
          <div className="faff-eyebrow">{isDenied ? 'Access declined' : 'Private beta'}</div>
          {isDenied ? (
            <>
              <h1 className="faff-auth-title">Request declined</h1>
              <p className="faff-auth-sub">
                Your access request wasn&rsquo;t approved this round. If you think
                this is a mistake, reach out to the team directly.
              </p>
            </>
          ) : (
            <>
              <h1 className="faff-auth-title">You&rsquo;re on the list</h1>
              <p className="faff-auth-sub">
                faff.run is in private beta. We&rsquo;ll review your account shortly
                &mdash; once approved, refresh this page and you&rsquo;re in.
              </p>
              <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: 'rgba(13,15,18,.55)', marginTop: 18 }}>
                Signed in as <strong>{user.email}</strong>
              </p>
            </>
          )}
          <div style={{ marginTop: 28 }}>
            <Link href="/landing" className="faff-btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
