# Stage 7 · every race number, its owner, and its meaning

Read from production, read-only, 2026-09-04, over the owner's active plan.

**Verdict: coherent.** Nine distinct quantities, each with one name, one owner
and one meaning. No collapse found. This is a real change from the state
CLAUDE.md Rule 16 records, where CIM carried *three different projected
finishes live at once, all labelled "projected"*.

## The four race rows, in full

| | 09-13 Santa Monica 10K (B) | 09-26 Dodgers 10K (C) | 11-08 Run Malibu HM (B) | 12-06 CIM (A) |
|---|---|---|---|---|
| stated goal | none | 45:00 | 1:30:00 | **3:00:00** |
| execution target | 43:00 | **47:05** | 1:36:00 | 3:23:50 |
| target source | `current_evidence` | `controlled_c_effort` | `current_evidence` | `current_evidence` |
| likely range | 42:07–43:51 | 42:05–43:52 | 1:32:08–1:37:38 | 3:13:30–3:27:41 |
| trajectory to race day | 42:59 | 42:59 | 1:34:52 | 3:20:33 |
| current fitness today | 42:59 | 43:04 | 1:36:01 | 3:23:47 |
| race pace | 6:56/mi | 7:35/mi | 7:20/mi | 7:46/mi |
| training/rehearsal pace | 6:56/mi | 6:56/mi | 7:20/mi | 7:52/mi |
| feasibility | `no_goal` | `comfortable` | `aggressive` | `unlikely_currently` |

## The nine quantities, and why none of them is another one

1. **stated goal** — the runner's, in `races.meta.goalDisplay`. CIM's 3:00:00 is
   carried untouched beside a 3:23:50 target. The coach projects; it never
   renegotiates.
2. **execution target** — what to run on the day. Distinct from the goal by
   construction, and its `source` says which mechanism set it.
3. **likely range** — what the evidence supports if raced.
4. **trajectory to race day** — where fitness is heading by then.
5. **current fitness today** — where it is now. CIM: 3:20:33 against 3:23:47.
   The two are three minutes apart and both are correct; collapsing them is the
   defect Rule 16 names, and `_cross_surface_contract.test.ts` asserts
   explicitly that they must not become equal.
6. **race pace** — the target expressed per mile.
7. **training pace** — the rehearsal pace, which is deliberately NOT the race
   pace on two rows: the C race (6:56 rehearsal vs 7:35 on the day) and CIM
   (7:52 vs 7:46).
8. **feasibility** — a word, not a veto. `unlikely_currently` on CIM sits beside
   an untouched 3:00:00 goal.
9. **the prose** — `plan_workouts.notes`, owned by `lib/race/race-row-note.ts`.

## The one case worth naming

The C race's target (47:05) sits **outside** its own likely range
(42:05–43:52). That is correct and it is the only row where a number looks
wrong in isolation: 47:05 is what he is being asked to run, 42:05–43:52 is what
he could run. They answer different questions.

It only stays coherent because the reason travels with it, and it does:

> "Dodgers. C race · this is the week's quality session. Run it as the workout,
> controlled. Tomorrow's 17-mile long run is the other half of this weekend, and
> running today controlled is what buys it."

**Checked, not assumed:** every race row's prose was compared against its own
`pace_target_s_per_mi`.

| row | column | prose |
|---|---|---|
| 09-13 | 416 s/mi | "Coach target 6:56/mi" ✓ |
| 09-26 | 455 s/mi | quotes no pace — correct, it is not being raced |
| 11-08 | 440 s/mi | "Coach target 7:20/mi" ✓ |
| 12-06 | 466 s/mi | "Pacing in race-week briefing" — the documented deliberate omission |

That is `race-row-note.ts`'s stated invariant holding on live data: *if the
prose names a pace, that pace is the one on the row.* It is also the fix for a
real incident — on 2026-09-02 the Santa Monica row read "Coach target 7:24/mi"
over a row prescribing 6:56/mi, 2:54 across a 10K, in the one field read on
race morning.

Both B races close with **"Yours to change"** — the no-forced-goal-decision
rule, visible in the prose.

## Enforcement

`lib/audit/_cross_surface_contract.test.ts` holds this: eight live paths must
agree on the projection, the two stamps are checked against their own owners,
and there is an explicit assertion that trajectory and current-fitness must not
collapse into one number. It was repaired this session (RACENUM-1,
SNAPSHOTQUANTITY-1) — it had been failing against production and could not pass
in any environment that runs it.

## The September 13 item from the brief

> "Investigate the September 13 plan race that reportedly lacks a canonical
> `races` row."

**The premise is false.** `santa-monica-10k-2026-09-13` exists: priority B, 7:00
AM start, self-seeded corrals, GPX-derived course summary (202 ft climb, 194 ft
descent, quarter-by-quarter), parking, time limit. It correctly carries no goal
time — a B race with no stated goal is raced off evidence, which is what
`feasibility: "no_goal"` and the 43:00 target say. **Nothing to insert, and
nothing was invented.**
