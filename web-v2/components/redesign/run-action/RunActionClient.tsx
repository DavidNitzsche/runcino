'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed } from '@/components/faff-app/types';
import { computeWeekMileage } from '@/lib/faff/week-mileage';
import { Sheet } from '@/components/redesign/feedback/Sheet';
import { Dialog } from '@/components/redesign/feedback/Dialog';
import { Badge } from '@/components/redesign/core/Badge';
import { Button } from '@/components/redesign/core/Button';
import { SegmentBar } from '@/components/redesign/nav/SegmentBar';

/**
 * components/redesign/run-action/RunActionClient.tsx
 *
 * The redesigned "skip or move today's run" sheet. Structurally ported
 * from the outside-studio handoff's WebRunAction.jsx (designs/design-
 * review-0818/ui_kits/web/WebRunAction.jsx) — same Badge / Button /
 * SegmentBar / Dialog composition inside the shared Sheet shell.
 *
 * The mock's specific scenario text ("Friday's easy 5 moves to
 * tomorrow...", "This week closes at 38 of 44 mi...") was fabricated for
 * the handoff deck. This port replaces every one of those sentences with
 * copy computed from the SAME real seed the live /today route and the
 * live faff-app skip/move UI (components/faff-app/views/TodayView.tsx,
 * shipped 2026-06-26) already use:
 *
 *   - today's workout    → seed.week[seed.todayIdx]
 *   - move candidates    → seed.week days from today forward (mirrors
 *     TodayView.tsx's moveTargets — same filter, same day fields)
 *   - week total         → computeWeekMileage over seed.season.weekDays
 *     [seed.season.nowIdx], the exact same call TodayClient.tsx makes for
 *     the "X of Y mi this week" tile, so this sheet and the Today page
 *     never disagree about what the week totals.
 *   - next big session   → seed.week, same lookahead TodayClient.tsx
 *     uses for its "Next up" row (Ctx label="Next up")
 *
 * Real write paths (unchanged endpoints — see the task report for how
 * the write path was verified WITHOUT firing a mutation against the
 * real plan):
 *   - move  → POST /api/today/reschedule { from_date, to_date, replace }
 *   - skip  → POST /api/today/skip { date }
 *
 * Honesty note on the skip confirmation copy: the mock's Dialog claims a
 * new, lower week total ("closes at 38 of 44 mi"). The real POST
 * /api/today/skip handler only inserts a day_actions row — it never
 * mutates plan_workouts, so the week's planned total is UNCHANGED by a
 * skip (confirmed by reading the route + computeWeekMileage, which sums
 * every day's plannedMi regardless of skip state). The live TodayView.tsx
 * skip copy reflects this too ("the plan keeps your weekly volume on
 * track"). This port states the real, unchanged total rather than
 * inventing a recomputed one.
 */

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
  letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
};
const bodyStyle: CSSProperties = {
  fontSize: 'var(--type-body-s)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body-s)', marginTop: 'var(--sp-6)',
};

