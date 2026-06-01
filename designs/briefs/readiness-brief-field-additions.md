# Brief · readiness brief · field additions for the redesigned drawer

**For:** backend / coach-engine agent
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Asks · the redesigned drawer ships today with client-side
derivations for these fields; backend versions let us delete the
derivations and surface authored coach voice instead.

---

## Context

David's redesigned Readiness Brief drawer landed at commit `14ab2930`
(handoff: `designs/from Design agent/readiness-drawer/`). The drawer
consumes `seed.readinessBrief` per the existing contract in
`web-v2/components/faff-app/types.ts:ReadinessBriefSeed`.

The design references **five fields** the current `ReadinessBriefSeed`
shape doesn't carry. Frontend ships today with client-side workarounds
for each. This brief asks backend to add them so the drawer renders
real authored data instead of derived approximations.

Listed in priority order · top to bottom · most user-visible first.

---

## 1 · `subjectiveCheckin` capture endpoint

**The biggest gap.** This unblocks the design's morning check-in
section + the subjective override doctrine (Saw et al.).

### What's missing

The design's Section 8 prompts "How do you feel this morning?" with a
2 / 4 / 6 / 8 / 10 button scale. The runner picks a number → backend
stores it → next morning's brief uses it as the subjective signal that
can override the objective composite when the gap is ≥15 pts.

Right now the entire section is omitted from the rendered drawer.

### Proposed shape

Add to `ReadinessBriefSeed`:

```ts
subjectiveCheckin: {
  /** ISO date the runner last answered (or null if never). */
  answeredAt: string | null;
  /** Their answer · 0-10 scale (matches the 2/4/6/8/10 button row
   *  but backend stores the full 0-10 range for flexibility). */
  rating: number | null;
  /** True when today's morning brief is still waiting for an answer
   *  (UI renders the prompt). False when answered for today OR when
   *  the prompt is suppressed (e.g. evening, post-run logged). */
  answered: boolean;
};
```

Plus an endpoint:

```
POST /api/readiness/subjective
  body: { rating: number /* 0-10 */ }
  → 200 { ok: true, willTriggerOverride: boolean }
```

When `willTriggerOverride` is true, the runner's answer disagrees with
the objective composite by ≥15 pts and the override block will fire
on next refresh.

### Impact

Without this: the drawer never shows the check-in, the
`subjectiveOverride` block stays null forever, and we miss the
strongest single recovery signal per the locked doctrine.

With this: the morning check-in renders inline; the override fires
when the runner's read disagrees with the numbers.

---

## 2 · `coldStart` envelope · richer empty state

### What's missing

When `band === 'no-data'` (brand-new runner, no HK sync, no nightly
snapshots yet), the drawer renders a "Building your baseline" state.
Currently it's generic — "A few more nights of sleep + HRV data and
the morning brief will fill in."

The design (README §"Special state: cold start") wants progress
specifics: "2 of 7 nights · 5 MORE NIGHTS TO YOUR FIRST READINESS
SCORE."

### Proposed shape

Add to `ReadinessBriefSeed` (only populated when `band === 'no-data'`,
null otherwise):

```ts
coldStart: {
  nightsLogged: number;    // count of distinct sleep nights synced
  nightsNeeded: number;    // threshold to surface first score (likely 7)
  /** Authored coach-voice copy framing the empty state. */
  note: string;
  /** True when HealthKit / Strava is already connected (so the
   *  "Connect Apple Health to skip the wait" CTA stays hidden ·
   *  it's already connected, just needs nights). */
  healthConnected: boolean;
} | null;
```

### Impact

Without this: empty state is honest but not informative. Runner
doesn't know how close they are to a real score.

With this: progress ring + N-more-nights subline + appropriate CTA.

---

## 3 · `streaks[].short` · default-collapsed banner copy

### What's missing

Design says streak banners render a one-liner by default
(`13px / 500`) and expand to the full `meaning` paragraph on tap.
Backend currently ships only `meaning`. Frontend renders the full
`meaning` text always (banner is never "collapsed").

### Proposed shape

Extend the streaks entry shape:

