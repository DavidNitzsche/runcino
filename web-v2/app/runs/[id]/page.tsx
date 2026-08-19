import '../../redesign/styles.css';
import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { userIdFromCookies } from '@/lib/auth/session';
import { loadRunDetail } from '@/lib/coach/run-state';
import { RunDetailClient, type RecapPayload } from '@/components/redesign/runs/RunDetailClient';

export const dynamic = 'force-dynamic';

/**
 * app/runs/[id]/page.tsx
 *
 * 2026-08-18 · Live cutover — this route now renders the redesigned Run
 * Detail screen directly (previously mounted Shell + RunDetailModal via
 * autoOpenRunId). Mirrors app/redesign/runs/[id]/page.tsx exactly,
 * including its already-fixed Next-15 '#'-in-dynamic-segment decode
 * (real watch-sync run ids carry a literal '#HHmm' suffix) — the old
 * Shell/RunDetailModal path had this same bug and is now retired from
 * this route entirely, so the bug is gone here as a side effect of the
 * cutover, not a separate fix. Chrome-free (no Rail) — Run Detail is a
 * Level-2 detail page per the design brief.
 */
export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = (() => {
    try { return decodeURIComponent(rawId); } catch { return rawId; }
  })();
  const userId = await userIdFromCookies();
  if (!userId) return redirect('/login');

  const detail = await loadRunDetail(userId, id);
  const recap = detail ? await fetchRecap(id) : null;

  return (
    <div className="redesign-root" data-theme="light">
      <RunDetailClient detail={detail} recap={recap} runId={id} />
    </div>
  );
}

async function fetchRecap(id: string): Promise<RecapPayload | null> {
  try {
    const h = await headers();
    const host = h.get('host');
    const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https');
    if (!host) return null;
    const cookieHeader = (await cookies()).toString();
    const res = await fetch(`${proto}://${host}/api/runs/${encodeURIComponent(id)}/recap`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || j.ok !== true) return null;
    return {
      verdict: j.verdict,
      facts: j.facts ?? [],
      coach_tip: j.coach_tip ?? null,
      conditions_note: j.conditions_note ?? null,
    };
  } catch {
    return null;
  }
}
