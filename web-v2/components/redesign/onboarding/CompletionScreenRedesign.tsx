import Link from 'next/link';
import type { OnboardingState } from '@/lib/onboarding/state';
import { distanceLabel } from '@/lib/onboarding/state';
import { Poster } from '@/components/redesign/core/Poster';
import { Button } from '@/components/redesign/core/Button';

/**
 * components/redesign/onboarding/CompletionScreenRedesign.tsx
 *
 * Reskin of the live components/onboarding/CompletionScreen.tsx, using
 * the same Poster hero primitive as LandingHeroRedesign (state "done").
 *
 * HONESTY GAP — CLOSED 2026-08-19 (onboarding five-mode end-to-end QA).
 * This screen used to carry a hardcoded mini-poster ("Easy 4.0 · 8:45/mi ·
 * ~35m") ported from the live CompletionScreen.tsx, under the reasoning
 * that faithfully porting an already-disclosed placeholder beat silently
 * changing behaviour. The live screen dropped that block on 2026-08-18 —
 * it rendered on EVERY completion including coached mode (Faff authors
 * NOTHING) and the "just run" path (no plan at onboarding), which is the
 * fabricated-number failure mode the race-data-SoT doctrine forbids, just
 * for plans instead of race results. The port kept it, so
 * /redesign/onboarding?step=done was still the last place in the app that
 * invented a first workout. It now states what state the runner is
 * actually in, per mode, mirroring CompletionScreen.tsx exactly:
 *   · coached: no plan is authored, ever · Faff tracks the work
 *   · no race + no TT goal: no plan authored at onboarding · add a race
 *     or a goal from Today
 *   · everything else: a plan WAS seeded server-side · point at Today
 *     rather than invent its shape
 *
 * Reached only via a real completion redirect after step 3's POST
 * succeeds — this screen itself has no write. The five-mode QA run
 * (docs/onboarding-qa-2026-08-19.md) drove all five onboarding paths
 * against real accounts and confirmed each seeds exactly what the copy
 * below claims.
 */
export function CompletionScreenRedesign({ state }: { state: OnboardingState }) {
  const isCoached = state.distance === 'coached';
  // Mirrors /api/onboarding/complete's own branch: a race path, or a no-race
  // path carrying a TT goal, is the only case that seeds a plan. 'none' with
  // no TT goal authors nothing (`seedPlan = { ok: true, mode: 'none' }`).
  const isRace = state.distance != null && state.distance !== 'none' && state.distance !== 'coached';
  const planSeeded = isRace || Boolean(state.ttDistance);

  const tag = isCoached ? 'Faff is tracking' : planSeeded ? 'Your plan is built' : 'You\u2019re all set';
  const verb = isCoached ? 'You\u2019re set.' : planSeeded ? 'Day one.' : 'You\u2019re in.';
  const sub = isCoached
    ? 'Your coach owns the plan. Faff tracks the work \u2014 runs, readiness, health \u2014 and stays out of the prescriptions.'
    : !planSeeded
      ? 'No plan yet, and that\u2019s fine. Log runs your way, or add a race or goal from Today whenever you want one built.'
      : state.distance === 'none' || !state.date
        ? 'Your plan is building. Head to Today for day one.'
        : `${distanceLabel(state.distance)} plan around ${formatRaceDate(state.date)}. Head to Today for day one.`;

  const daysToRace = state.date && isRace ? daysUntil(state.date) : null;

  return (
    <Poster state="done" tag={tag} verb={verb} rx={sub} minHeight={480}>
      {/* The only number this screen may state is one the runner typed
          themselves. The first day's shape belongs to /today, once the
          resolver has actually run. */}
      {daysToRace != null && (
        <div style={{
          background: 'rgba(0,0,0,.28)', borderRadius: 'var(--radius-l)', padding: 'var(--sp-7)',
          marginTop: 'var(--sp-8)', maxWidth: 420,
        }}>
          <div className="faff-value" style={{ fontSize: 'var(--type-value-2)' }}>
            {daysToRace}<span style={{ fontSize: '.4em', opacity: 0.75, marginLeft: 3 }}>d</span>
          </div>
          <div style={{ fontSize: 'var(--type-label-s)', color: 'rgba(255,255,255,.74)', marginTop: 3 }}>To race</div>
        </div>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 'var(--sp-9)', maxWidth: 360 }}>
        <Link href="/today" style={{ textDecoration: 'none' }}>
          <Button variant="secondary" size="lg" full style={{ color: '#221503' }}>Go to Today</Button>
        </Link>
      </div>
    </Poster>
  );
}

function formatRaceDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function daysUntil(iso: string): number | null {
  const target = new Date(`${iso}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const ms = target.getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 86400000));
}
