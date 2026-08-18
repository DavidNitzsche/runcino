import { redirect } from 'next/navigation';
import { userIdFromCookies } from '@/lib/auth/session';
import { LogSheetClient } from '@/components/redesign/log/LogSheetClient';

export const dynamic = 'force-dynamic';

/**
 * app/redesign/log/page.tsx
 *
 * The redesigned Log Sheet screen — reached to manually log a run that
 * wasn't auto-captured by Strava/watch. Unlike Today/Run Detail/Activity/
 * Block, this route has no server-side read: the form starts blank (today's
 * date, no distance/duration/note yet) and the only real data traffic is
 * the client-side POST to /api/run/manual on save (see
 * components/redesign/log/LogSheetClient.tsx for the write path and the
 * honesty-gap notes against that route's actual accepted body).
 *
 * Still auth-gated server-side, same as every other /redesign/** route —
 * userIdFromCookies() + redirect('/login') mirrors app/redesign/runs/[id]/
 * page.tsx exactly. There is no per-user data to scope here (the form is
 * blank until submit), but an unauthenticated visitor should never even
 * see a working "save a run" form — the POST would just 401 anyway, but
 * failing at the page is the honest result rather than a form that always
 * errors on submit.
 *
 * Sheet.tsx's own header notes these level-3 screens are meant to mount
 * over whatever surface was already showing, "never a route" on their
 * own — true for how Gear/Settings/CoachReply/RunAction will eventually be
 * reached (a button on Today/Run Detail pushing sheet state). Log is a
 * genuine write action reached from elsewhere in the real app, not a page
 * someone deep-links to for its own sake, so per this task's brief it gets
 * a real route (`/redesign/log`) that renders the same Sheet shell
 * standalone — consistent with how this batch's other screens are each a
 * real page backed by real data, and enough to open, inspect and verify
 * the screen on its own during this port. LogSheetClient's `close()`
 * calls `router.back()`, so from a real entry point (e.g. a future "Log a
 * run" button on Today) closing returns to wherever the sheet was opened
 * from, exactly like the design intends.
 */
export default async function RedesignLogPage() {
  const userId = await userIdFromCookies();
  if (!userId) return redirect('/login');

  return (
    <div className="redesign-root" data-theme="light">
      <LogSheetClient />
    </div>
  );
}
