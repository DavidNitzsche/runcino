# The DURATION HOLD's reason — reaching back replaced with the true, proximate one

**Date:** 2026-09-01 · **Status:** shadow-mode fix, verified against real
production data. Nothing wired into a live path; the decision the runner
would eventually see (were `representative_execution` ever promoted) is
unchanged — only the sentence explaining it is.

This is the direct follow-up to `docs/reports/absorption-dual-log-2026-09-01.md`
§7.1's finding on the one real 8-day disagreement episode
(2026-08-16 → 2026-08-23, inside the Americas Finest City half's post-race
recovery window): *"The one real episode's decision (hold after a race) looks
defensible, but its stated reason (citing 6-7-week-old missed sessions
reached back into view) doesn't credit what's actually true that week."*

## TL;DR

- **Confirmed the bug live, on real data, before touching anything** (Rule
  18). `readAdaptationSplit` against David's real account for
  2026-08-16/08-20/08-23 reproduced the prior report's exact quoted sentence
  verbatim: *"Holding the current stimulus rather than adding to it — 7 of
  11 key sessions delivered the full stimulus · 1 partial · 3 not run · 0 of
  2 quality sessions on target."* No reference to the race anywhere in it.
- **Root cause**: `classifyAdaptation`'s `summarise()` function
  (`web-v2/lib/adaptation/adaptation-model.ts`) composes a `marginal`-band
  summary by taking the single weakest-scoring `DimensionRead` and quoting
  its `.detail` text verbatim. `representative_execution`'s execution
  dimension (`readExecution`) had to widen its lookback
  (`representativeLookback`) to stay representative once the AFC taper/race/
  recovery days were excluded — so on the AFC episode, the weakest
  dimension's `.detail` is built from sessions 6-7 weeks distant that the
  widening reached back to find, not from anything about the current week.
  The sentence is TRUE (those sessions really happened, really fell short)
  but not PROXIMATE — it isn't the reason a runner three days post-race would
  recognise as the actual explanation for a hold.
- **The fix**: an optional, narration-only field —
  `AdaptationInput.recentPrescribedWindow` — set only by
  `loadRepresentativeExecutionInput` (the one reader whose lookback widening
  creates the reaching-back risk), naming which doctrine-prescribed taper or
  post-race recovery window today itself sits inside, and how many days
  since race day. `summarise()`'s `marginal` branch now checks this FIRST and
  prefers it over the weakest dimension's detail whenever it is present.
  Nothing else changed: no dimension score, no band, no decision, no other
  band's text.
- **Verified band/decision unchanged, by construction and by re-running
  against the same real dates.** `summarise()` is called strictly after
  `band`/`decision`/`stepMultiplier` are already finalised in
  `classifyAdaptation` — the function only ever returns a `string` — so this
  class of fix cannot move a decision even in principle. Re-ran the same
  five real dates after the fix and confirmed every band/decision matched
  the pre-fix run exactly; only the `summary` string changed.

---

## 1 · Where the reason is actually composed

The task's own candidate list (`classifyAdaptation`/`detectDuration`) named
the right neighbourhood but not quite the right function. Two systems are
involved:

- **`detectDuration`** (`web-v2/lib/adaptation/adaptation-engine.ts`,
  the live DURATION lever) gates on `absorptionPermitsLoadProgression
  (absorption)` and, when it blocks, composes its OWN generic explanation —
  `"The long run holds at X mi. The current load is being completed but not
  absorbed cleanly, and a longer long run is more of the same load."` This
  text is band-agnostic and does not quote any dimension detail at all, so
  it was never the source of the reaching-back sentence the prior report
  quoted.
- **`classifyAdaptation` → `summarise()`** (`web-v2/lib/adaptation/
  adaptation-model.ts`, lines ~752-786 before this fix) is where the
  reaching-back sentence actually comes from. For a `marginal` band it takes
  `dimensions.filter(d => d.score != null && d.detail).sort(...)[0]` — the
  single weakest dimension — and drops its `.detail` string verbatim into
  the summary: `` `Holding the current stimulus rather than adding to it —
  ${weakest.detail}.` ``. `AdaptationVerdict.summary` is exactly what
  `AdaptationComparisonRecord.representative_execution` (the shadow log's
  persisted record) carries, and exactly what the prior report's §7.1
  quoted and reasoned about.

So the fix lives in `adaptation-model.ts`, as the task's primary candidate
predicted — `summarise()` specifically, not `classifyAdaptation`'s band/
decision logic (untouched) and not `detectDuration` (untouched; its own
generic explanation text was never the vector for this problem and is left
exactly as-is).

