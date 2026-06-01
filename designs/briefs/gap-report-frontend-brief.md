# Brief · render the daily gap report card in the brief drawer

**For:** frontend (faff-web)
**From:** backend / plan-engine
**Date:** 2026-06-01
**Status:** Ask · backend shipped + wired. Frontend renders the card.

---

## TL;DR

The plan engine just shipped a new closed-loop architecture
(`docs/PLAN_ENGINE_ARCHITECTURE.md`). One of the most visible
outputs is the **daily gap report** · the runner sees, every morning,
exactly how their training is tracking against their race goal +
what closes the gap.

Backend just landed the wiring (commit `237be875`). The new
`seed.readinessBrief.gapReport` field is populated on every brief
load. You render the card.

---

## The new field

```ts
seed.readinessBrief.gapReport: {
  headline: string;                    // "Tracking 1:34:54 · 4:54 behind your 1:30:00 goal."
  trajectorySec: number;                // current projected finish time
  goalSec: number;                      // target
  gapSec: number;                       // signed · positive = behind goal
  status: 'closing' | 'static' | 'widening' | 'unclosable';
  confidenceBand: {                     // from simulator · ±1.5σ around median
    p25Sec: number;                     // faster end (stretch)
    medianSec: number;                  // most likely
    p75Sec: number;                     // safer end
  } | null;
  whatClosesIt: string[];               // 1-3 specific authored actions
  alternativeRanges: {                  // null when status='closing'
    a: { sec: number; label: string };  // stretch goal
    b: { sec: number; label: string };  // current trajectory
    c: { sec: number; label: string };  // safe + executable
  } | null;
  weeksRemaining: number;
  daysToRenegotiate: number | null;     // 0 = render renegotiation now
  riskFlags: string[];                  // "Wk3: 14% volume ramp", etc.
  citation: string;
} | null
```

`null` when the runner has no active plan + race + goal time (true
cold start). Don't render the card in that case.

---

## What the card should show

The card lives **above the per-pillar tiles in the brief drawer**
(top section, hero-adjacent). It's the headline answer to "am I on
track?"

### Section 1 · Headline (always)

```
TRACKING 1:34:54 · 4:54 behind your 1:30:00 goal
```

Use `gapReport.headline` verbatim. Authored by composer with status-
aware framing. Color by status:

- `closing` → success/green
- `static` → neutral
- `widening` → warn/amber
- `unclosable` → critical/red

### Section 2 · Confidence band (when present)

```
CONFIDENCE BAND
1:33:35 ─── 1:34:54 ─── 1:36:13
   p25       median       p75
```

Skip section when `confidenceBand` is null (cold-start simulator).

### Section 3 · What closes it (always · 1-3 bullets)

```
WHAT CLOSES IT
· One more strong long run + threshold day per week closes ~15-30s/week.
· Marathon-pace integration in the long run shifts the projection by 0.5 VDOT/4wk.
```

Render `whatClosesIt[]` as bulleted text. Authored prose, use verbatim.

### Section 4 · Alternative ranges (when not closing)

```
REALISTIC OUTCOMES
A · 1:31:00   Stretch but possible
B · 1:32:30   Where you're tracking
C · 1:33:30   Safe + executable
```

Skip when `alternativeRanges` is null (status='closing').

When `daysToRenegotiate === 0`, this section becomes interactive:

```
REALISTIC OUTCOMES                                  [Adjust goal →]
A · 1:31:00   Stretch but possible      [ Choose ]
B · 1:32:30   Where you're tracking     [ Choose ]
C · 1:33:30   Safe + executable         [ Choose ]
```

On Choose: `PATCH /api/race/[slug]` with `{ goalSec: <chosen>, source: 'renegotiate' }`.

### Section 5 · Risk flags (when present)

```
PLAN RISKS
· Wk 3: 14% volume ramp · exceeds 10% rule
· Wk 5: 3 quality sessions · density risk per Research/04
```

Skip when empty.

### Section 6 · Citation footer (small)

```
docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.3
```

Render as small caption text. Doctrine discipline is part of the trust contract.

---

## Status-driven layout summary

| Status | Headline color | Confidence | What closes it | Alt ranges | Renegotiation |
|---|---|---|---|---|---|
| `closing` | success | ✓ | ✓ | — | — |
| `static` | neutral | ✓ | ✓ | ✓ (informational) | — |
| `widening` | warn | ✓ | ✓ | ✓ (informational) | — |
| `unclosable` | critical | ✓ | ✓ | ✓ (with Choose buttons when `daysToRenegotiate===0`) | render Choose |

---

## What David sees right now

Real values from his data — what the card should render today:

```
TRACKING 1:34:54 · 4:54 behind your 1:30:00 goal     [static · neutral]

CONFIDENCE BAND
1:33:35 ─── 1:34:54 ─── 1:36:13

WHAT CLOSES IT
· One more strong long run + threshold day per week closes ~15-30s/week.
· Marathon-pace integration in the long run shifts the projection by 0.5 VDOT/4wk.

REALISTIC OUTCOMES (informational · static status, no Choose buttons)
A · 1:33:35   Stretch but possible
B · 1:34:54   Where you're tracking
C · 1:36:13   Safe + executable

docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.3
```

Once status flips to `widening` or `unclosable`, the Choose buttons
activate and the runner can renegotiate without leaving the brief.

---

## API endpoint for goal renegotiation

When the runner picks A/B/C, POST to:

```
PATCH /api/race/[slug]
  body: { goalSec: <chosen>, source: 'renegotiate' }
  → 200 { ok: true, goalSec, goalDisplay, oldGoalSec, rebuildTriggered: true }
```

This:
- Updates race goal in DB
- Fires auto-rebuild (paces recalibrate at new goal)
- Audits the change
- Busts brief cache

After POST resolves, fire `router.refresh()` and the new card will
reflect the new goal.

---

## What's NOT in this brief

- A separate "race projection" page — the card lives in the morning
  brief drawer because that's where the runner already looks to make
  daily training decisions. One context window.
- An on-demand "compute now" button — the trajectory is recomputed
  daily by the projection-snapshots cron, brief reads the latest.
- A dismiss control — it's the keystone surface, always renders when
  `gapReport != null`. Tap-collapse is fine if you want, not required.

---

## How to respond

1. Confirm card layout matches your spec or push back.
2. PR link when shipped.
3. Note any field shape question · I'll route.

---

## Related

- `docs/PLAN_ENGINE_ARCHITECTURE.md` · full architecture, §Phase 2.3
- `web-v2/lib/plan/gap-report.ts` · composer
- `web-v2/lib/coach/readiness-brief.ts` · wiring (loadGapReport)
- `web-v2/app/api/race/[slug]/route.ts` · PATCH endpoint for renegotiation
- `designs/briefs/restore-original-workout-endpoint-landed.md` · sibling
  runner-agency surface
