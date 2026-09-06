# Handback · the loop, and four things that had never run

All merged to `main` and deployed. `AUTOMATIC_ADAPTATION_AUTHORITY` is still the
literal `false`. No production write, no production DDL.

---

## 1 · The Accept button had never sent a request

`APIV5.swift:answerProposal` built its URL as `API.baseURL.absoluteString +
"api/plan/..."`, and `baseURL` carries no trailing slash. Against production
that is:

```
https://www.faff.runapi/plan/workout-proposals/6/accept
```

A **valid** URL naming a host that does not exist. The POST left the phone,
failed DNS, and the caller's `_ = try? await` ate the error. Against a local
host the authority is unparseable, `URL(string:)` returns nil, and the function
returned false having opened no socket.

Three taps, zero requests, watched in an empty server log.

`fetchDecisions` had the identical defect, so **the Coach Decisions screen had
never once loaded** — it drew the outage state every time it opened. These were
the only two of eleven paths in that file missing a leading slash, and they were
the two the whole surface rests on.

Four sessions of work opened the propose lane. The button at the end of it had
never sent a byte.

**This is native code, so it needs a TestFlight build to reach your phone.**

## 2 · Three more things that had never run

**Every runner-accepted ledger row was rejected.** `recordDecision` hard-coded
`responded_at` to NULL while taking `runner_response` from the caller. The
migration's own CHECK requires a settled response to carry its moment, so every
insert carrying ACCEPTED was refused by the database — the entire runner-accept
lane, which is the only lane that can produce an upward adaptation. The plan
mutated, the ledger stayed empty, and `mutatePlan` logged to `console.error` and
returned normally. Rule 21's own defect, reproduced inside the mechanism built
to end it. Found independently by two workstreams on the same day, each on its
first end-to-end run.

**An accepted upgrade wrote nothing and reported success.** `mark_upgrade`
joined the proposable set on 09-05; the accept path rebuilt its action from
three fields, none of which is `bumps`, and the upgrade limb is guarded on
`bumps.length > 0`. So it answered `{ ok: true, applied: 0 }`. You tap "Add to
Thursday", the plan does not move, the response says it worked.

**The canonical shadow never started.** Not "stopped after 9/3" — never ran. The
three rows that exist are all stamped 2026-09-03 18:22:28Z from one hand-run on
a laptop. `runAndPersistCanonicalShadowEvaluation` returns on its first line
when `readOnlyConnectionConfigured()` is false, into a `console.warn` on
Railway. **`DATABASE_URL_RO` is not set on the Railway service.** The pace
shadow, one statement above it in the same loop, wrote 14 rows a day throughout.

The remedy is one environment variable, and it is yours to set. With it present,
today's pass would produce 9 decision records across 3 runners — including a
`WEEKLY_VOLUME REGRESS` — and 4 named refusals.

---

## 3 · The 9/21 week, priced by demand

You asked for complete demand rather than stressor count. Measured with the
engine's own model, which prices weekly miles, the long-run surcharge and
quality minutes together:

```
week        mi   long  qmin   demand   Δ vs trailing-3 max
2026-08-31  46.5  15    102    83.91        —
2026-09-14  46.8  16.5   65    72.38    -13.7%
2026-09-21  55.2  17    110    95.75    +14.1%   ← by mileage: +17.9%
2026-10-26  60    21.5  130   108.28     +9.6%   ← the block's real peak
```

By demand the step is **smaller** than by mileage, because 08-31 already carried
102 quality minutes. And 09-21 is not the block's stress point: the same runner
is asked for 108.3 five weeks later.

**Three rolling boundaries** replace the single gate, each deciding with the
evidence available at that moment and able to change only what is still ahead:
the day before the week, the morning after the mid-week quality session, and the
morning after the race before the long run. Scheduled nightly and idempotently,
each with an overdue date so a boundary that never fires is noticed. Dates are
derived from a week's own sessions, not hard-coded to this one.

Nothing has been written to your plan.

## 4 · The two vertical slices

**Threshold — three owners became one.** The census measured them live: 430
canonical, 431 in the goal-projection pass bar, 431 in `easyPaceForBlend`, 472
in the onboarding seeder. Widest pair 42 s/mi. All now read the one ladder;
`loadRecentTestPoints` no longer has a `vdot` parameter at all, deleted rather
than ignored. The full round trip runs in scratch — evidence → belief → PUSH →
arbitration → proposal → card → acceptance → mutation → ledger → undo — and
produced **`{"UP": 1}`**, the first non-zero upward count this engine has ever
recorded.

