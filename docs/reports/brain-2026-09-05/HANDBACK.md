# Handback · overnight 2026-09-05

**Start `bcfe68b80` · end: the final commit of this document.**
**TestFlight 280**, from `7998ad4b9`, provenance verified by ancestry.
**Zero unexpected test failures** for the first time in the programme.

`AUTOMATIC_ADAPTATION_AUTHORITY` is still `false`. No live plan was written, no
adaptation promoted, no production migration applied.

---

## The ten questions, answered directly

**1 · If I run more mileage than planned next week and absorb it cleanly, exactly what belief changes?**

`demonstratedVolume` in `lib/adaptation/volume-evidence/belief.ts`, and only that.
The surplus is classified into one of six kinds, admitted only if execution
identity, telemetry, deterioration, injury and absorption all permit, and then
credited **continuously**: a small overrun contributes a small fraction, capped
at 5% of a week per week, with a full step unlocked at 15%. Absorption is a
confirmation factor, not a gate, so the evidence is recorded even while it is
provisional. Fatigue is a **separate channel** and always moves, even when
capacity does not.

**2 · Which future workouts or weeks can change?**

Future **unsealed ordinary** weeks. Cutbacks, tapers, recovery weeks and race
weeks are preserved by construction. Volume and intensity may not both advance
in one week (`Research/00a`, one-at-a-time).

**3 · When are they reconsidered?**

At the next weekly boundary, through the deferral queue, which persists and
re-offers rather than dropping. A deferred progression cannot become a silent
suppression.

**4 · What will I see in the app?**

**As of build 280: a card on Today.** Direction, headline, the evidence
sentence, *Do it* / *Leave it*. Before tonight there was no proposal surface in
the V5 app at all. **Not yet rendered against real data** — see the honest gap
at the end.

**5 · If threshold evidence improves simultaneously, which lever advances and why?**

Volume, then the long run, then pace — `ARBITRATION_PRIORITY`, cited to
`PROGRESSIVE_BASELINE_DOCTRINE` ("duration is the primary early lever") and Q22
(the long run's validity depends on weekly volume, and a dependency settles the
order). The loser is deferred, not discarded.

**6 · If I recover poorly, what changes?**

The absorption factor falls, so credited evidence falls with it. Below 90% of
prescribed volume in the following weeks it reaches zero, and 90% is doctrine
(`PROGRESSIVE_BASELINE_DOCTRINE` Q9). Fatigue still rose. Capacity did not.

**7 · If heat, hills or bad telemetry explain the result, how is that handled?**

Telemetry credibility is its own channel: a flat-lined HR trace makes the HR
condition **drop out**, not fail. An absent read is not a failure (Rule 11), and
a condition that can only come back absent is a wall rather than a bar.

**8 · Can I move a workout without SQL, and does the entire plan re-adjudicate?**

Move: **yes** — `lib/plan/reschedule.ts`, the API route and the iPhone sheet all
exist, and race proximity is now read at day grain. Re-adjudicate: **no.** The
rescheduler cannot read weekly demand, because `weekly-demand.ts` reaches
`lib/adaptation/**`, a forbidden directory for that surface. That ratchet may
shrink and never grow, so it is the owner's call.

**9 · Can every adaptive lever now travel from evidence to a runner-visible proposal?**

**No.** One lever can (weekly volume, via `mark_upgrade`).

The matrix states it plainly and I verified this line in the document itself:
**"One of the twenty-three meets that bar: threshold pace."** A lever counts as
complete only when valid evidence can alter a future prescription, produce an
explanation, and reach every intended surface behind the right authority
boundary. The finer split reported to me (seven sealed, five shadow, seven with
no owner) I have NOT independently counted, and say so rather than pass it on as
if I had.

And the matrix found the constraint that outlives tonight's fix: **the propose
lane cannot carry most levers.** `action_payload` held only `newType`, `newDate`
and `shaveFraction`, and the accept route rebuilds exactly those three. I widened
it for distance, so an upward mileage proposal now has somewhere to live. **A
pace change and a dose change still do not.**

There is a second constraint of the same kind, on explanation rather than
action: `adaptation-info.ts` computes `wasAdapted` from the ROW having changed
(type, sub-label, distance, date), not from a decision having been made. A
record-only judgment changes none of those, so **every judgment the engine makes
and does not apply is invisible on every surface by construction.**

