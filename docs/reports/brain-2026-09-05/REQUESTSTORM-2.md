# REQUESTSTORM-2 · the flood, and the accept flow proved

2026-09-05 · branch `requeststorm-2` off `origin/main` @ `ec6e4c608`. Not merged.

---

## PART A · THE MEASURED CAUSE OF THE FLOOD

**It is not a loop, not a scheduling bug, and not a throttle problem. The phone
sends a payload roughly 250x larger than the only thing anyone reads, and the
size itself is what corrupts the data.**

### The arithmetic, from the owner's own request log

Entries #71-#91 of his 98-request log are 21 sequential `POST /api/ingest/health`.
`postHealthSamples` chunks at 500, so that import carried **10,001-10,500
samples**. Subtracting the ~130 non-active-energy rows a 7-day window produces
(22 sample types, mostly one per day) leaves **~10,300 active-energy buckets —
about 1,470 per day**, which is exactly the rate a worn Apple Watch emits
`activeEnergyBurned` at. The count identifies the import: `daysBack: 7`, the
cold-launch path at `FaffApp.swift:333`, not the 30s-throttled foreground one.

### Why that payload had no reader

`activeEnergySamples` shipped raw buckets, and its own comment gave the reason:
`resolveCalories` tier 2, which summed them inside a run's time window.

**That tier was deleted on 2026-08-24.** `web-v2/lib/runs/energy.ts`'s header
says so at length, and `energy.test.ts:135` asserts it stays deleted. The only
surviving consumer is `lib/coach/health-state.ts`, which does
`SUM(value) GROUP BY sample_date` — a daily total. And `health_samples` carries
`UNIQUE (user_id, sample_type, sample_date)`, so **one row per day is all the
table can physically hold**. Production, read-only, 2026-09-05:

```
active_energy rows: 135    distinct dates: 135    (never two rows for one day)
```

### And the chunking silently destroyed the total

The ingest route pre-aggregates active_energy by date — correctly — but it does
so **per request body**, and the upsert is last-write-wins. Splitting one day
across up to 21 bodies means the stored value is whatever the final chunk
holding that date contributed. Measured on the owner's 135 stored days:

```
days                135
under 100 kcal       54   (40%)
under  60 kcal       47
under  20 kcal       37   (27%)
min 0.1 · max 3706 · mean 365.2 · median 220.9
```

Joined against what he actually ran those days:

| date | stored active_energy | miles run |
|---|---|---|
| 2026-08-23 | **11.4 kcal** | 11.01 |
| 2026-07-14 | **2.1 kcal** | 8.02 |
| 2026-08-24 | **1.1 kcal** | 4.02 |
| 2026-07-07 | **2.2 kcal** | 7.56 |
| 2026-08-01 | **1.8 kcal** | 4.16 |
| 2026-09-03 | **14.2 kcal** | 9.19 |
| 2026-08-17 | **0.1 kcal** | 0.00 |

Eleven point four kilocalories for an eleven-mile day. Every one of those rows
is internally well-formed, which is why nothing caught it — the same shape as
Rule 10's stale-but-perfect HR-zone distribution.

### What changed

1. **The phone sums the day itself.** `activeEnergyDailyTotals` (was
   `activeEnergySamples`) emits ONE row per calendar day, keyed by the same
   `isoDay` the per-bucket path used so the stored day-bucketing does not move.
   `~10,300 samples → ~7`. One import's health payload goes from **21 POSTs to
   1**, and the day's total arrives whole in one body where no chunk boundary
   can cut it. This is not a throttle: the phone sends less because there was
   never anything on the other end that wanted more.
2. **Strength stops re-POSTing what has not changed.** `syncStrengthFromHK`
   POSTed every workout in its 28-day window on every import — the 5
   `/api/strength` calls in his log, forever, resending identical rows. The
   UUID cache it needed was already being written twenty lines below and was
   only ever read by the delete-diff. Now keyed on uuid + a content fingerprint
   (`date|type|minutes`), so an edited session still re-posts and an unchanged
   one does not. Recorded only after a confirmed 2xx; a failure leaves no
   fingerprint so the next import retries.
