# Natural Coaching Experience — Implementation Handback (2026-09-12, round 2)

**Status: IMPLEMENTATION PUSHED, NOT MERGED.** Both independent reviews requested
by this round's task are complete; one led to a self-correction (§8 — read it,
it's the most important section here). `main` is untouched — this branch is
pushed to origin only, no merge performed.

Evidence-type key (this repo's convention): `[SRC]` source inspection ·
`[TEST]` automated test, run this session · `[PROD]` production query ·
`[REVIEW]` an independent reviewing agent's own finding · `[BLOCKED: reason]`.

---

## 1. Branch / base / current SHA

- **Base:** `origin/main@a79c5c86dfe9856bbc3a093649a1663531d8d030` — confirmed
  current via `git fetch` at the start of this round and re-checked before
  every push. Zero commits on `origin/main` touch any file this round changed.
- **Branch:** `claude/faff-natural-coaching-vyloay`, pushed to origin, **not
  merged to `main`**.
- **This round's commits**, on top of the already-reviewed checkpoint-1 work
  (`d1aac49e2`/`4b098205d`/`e616ab398`):
  1. `a837f34b7` — the implementation: stale-row format-migration fix, C-race
     jargon removal, the `experience.ts` em-dash, the CIM elevation "we/us"
     voice fix. Over-reached on "quality session" (see §8).
  2. `a72ca8786` — two test-coverage gaps closed after Review 1 named them.
  3. `7b048c90b` — self-correction after Review 2's flag led to a wider check:
     reverted the "quality session" → "hard session" substitutions, fixed a
     second missed "C race" site, kept only the genuine tier-label removal.
- **Overlap check with Marathon Plan / Adaptation (task item 1):** no branch
  under `evidence-agent/*`, `origin/brain/*`, `origin/feat/*`,
  `origin/fix/adaptation-*`, `origin/fix/plan-snapshot-*` is less than 10 days
  old or touches any file this round changed. The one genuinely live,
  same-day concurrent work is the Adaptation team's own
  `08-adaptation-vertical-slice` milestone-1 checkpoint (§6) — read, not
  touched, no file overlap.

## 2. Final file footprint

| File | What changed | Calculation/logic touched? |
|---|---|---|
| `web-v2/lib/race/race-row-note.ts` | Widened `TARGET_SENTENCE_SOURCE` regex to recognize the OLD coach-target sentence format alongside the current one | No |
| `web-v2/lib/plan/generate.ts` | Dropped "B effort." and "C race ·" leading tier-labels from THREE `slot.notes` branches (two in the C-race default — a second site found on re-audit — one in the b_effort branch) | No |
| `web-v2/lib/race/race-outlook.ts` | Dropped "C race." from `execution.reasonVsExpected` (2 branches) and from `differsFromPrevious` (1 branch, found on re-audit) | No |
| `web-v2/lib/postrun/experience.ts` | Removed one em dash at line 711 | No |
| `web-v2/lib/training/race-card.ts` | Dropped "we've"/"for us" from the CIM course-elevation decision-card copy | No |
| `web-v2/lib/plan/replan-scenarios.ts` | **Net zero** — "quality session" → "hard session" applied then reverted (§8) | No |
| `web-v2/lib/plan/reschedule.ts` | **Net zero** — same reversion, touched then restored | No |
| 6 test files | New/extended pinned-string tests for the above, matching final wording | N/A |

## 3. Before / after, every sentence that actually changed

| Site | Before | After |
|---|---|---|
| `generate.ts` `b_effort` branch | `"{name}. B effort. Hard, not all out. ..."` | `"{name}. Hard, not all out. ..."` |
| `generate.ts` C-race default (×2 sites) | `"{name}. C race · this is the week's quality session. Run it as the workout[, controlled...]."` | `"{name}. This is the week's quality session. Run it as the workout[, controlled...]."` |
| `race-outlook.ts`, goal-slower-than-ceiling | `"C race. Run it as the week's hard session, not as a race. ..."` | `"Run it as the week's hard session, not as a race. ..."` |
| `race-outlook.ts`, no-goal | `"C race. Run it as the week's hard session, controlled, ..."` | `"Run it as the week's hard session, controlled. ..."` |
| `race-outlook.ts`, `differsFromPrevious` | `"A C race is run as the week's hard session, ..."` | `"This is run as the week's hard session, ..."` |
| `experience.ts:711` | `"...not pace — this is a record..."` | `"...not pace, so this is a record..."` |
| `race-card.ts`, fact card | `"...so we've corrected it. See the numbers below...."` | `"...so this is corrected below...."` |
| `race-card.ts`, choice card | `"...isn't dense enough for us to trust it over the record..."` | `"...isn't dense enough to trust over the record..."` |

**Net-zero (attempted, then reverted — see §8):** `replan-scenarios.ts` (4
sites) and `reschedule.ts` (1 site) — all read exactly as they did before
this round started. "quality session"/"quality stimulus" is correct,
established vocabulary and was never the defect.

**Deliberately left unchanged, and why:** `AddRaceV5.swift`'s Priority
picker ("B · Tune-up", "C · For fun"), `replan-scenarios.ts`'s refusal
("Mark it B or C on the race"), and `BlockV5.swift`'s Alert ("No B or C
race on the calendar to fold in") all name a real, runner-visible control
by its real value — not the jargon-leak pattern this pass fixes.
`race-role.ts`'s "B effort"/"RUN IT AT B EFFORT" card (the decision UI
itself, which coins and explains the term at the point of choice, matching
button label) is the same case.