## 2 · Falsified first (Rule 18)

Before writing any fix, `web-v2/lib/adaptation/_falsify_reason_honesty.script.ts`
was added and run against production (read-only role) via
`npx vitest run --config vitest.shadow-run.config.ts --reporter=verbose
lib/adaptation/_falsify_reason_honesty.script.ts`, calling
`readAdaptationSplit(DAVID_UUID, date)` for five real dates spanning the
episode. **Before the fix:**

```
=== 2026-08-15 === (control, before the episode)
representative: normal/PROGRESS
  summary: Training is landing about as expected. Continuing on the planned progression.

=== 2026-08-16 === (race day — episode starts)
representative: marginal/STAY
  summary: Holding the current stimulus rather than adding to it — 7 of 11 key
  sessions delivered the full stimulus · 1 partial · 3 not run · 0 of 2
  quality sessions on target.

=== 2026-08-20 === (the prior report's own anchor date)
representative: marginal/STAY
  summary: Holding the current stimulus rather than adding to it — 8 of 12 key
  sessions delivered the full stimulus · 1 partial · 3 not run · 0 of 2
  quality sessions on target.

=== 2026-08-23 === (last disagreement day)
representative: marginal/STAY
  summary: Holding the current stimulus rather than adding to it — 7 of 11 key
  sessions delivered the full stimulus · 1 partial · 3 not run · 0 of 2
  quality sessions on target.

=== 2026-08-24 === (both readers agree again)
representative: marginal/STAY
  summary: Holding the current stimulus rather than adding to it — aerobic
  decoupling poor on 3 of 4.
```

This confirms, on the exact real episode, exactly the defect the prior
report described: no reference to the race, a sentence built entirely from
session-level detail that (per the prior report's own dated observation
list) reaches back to 2026-06-18 – 2026-07-07 to replace the AFC taper/race/
recovery rows the exclusion dropped.

## 3 · The fix

Three small, additive changes, no existing field or function signature
altered:

**`web-v2/lib/training/normal-window.ts`** — new pure function
`activePrescribedWindow(todayISO, windows)`. Answers a different question
from the existing `isPrescribedNonNormal` (a boolean): WHICH window today
sits inside, and whether today is still counting down to the race
(`'taper'`) or counting up from it (`'post_race_recovery'`), via
`daysSinceRace = daySpan(window.raceDateISO, todayISO)`. When more than one
window covers today (a compound block), the window with the latest
`fromISO` wins — the most recently opened race is the one a runner would
actually name. No I/O; falsifiable without a database per Rule 18.

**`web-v2/lib/adaptation/adaptation-model.ts`** —
`AdaptationInput.recentPrescribedWindow?: { kind: 'taper' |
'post_race_recovery'; raceSlug: string; daysSinceRace: number } | null`, an
OPTIONAL field (so every existing caller/fixture that omits it — and there
are at least eight construction sites across the codebase — is unaffected;
none needed editing). `summarise()` gained a `proximateHoldReason()` helper
and now checks it first in the `marginal` branch:

```ts
case 'marginal': {
  const proximate = proximateHoldReason(recentPrescribedWindow);
  if (proximate) return `Holding the current stimulus rather than adding to it — ${proximate}.`;
  return weakest?.detail
    ? `Holding the current stimulus rather than adding to it — ${weakest.detail}.`
    : 'Holding the current stimulus rather than adding to it. The last block has not been fully absorbed yet.';
}
```

`proximateHoldReason` produces, for `post_race_recovery`: *"you are N days
past your race and still inside the scheduled recovery window — this is
expected, not a shortfall"* (or *"you raced today, and today is not a day to
add stimulus"* on race day itself); for `taper`: *"you are N days out from
your race, inside the taper."*

**`web-v2/lib/adaptation/load.ts`** — `loadRepresentativeExecutionInput`
already resolves `windows` (`loadPrescribedWindows`) and `todayISO` to run
its Rule 8 exclusion; it now also calls `activePrescribedWindow(todayISO,
windows)` and threads the result into the returned `AdaptationInput` as
`recentPrescribedWindow`. `loadAdaptationInput` (the live, unpromoted
reader) is untouched and does not populate the field — it reads a fixed
42-day window with no lookback extension, so it never has to reach past a
recovery block to find evidence, and leaving it `undefined` there is
correct, not an oversight.