**Volume — your case reproduces exactly.** 2026-06-15: 45.5 prescribed → 47.3
completed → 1.9 mi surplus → **27.8% of a step**, against zero under the old
binary bar.

Through the newly wired production path it does not fire, and the reason is
specific rather than a shrug: of 17 weeks, exactly one carries admissible
surplus, and it is refused because that week's long run genuinely deteriorated.
Accumulation is proven synthetically (three 5%-over weeks → a real proposal at
0.667 of a step, raising 06-29 from 44 → 45.5) because your history contains one
surplus week, not several.

One disagreement was left alone deliberately: `admit.ts` blocks on a single
deteriorated session while `deteriorationPattern`'s own sentence says one
"reduces confidence without blocking progression". Those cannot both be right,
and that disagreement is the entire reason your named week contributes nothing.
Changing an admission threshold so the lane fires is the tuning Rule 21 forbids,
so it is written up with the numbers rather than adjusted.

## 5 · Safety, and what the data actually says

The literal `safety: 'NORMAL'` is gone; precedence is injury > illness > niggle
> recovery constraint > normal, exhaustive over all twelve ordered pairs.
Missing safety data resolves UNREADABLE and refuses — the branch carries no
`rank`, so the code does not compile until the caller branches.

What exists in production, measured:

| state | reality |
|---|---|
| open injury | one row in the whole table, on a test account, not yours |
| illness | 2 rows, both yours, both cleared 2026-05-29 |
| niggle / pain | **0 rows. Ever. For anybody.** |
| return-to-running | **0 check-ins ever** |
| disruption | one 8-day gap, 2026-06-28 to 07-05 |

It fires on real history: the injury account resolves HARD_STOP today, and you
resolve CONSTRAINED across 07-05..19 off that real gap, clearing exactly at
doctrine's day 14.

A doctrine finding came with it: the niggle caution threshold was 5 under a
header asserting no research gives a 1-10 pain scale a band. `Research/05` §1.2
does, and always did — "3-5: amber. Hold current load; do not progress."
Corrected to 3.

---

## 6 · Gates that could not fail, found by falsifying them

Six this session, each fixed:

- The **canonical engine seal** matched `import ... from` only, so any file could
  write `export { X } from '@/lib/adaptation/canonical/...'` and hand the symbol
  to anyone with every guard reporting clean. Found by adding an allowlist entry
  and discovering that deleting it changed nothing.
- My **Rule 9 continuity walk** asserted the verdict flipped at most once — which
  a hard threshold also satisfies. Now walks the derivative.
- The **threshold owner scan** passed when the seeder called the canonical
  resolver and discarded its result.
- The **URL join gate** failed to fail on the real defect, because it matched
  inline literals and the defect binds `let path` on the line above.
- The **volume merged-row plant** left the suite green through two drafts.
- Three of the **shadow gates** passed on first attempt and were rewritten.

## 7 · What is still not done

- **The loop does not run in production.** 8 of the 16 orchestration steps are
  wired, 3 shadow, 4 unwired, 1 not built. The stages compose in scratch;
  nothing composes them on the nightly path. `WIRED_STEP_PIN` was deliberately
  not raised — raising it because a test assembled the stages by hand is exactly
  the claim this project keeps retracting.
- **Step 16 does not exist.** Nothing re-reads a decision after its reassessment
  date to record whether it was right. That is the step that would let the
  engine learn from being wrong.
- **A decline is not in the ledger.** It performs no mutation and `mutatePlan`
  is the ledger's only writer, so the census cannot see refusals.
- **HOLD and SAFETY_STOP cannot be produced by any live path** — they were
  seeded directly for the screenshots.
- **12 of 21 action kinds have a live generator**; 23 facet gaps remain on the
  ratchet, the largest cluster being undo.
- **`plan_weeks.user_uuid` is NULL on all 15 weeks of your live block.** Any
  reader scoping weeks by it sees a block that ended 2026-08-24.

## 8 · What needs your go

1. **`DATABASE_URL_RO` on the Railway service** — the actual remedy for §2.
2. **Migrations 166 and 167.** The packet is complete: every statement,
   permissions (nothing to grant; the app runs as owner and default privileges
   already cover the read-only role), locking (no statement touches an existing
   relation), deployment ordering in both directions, failure recovery, expected
   row counts, and read-only verification queries.
3. **A TestFlight build** — the Accept-button fix is native code and cannot
   reach your phone without one.
