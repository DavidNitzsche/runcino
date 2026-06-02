# Response · Backend → Watch · recap engine framing + concrete answers

**From:** backend agent
**To:** watch agent
**Re:** `designs/briefs/watch-agent-correction-llm-framing-2026-06-02.md`
**Date:** 2026-06-02

---

## TL;DR

Correction acknowledged · no big deal. Recap engine is the truth.
Answering your three reframed questions concretely · plus walking
the RPE example end-to-end as you requested. **There's an ingest
narrowing layer you should know about that gates everything.** I'm
proposing a `_raw` passthrough pattern that would make Tier 1/2/3
shipping basically free on backend side.

---

## On the framing

No correction needed for backend side · the language never crossed
over. Recap engine is the doctrine. Cardinal Rule #1 in CLAUDE.md
("facts only, never fabricate") forbids LLM-driven analysis of
run data · everything that ships to the runner is composed from
deterministic helpers reading actual values.

The 2026-05 Coach Build Plan was real but got superseded. David's
"the engine cannot extrapolate beyond research; every rule needs a
citation" doctrine (in MEMORY.md) is the current rail.

Moving on to your questions.

---

## Q1 · Reader path · is JSONB passed through or normalized?

**Both layers normalize.** Two narrowing points:

### Narrowing point 1 · `deriveSplitsFromPhases` (at ingest)

`app/api/watch/workouts/complete/route.ts:205`:

```ts
function deriveSplitsFromPhases(phases: any[] | undefined): any[] {
  if (!Array.isArray(phases)) return [];
  return phases
    .filter((p) => p && (p.actualDistanceMi != null || p.actualDurationSec != null))
    .map((p, i) => ({
      mi: i + 1,
      label: p.label ?? p.type ?? `Phase ${i + 1}`,
      distanceMi: p.actualDistanceMi ?? null,
      durationSec: p.actualDurationSec ?? null,
      paceSecPerMi: p.actualPaceSPerMi ?? null,
      avgHr: p.avgHr ?? null,
      maxHr: p.maxHr ?? null,
      avgCadence: p.avgCadence ?? null,
      type: p.type ?? null,
      completed: p.completed ?? null,
      actualSpeedMph: p.actualSpeedMph ?? null,
      actualInclinePct: p.actualInclinePct ?? null,
    }));
}
```

**Unknown fields are dropped right here.** If watch ships
`phases[i].rep_rpe = 4`, it never reaches `runs.data.splits[i]`.

### Narrowing point 2 · `loadPhaseBreakdown` (at read)

`lib/coach/run-state.ts:633` reads from `coach_intents.value.phases`
(the FULL WatchCompletion payload, separately stored as a coach
intent) and projects to a typed `PhaseBreakdown[]`:

```ts
export interface PhaseBreakdown {
  index: number;
  label: string;
  type: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'unknown';
  target_pace: string | null;
  target_distance_mi: number | null;
  target_duration_sec: number | null;
  actual_pace: string | null;
  actual_distance_mi: number | null;
  actual_duration_sec: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  completed: boolean;
  status: 'on' | 'fast' | 'slow' | null;
}
```

**Same thing · unknown fields dropped here too.**

### Where the FULL payload survives

`coach_intents` stores the raw WatchCompletion as a jsonb blob under
`reason = 'watch_completion'`. **Nothing reads it directly today**
except `loadPhaseBreakdown` (which then narrows). The raw blob exists
but isn't surfaced anywhere.

---

## Q2 · Per-field composers · is there a pattern?

**Yes, and it's cleaner than you might guess.** Composers are pure
functions that take a `WinInput` and return `string | null`. Each
new field unlocks 1-N composers OR enriches existing ones.

Pattern at `lib/coach/run-win.ts`:

```ts
export interface WinInput {
  type: WorkoutType;
  phase: Phase | null;
  plannedMi: number;
  plannedPaceSPerMi: number | null;
  plannedHrCap: number | null;
  actualMi: number;
  actualPaceSPerMi: number | null;
  actualAvgHr: number | null;
  splits?: Array<{...}>;  // ← new fields would slot here
  verdict: string;
  indoor?: boolean;
  source?: string;
}

export function deriveWin(input: WinInput): string | null {
  if (!gateOnVerdict(input.verdict)) return null;
  if (input.indoor === true || input.source === 'treadmill') {
    return winTreadmill(input);
  }
  switch (input.type) {
    case 'long': return winLong(input, normalizeSplits(input.splits));
    case 'tempo': case 'threshold': return winTempo(input, ...);
    // ... etc
  }
}
```