export function RunActionClient({ seed }: { seed: FaffSeed }) {
  const router = useRouter();
  const today = seed.week[seed.todayIdx];
  const isRest = today?.type === 'rest';
  const isDone = !!today?.done;
  const distMi = today && today.dist && today.dist.trim() !== '·' ? today.dist : null;
  const hasRealRun = !!today && !isRest && !!distMi;

  // Same source + same call as TodayClient.tsx's "X of Y mi this week"
  // tile — one definition of the week's total, not a second invented one.
  const weekDaysForMileage = seed.season.weekDays?.[seed.season.nowIdx] ?? [];
  const weekMileage = computeWeekMileage(
    weekDaysForMileage.map((w) => ({ dateISO: w.date ?? null, plannedMi: w.mi, doneMi: w.doneMi ?? 0, type: w.type })),
    { todayISO: seed.todayISO },
  );

  // Candidate move-to days · mirrors TodayView.tsx's moveTargets exactly
  // (this week's days from today forward, minus today itself).
  const moveTargets = today?.iso
    ? seed.week
        .filter((w) => w.iso && w.iso !== today.iso && w.iso >= seed.todayISO)
        .map((w) => {
          const distNum = parseFloat(w.dist || '0') || 0;
          const hasRun = w.type !== 'rest' && distNum > 0;
          const label = w.name || titleCase(w.type);
          return {
            iso: w.iso as string,
            dw: titleCase(w.dw),
            dn: w.dn,
            hasRun,
            runLabel: hasRun ? `${label} · ${distNum} mi` : 'Rest',
          };
        })
    : [];

  const [moveTo, setMoveTo] = useState<string | null>(moveTargets[0]?.iso ?? null);
  const [skipping, setSkipping] = useState(false);
  const [busy, setBusy] = useState(false);

  function close() {
    router.push('/today');
  }

  // Nothing real to skip or move: today is a rest day, or today's run is
  // already logged. State-driven, not a template that always shows the
  // same two actions regardless of what's actually true today.
  if (!today || !hasRealRun || isDone) {
    return (
      <Sheet title="Skip or move" kicker="Today" onClose={close}>
        <div style={{ fontSize: 'var(--type-body)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)' }}>
          {isDone
            ? "Today's run is already logged — nothing to skip or move."
            : "Today is a rest day. There's nothing on the plan to skip or move."}
        </div>
      </Sheet>
    );
  }

  const typeLabel = today.name || titleCase(today.type);
  const target = moveTargets.find((t) => t.iso === moveTo) ?? null;

  // Same lookahead TodayClient.tsx uses for its "Next up" row.
  const nextBig = seed.week
    .slice(seed.todayIdx + 1)
    .find((d) => d.type === 'long' || d.type === 'race' || d.type === 'tempo' || d.type === 'intervals');
  const nextBigLabel = nextBig ? `${titleCase(nextBig.dw)}'s ${nextBig.name || titleCase(nextBig.type)}` : null;

  async function doMove() {
    if (!target || busy) return;
    setBusy(true);
    try {
      const send = (replace: boolean) => fetch('/api/today/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_date: today!.iso, to_date: target.iso, replace }),
      });
      const r = await send(target.hasRun);
      const j = await r.json().catch(() => ({}));
      if (r.ok && (j as { conflict?: boolean }).conflict && !target.hasRun) {
        // Stale seed: the target actually already has a run. Mirrors
        // TodayView.tsx's doMove — confirm, then replace.
        if (!window.confirm('There is already a run on that day. Replace it?')) { setBusy(false); return; }
        await send(true);
      }
      close();
    } finally {
      setBusy(false);
    }
  }

  async function doSkip() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/today/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today!.iso }),
      });
      setSkipping(false);
      close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Skip or move"
      kicker={`Today · ${typeLabel} · ${distMi} mi`}
      onClose={close}
      footer={target ? (
        <Button variant="primary" onClick={doMove} disabled={busy}>
          Move to {target.dw} {target.dn}
        </Button>
      ) : undefined}
    >
      {moveTargets.length > 0 && (
        <div>
          <div style={{ ...labelStyle, marginBottom: 'var(--sp-6)' }}>Move to another day</div>
          <SegmentBar
            value={moveTo ?? undefined}
            onChange={setMoveTo}
            options={moveTargets.map((t) => ({ value: t.iso, label: `${t.dw} ${t.dn}` }))}
          />
          {target && (
            <div style={bodyStyle}>
              {target.hasRun
                ? `${target.dw} already carries ${target.runLabel}. Moving today's run there will ask to replace it — the week still totals ${weekMileage.plannedMi} mi either way.`
                : `${target.dw} is a rest day. The dose moves there unchanged — the week still totals ${weekMileage.plannedMi} mi.`}
            </div>
          )}
        </div>
      )}

      <div style={{ boxShadow: 'inset 0 1px 0 var(--rule-light)', paddingTop: 'var(--sp-8)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={labelStyle}>Skip instead</div>
          <Badge tone="quiet">Not made up</Badge>
        </div>
        <div style={bodyStyle}>
          The {distMi} mi drops from this week rather than move.{nextBigLabel ? ` ${nextBigLabel} is unaffected either way.` : ''}
        </div>
        <Button variant="destructive" full style={{ marginTop: 'var(--sp-7)' }} onClick={() => setSkipping(true)}>
          Skip today's run
        </Button>
      </div>

      {skipping && (
        <Dialog
          open
          title="Skip today's run?"
          destructive
          confirmLabel="Skip it"
          cancelLabel="Keep it on the plan"
          onCancel={() => setSkipping(false)}
          onConfirm={doSkip}
        >
          {distMi} mi won&apos;t run today. The plan&apos;s weekly total stays {weekMileage.plannedMi} mi — nothing here needs to be made up.{nextBigLabel ? ` ${nextBigLabel} is unaffected either way.` : ''}
        </Dialog>
      )}
    </Sheet>
  );
}
