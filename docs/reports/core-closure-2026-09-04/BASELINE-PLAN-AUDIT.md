# Stage 4 · the baseline marathon plan, read as a coach would read it

Subject: the owner's live block, plan `pln_7636bcc0a201bf2d`, authored
2026-09-03, goal CIM 2026-12-06, stated goal 3:00:00. Read **read-only** from
production on 2026-09-04. Nothing here was inferred from a passing generation
test; every number is off `plan_workouts` on the active plan.

Weeks are chunked Monday-start for legibility. The app's own week ends on
`user_settings.long_run_day`, so a boundary or two differs — the volumes and
the sequence do not.

| Wk | Start | Mi | Long | Q | Days | Character |
|---|---|---|---|---|---|---|
| 1 | 08-24 | 38.0 | 13 | 0 | 5 | lead-in |
| 2 | 08-31 | 46.5 | 15 | 2 | 6 | build |
| 3 | 09-07 | 24.4 | 6.2 | 2 | 5 | **Santa Monica 10K (B)** |
| 4 | 09-14 | 46.8 | 16.5 | 1 | 6 | build · long carries 3@M + 1@E + 2@M |
| 5 | 09-21 | 55.2 | 17 | 2 | 6 | **Dodgers 10K (C)** Sat + 17 long Sun |
| 6 | 09-28 | 43.0 | 14 | 1 | 5 | cutback |
| 7 | 10-05 | 59.5 | 18.5 | 2 | 6 | build |
| 8 | 10-12 | 59.6 | 20 | 1 | 6 | long carries 5@M + 1@E + 3@M |
| 9 | 10-19 | 46.0 | 15 | 2 | 6 | cutback |
| 10 | 10-26 | **60.0** | **21.5** | 2 | 6 | **peak** |
| 11 | 11-02 | 43.2 | 13.1 | 2 | 6 | **Run Malibu Half (B)** |
| 12 | 11-09 | 40.5 | 16 | 0 | 6 | post-half recovery · long 4@M |
| 13 | 11-16 | 49.0 | 16 | 1 | 6 | taper −3 · long 5@M |
| 14 | 11-23 | 36.0 | 10 | 1 | 6 | taper −2 · tempo 4.5@T |
| 15 | 11-30 | 43.7 | 26.22 | 2 | 6 | **race week** |

## What is right, and worth saying so

**The progression is real and it is earned, not aspirational.** 38 → 46.5 →
(race) → 46.8 → 55.2 → (cutback 43) → 59.5 → 59.6 → (cutback 46) → 60.0. Three
cutbacks land in the right places, and every step up compares sensibly against
the pre-cutback week rather than the cutback itself: 55.2 → 59.5 is +7.8% over
the prior peak, not the +38% a naive week-over-week read suggests.

**Marathon specificity is present and it grows.** MP work inside the long run
at 09-14 (3+2 mi), 10-12 (5+3 mi), 11-09 (4 mi), 11-16 (5 mi). That is the
owner's own documented ruling being honoured — "embedding marathon effort
inside long runs is generally more valuable than adding large standalone
marathon-pace tempos" — and `generate.ts` cites it at the `taperMpDose` call
site rather than silently diverging from `Research/08` §9.2.

**Threshold support is continuous.** A T session in 10 of 15 weeks, growing
3.4 → 4.5 → 5.5 → 6 mi at T. High-intensity support is present without
crowding it: hills (09-04), 7×800 @ I (10-01), a 5-rung 1km ladder MP→5K
(10-06), 8×3min and 9×3min @ I.

**The taper's shape is correct.** From peak 60: 49 (−18%), 36 (−40%), race
week 17.5 non-race (−71%). `Research/08` §9.2's 80-90 / 60-70 / 40-50 bands,
near enough. W14 carries "4-5 mi threshold" exactly as the −2 row asks.

**Recovery between key sessions holds.** No week places two quality days
adjacent; the 5-day gap pattern (Tu/Th or Tu/Fr) is consistent.

## Findings

### S4-1 · the long-run development stops six weeks out — the strongest finding

The longest run in the block is **21.5 mi on 2026-10-25, forty-two days before
race day**. After it: 13.1 (race), 16, 16, 10, race. Only **two runs of 20 mi
or more exist in the entire block**, both in October.

For a 3:00 marathon — roughly 2:30–2:40 of continuous running at goal effort —
that is thin, and the last six weeks do nothing to extend it. Conventional
marathon prep places the longest runs 8, 6 and 4 weeks out; here the peak long
is 6 weeks out and nothing after it exceeds 16.

**This is largely an INPUT consequence, not an engine defect, and the
distinction matters.** The runner has four races inside a fifteen-week build
(09-13 10K, 09-26 10K, 11-08 half, 12-06 marathon). Weeks 3, 5, 11 and 12 are
each shaped by one of them. The engine is honouring a race calendar it did not
choose. A coach would still say it out loud: *the half on 11-08 costs the two
weeks either side of it, and those are exactly the weeks a marathon block wants
its longest runs in.*

**Recommendation, for the owner rather than the engine:** either move the peak
long run later (a 20–21 on 11-15 or 11-22 in place of the 16s), or accept the
half as the last long effort and say so explicitly in the block note. This is a
coaching decision with a real trade-off, so it is raised, not taken.

### S4-2 · `race_week_tuneup` authored nineteen days before the race — TUNEUPTYPE-1

`plan_workouts` carries `type = 'race_week_tuneup'` on **2026-11-17**. Race day
is 12-06. It is not race week; the −3 taper week is.

