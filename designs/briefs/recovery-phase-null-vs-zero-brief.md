# Brief · recovery-phase · null vs zero data hygiene

**For:** backend / coach-engine
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Frontend defensive patch shipped · backend fix needed

---

## TL;DR

`lib/coach/recovery-phase.ts` defaults `pctRecovered` to **0 (zero)**
when measurement data is missing, instead of **null (no data)**.
Downstream this produces the self-contradicting card David flagged:

> Sunday's 12mi long run
> 0%  · Day 2 of 2 expected
> HRV 0% back · RHR 0% back · SLEEP 0% back · HR RECOVERY 0% back · WRIST TEMP 0% back · RESP RATE 0% back
> Form metrics on subsequent easy runs are within normal range · muscle recovery on track.
> Earliest quality session: 2026-06-02 · Body is **0% recovered · ready for the next quality session.**

Zero is being treated as a measurement when it's actually "we don't
know yet."

---

## Root cause · two related bugs

### Bug 1 · pillar `pctRecovered` defaults to 0 when data is missing

`web-v2/lib/coach/recovery-phase.ts:271`:

```ts
let pctRecovered = 0;
if (baseline != null && day0 != null && current != null) {
  // proper recovery math
} else if (baseline != null && current != null && day0 == null) {
  // shorter fallback
}
// else pctRecovered stays at 0
```

A pillar needs 3 measurements:
- `baseline` · 28-day avg BEFORE the anchor session
- `day0` · the anchor day's reading
- `current` · today's reading

For runners who don't wear their watch overnight on the anchor day
(common: long runs often end mid-morning, runner takes the watch off
for a shower / sleeps without it that night), `day0` is null. Same
for today if the watch hasn't synced. The result: 0% back for
"haven't recovered" when it should be "no comparison data."

### Bug 2 · green-light copy contradicts itself on time-based fallback

`web-v2/lib/coach/recovery-phase.ts:408`:

```ts
if (percentRecovered >= 80 || daysSince >= expDays) {
  daysOut = 0;
  reason = `Body is ${percentRecovered}% recovered · ready for the next quality session.`;
}
```

The `|| daysSince >= expDays` clause says "ready" when elapsed days
≥ expected days, regardless of actual recovery %. Combined with bug 1,
this produces "0% recovered · ready" — claiming both that the body is
fully un-recovered AND ready to push.

---

## What we want

### Option A · null indicator on pctRecovered (clean, breaks shape)

```ts
pillars: Array<{
  key: 'hrv' | 'rhr' | 'sleep' | 'hr_recovery' | 'wrist_temp' | 'resp_rate';
  label: string;
  day0Value: number | null;
  currentValue: number | null;
  baselineValue: number | null;
  pctRecovered: number | null;   // ← was number, now nullable
}>
```

`null` when any of baseline/day0/current is null. Aggregate
`percentRecovered` excludes null pillars when averaging; if ALL
pillars are null, the aggregate is also null.

### Option B · keep number, add a coverage flag (back-compatible)

```ts
pillars: Array<{
  ...existing fields,
  hasComparisonData: boolean;    // false when any of baseline/day0/current is null
}>;
percentRecovered: number;
percentRecoveredCoverage: number;  // 0..1 · fraction of pillars with data
```

Frontend can use `hasComparisonData` to render "no data" for the
pillar, and `percentRecoveredCoverage` to gate the aggregate copy.

### Option C · explicit "insufficient_data" state on the envelope (cleanest UX)

```ts
recoveryPhase: {
  ...existing fields,
  /** When fewer than 2 pillars have comparison data, this is true.
   *  Frontend renders the card with "syncing" framing instead of
   *  the "X% recovered" copy. */
  dataInsufficient: boolean;
  /** When dataInsufficient is true, this is null (don't render). */
  percentRecovered: number | null;
  nextQualityGreenLight: {
    date: string;
    daysOut: number;
    reason: string;
  } | null;
}
```

The card still renders (anchor session is real data, expected days
is real data) but the recovery-progress claims are absent when the
underlying measurements aren't there.

### Green-light copy fix (regardless of which option above)

The `|| daysSince >= expDays` branch should NOT recycle the same
"Body is X% recovered · ready" template when X is meaningfully low.
Suggested:

```ts
if (percentRecovered >= 80) {
  reason = `Body is ${percentRecovered}% recovered · ready for the next quality session.`;
} else if (daysSince >= expDays && percentRecovered >= 50) {
  reason = `Past expected recovery window · body ${percentRecovered}% back · resume on feel.`;
} else if (daysSince >= expDays) {
  // data-insufficient or genuinely behind · don't claim "ready"
  reason = `Past expected recovery window · resume on feel.`;
} else {
  reason = `${percentRecovered}% recovered · projected green light in ~${daysOut} day${daysOut === 1 ? '' : 's'}.`;
}
```

---

## Frontend defensive patch shipped today

Until backend lands the fix, the frontend detects the
data-insufficient state heuristically:

```ts
const allPillarsZero = rp.pillars.every(p => p.pctRecovered === 0);
const allPillarsNoData = rp.pillars.every(p =>
  p.day0Value == null || p.currentValue == null
);
const dataInsufficient = allPillarsZero && allPillarsNoData;
```

When `dataInsufficient`, the card renders:
- Aggregate pct as `·` instead of `0%`
- Bar empty
- Per-pillar "no data" instead of "0% back"
- Green-light copy: "Recovery tracking awaiting watch sync · pillar measurements not in yet."

Anchor session and "Day N of M expected" still render (they're real
data). The misleading recovery claims disappear.

The patch is a stopgap. Backend should own the null-vs-zero
distinction.

---

## Priority

Medium · the card was rendering misleading copy that contradicts
itself ("0% recovered · ready"), which is worse than rendering
nothing. The frontend stopgap fixes the worst of it, but backend
owning the null indicator is the right long-term shape.

---

## Files

- `web-v2/lib/coach/recovery-phase.ts` · `loadPillarRecovery` (line 271
  default) + `computeNextQualityGreenLight` (line 408 contradictory copy)
- `web-v2/components/faff-app/types.ts` · RecoveryPhase pillar shape
- `web-v2/components/faff-app/views/HealthView.tsx` · the defensive patch

---

## How to respond

1. Pick Option A / B / C above and ship.
2. Drop the frontend defensive patch once shape is honest.
3. Fix the green-light copy contradiction regardless of which option.
