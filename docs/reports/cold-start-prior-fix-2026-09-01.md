# Cold-start canonical prior fix — self-reported onboarding mileage wired into `capacity-resolver.ts`

**Scope note, stated up front per the same discipline the earlier canonical-
authoring-migration report used for its own merge-safety call.** The bug this
fixes (`docs/reports/canonical-authoring-migration-2026-09-01.md` §5.1) lives
in `web-v2/lib/training/capacity-resolver.ts`'s `loadVdotFallback`. That file
is **not** shadow-only — `lib/training/load-prescription-anchors.ts`,
`lib/training/prescription-resolver.ts`, `lib/training/coaching-thesis.ts` and
`lib/adaptation/load-adaptation-engine.ts` all call its four resolvers
directly, and those are the functions `recompute-paces.ts` / `reanchor-plan.ts`
already call in production, nightly, for every runner's unrun days. So this
fix has a bigger blast radius than the shadow-only `canonical-authoring-
migration-20260901` branch was scoped to carry, and it is **not** committed
there. It lives on its own branch, **`cold-start-prior-fix-20260901`**,
branched from that same commit (`8641a234`), pushed on its own, not merged and
not pushed to `main`. §3 below is the direct proof that this change does not
alter what the already-deployed resolvers return for any account that carries
real evidence — that is the property that makes a same-file, different-branch
change defensible to review independently of the shadow-compare work.

---

## 1 · The bug, restated precisely

`docs/reports/canonical-authoring-migration-2026-09-01.md` §5.1: a brand-new,
zero-run account's canonical threshold pace floored to VDOT 30
(`conservativeVdotFromMileage(0)`, ≈10:42/mi) regardless of what the runner
typed at onboarding about their own running history, because
`capacity-resolver.ts`'s `loadVdotFallback` never read
`profile.history_avg_weekly_mi` — the same self-reported weekly mileage the
**legacy** VDOT cascade (`generate.ts`'s `COLD-2`/`HIGHVOL-1` comments) has
always seeded a zero-run account's cold-start floor from. Measured on real
accounts: **~35-39% slower** than the legacy path for the same runner.

## 2 · The boundary preserved, and how

**Self-reported onboarding mileage informs a low-confidence prior. It never
masquerades as demonstrated capacity.** Concretely:

- `SourceMode.user_prior` already existed in `capacity-resolver.ts` for
  exactly this shape ("a self-reported ability, unverified by any running")
  and was already ranked strictly between `vdot_fallback` and
  `population_prior` in `SOURCE_MODE_STRENGTH` — **declared and ranked, never
  once assigned.** No new `SourceMode` was needed; only the missing wire,
  confirming the task brief's own suspicion.
- A new confidence band, `CAPACITY_CONFIDENCE_BANDS.userPrior = 0.15`, flat,
  strictly between `fallbackFloor` (0.20) and `populationPrior` (0.10) — never
  touching the fallback band (a self-report is still not an observation of the
  runner running) and never equal to the population floor (a self-report IS
  runner-specific, unlike knowing nothing). See the constant's own doc comment
  in `capacity-resolver.ts` for the full argument.
- The self-report is **only** eligible to substitute into the existing
  mileage-based rung's `weeklyMi` input — the exact same `conservativeVdotFromMileage`
  conversion the population-prior rung already used, monotonic, bounded,
  conservative, unchanged. It is never used to fabricate a VDOT, a race
  result, or an evidence id (`evidenceIds` stays `[]` at this rung, same as
  `population_prior`).
- **The substitution fires only when the runner's own Rule-8-filtered real
  training data reads zero or refuses.** The moment any real logged mileage is
  nonzero — however small — it wins automatically, with no special-case code:
  `priorWeeklyMi`'s first branch is `if (real > 0) return { weeklyMi: real, ... }`,
  before the self-report is even consulted. This is the "explicit replacement
  behavior" the brief asked for, and it falls out of the existing
  confidence-weighted composition rather than needing new transition logic.

## 3 · Blast radius — proof, not assertion, that this is additive for every real-evidence account

**The question:** does this change alter what the already-deployed capacity
resolvers return for any existing real account with real evidence?

**The answer: no. Proven three ways.**

### 3a · By construction

The only line that changed behavior is `priorWeeklyMi`'s guard:

```ts
const real = r.ok ? r.value : 0;
const refused = !r.ok;
if (real > 0) return { weeklyMi: real, refused: false, usedSelfReport: false };
```

Any account whose Rule-8-filtered normal weekly mileage (`normalWeeklyMi`) is
a real nonzero number takes this branch and returns **exactly** what
`priorWeeklyMi` returned before this change — same `weeklyMi`, same
`refused`, and (new field) `usedSelfReport: false`, which downstream maps to
the same `population_prior` sourceMode and the same `fallbackConfidence`/
`populationPrior` confidence as before. The self-report is never consulted.
Direct-tier evidence (`resolveThresholdPaceCorpus`/`resolveEasyPaceCorpus`,
tier 1 of both ladders) is untouched by this diff entirely — no line inside an
`if (direct.ok)` branch changed.

### 3b · By this database's actual population

Queried fresh against the read-only role (`faff_readonly`), every account this
database holds:

| Account | Runs |
|---|---|
| `dnitch85@me.com` (the owner) | **272** |
| 15 QA/test seed accounts | **0**, every one |

There is no account in this database with *partial* evidence (some real runs,
short of the direct-tier bar) to worry about — the population is exactly two
shapes: one real, evidence-rich account, and fifteen genuinely zero-run
accounts. That makes the blast-radius question empirically checkable in full,
not just arguable from the code.

### 3c · Direct before/after diff on the owner's real account

Ran all four resolvers (`resolveThresholdCapacity`, `resolveHighIntensityCapacity`,
`resolveEasyCeiling`, `resolveDurability`) against the owner's real account
(`0645f40c-951d-4ccc-b86e-9979cd26c795`, `todayISO=2026-08-31`, 272 real runs,
real races), captured the full JSON (every field except the wall-clock
`resolvedAt` timestamp, which necessarily differs run to run), reverted
`capacity-resolver.ts` to its pre-fix state, ran again, and diffed:

```
diff owner-before.json owner-after.json
(no output — exit 0)
```

**Byte-identical.** The owner's threshold read stays `direct`, conf 0.79,
7:00/mi; high-intensity `vdot_fallback`; easy `direct`; durability unchanged —
none of it moved. This is the same account
`_capacity_resolver.audit.test.ts` (unmodified, pre-existing) already asserts
against, and it still passes.

## 4 · Falsification (Rule 18)

Six new tests in `web-v2/lib/training/_capacity_resolver.test.ts` (3e-1
through 3e-5, plus 4a-1) target this fix specifically. Run against the
**unfixed** code (temporarily reverted `capacity-resolver.ts`, `git checkout
--`, test file left in its fixed state):

```
✗ 3e-1 · a zero-run account with an onboarding self-report gets `user_prior`, not the flat population floor
✗ 3e-2 · the self-report never crosses into direct/inferred, and is capped by the same monotonic conversion
✗ 3e-4 · self-report substitutes on a REFUSED habit window too, and both facts are reported
✗ 3e-5 · HIGH-INTENSITY tier 4 mirrors the same user_prior substitution
✗ 4a-1 · userPrior sits strictly between the fallback floor and the population prior (2026-09-01)
  5 failed, 31 passed
```

`3e-3` ("ANY real logged mileage displaces the self-report automatically")
correctly **passed** against the unfixed code too — it asserts the
pre-existing `population_prior` behavior for a nonzero real-mileage account,
which this fix does not change. That is the intended, checked asymmetry: the
new tests fail exactly where the fix is supposed to change behavior, and pass
exactly where it is not.

Restored the fix; all 36 tests in the file pass. `tsc --noEmit`: clean.

## 5 · Real-account before/after — the numbers the fix actually moves

Via `lib/plan/_authoring_shadow_compare.audit.test.ts`'s corpus sweep (the
same harness the migration report used), run against the DB-backed accounts —
captured first-hand in this session, both states, not copied from the prior
report:

| Account | Legacy T (unchanged) | Canonical T · BEFORE | Canonical T · AFTER | sourceMode before → after |
|---|---|---|---|---|
| `qa-phone-onboard-…` | 7:42/mi | 10:42/mi (+180s, 39.0%) | **9:23/mi (+101s, 21.9%)** | `population_prior` (0.10) → `user_prior` (0.15) |
| `qa-race-…` | 7:56/mi | 10:42/mi (+166s, 34.9%) | **9:23/mi (+87s, 18.3%)** | `population_prior` (0.10) → `user_prior` (0.15) |
| `apple-review@faff.run` | 7:43/mi | 10:42/mi (+179s, 38.7%) | **8:23/mi (+40s, 8.6%)** | `population_prior` (0.10) → `user_prior` (0.15) |
| `qa-phone-verify-…` | 10:42/mi | 10:42/mi (0s) | 10:42/mi (0s, unchanged) | `population_prior` (unaffected — `history_avg_weekly_mi = 0`, a genuine "I don't run yet" self-report, correctly never substituted) |

The divergence roughly halves to a third across the three affected accounts —
**closed to something reasonable, not necessarily to zero**, exactly as
scoped. `qa-phone-verify` is untouched because its own self-report is a real
zero (`ZEROSAY-1`), which this fix's `> 0` gate correctly declines to spend —
proof the fix does not manufacture a prior out of an absent answer.

### 5.1 · Why a residual gap remains, and why it is not this fix's bug

Traced to source, not assumed. `qa-phone-onboard`, `qa-race` and
`apple-review` all carry a **stated race goal** (goal seconds 6120/6300/12600).
The "legacyT" figure above is `composePlan`'s **goal-blended** plan-wide
`tPaceSec` — legacy's goal-blend logic (Pace Prescription territory, not
Capacity) can pull the effective T-pace faster than the raw capacity floor,
bounded by the "achievable floor." Confirmed directly by computing the
**goal-free** legacy capacity floor for the same three accounts
(`tPaceFromVdot(conservativeVdotFromMileage(compose.recentWeeklyMi))`, no goal
blend):