**10 · What still prevents the brain from operating autonomously?**

Four things, in order of size. The seam is off by your ruling. Most levers
cannot be *described* by a proposal payload, let alone carried by one. Eighteen
of twenty runner beliefs have more than one live answer. And nothing yet
evaluates an earning gate on its assessment date.

---

## What changed tonight, and why each mattered

### The proposal lane was one-directional

`PROPOSABLE_KINDS` held `downgrade`, `shave`, `reschedule`, `field_test`. Two
reduce, two move, **none add**. An upward adaptation fell through to an
observational note nobody reads.

Opening the seam would NOT have fixed this: an upgrade would then have been
applied **silently** rather than offered, and Rule 21's census could not tell
"never proposed" from "proposed and declined" because there was no propose lane
to decline from.

`action_kind` is plain text with no constraint, so this needed no migration.

### And the card had no screen

Served only at `/api/plan/workout-proposals`, whose one Swift caller is the v4
shell behind `-faffLegacy`. Production: **7 rows ever, 0 accepted, 0 dismissed**,
one pending since 2026-08-25.

### The admission bar was a cliff

Your 2026-06-15 week (47.3 against 45.5) contributed **zero**. It now
contributes **27.8% of a step**. Under the old bar, **zero weeks were admitted
in all of 2026**.

Three weeks at 5% over unlock a progression. One week 40% over is capped and can
never unlock one, structurally.

### Nine red tests were one defect

A `silent_rebuild` gave every already-run day **two ids**. The reign rule handed
the resolver the archived copy, so the EXACT tier compared two names for one
prescription. Verified in production. **Rendered with real payloads.**

---

## Corrections I owe you

1. **"No upward adaptation has ever fired" is wrong**, and I repeated it all
   session. `reanchorActivePlan` pushed VDOT 46.3 to 47.7 on 2026-09-02, rewrote
   76 workouts, and you acknowledged it. It fires outside the seam and writes no
   `coach_intents` row, which is exactly why the census reads zero. The shadow
   log also shows the engine asking to push on four consecutive days.
2. The registry is **75 module orphans**, not "111 entries".
3. **CLAUDE.md Rule 9 is stale** in two citations: the values named at
   `achievable-target.ts:196` and `generate.ts:9896` no longer exist.
4. A safety claim I checked rather than passed on: `resolvePrescription` takes
   no safety input, but the V5 route **does** gate, routing a STOP to the injury
   or sick panel. Real architectural risk, **not** a live hole.

## Defects in my own work tonight

- The decline lookup searched `rejected` for the **chosen** option, which can
  never match, so every trace read as unjustified.
- A taper hold was scored as unjustified absorption when it is **prescribed
  recovery**, dropping the archetype sweep from 85 promoted to 12.
- **No test covered the objective acting inside the gate**, only the predicate.
  Found by falsifying. Same shape as `taperIntegrity` the night before.
- The format lint caught me spelling my own rounding rule; my fix then appended
  a unit the formatter already carries and produced `"9 mi mi"`.

## Held back, and exactly why

- **`wire-adjudication`** · 0 of 7 active plans would promote, six purely for
  absent history. A fatal block must not merge until a blocked plan produces a
  visible, actionable failure.
- **`reshape` out of the proposal lane** · `_seal_single_seam.test.ts` cites
  your 2026-09-02 ruling naming it. A doctrine-cited guard is not weakened to
  make room for new work. **Your call.**
- **`runner-state` and `dose-responsive` are merged but unwired**, registered as
  orphans with stated expiry. Said plainly rather than dressed up.

## Queued as tasks, not smuggled in

- `loadPostRunExperience` grades **by date, not by run**, so a supplemental run
  is compared against that day's prescription. The parity audit cannot see it.
- A `race_week_tuneup` typed into a week with no race, mapping to `RACE`
  effort class.

## The honest gap

**Rule 13 is not satisfied for the proposal card.** It compiles, it is wired, it
shipped in 280. Nobody has seen it. And with zero pending proposals in
production, the correct check this morning is that **Today looks unchanged** —
a card appearing today would mean something is wrong.
