import '../../redesign/styles.css';
import { redirect } from 'next/navigation';
import { userIdFromCookies } from '@/lib/auth/session';
import { LogSheetClient } from '@/components/redesign/log/LogSheetClient';

export const dynamic = 'force-dynamic';

/**
 * app/runs/new/page.tsx
 *
 * 2026-08-18 · Live cutover — canonical route for the Log a run sheet,
 * replacing the /redesign/log address Rail's "Log a run" button used to
 * push to. Named /runs/new (not /log — that path is now the live Activity
 * screen) so it sits naturally alongside /runs/[id]. Chrome-free, no Rail
 * — a Level-3 sheet per the design brief, same posture as its
 * /redesign/log counterpart. Mirrors app/redesign/log/page.tsx exactly:
 * same auth gate (blank form, no seed read — the only real data traffic
 * is the client-side POST to /api/run/manual on save), same
 * LogSheetClient.close() → router.back() behavior.
 */
export default async function LogNewRunPage() {
  const userId = await userIdFromCookies();
  if (!userId) return redirect('/login');

  return (
    <div className="redesign-root" data-theme="light">
      <LogSheetClient />
    </div>
  );
}
