import { Tile } from '@/components/redesign/core/Tile';
import { Stat } from '@/components/redesign/core/Stat';
import { Skeleton } from '@/components/redesign/feedback/Skeleton';
import { RangeScale } from '@/components/redesign/graphics/RangeScale';
import { CoachSay } from '@/components/redesign/coach/CoachSay';

/**
 * components/redesign/onboarding/OnboardingSidebar.tsx
 *
 * The right-hand column WebOnboarding.jsx / WebDayOne.jsx both render
 * beside the main card: "What you get" (goal-mode summary) / "Readiness"
 * / "Fitness" / a quiet coach line. Shared by every in-flow step (goal,
 * goal-details, signals, confirm) — landing and done have no sidebar in
 * either the mock or the live route.
 *
 * HONESTY NOTE: every tile here is a designed EMPTY/LOADING state, not a
 * fabricated number. This is not a shortcut — it's what the mock itself
 * does (WebOnboarding.jsx and WebDayOne.jsx both render Skeleton /
 * RangeScale state="loading" / Silence-style copy for these exact three
 * panels), because none of readiness, fitness (VDOT), or "this week" can
 * be honestly computed before the runner has an account and logged runs.
 * The copy strings below ("Needs 14 nights of sleep and HRV...", "Arrives
 * with your first hard effort", "Run three times and I will have
 * something worth saying") are the mock's own real copy, reused verbatim
 * — not invented for this port.
 */
export function OnboardingSidebar({ whatYouGet }: { whatYouGet: string }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <Tile>
        <div style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>What you get</div>
        <div style={{ fontSize: 'var(--type-say-3)', lineHeight: 'var(--lh-say-3)', marginTop: 'var(--sp-5)', textWrap: 'pretty' }}>
          {whatYouGet}
        </div>
      </Tile>
      <Tile>
        <div style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>Readiness</div>
        <Skeleton height={44} style={{ marginTop: 'var(--sp-6)' }} />
        <Skeleton height={8} radius="pill" style={{ marginTop: 'var(--sp-7)' }} />
        <div style={{ marginTop: 'var(--sp-5)', fontSize: 'var(--type-meta)', color: 'var(--text-quiet)' }}>
          Needs 14 nights of sleep and HRV before it means anything.
        </div>
      </Tile>
      <Tile>
        <Stat label="Fitness" sub="Arrives with your first hard effort" value="—" size="md" tone="quiet" />
        <RangeScale min={30} max={85} state="loading" endpoints={['30', '85']} />
      </Tile>
      <Tile tone="bare">
        <CoachSay size="sm" attribution="Coach">
          Nothing to judge yet. Run three times and I will have something worth saying.
        </CoachSay>
      </Tile>
    </div>
  );
}