This is not cosmetic. `lib/plan/adapt.ts:433` declares:

```
export const RACE_PROTECTED_TYPES = ['race', 'race_week_tuneup', 'shakeout']
```

— "rows the adapter must never shave or downgrade … race execution is owned by
the race-week machinery, not the volume adapter." A row nineteen days out is
not race execution, so it inherits a protection it has not earned: the adapter
cannot reduce it even when the runner needs it reduced. Rule 16 read onto a
type name — one quantity, one name — and the name here asserts a fact that is
false.

The session itself (5×400m @ 5K pace) is defensible as a −3 primer. It is the
TYPE that is wrong, and the type is load-bearing in four places, all correct in
race week and all wrong nineteen days out:

1. `RACE_PROTECTED_TYPES` — never shaved or downgraded by the adapter.
2. `recomputePacesForPlan` exempts it, so its pace never re-prices from
   evidence, for the ten weeks the block exists to move that evidence.
3. `anchor-provenance.ts` prices it off the runner's **stated goal** rather than
   the fitness anchor.
4. `EFFORT_CUED_TYPES` excludes it, so a provisional anchor still prints as a
   hard rep pace.
5. **The watch has no session for it.** `lib/onboarding/_onboarding_e2e.test.ts`
   reports 127 instances across the archetype sweep — e.g. *2026-11-19 type
   "race_week_tuneup" (5 mi authored): the watch's fallback prescription is "No
   workout scheduled"* — on a non-race week. This was already a known-open
   defect in that file's `KNOWN` list; what this audit adds is that its
   reachable instances are the type appearing outside race week.

### What was attempted, and why it was reverted

Substituting the type was tried and it does not work. Both candidates broke the
session rather than the symptom:

- `intervals` → *"a VO2max session was cut to 2 rep(s)"* against a floor of 3,
  caught by `lib/prescription/_trajectory.test.ts` on David's own block.
- `tempo` → *"3mi continuous tempo built a 1.8mi block"*, and 8,893 sessions
  past the 8,114 ratchet for legs outweighing their work
  (`_quality_day.test.ts`, `_boundary_run.test.ts`).

**That is itself the finding, and it explains the original design.** A taper
week's quality budget is small by construction, and `race_week_tuneup` is the
only session shape in this engine that scales into it — a rep set loses reps
until it is no longer the session, and a continuous block loses its work to its
own warm-up. The type substitution was reverted.

**The correct fix is on the consumer side**: each of the four sites above should
ask whether the row is in a race week rather than inferring it from a type name
that cannot carry that fact. Four sites, in modules where a wrong move re-prices
a real runner's race, so it is named and scoped rather than attempted at the end
of a session.

Held meanwhile by a **ratchet** in `_layout_contract.test.ts`: 3,475 non-race
weeks across the 8,781-plan matrix carry the type today, the count may shrink
and never grow, and the ratchet fails if it reaches zero without being replaced
by a real assertion.

### S4-3 · the 10K is tapered for harder than the half

Week 3 (Santa Monica 10K, priority **B**) drops to **24.4 mi, −47% from 46.5**,
with two rest days and a shakeout — a full taper.

Week 11 (Run Malibu Half, priority **B**) holds **43.2 mi**, one rest day, and
puts a 10 mi session with **6 mi at T** on the Tuesday before Sunday's race —
no taper at all.

Same priority. The shorter, less demanding race gets the deeper taper; the
longer one, closer to the goal race, gets none. Whichever is right, both cannot
be, and the divergence is not argued anywhere. Per the note already in
CLAUDE.md, `POST_RACE_RECOVERY_WEEKS` and `BLOCK_SHAPE.taperWeeks` are
whole-week tables and the 10K row rounds 7–10 days **up** to 2 weeks — which is
the mechanism producing the deeper 10K taper. It is doctrine-bound, so this is
raised for the owner of that table rather than patched here.

### S4-4 · week 5 stacks a C race and a 17-mile long run on consecutive days

09-26 race 6.21 (Saturday), 09-27 long 17 (Sunday), in a 55.2 mi week.

Checked rather than assumed: the race row's own `race_execution` reads
`source: "controlled_c_effort"`, `feasibility: "comfortable"`, and the reason
string is *"C race. Run it as the week's hard session, not as a race."* The 17
is 103% of the prior 30 days' longest (17 on 09-20), inside `Research/00a`'s
110% spike red line. **Deliberate, doctrine-cited, and correct** — recorded
here because it looks alarming in a table and is not.

## Verdict

**The baseline is progressive, marathon-specific and internally coherent, and
it would make this runner faster without adaptation rescuing it.** Volume,
frequency, threshold support, high-intensity support, cutback placement, key-
session spacing and taper shape all hold up to a coach's reading.

Two things stand between it and a plan I would sign off unreserved: the long
run stops developing six weeks out (S4-1, mostly an input consequence of a busy
race calendar, and a decision the owner should make), and one row carries a
type name that grants it four exemptions it should not have (S4-2, a real
defect, held by a ratchet and scoped for a consumer-side fix).

Neither was fixed by writing to the live plan, and the live plan was not
rebuilt. S4-2's eventual fix changes AUTHORING, so David's current block keeps
its 2026-11-17 row either way until a rebuild he authorises.

No self-declared experience level, readiness, TSB, sleep/HRV/RHR, illness or
injury flow, goal-realism veto or hidden confidence threshold was consulted in
producing this read, and none appears to have shaped the block.

**The live plan was not written to.** Every query in this audit was read-only
over `DATABASE_URL_RO`.