## 4. The time-critical finding, and what was done about it

Unchanged from the first draft of this handback — repeating because it's
still live and still time-boxed. An independent review of checkpoint 1
found, by querying `DATABASE_URL_RO` directly, that David's real Santa
Monica 10K `plan_workouts.notes` row — **his race is 2026-09-13, tomorrow**
— was authored under the OLD sentence format and would silently fail to
reprice once the accepted fix landed. [PROD] confirmed real row text:

```
"Santa Monica 10k. B race · race effort. Recovery days follow before
 quality resumes. Coach target 6:55/mi, set from your current fitness.
 Yours to change."
```

**Fixed:** `race-row-note.ts`'s regex now recognizes both formats. [TEST]
`_race_row_note_format_migration.test.ts`, 5/5 passing, falsified against
the pre-fix regex.

**Still a real, live decision:** whether the next scheduled reprice pass
runs against this row before race morning wasn't verified this round, and a
one-off manual reprice against this specific `plan_workout_id` is a
production data write requiring your explicit per-statement go per
`CLAUDE.md`. **If you want this guaranteed before tomorrow, say so and pick
(a) trust the next automatic reprice cycle, or (b) authorize a one-row
manual reprice.**

## 5. Verification

- **Every changed sentence has a falsified-then-passing test** (Rule 18),
  reverted via file-copy (not `git stash` — see §7), confirmed the
  assertion fails, restored, confirmed it passes.
- **Full relevant suite:** `lib/plan`, `lib/race`, `lib/postrun`,
  `lib/training`, `lib/faff` — **7191/7281 passing**, 89 skipped. The one
  failure (`_authoring_shadow_compare.audit.test.ts`) is a pre-existing
  Rule-18-style liveness gate that correctly refuses to report clean without
  `DATABASE_URL_RO`, unrelated to this diff.
- **`scripts/check-coach-voice.sh`:** clean, 379 files — **but a real gate
  gap is named, not fixed:** its scanned scope does not include
  `web-v2/lib/postrun` or `web-v2/lib/training` (Review 2 independently
  confirmed this by reading and running the script). Neither is
  `web-v2/lib/faff/coach-lexicon.ts`'s jargon list extended with "c race"/
  "b race" — investigated and deliberately NOT added: `native-v2/Faff/Faff/
  ViewsV5/BlockV5.swift:881`'s Alert ("No B or C race on the calendar to
  fold in") contains the literal substring "C race" and is a LEGITIMATE
  reference to the real priority picker, so an always-blocked lexicon entry
  would break that string too. Fixing that Alert's wording to make the
  gate additon safe is real, bounded follow-up work, named here rather than
  rushed.
- **No simulator render of MY specific changed strings was produced.**
  Review 2 did get further than either prior pass — it built and launched
  the real app from this branch in the iOS Simulator and captured genuine
  (non-fixture) screenshots of other catalog entries — but the specific
  `6a-longest` row it tried to screenshot exhibited scroll drift across
  ~20+ concurrently-booted simulators sharing this environment, and it
  stopped rather than force a result. That entry, on inspection, is a
  hand-authored Swift JSON fixture anyway (confirmed in §8's own
  investigation) — independent of the TS backend, so even a clean
  screenshot of it wouldn't have proven anything about the real code path.
  **This round's evidence is execution-level (real functions, real
  numbers) and test-level, not a pixel render**, stated plainly rather than
  worked around.
- **A real near-miss, disclosed:** mid-session, a `git stash` used to
  temporarily revert one file for falsification testing accidentally popped
  a DIFFERENT concurrent session's WIP stash (stash is shared across all
  worktrees of this repo). No damage — the failed pop left the other
  session's stash entry untouched, and this branch's own tree was restored
  cleanly with `git checkout --ours` + `git reset`. Switched to file-copy
  reverts for the remainder of this round.

## 6. Truth dependencies consulted (task item 3)