3. **The banner.** `API.authedSend` posts `.faffReachabilityLost` on any
   transport error, and `RootTabView` shows "can't reach faff" for six seconds
   and auto-hides — which is precisely "See the banner but then it went away."
   One foreground import gave that **26 chances to fire** (21 health chunks + 5
   strength) over a screen that was perfectly current. `authedSend` now takes
   `announcesReachability: Bool = true`; background ingest passes `false`.
   Rule 11 is intact: the error still throws, is still recorded in
   `RequestDiagnosticsLog` with its real outcome, and still counts toward
   `StuckConnectionMonitor` (whether the POOL is dead is a question about the
   pool, not about who asked). Only the runner-facing global claim is withheld.
4. **The server reports the fragment shape instead of quietly summing it.**
   `lib/health/active-energy-batch.ts` is now the one place that aggregates,
   and it returns `bucketShapedDates` — dates for which a single body carried
   more than one active_energy sample, i.e. the sender is shipping buckets. The
   route warns loudly and returns it. It cannot repair a fragment (only the
   client holds all the buckets), but it can no longer be silent about one.

### What I did NOT do

**The 54 corrupt production days are still corrupt.** No code change repairs
historical rows. Repairing them means re-ingesting active energy from HealthKit
on the phone for that window, or a direct write — both need David's explicit go
per CLAUDE.md, and neither has one. Flagged, not executed.

---

## PART B · THE ACCEPT FLOW, PROVEN