**Deliberately out of scope**: the `poor` band's identical
`weakest?.detail` pattern was left unchanged. The real AFC episode never
lands in `poor` (only `marginal`), so there is no real data to falsify a fix
against there, and Rule 15's discipline is to not touch a path the corpus
cannot exercise. Noted for whoever next touches this function.

## 4 · Verified: same decision, better reason

Re-ran the identical falsifier against production after the fix:

```
=== 2026-08-15 === representative: normal/PROGRESS   (unchanged)
  summary: Training is landing about as expected. Continuing on the planned progression.

=== 2026-08-16 === representative: marginal/STAY   (unchanged)
  summary: Holding the current stimulus rather than adding to it — you raced
  today, and today is not a day to add stimulus.

=== 2026-08-20 === representative: marginal/STAY   (unchanged)
  summary: Holding the current stimulus rather than adding to it — you are 4
  days past your race and still inside the scheduled recovery window — this
  is expected, not a shortfall.

=== 2026-08-23 === representative: marginal/STAY   (unchanged)
  summary: Holding the current stimulus rather than adding to it — you are 7
  days past your race and still inside the scheduled recovery window — this
  is expected, not a shortfall.

=== 2026-08-24 === representative: marginal/STAY   (unchanged)
  summary: Holding the current stimulus rather than adding to it — you are 8
  days past your race and still inside the scheduled recovery window — this
  is expected, not a shortfall.
```

Every band and every decision across all five sampled dates — including
2026-08-24, where both readers already agreed pre-fix — is byte-identical to
the pre-fix run. Only the `summary` string changed, and only on dates where
`recentPrescribedWindow` is non-null (today falls inside a real prescribed
window). 2026-08-24's summary also improved even though that date was
already an agreement date pre-fix: it is still 8 days into AFC's post-race
recovery window, so the same proximate reason correctly applies there too,
not just across the disagreement episode — a sign the fix generalises
sensibly rather than being special-cased to the 8 disputed days.

**Why the decision cannot have moved, independent of the re-run**:
`summarise()` is called as the very last step of `classifyAdaptation`, after
`band`, `decision`, `stepMultiplier` and `confidence` are already computed
and closed over. It returns only a `string` assigned to
`AdaptationVerdict.summary`. There is no code path by which changing this
function's output can change any other field on the verdict — the re-run
above is confirmation, not the only evidence.

## 5 · Verification

- `npx tsc --noEmit`: clean, both before and after a concurrent session
  landed an unrelated MASKING-1 fix in the same file
  (`filterExecutionEvidenceByPrescribedWindow`, addressing the prior
  report's §7.2 total-masking edge case) partway through this task. The two
  changes touch disjoint regions of `load.ts` and compose cleanly — verified
  by re-reading the merged diff, not assumed.
- The falsifier script (`_falsify_reason_honesty.script.ts`) is a new,
  permanent addition alongside its siblings
  (`_shadow_run_absorption_split.script.ts`,
  `_season_sweep_absorption_duration.script.ts`), registered in
  `vitest.shadow-run.config.ts`'s `include` list the same way. Not part of
  `npm test`; read-only against production.
- Confirmed via `grep` that every live call site
  (`app/api/coach/read/route.ts`, `lib/plan/adapt.ts`,
  `lib/adaptation/load-adaptation-engine.ts`) calls `readAdaptation` (backed
  by `loadAdaptationInput`, which never populates `recentPrescribedWindow`)
  — never `readAdaptationSplit`/`loadRepresentativeExecutionInput`. This fix
  cannot reach a runner today. `lib/prescription/trajectory.ts` also calls
  `classifyAdaptation` directly with a hand-built `blank: AdaptationInput`
  that omits the new optional field — safe by construction, since
  `proximateHoldReason(undefined)` returns `null` immediately.

## 6 · What was not done

- `shadow-compare.ts`, `generate.ts`, `capacity-resolver.ts` — not touched,
  per this task's scope discipline.
- The DURATION decision logic itself (`detectDuration`,
  `absorptionPermitsLoadProgression`, the band/decision computation in
  `classifyAdaptation`) — not touched. Only the `summary` string composed
  after the decision is already final.
- The `poor` band's identical pattern — named in §3 as deliberately
  deferred, not fixed, since the real episode never exercises it.
- Whether `representative_execution` should be promoted — not this task's
  question, and this fix does not change the promotion recommendation from
  `docs/reports/absorption-dual-log-2026-09-01.md`. What it does is remove
  one concrete objection that report raised against a future promotion: the
  reason a promoted reader would give for this exact real episode no longer
  reaches for stale evidence when a truer, closer one was sitting in plain
  sight.
