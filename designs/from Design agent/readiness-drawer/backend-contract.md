
# Readiness · morning brief · backend landed

**Companion to** the existing `lib/coach/readiness.ts` doctrine ·
**Surface** · a new "morning brief" panel (placement TBD by design ·
likely Today view's hero or a dedicated /readiness view).

This doc is the **drop-in for the design agent** picking up the morning
brief. It says what the backend ships, what the data envelope looks like,
how each pillar is computed, what's null vs always-populated, and what
the open design decisions are.

The brief is **rooted in research** (Plews HRV approach · Saw et al.
subjective doctrine · Gabbett ACWR critique). It is **not** a fitness
score · it's an autonomic + sleep state readout that the runner can
inspect daily AND watch trend over weeks.

---

## What shipped · 4 pieces · 1 commit

| Piece | File | What it does |
|---|---|---|
| Snapshot table | `db/migrations/131_readiness_snapshots.sql` | Daily score + per-pillar JSONB + active streaks. Idempotent on `(user_uuid, snapshot_date)`. |
| Snapshot writer | `lib/coach/readiness-snapshot.ts` | Pure function · loads CoachState, runs `computeReadiness`, persists. Skips brand-new users with zero signal. |
| History loader | `lib/coach/readiness-history.ts` | 60-day pillar history + Plews-style HRV derivatives (7-day rolling LnRMSSD + SWC + CV). |
| Brief composer | `lib/coach/readiness-brief.ts` | Top-level `loadReadinessBrief(userId, state)` · returns the full envelope. |
| Cron route | `app/api/cron/readiness-snapshot/route.ts` | Nightly writer for every active user · same auth pattern as snapshot-projections. |
| Cron workflow | `.github/workflows/readiness-snapshot.yml` | Daily 08:15 UTC = 01:15 PT. Runs AFTER snapshot-projections so the load pillar reflects the latest VDOT. |
| Seed wiring | `components/faff-app/seed.ts` | Adds `seed.readinessBrief: ReadinessBriefSeed | null` to FaffSeed. |
| Type contract | `components/faff-app/types.ts` | `ReadinessBriefSeed` + extended `FaffSeed`. |

---

## The contract design renders · `ReadinessBriefSeed`

```ts
type ReadinessBriefSeed = {
  date: string;                 // YYYY-MM-DD

  // ── Top of panel ───────────────────────────────────────────
  score: number;                // 0-100
  band: 'sharp' | 'ready' | 'moderate' | 'pull-back' | 'no-data';
  label: string;                // 'READY'
  /** One-line plain-language framing · band-aware + streak-aware.
   *  Examples:
   *    "HRV down 3 days — the trend matters more than today's number."
   *    "Sharp · the system is firing. Today is for hard work if the plan calls for it."
   *    "Moderate · one or two pillars dipped. Single-day dips are noise; check tomorrow." */
  headline: string;
  /** Score delta vs yesterday + biggest pillar mover.
   *  Example: "HRV down 8 pts vs yesterday."
   *  Null when no yesterday snapshot exists (cold start). */
  oneLineMover: string | null;

  // ── 14-day score trend ─────────────────────────────────────
  /** Includes TODAY's value (computed live, not yet snapshotted).
   *  Length 1 on cold start · length 15 once 14 days of history land. */
  scoreTrend: Array<{ date: string; score: number; band: string }>;

  // ── 5 per-pillar tiles ─────────────────────────────────────
  pillars: Array<{
    key: 'sleep' | 'hrv' | 'rhr' | 'load' | 'hr_recovery';
    label: string;               // 'SLEEP'
    weightPct: number;           // 28
    observedValue: string;       // '7.2h · 7-night avg'
    observedSub: string;         // '+0.3h vs target' (state both numbers · no derived deltas)
    baseline: string;            // 'target 7.5h'  OR  'baseline 70ms'
    band: PillarBand;            // own band per pillar (own thresholds)
    weightContribution: number;  // signed contribution to score (the math)
    meaning: string;              // plain-language interpretation of THIS value
    confounders: Array<{          // alternative explanations the runner can check
      pillar: string;
      explanation: string;
      likely: boolean;            // when likely=true, surface prominently
    }>;
    trend: Array<{ date: string; value: number }>;  // 14-day sparkline
    citation: string;             // 'Research/15 §HRV · Plews approach'
  }>;

  // ── Streaks · 3+ day persistence per pillar ────────────────
  streaks: Array<{
    pillar: string;
    direction: 'above' | 'below';
    days: number;
    startDate: string;
    /** Plain-language interpretation of THIS streak.
     *  "Sleep below the 7.5h target 4 nights running. Cumulative debt
     *   compounds · Research/00b says single short nights don't matter,
     *   sustained dips do." */
    meaning: string;
  }>;

  // ── Movers · biggest pillar delta vs yesterday ─────────────
  movers: Array<{
    pillar: string;
    deltaPts: number;             // signed
    label: string;                // "HRV down 8 pts vs yesterday"
  }>;

  // ── Subjective override · per Saw et al. doctrine ──────────
  /** Surfaced when subjective 1-10 wellness disagrees with objective by ≥15 pts.
   *  Currently always null · the subjective check-in UI hasn't shipped yet. */
  subjectiveOverride: {
    subjectiveScore: number;      // 0-100 derived from 1-10
    objectiveScore: number;
    deltaAbs: number;
    advice: string;
  } | null;

  // ── Forward-looking · what to watch tomorrow ───────────────
  /** 0-3 short callouts. Examples:
   *    "If HRV stays down another day, treat it as signal · ease the load."
   *    "Sleep debt is building (~4h over 3 nights). One 9h+ night resets the trend."
   *    "HRV rolling-CV is at 5.4% · early-destabilization band per Plews." */
  watchTomorrow: string[];
};
```

---

## What's null vs always-populated

| Field | Null when | Design behavior |
|---|---|---|
| The whole brief | Brand-new user · all 5 pillars have no data | Render an empty-state with "wear the watch overnight · brief lights up after a few syncs" |
| `oneLineMover` | No yesterday snapshot (day 1 of cron · cold start) | Hide the mover line · panel still renders |
| `streaks` (empty array) | Single-day dips · no 3+ day persistence | Don't render the "watching" callout list |
| `movers` (empty array) | Day 1 or no notable delta (≥2 pts on any pillar) | Hide the movers row |
| `pillar.trend` (empty array) | No history yet for that pillar (e.g. HR Recovery before any Apple Watch workout) | Don't render the sparkline · keep the rest of the tile |
| `pillar.confounders[i].likely=true` | Data signal supports it (load > 1.2 → "recent volume bump" likely · sleep < 7h → "sleep deficit" likely for HRV) | Surface `likely=true` confounders FIRST · the rest go in an expandable list |
| `subjectiveOverride` | Subjective wellness UI hasn't shipped yet · always null today | Don't render the override callout until populated |
| `watchTomorrow` (empty array) | No streaks + no sleep debt + no CV rise | Don't render the watching section |

The brief is **always honest about partial data** · no fabrication.
Every empty case has a graceful degrade rather than placeholder noise.

---

## Doctrine per pillar · what the meaning + citation reflect

Each pillar's `meaning` string is per-runner per-day. Each `citation` is a
single Research path the doctrine drawer can deep-link.

### Sleep (28%)
- Source: `Research/00b §Sleep`
- Math: 7-night avg vs **dynamic target** (7.5h baseline · 8.0h under ACWR
  >1.0 · 8.5h under ACWR >1.3 · "recovery requirements scale with absolute
  training load")
- Streak: <7.5h for ≥3 consecutive nights → debt-accumulation flag
- Confounders: schedule debt · high training load (likely if ACWR >1.2) ·
  caffeine after 2pm · race-week travel

### HRV (28%) · the Plews approach
- Source: `Research/15 §HRV · Plews approach`
- Math: per-night vs 30d baseline + 7-day rolling LnRMSSD vs SWC
  (0.5×SD of prior-60d rolling) + CV of rolling
- Streak: rolling-7 below SWC for ≥3 days → early functional-overreach flag
- Confounders: cumulative training load (likely when ACWR >1.2) · sleep
  deficit (likely when 7-avg <7h) · life stress · alcohol/stimulants ·
  body fighting illness

### RHR (24%)
- Source: `Research/15 §RHR · 60-day nocturnal baseline`
- Math: vs 60-day baseline · -2 per bpm above · +1 per bpm below · clamp -12/+6
- Streak: ≥3 bpm above baseline for ≥3 consecutive days → "worth checking
  subjective state"
- Confounders: brewing illness · dehydration · alcohol · late dinner ·
  recent volume bump (likely when ACWR >1.2) · heat exposure · genuine
  overreach (likely when ACWR >1.4)

### Load · ACWR (15%)
- Source: `Research/15 §ACWR · directional sanity check (per Impellizzeri critique)`
- Math: Gabbett 7d:28d ratio · banded (≤0.8 = -3 · 0.8-1.0 = +2 · 1.0-1.3 = +5
  · 1.3-1.5 = -3 · >1.5 = -8)
- Note: the doctrine drawer copy is **descriptive only** · "ratio is X,
  band is Y" · not "do Z about it." Prescriptions live in the coach voice,
  not the readiness panel. This was a David callout: panel and coach
  voice can't openly contradict.

### HR Recovery (5%)
- Source: `Research/15 §HR Recovery · 60s post-workout drop`
- Math: vs 30-day baseline · ±1 per 2 bpm · cap ±5
- Streak: not surfaced (single-workout signal, intentionally low-weight)
- Confounders: hard session in last 24h · heat exposure · sleep deficit

---

## Open questions for design

These didn't block shipping but design owns them:

1. **Surface placement.** Today's hero · dedicated /readiness route ·
   inline on Health view · all of the above? The brief envelope is the
   same data; multiple surfaces can consume it.

2. **Trend dominance.** Research says the 14-day trend is more
   informative than today's spot number. Should the sparkline be the
   biggest visual element on the panel, with today's number small?
   Or lead with the number?

3. **Confounder display.** Each pillar carries 3-7 confounders, with
   some marked `likely=true` (data-driven). Show all on tap? Auto-expand
   when band is moderate/pull-back? Always-collapsed unless something is
   flagged?

4. **Streak callouts.** When a streak exists, should the headline lead
   with it (current behavior) or render it as a separate banner above
   the score?

5. **The `oneLineMover` framing.** Currently: "HRV down 8 pts vs
   yesterday." Should it also surface the PILLAR's specific delta
   ("HRV 62ms · 5 below baseline") for readers who want the raw signal?

6. **Subjective wellness check-in.** The brief envelope already has the
   `subjectiveOverride` slot ready · all that's missing is the UI to
   collect a 1-10 wellness rating each morning. Per Saw et al., when
   subjective and objective disagree, **subjective wins** · the override
   should be loud when it fires. Decide if/when to ship the input.

7. **What to watch tomorrow.** The `watchTomorrow` array is intentionally
   plain English. Is this a list at the bottom? A separate "look-ahead"
   card? Inline tooltips on the relevant pillar?

8. **Cold-start state.** The brief returns null when zero pillars have
   data. Design needs an empty-state for "no signal yet" that's
   encouraging rather than dead — research notes that wearable composite
   scores need ~7 nights of overnight wear to start meaning something.

9. **Trend on the score itself.** `scoreTrend` is 0-100 over 14 days.
   Should it be a smooth sparkline · a banded background (sharp/ready/
   moderate/pull-back zones tinted) · a dot per day? The band tells the
   runner where they USUALLY land relative to their personal range.

10. **Movers visual.** Currently text-only. Is there a tile-flip pattern
    that shows which pillars moved up vs down with the magnitude (e.g.
    arrow + delta number)?

---

## Doctrine guardrails

These are non-negotiable without explicit user approval (David):

- **No prescription on the readiness panel.** The readiness card is a
  READING, not an order. "Don't run hard today" is the coach's job ·
  surfacing it on the readiness panel creates contradiction. The
  doctrine drawer can say "Research/X recommends pulling back when
  this pattern holds" · but the action belongs to coach voice.
- **State both numbers, no derived deltas.** Sleep tile shows "7.2h ·
  7-night avg" + "target 7.5h" · NOT "−0.3h short." Same rule the
  coach voice already follows. The runner can do the subtraction.
- **Subjective beats objective.** When the runner answers the
  subjective check-in (when shipped) and the objective score disagrees
  by ≥15 pts, the `subjectiveOverride` block surfaces · its `advice`
  copy says "go with what your body is telling you · the watch is a
  proxy for what you already know."
- **No false precision.** Per Research/15, "[wearable composite scores]
  do not measure recovery directly — they measure correlates of
  autonomic and sleep state." Avoid confidence intervals, ±N
  qualifiers, or anything that implies medical precision. The score is
  a directional read.

---

## How to verify a change

The same pattern the GapPanel docs use:

1. **`loadReadinessBrief(userId, state)`** is the top-level entry.
   For a given user it returns the full envelope or null. Smoke-test
   by hitting `/api/cron/readiness-snapshot` (POST with CRON_SECRET)
   and then re-rendering the user's page · the brief appears.

2. **Streak detection** is in `lib/coach/readiness-brief.ts`
   §detectStreaks. To trigger a streak in test, seed 3+ consecutive
   below-baseline rows in `health_samples` for one pillar.

3. **Confounder surfacing**: write a fake `CoachState` with
   `loadAcwr > 1.2` and verify the RHR/HRV/Sleep tiles surface the
   "recent volume bump" / "cumulative load" / "high load needs more
   sleep" confounders with `likely=true`.

4. **Score trend** needs snapshot history · run the cron a few times
   over consecutive days (or seed test rows in `readiness_snapshots`).

---

## File map · what design opens first

```
designs/briefs/
└── readiness-brief-backend-landed.md           ← this file

web-v2/
├── components/faff-app/
│   ├── types.ts                                ⭐ ReadinessBriefSeed contract
│   └── seed.ts                                 ⭐ seed.readinessBrief wiring (line ~1340)
├── lib/coach/
│   ├── readiness.ts                            ⭐ score computation (existing, untouched logic)
│   ├── readiness-brief.ts                      ⭐ envelope composer
│   ├── readiness-history.ts                    60d pillar loader + Plews HRV
│   └── readiness-snapshot.ts                   nightly writer
├── app/api/cron/readiness-snapshot/route.ts    daily cron route
└── db/migrations/131_readiness_snapshots.sql   snapshot table

.github/workflows/readiness-snapshot.yml         daily 08:15 UTC
```

⭐ = first files to read. The composer (`readiness-brief.ts`) is the
authority on what each field means.

---

## TL;DR

Open `lib/coach/readiness-brief.ts` to see how the envelope composes.
Open `components/faff-app/types.ts` to see the rendered contract. The
brief is null-tolerant per chunk · the panel must render gracefully
when individual pillars / streaks / movers are empty. Lead with the
band-aware headline + 14-day trend, not the spot number.

No prescription. No false precision. Subjective beats objective when
the two disagree. Trend matters more than today.

