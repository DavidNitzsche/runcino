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
 * HONESTY GAP — ported, not introduced: the live CompletionScreen.tsx's
 * own file header already flags its "tomorrow" mini-poster (EASY 4.0 ·
 * 8:45/mi · ~35m) as a documented fudge: "We don't reach into the real
 * plan engine here... The 'first day' detail will lift from the resolver
 * once /today is opened." Per this session's honesty-gap discipline that
 * would normally mean dropping a fabricated stat — but this is not a
 * mock inventing a number the real app lacks; it's the REAL, currently
 * shipping production component's own known, already-documented
 * placeholder. Porting the visual layer of an existing, disclosed
 * limitation faithfully (and re-disclosing it here) is the correct call,
 * not silently "fixing" behavior nobody asked this task to change.
 *
 * Reached only via a real completion redirect after step 3's POST
 * succeeds — this screen itself has no write. Not live-verified in this
 * port (reaching it live requires firing the step-3 submit, which David's
 * explicit instruction rules out) — verified structurally by reading
 * CompletionScreen.tsx and matching its field usage 1:1.
 */
export function CompletionScreenRedesign({ state }: { state: OnboardingState }) {
  const sub = state.distance === 'none' || !state.date
    ? 'Your first day is ready.'
    : `${distanceLabel(state.distance)} plan around ${formatRaceDate(state.date)}. First day below — head to Today when you're ready.`;

  const tomorrow = computeTomorrow();
  const daysToRace = state.date ? daysUntil(state.date) : null;

  return (
    <Poster state="done" tag="Your plan is built" verb="Day one." rx={sub} minHeight={480}>
      <div style={{
        background: 'rgba(0,0,0,.28)', borderRadius: 'var(--radius-l)', padding: 'var(--sp-7)',
        marginTop: 'var(--sp-8)', maxWidth: 420,
      }}>
        <div style={{ fontSize: 'var(--type-label-s)', color: 'rgba(255,255,255,.7)' }}>
          Tomorrow · {tomorrow.weekday} · {tomorrow.dateLabel}
        </div>
        <div className="faff-display" style={{ fontSize: 'var(--type-display-3)', marginTop: 'var(--sp-4)' }}>Easy 4.0.</div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 'var(--sp-7)',
          marginTop: 'var(--sp-7)', paddingTop: 'var(--sp-7)', borderTop: '1px solid rgba(255,255,255,.15)',
        }}>
          <MiniStat value="8:45" unit="/mi" label="Pace" />
          <MiniStat value="~35m" label="Est. time" />
          {daysToRace != null ? <MiniStat value={`${daysToRace}d`} label="To race" /> : <MiniStat value="—" label="Weekly" />}
        </div>
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 'var(--sp-9)', maxWidth: 360 }}>
        <Link href="/today" style={{ textDecoration: 'none' }}>
          <Button variant="secondary" size="lg" full style={{ color: '#221503' }}>Go to Today</Button>
        </Link>
      </div>
    </Poster>
  );
}

function MiniStat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div>
      <div className="faff-value" style={{ fontSize: 'var(--type-value-2)' }}>
        {value}{unit && <span style={{ fontSize: '.4em', opacity: 0.75, marginLeft: 3 }}>{unit}</span>}
      </div>
      <div style={{ fontSize: 'var(--type-label-s)', color: 'rgba(255,255,255,.74)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

function computeTomorrow(): { weekday: string; dateLabel: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    dateLabel: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  };
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