Rendered against a **scratch** copy of the owner's real data:
`faff_requeststorm2`, built by the existing `scripts/walk-substrate.sh` (which
reads production only through `DATABASE_URL_RO` and reports **"3 statements
issued by this process, 0 mutating"**). Migrations 166/167/168 applied there
only. Server on `:3111` via `walk-server.sh`; the session token exists only in
the scratch database, so an authenticated 200 is proof of which database is
being read. Simulator build signed, `-derivedDataPath`, `-faffHost
http://127.0.0.1:3111`.

The proposal was written by the app's **own writer** (`writeWorkoutProposals`),
not by hand — and it refused the first attempt because the reason named a
disposition rather than a fact, which is that gate working.

### The 14 steps

| # | step | evidence |
|---|---|---|
| 1 | proposal appears on Today | `acceptwalk-01` · PULL BACK / PROPOSAL card under DECISIONS |
| 2 | details loads | `acceptwalk-02` · THE REASONING, evidence used, sessions affected |
| 3 | Accept sends the production-shaped path | server log: `POST /api/plan/workout-proposals/6/accept` — no `www.faff.runapi` |
| 4 | server receives it | `POST /api/plan/workout-proposals/6/accept 200 in 1691ms` |
| 5 | before-state validation passes | ledger `proposal.action.before = [{type: tempo, distanceMi: 6.2, ...}]`, `mutation_violations: []` |
| 6 | authority is RUNNER_ACCEPTED | ledger `authority = RUNNER_ACCEPTED`, `authority_verdict = PERMITTED` |
| 7 | scratch plan mutation applies | `plan_workouts wko_1cf8cd95971f2226` tempo 6.2 → **easy 6.2**; `mutation_outcome = applied` |
| 8 | ledger records | `plan_decision_ledger` 0 rows → 1 row, full before/after/explanation |
| 9 | Today refreshes | `acceptwalk-03` · DECISIONS block gone |
| 10 | Coach Decisions shows the applied result | `acceptwalk-04` · SETTLED · "PULL BACK · YOU SAID YES" + Take it back |
| 11 | Watch payload reflects it | `/api/watch/today?date=2026-09-08` → `name: "EASY"`, `summary: "6.2 mi · Easy aerobic"`, phase `6.2 mi easy` @ 537 s/mi |
| 12 | undo restores the original | `POST .../6/undo 200`; row back to **tempo 6.2**; proposal `pending`; second ledger row `runner_response DECLINED`. `acceptwalk-05` |
| 13 | decline records, no mutation | `POST .../6/dismiss 200`; `/api/v5/decisions` → `outcome: "declined"`; plan row **unchanged** at tempo 6.2 |
| 14 | a server failure is VISIBLE | `acceptwalk-06` (real 409, amber Alert) and `acceptwalk-07` (dead server, red ErrorNote) |

Step 14 used a **real** server refusal, not a synthetic one: the session was
moved under the pending card, and the route answered

```
HTTP 409
{"ok":false,"error":"stale","detail":"workout wko_1cf8cd95971f2226 is now 9 mi"}
```

Before this change that produced **nothing at all** on screen. It now draws the
attention treatment: *"This session has changed since the coach proposed it, so
the decision no longer fits. It will be raised again against the session as it
stands."* `detail` is never printed — it names a row id and is machine text.

### Every swallowed error removed

| id | site | was | now |
|---|---|---|---|
| SE-1 | `TodayBeforeV5.swift:557` | `_ = try? await API.answerProposal(...)` then an unconditional refresh — a failed tap and a successful one rendered identically. **This is the hole the build-282 URL bug lived in for its whole life.** | three-way switch. `.ok` refreshes and posts `.faffPlanMutated`; `.refused` prints the engine's sentence as `Alert`; `.failed` and a thrown error print `ErrorNote` and deliberately do NOT refresh |
| SE-2 | `APIV5.swift answerProposal` | returned a bare `Bool` and discarded the response body — the last write in the file still collapsing a refusal at the transport | returns `V5Write` (`.ok`/`.refused`/`.failed`); the 409 is translated by STATUS, the way `postRaceResultOutcome` handles its 404. The URL-build failure now throws instead of returning `false` having sent nothing |
| SE-6 | `RescheduleV5.rescheduleWrite` | a 2xx whose body would not decode returned `.failed`, whose copy is *"That did not go through, and nothing was changed. Try again."* — asserting the opposite of what happened over a plan that HAD moved, and inviting a duplicate write | new `.appliedUnreadable` → `.doneUnreadable` stage: says the change landed, re-syncs the block, offers no Undo (there is no `decisionId` to undo with, and a button that cannot work is a new lie) |
| SE-7 | `RescheduleV5.undoReschedule` | `(body?.ok ?? false)` — a 2xx omitting `ok` printed *"Your plan is as the change left it."* over a plan that had been put back. The identical incident this file already documents from 2026-09-02 | `.undoneUnreadable`; a 2xx is the server saying it did the thing |
| SE-4 | `HostsV5.swift undo` | captured `status` for the 409 and never read it; every non-ok landed on `state = .failed`, which replaces the whole loaded history with the outage body — a coach that answered clearly drawn as a coach we could not reach | three renderings: transport failure → outage; 409 → the record stays on screen under an `Alert`; anything else → outage |
| SE-10 | `APIV5.swift V5Today` | `proposals`/`proposalsRead` decoded with `opt` (`try?`), so a PRESENT-but-malformed list became `[]` and the section drew nothing — **silently defeating the careful three-state guard directly above it** | a decode failure resolves to `proposalsRead = "failed"`, which the surface already knows how to draw. Absent stays absent |

Plus one found by walking it rather than reading it: **a successful take-back
did not tell Today.** The decision correctly returned to STILL OPEN on the
Decisions screen while Today went on showing no decision at all until the runner
happened to pull to refresh. `undo` now posts `.faffForegroundRefresh` too.

---

## FALSIFICATIONS (Rule 18) · verbatim

**1 · `active-energy-batch.test.ts`, sum replaced with last-write-wins** (the
database's own shape):

```
× sums every bucket for a date rather than keeping the last one 4ms
AssertionError: expected [ { sample_date: '2026-08-23', …(1) } ] to deeply equal [ { sample_date: '2026-08-23', …(1) } ]
Tests  1 failed | 7 passed (8)
```

**2 · same file, fragment reporting silenced** (`bucketShapedDates` always `[]`):

```
× names every date this body carried as buckets 3ms
AssertionError: expected [] to deeply equal [ '2026-08-23', '2026-08-24' ]
Tests  1 failed | 7 passed (8)
```

**3 · `ActiveEnergyAggregationTests`, per-bucket shape restored** — 7 of 9 failed;
the two that matter:

```
XCTAssertEqual failed: ("1470") is not equal to ("1") - 1,470 HK buckets in one
day must produce ONE row. 1470 rows is the request flood.

XCTAssertEqual failed: ("Optional(1.0)") is not equal to ("Optional(1000.0)") -
The day's total must be the sum of every bucket, not a fragment of it.
```

That second number is the production defect exactly: a day's whole energy
reduced to one bucket's worth.

**4 · `check-background-ingest-voice.sh`, parameter dropped at a call site:**

```
check-background-ingest-voice: FAIL · native-v2/Faff/Faff/HealthKitImporter.swift:1836
  request built at line 1808 for api/ingest/health
  let (data, http) = try await API.authedSend(req)
  This is a BACKGROUND INGEST write and it does not say whether
  it may raise the global "can't reach faff" banner.
```

(also named the `/api/ingest/workout` site, 2 findings, exit 1)

**5 · same gate, parameter kept but no longer gating the post:**

```
check-background-ingest-voice: FAIL · native-v2/Faff/Faff/API.swift posts .faffReachabilityLost
  without gating it on announcesReachability. The parameter is now
  decoration, which is worse than not having it (Rule 20).
```

**6 · same gate, liveness — ROOT at a real directory with no Swift:**

```
check-background-ingest-voice: FAIL · read 0 Swift files under web-v2/lib/health.
```

**7 · same gate, liveness — the endpoint list gone stale:**

```
check-background-ingest-voice: 0 ingest request site(s), 0 checked, 0 unchecked, across 332 Swift files
check-background-ingest-voice: FAIL · found 0 request sites for any of:
    api/ingest/health-RENAMED · api/ingest/workout-RENAMED · api/strength-RENAMED
  Reporting clean on zero sites is the worst outcome available (Rule 18).
```

**8 · `check-v5-url-join.sh` widened, then falsified on the file it used to be
blind to.** The audit found the gate hardcoded `FILE=".../APIV5.swift"` while
`RescheduleV5.swift:255` performs the identical `baseURL.absoluteString + "…"`
join, entirely outside the scan. Scope is now discovered at run time. Dropping
the leading slash there:

```
check-v5-url-join: scanning 2 file(s) · 5 concatenation(s), 8 v5() call(s)
  FAIL native-v2/Faff/Faff/ViewsV5/RescheduleV5.swift:279 · path "api/plan/reschedule" (inline) has no leading slash.
      https://www.faff.runapi/plan/reschedule — a host that does not exist.
```

**9 · The `_format_lint` ratchet falsified itself, unprompted.** Moving the
kcal rounding out of the ingest route made its allowlist entry stale, and the
gate refused to pass until the entry moved with the code. Entry rewritten with
an honest reason (it rounds a kilocalorie total, not a distance/pace/clock;
`lib/format/run.ts` has no kcal formatter to route it through).

---

## VERIFICATION

```
npx tsc --noEmit                clean
npx vitest run                  11,318 passed, 1 failed, 1 expected fail, 157 skipped
npm run prebuild                exit 0  (26 gates, including the new one)
npx next build                  exit 0  (Rule 19 · the step the chain used to stop before)
xcodebuild build                BUILD SUCCEEDED
xcodebuild test (new gate)      9/9
check-xcodeproj-sync            258 files, 258 references
```

The one vitest failure is `_authoring_shadow_compare.audit.test.ts`, which
refuses to report green without `DATABASE_URL_RO` — correct Rule 18 behaviour,
not a defect. **In isolation with the credential: 3/3 passed.**

`_durability_anchor.audit.test.ts` passes in the full suite. It fails only under
my hand-exported environment with `Error: The server does not support SSL
connections`, thrown by `pg` at connect time before any application code runs.
Nothing in this diff touches connection setup. Stated rather than papered over.

`AUTOMATIC_ADAPTATION_AUTHORITY` is untouched and still the literal `false`.

---

## WHAT I COULD NOT PROVE

- **That the flood is fixed on the owner's phone.** Everything above is
  measured on his data and his code paths, and the arithmetic is
  deterministic, but the simulator has no HealthKit history — no simulator run
  can post 21 chunks, so the 21→1 claim rests on the sample count and the
  aggregation gate, not on a rendered import. It needs one foreground on a real
  phone with a TestFlight build, and I have not shipped one.
- **That the ledger sees a decline.** A dismiss writes `status = 'dismissed'`
  and shows correctly on Coach Decisions, but writes **no `plan_decision_ledger`
  row** — the ledger held 2 rows (accept, undo) and stayed at 2 through the
  decline. Rule 21 asks every adaptation to record what it did and on what
  evidence; a runner declining is a decision the ledger currently cannot see.
  Out of scope here, and left as a finding rather than a change.
- **Whether the pull-to-refresh hang is a defect.** While the server was
  suspended mid-refresh the whole Today screen stopped accepting input, and
  recovered the instant the server came back. That is consistent with SwiftUI's
  `.refreshable` holding the scroll view for the life of its async closure
  rather than with a blocked main thread, and I did not instrument it far
  enough to say which. Worth a look; I am not claiming a diagnosis.
- **The historical repair.** See Part A.

## TEAR-DOWN

```
dropdb -h localhost faff_requeststorm2
rm -f web-v2/.walk-session-token
```