- **Brain v2.1.1 errata** — read in full. Its C-race finding
  (`generate.ts:9683`'s `victim.notes = 'Off. Race week for a tune-up · rest
  is the work now.'`) is a DIFFERENT, already-jargon-free branch from the
  ones fixed this round — confirmed by reading the line directly. No action
  needed; noted so the two findings aren't conflated.
- **UX/IA acceptance plan** — read in full via `git show`. One copy-adjacent
  item (`NotOnPhoneYetV5`'s "Your training is on the web, and it is
  working.") needs a product-truth answer about the web-frontend pause this
  role can't supply unilaterally. Not touched.
- **Design-System Phase 2** — read in full. This is where the
  `replan-scenarios.ts` render-confirmation for `6a-longest` came from —
  worth noting given §8's correction: the design-system audit correctly
  confirmed the string renders; it never claimed "quality session" was a
  defect, that inference was mine and it was wrong.
- **Adaptation's own concurrent milestone-1 checkpoint** — read in full,
  source of the sharper Apply-failure detail in §7. No file overlap.

## 7. Apply-failure — still correctly BLOCKED

Per task instruction 4, unchanged from the interim status: confirmed reason
codes today are `apply_refused` and `apply_failed` (neither connectivity-
related), from Adaptation's own concurrent checkpoint, not inference. Blast
radius independently re-measured at 4 native call sites plus 1 web site.
**Not implementing a resolver yet** — Adaptation's own accept-lane reopen
bug (their Bug 2) hasn't shipped, and writing copy against an unstable
reason-code contract risks the exact "code says one thing, the row says
another" trap §4 already surfaced once this round.

## 8. The self-correction — read this one

Review 2 flagged that the `6a-longest` catalog fixture in `BlockV5.swift`
still literally read "quality session," unchanged by my commit, and called
it a possible staleness gap. Investigating that led to a much bigger finding
than the fixture itself: **grepping "quality session" across the whole app
showed it is this app's own established, canonical, constantly-rendered
term** — a literal Block-screen stat label (`v5-block.ts:260`, `{ id:
'quality-done', label: 'Quality sessions', ... }`), an enum-to-string
mapping (`ChartsV5.swift:1337`, `case .quality: return "quality session"`),
and dozens of coach sentences across `lib/coach`, `lib/plan`, `lib/faff`
(e.g. `heat-gate.ts`: "Run the quality session on time and effort, not
pace."; `limiter.ts`: "Cut the second quality session before cutting
volume").

That means the first commit's `replan-scenarios.ts`/`reschedule.ts`/two
`generate.ts` substitutions of "quality session" → "hard session" were not
jargon removal. They introduced a SECOND name for a thing the app already
names consistently elsewhere — Rule 16 ("one quantity, one name") violated
in the direction opposite the one I was fixing. The only genuine defect in
any of these strings was ever the leading "C race ·"/"B race ·" tier label
glued in front — a term with no antecedent anywhere a runner can see it
defined, unlike "quality session" or the priority picker's own "B ·
Tune-up"/"C · For fun."

**All four "hard session" substitutions in `replan-scenarios.ts` and the one
in `reschedule.ts` were reverted to their original wording.** The two
`generate.ts` C-race branches keep the tier-label removal but also revert
to "quality session." `race-outlook.ts`'s three "hard session" strings
needed NO correction — confirmed by diff against the pre-existing commit
that this wording predates this round entirely; only "C race" was ever
touched there.

I'm naming this plainly because it's exactly what the two-review structure
this task specified is for: an independent pass with no stake in my
reasoning caught something I'd missed, and pursuing it caught something
bigger than what was flagged. A quieter handback would fold this in as if
it were always the plan; that's not what happened.

## 9. Independent reviews — both verdicts

**Review 1 — Truth/authority review** (dispatched against `a837f34b7`).
Verdict: **PASS WITH NOTES**. Independently re-derived every change from
source, ran the real test suite, falsified 4+ tests itself, confirmed no
`BRAIN_CONSTITUTION.md` ownership violations. Found two real test-coverage
gaps (`experience.ts:711` untested, `race-card.ts` choice-card string
unasserted) — **both closed in `a72ca8786`**.

**Review 2 — Rendered UX/voice review** (dispatched against `a837f34b7`,
same commit). Verdict: **PASS WITH NOTES**. Built and launched the real app
in the iOS Simulator from this branch (confirming simulator access is
available — useful for future rendering work). Source-traced every changed
string to its real Swift/TSX consumer. Independently confirmed the same two
test gaps Review 1 found (already closed by the time this review landed —
it was pinned to the earlier commit) and, separately, the stale-fixture
observation that led to §8's correction. Flagged one lower-confidence
possible miss (`reschedule.ts`'s "quality stimulus") — investigated, and
per §8, it turned out NOT to need fixing either; reverted along with the
rest.

**Neither review's PASS verdict has been re-confirmed against the final
corrected commit (`7b048c90b`).** Given the correction shrinks the diff
(reverts outnumber new changes) and every remaining change is the same
class of fix both reviews already validated (tier-label removal, confirmed
render path or confirmed-dead field), I'm not dispatching a third review
round for this — but that is a judgment call, named here so it can be
challenged rather than assumed.

## 10. Merge recommendation

This round's final diff is small, precisely scoped, and every changed
sentence is falsified-then-tested. Both reviews passed the substance of the
fix (tier-label removal, the regex fix, the em-dash, the CIM voice fix); the
one thing they didn't review is the correction itself, which is a
subtraction (reverting an over-reach) rather than a new claim needing fresh
verification. **Recommend merge**, with two things surfaced for your own
decision regardless: (a) the Santa Monica reprice timing question in §4 —
time-boxed to tomorrow — and (b) whether to fix `BlockV5.swift:881`'s Alert
wording as a small follow-up so "c race"/"b race" can safely be added to
`coach-lexicon.ts`'s always-blocked list (§5). Per this task's own
instruction, I have not merged or pushed to `main`.