```ts
streaks: Array<{
  pillar: string;
  direction: 'above' | 'below';
  days: number;
  startDate: string;
  /** One-line collapsed summary · 5-10 words · the default state.
   *  e.g. "Sleep below the 7.5h target 4 nights running." */
  short: string;
  /** Full coach-voice explanation · revealed on tap.
   *  e.g. "Cumulative debt compounds · Research/00b says single
   *  short nights don't matter, sustained dips do." */
  meaning: string;
}>;
```

The composer authors both; frontend renders short by default and
appends meaning under a divider when the row is tapped open.

### Impact

Without this: streak banners are tall and read like paragraphs by
default. The visual hierarchy in the design is lost.

With this: compact-by-default banners that expand for depth.

---

## 4 · `trendNote` · authored coach voice for the 14-day chart

### What's missing

Design has a paragraph below the 14-day score trend chart authored in
coach voice. Frontend currently derives this client-side:

```ts
const past = scoreTrend.slice(0, -1);
const priorAvg = round(avg(past));
const delta = score - priorAvg;
// "Down from a 68 average. Watch the load." (etc.)
```

The derivation is a hardcoded coarse template (down/holding/up). It
doesn't know about streak context, pillar contributions, or trajectory.

### Proposed shape

Add to `ReadinessBriefSeed`:

```ts
/** One-paragraph framing of the 14-day score trend. Composed against
 *  the full pillar + streak context (the derivation can name a
 *  specific pillar driving the trend). Null when scoreTrend < 4 days
 *  (not enough data to call a trend). */
trendNote: string | null;
```

Composer can reference active streaks, biggest mover, and trajectory:
"Down from a 68 average · 4-day HRV dip is dragging the composite.
One full night resets the trend."

### Impact

Without this: trend note is template prose, indistinguishable across
weeks.

With this: real coach voice that names the cause.

---

## 5 · `composition` · explicit BASELINE / NET / TODAY field

### What's missing

Design's Section 6 shows: `BASELINE 53 · NET −11 · TODAY 42`.
Frontend derives this client-side from `scoreTrend` (baseline = mean
of the past 14 days excluding today). Two issues:

- Baseline math should match whatever the composer uses internally
  (which may be 28-day rolling, exponentially weighted, etc.) ·
  client derivation diverges from authoritative score-composition math.
- When scoreTrend is short (< 2 days), the section silently disappears
  rather than showing the actual baseline the composer would use.

### Proposed shape

Add to `ReadinessBriefSeed`:

```ts
composition: {
  baseline: number;        // the composer's rolling baseline · the math source-of-truth
  net: number;             // signed · today's score minus baseline
  today: number;           // duplicates `score` · keeps the row data-self-contained
} | null;
```

Null only when there's truly no history (cold start). Otherwise always
populated so the composition line always renders honestly.

### Impact

Without this: the composition line shows a baseline that may be
slightly different from what the composer's score formula thinks of as
baseline. Small drift, but it's the "math" surface · drift here erodes
trust.

With this: one number, one source.

---

## Priority + rollout

| # | Field | User impact | Backend complexity |
|---|---|---|---|
| 1 | `subjectiveCheckin` + POST endpoint | High · unblocks override doctrine | Med · new table column + endpoint |
| 2 | `coldStart` envelope | Med-High · honest first-run UX | Low · count distinct sleep_nights |
| 3 | `streaks[].short` | Med · visual hierarchy in design | Low · composer authors one extra string per streak |
| 4 | `trendNote` | Med · authentic coach voice | Med · composer needs context |
| 5 | `composition` | Low · math consistency | Low · expose internal baseline |

If you ship in this order, frontend can remove each client-side
derivation as the field lands. Order isn't strict · whichever's
cheapest first works too.

## How to respond

1. Confirm shape for each (or push back).
2. Note any composer changes that need design input · I'll route those.
3. PR links when shipped · frontend will swap derivations for real
   fields in same-week commits.

---

## Related

- `designs/from Design agent/readiness-drawer/README.md` · the
  authoritative design spec
- `designs/from Design agent/readiness-drawer/backend-contract.md` ·
  the current backend contract (this brief proposes the diff)
- `designs/briefs/readiness-brief-backend-landed.md` · the original
  contract landing brief
- `web-v2/components/faff-app/overlays/Drawer.tsx` · the renderer
  (search for "derived client-side" comments to find each workaround)