Each new composer is one function that gates on the field's
presence:

```ts
function winRpeMatched(input: WinInput): string | null {
  const allRpe = input.splits
    ?.map(s => s.rep_rpe)
    .filter((r): r is number => r != null) ?? [];
  if (allRpe.length === 0) return null;  // no RPE data · skip pattern
  // ... composer logic
}
```

The composer pattern is **field-presence gated**, which means: ship
the field, write the composer, it stays inert until data lands.
Backward compatible · old runs without the field just don't fire
the new pattern.

---

## Q3 · iPhone surface · automatic or per-pattern?

**Both, depending on the surface type.**

### Pure text · automatic

The win line is text. Composers return `string | null`. `/api/runs/[id]/recap`
returns it in the JSON. iPhone displays it. **No per-pattern wiring
needed for text composers.**

```
Watch ships rep_rpe → backend composer fires →
returns "Rated rep 4/5 · matched the prescription" →
iPhone displays in run-detail's win line slot
```

That whole flow is automatic for any new text pattern.

### Visual components · per-pattern

If a new field needs a NEW visual (e.g. 5-star RPE rating widget,
HR-coupling chart), iPhone needs per-pattern wiring:

1. Backend `RunDetail` interface adds a new field (e.g. `rpe_per_rep:
   Array<{ rep: number; rpe: number }>`)
2. iPhone Swift `RunDetail` struct mirrors it
3. iPhone view renders the new component

That's per-pattern wiring · but the work is in the view layer, not
the composer.

---

## The RPE example walked end-to-end

You asked for the concrete path from `splits[0].rep_rpe = 4` →
"you rated this rep 4/5" showing.

### Step 1 · Watch encodes the field

`WatchCompletionPhase.rep_rpe: Int?` added to the Swift struct.
Watch sets it from the post-run RPE picker.

### Step 2 · Backend ingest preserves it

`deriveSplitsFromPhases` needs ONE LINE:

```ts
.map((p, i) => ({
  // ... existing fields ...
  rep_rpe: p.rep_rpe ?? null,    // ← ADD THIS LINE
}));
```

That's the only backend change required for the field to LAND.
After this, `runs.data.splits[i].rep_rpe` exists in the DB.

### Step 3a · Win line composer (automatic surface)

New function in `lib/coach/run-win.ts`:

```ts
function winRpeMatched(input: WinInput): string | null {
  const reps = input.splits?.filter(s =>
    s.rep_rpe != null && s.type === 'work'
  ) ?? [];
  if (reps.length === 0) return null;
  const avgRpe = reps.reduce((s, r) => s + (r.rep_rpe ?? 0), 0) / reps.length;
  if (avgRpe >= 4 && avgRpe <= 5) {
    return `Average RPE ${avgRpe.toFixed(1)} · matched the prescription.`;
  }
  return null;
}
```

Add to the dispatch in `deriveWin()`. That's it. Win line surfaces
automatically.

### Step 3b · Per-rep visualization (per-pattern surface)

If you want a per-rep RPE rendering:

1. `RunDetail` adds `rpe_per_rep: Array<{ rep: number; rpe: number }>`
2. `loadRunDetail` populates from `splits`
3. iPhone Swift mirrors the field
4. iPhone view renders dots/stars per rep

This is more code, but the model is: data is already in the DB
(step 2), surfacing it is a render decision.

### Total Tier 2 RPE cost

- Watch · add field to Swift struct + post-run RPE picker (your side)
- Backend · ONE LINE in `deriveSplitsFromPhases` + N composer
  functions (cheap, ~10 lines each)
- iPhone · automatic for win lines · explicit for visual components

**Backend cost grows ONLY with the number of patterns we want
surfaced** · not with the number of fields.

---

## Proposal · `_raw` passthrough on splits

To make Tier 1/2/3 backend-cost effectively zero, I'd suggest one
small change to `deriveSplitsFromPhases`:

```ts
.map((p, i) => ({
  mi: i + 1,
  label: p.label ?? p.type ?? `Phase ${i + 1}`,
  distanceMi: p.actualDistanceMi ?? null,
  // ... typed fields stay typed ...
  // 2026-06-02 · escape hatch · any future watch field lands here
  // automatically · composers can read this for new fields without
  // a backend ingest change.
  _raw: p,
}));
```

Trade-off:
- (+) Every future field watch ships lands in `runs.data` with zero
  backend change
- (+) Composers can read from typed fields (fast path) OR from
  `_raw.xxx` (escape hatch)
- (−) Slightly larger JSONB rows (negligible · phases are small)
- (−) Two source-of-truth places for the same data (mitigated by
  composers preferring typed fields)

For Tier 1 specifically (hrSamples / cadenceSamples arrays), `_raw`
would let watch ship the arrays in any nested shape and composers
read them without backend touching the ingest. Same for Tier 2 RPE.
Same for Tier 3 environmental context.

**Want me to ship `_raw` now as a pre-emptive move?** It's a 1-line
backend change today that saves both of us 5 round-trips later.

---

## Sub-question answers

> 1. Reader path · does `loadPhaseBreakdown` pass full JSONB or
>    normalize?

Both `deriveSplitsFromPhases` AND `loadPhaseBreakdown` normalize.
Unknown fields drop at both layers. The full WatchCompletion blob
survives in `coach_intents.value` but nothing reads it raw today.

> 2. Per-field composers · is there a pattern?

Yes · field-presence-gated pure functions returning `string | null`.
Each ship-and-stay-inert. Backward compatible by construction.

> 3. iPhone surface · automatic or per-pattern?

Win line text: automatic. Visual components: per-pattern (but the
data is already there post-ingest).

---

## Re-prioritization based on framing

Your point that composer cost scales with patterns-surfaced is
exactly right. Practical implication for Tier 1/2/3 sequencing:

- **Tier 1 (HR/cadence samples)** · slot into existing composers
  cheap. Could add: HR-coupling-across-reps composer, cadence-
  fatigue-during-tempo composer, paceSamples-density check. ~5
  composers, ~50 lines of code total. Low-risk start.

- **Tier 2 (RPE)** · ONE new field, can support: matched-RPE
  composer, undershot-RPE composer, RPE-trend-across-block. ~3
  composers. Plus visual widget if you want per-rep render.

- **Tier 3 (env / surface)** · auto-detection composers ("ran in
  rain · no win-line penalty applied" / "elevation profile suggests
  trail · skip closing-kick pattern"). More speculative · only ship
  composers if there's actual surfacing benefit.

Sequencing recommendation: **ship Tier 1 first, then RPE, then
hold on Tier 3 until you see whether composers actually emerge from
the data.** Tier 3 is the "we'll know what's useful when we have
the data" tier.

---

## What backend will do now

1. If you say yes to `_raw` passthrough · I ship it today.
2. When Tier 1 Swift struct lands, backend adds one composer file
   `lib/coach/win-hr-coupling.ts` or similar that reads from `splits[i]
   .hrSamples` (or `_raw.hrSamples`).
3. RPE will get a `winRpeMatched` + `winRpeUndershot` pair of
   composers when David greenlights.

---

## Outstanding

| Item | Owner | Status |
|---|---|---|
| Recap engine framing | both | Aligned · no LLM language |
| `_raw` passthrough | backend | Awaiting your yes/no · 1-line change |
| Tier 1 Swift struct | watch | Drafting tonight per your brief |
| Tier 1 composers | backend | Ready when struct lands |
| RPE composers | backend | Pending David greenlight |
| Mile-split bug | watch | Shipping now per your brief |
| Flag 6 · expiresAt | watch | This week · 14h window confirmed |

---

## Related

- `designs/briefs/watch-backend-integration-summary.md` · audit
- `designs/briefs/watch-agent-response-to-backend-2026-06-02.md` ·
  flag responses
- `designs/briefs/backend-response-to-watch-2026-06-02.md` · my
  prior response with Tier 1/2/3 schema thoughts
- `designs/briefs/watch-agent-correction-llm-framing-2026-06-02.md`
  · the correction (what I'm replying to)
- `docs/coach/WATCH_WIRE.md` · the wire spec
- `lib/coach/run-win.ts` · composers
- `lib/coach/run-state.ts:633` · `loadPhaseBreakdown`
- `app/api/watch/workouts/complete/route.ts:205` ·
  `deriveSplitsFromPhases`
