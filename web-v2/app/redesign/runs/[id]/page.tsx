import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { userIdFromCookies } from '@/lib/auth/session';
import { loadRunDetail } from '@/lib/coach/run-state';
import { RunDetailClient, type RecapPayload } from '@/components/redesign/runs/RunDetailClient';

export const dynamic = 'force-dynamic';

/**
 * app/redesign/runs/[id]/page.tsx
 *
 * The redesigned Run Detail screen. Same real data path as the live
 * /runs/[id] route — no new data loader:
 *
 *   · lib/coach/run-state.ts#loadRunDetail(userId, id) — called directly,
 *     server-side, for the run itself (pace/HR/splits/elevation/cadence/
 *     weather/shoe/terrain). The live /runs/[id] route instead mounts the
 *     Shell + RunDetailModal client-fetch loop (fetch('/api/runs/[id]'));
 *     that indirection exists so the modal can also open from /today and
 *     the activity heatmap. This route only ever renders the standalone
 *     page, so calling the loader directly is the more direct equivalent
 *     — same function, one fewer network round trip.
 *
 *   · GET /api/runs/[id]/recap (lib/coach/run-recap.ts#deriveRecap) — kept
 *     as an HTTP call rather than re-deriving RecapInput inline. The route
 *     assembles maybe 150 lines of plan-vs-actual reconciliation (frozen
 *     watch-completion targets, work-phase weighting, finish-segment
 *     matching, voice-band, terrain) before calling deriveRecap; that
 *     assembly is exactly the kind of real logic this task must reuse,
 *     not reimplement. Cookies are forwarded so the call authenticates as
 *     the same signed-in runner.
 */
export default async function RedesignRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  // 2026-08-18 · Next 15's dynamic-segment param is NOT decoded when the
  // segment carries a `%23` ('#') — confirmed by inspecting the raw param
  // server-side: it arrives as the literal string "...2026-08-09%230613"
  // instead of "...2026-08-09#0613". Real run ids commonly carry a literal
  // '#' (the watch-sync "YYYY-MM-DD#HHmm" session-start suffix documented
  // in lib/coach/run-state.ts's loadPhaseBreakdown) — undecoded, the id
  // never matches loadRunDetail's lookup and every such run 404s. The same
  // gap exists on the live /runs/[id] + RunDetailModal fetch path (verified
  // against this same dev server); out of scope to touch here, so this is
  // a local, defensive decode scoped to this new route only.
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
    // Recap is a value-add, not a hard dependency — the page still renders
    // real run data (pace/HR/splits/etc.) with no coach verdict when this
    // fails, same graceful-degrade RunDetailModal already relies on.
    return null;
  }
}