| Account | Legacy goal-blended (printed as "legacyT") | Legacy goal-free capacity floor | Canonical AFTER (goal-free, this fix) |
|---|---|---|---|
| `qa-phone-onboard-…` | 7:42/mi (462s) | **9:23/mi (563s)** | **9:23/mi (563s)** |
| `qa-race-…` | 7:56/mi (476s) | **9:23/mi (563s)** | **9:23/mi (563s)** |
| `apple-review@faff.run` | 7:43/mi (463s) | **8:23/mi (503s)** | **8:23/mi (503s)** |

**Exact match, every account, once the goal-blend is removed from the
comparison.** This fix makes the canonical capacity resolver land on
precisely the number the legacy mileage-based cascade would produce with no
goal involved — which is the correct, doctrine-required behavior for a
capacity resolver (§6, compile-time goal isolation). The residual gap in the
raw legacy-vs-canonical comparison is Pace Prescription's job (blending a
resolved capacity against a stated goal), explicitly named as **not yet
wired** in the migration report's §2(c) "goal-isolation gotcha" — a different,
already-identified, already-scoped-out piece of work, not a defect in this
fix.

## 6 · Gates and regression

| Check | Result |
|---|---|
| `tsc --noEmit`, whole project | 0 errors |
| `lib/training/_capacity_resolver.test.ts` | 36/36 pass (30 pre-existing + 6 new) |
| `lib/training/_capacity_resolver.audit.test.ts` (owner, real DB) | pass, byte-identical pass-through assertions hold |
| `lib/training/` full suite | 759/759 pass |
| `lib/plan/` full suite | 2047/2047 pass |
| `scripts/check-doctrine.sh` | pass, 662/662, 323 citations |
| `scripts/check-normal-window.sh` | pass |
| `scripts/check-swallowed-failure.sh` | pass, 13 argued exemptions (no new one added) |
| `scripts/check-coercion.sh` | pass, 33 argued exemptions (no new one added — see §7) |
| `scripts/check-generated-content.sh` | pass, 258/258 |
| `scripts/check-coach-voice.sh` | pass |
| `scripts/check-client-graph.sh` | pass, 24/24 |

## 7 · A real finding caught by the gates on first run

`check-coercion.sh`'s Rule 11 scanner flagged the first draft of
`loadOnboardingWeeklyMiPrior`: `n > 0 ? n : null` collapsed a genuine
self-reported **zero** (`HIST_AVG_MIDPOINTS['0'] = 0`, `ZEROSAY-1` — "the
runner said they do not run yet") into the same `null` a **missing** answer
produces. Fixed by restructuring the reader to return the real `0` and let
`priorWeeklyMi`'s own `> 0` usability gate decide whether a zero self-report
is spendable (it correctly declines to) — the policy question belongs one
layer up, not folded into the reader erasing the value before it gets there.
Re-run: clean, no exemption added. This is exactly the incident class Rule 18
says a gate should catch, and it did, on the first run of a genuinely new
reader.

## 8 · Files changed

- `web-v2/lib/training/capacity-resolver.ts` — `loadOnboardingWeeklyMiPrior`
  (new), `VdotFallbackRead.selfReportedWeeklyMi` (new field),
  `priorWeeklyMi` (extended), `composeThresholdCapacity` /
  `composeHighIntensityCapacity` (both tiers 2-4 / tier 4 updated),
  `CAPACITY_CONFIDENCE_BANDS.userPrior` (new), `ONBOARDING_MILEAGE_USER_PRIOR`
  reason code (new). +207/-23 lines including doc comments.
- `web-v2/lib/training/_capacity_resolver.test.ts` — 6 new tests, `emptyFallback`
  extended. +99 lines.

No line of `generate.ts`, `spec-builder.ts`, or the shadow-compare files
changed. No plan any real user reads was regenerated or persisted differently
by this work — it is a read path, and §3 above is the direct evidence that
its output does not move for anyone with real training data.

## 9 · What this pass does NOT do

- Does not wire self-reported **race** history (`profile.race_history`,
  legacy's separate `PARITY-1` mechanism) into the canonical resolver — that
  is a different self-report, feeding a different tier (`measured_vdot`, via
  `bestVdotFromRaceHistory`), and out of this task's explicit scope
  ("self-reported onboarding **mileage**").
- Does not implement goal-blending on the canonical capacity anchors — §5.1
  names this as the actual source of the residual legacy/canonical gap on
  goal-bearing cold-start accounts, and it belongs to Pace Prescription, a
  different owner per the Constitution, already named as unwired work in the
  migration report.
- Does not enable canonical authoring for any real user, and does not merge
  this branch anywhere. `capacity-resolver.ts`'s four resolvers were already
  live (consumed by `recompute-paces.ts`/`reanchor-plan.ts` in production);
  this fix changes what they compute for zero-run accounts only, proven
  additive for every account with real evidence in §3.
