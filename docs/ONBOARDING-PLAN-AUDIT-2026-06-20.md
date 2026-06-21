# Onboarding → Plan-Creation Audit — 2026-06-20

## Verdict: **58/59 input combinations produce a sane plan**

Every realistic onboarding input — across experience level, training frequency
(0–6 days/week), current volume (0–45 mi/week), and goal distance (5K → 100K),
on both the goal and race paths — generates a structurally sound training plan.
The single exception is a physically impossible input that fails *safely* (see
Limitations).

This audit was run live against **prod** (`www.faff.run`) through the real
onboarding + goal/race APIs, pulling the actual `plan_workouts` rows and
asserting plan shape.

---

## Scope — the input space tested (59 cases)

| Dimension | Values |
|---|---|
| Experience | beginner, intermediate, advanced, null |
| Frequency | 0, 1, 2, 3, 4, 5, 6 days/week |
| Volume | 0, 5, 15, 25, 35, 45 mi/week (+ matching history bands) |
| Goal distance | 5K, 10K, Half Marathon, Marathon, 50K, 100K |
| Plan length | 4 (min runway), 12, 24 weeks |
| Path | goal (`/api/profile/goal`) AND race (`/api/race`, with race date + start date) |
| Edges | sedentary 0-day, 1-day×Marathon mismatch, advanced 6-day high-volume short race, null experience |

Harness: `web-v2/scripts/_audit_onboarding_plan_matrix.mjs` (re-runnable;
`node scripts/_audit_onboarding_plan_matrix.mjs`, exit 0 = all pass).

---

## Invariants verified — per plan, every week

1. **Generates** — no `PlanValidationError`, no null plan.
2. **long ≥ easy** — the long run is always the longest easy/steady run (no inversion).
3. **Quality not dwarfing** — the interval/tempo session doesn't exceed ~1.5× the long run or ~60% of the week.
4. **7 contiguous days** — exactly seven distinct calendar days per week (no dup pills, no gaps).
5. **Progressive ramp** — week 0 below peak; no cold-start jump to peak.
6. **Real taper** — race-week *training* volume (excluding the race itself) drops below peak.
7. **Quality has pace + spec** — every interval/tempo row carries a target pace and a structured workout spec.

---

## Bugs found + fixed (this session)

| # | Bug | Fix |
|---|---|---|
| 1 | `experience_level` collected at onboarding but never persisted → everyone defaulted to *intermediate* | Persist to `profile.experience_level` |
| 2 | DB `CHECK` constraints rejected 0–5 mi / 0–2 days → low-volume beginner onboarding hard-failed | Migration 148 widens both constraints |
| 3 | True-beginner support: freq 1–2 ignored (cap disabled → 5–6 days), no 0-day handling, 10mpw floor too high | Respect 1–2 as a cap, freq 0 → 3-day couch-to-X, beginner floor 6mpw |
| 4 | **Inverted plan** — long pinned at the tier cap while weekly volume dumped onto the easy day (Lilley: 3mi long / 9mi easy every week) | Invariant: easy can never exceed the long |
| 5 | Week strip `21 21 … 27` — `/api/plan/week` emitted one row per workout, doubling run+strength days and gapping rest days | Collapse to one running workout per day, emit exactly 7 contiguous days |
| 6 | Corruption check rejected a legitimately smaller plan (marathon→5K, or a cold-start beginner) by comparing to the active prior plan | Skip on a user-initiated fresh target (only meaningful for same-goal regens) |
| 7 | Quality session over-prescribed for beginners (5×800m = 5.7mi in a 9.7mi week) | Scale warmup/cooldown + rep count to the quality-day budget |
| 8 | **Inversion on cutback/taper weeks** — long-smoothing + taper rescale trim the long *after* the easy clamp | Final easy≤long sweep after all volume adjustments, incl. the race day in short-race weeks |
| 9 | **freq=1 plans failed to generate** — validator required a quality session every quality week, impossible on 1 run/week | Skip the quality-coverage rule at ≤1 day/week |

Goal/race also now capture **"when do you want to start"** (goal anchors week 0
there; race runway = start → race date), which the onboarding flow no longer
asks (there's no goal yet at onboarding).

---

## Limitations (1)

**`1 day/week + Marathon`** — generates no plan. A single weekly run *is* the
weekly volume, so ramping toward marathon volume forces a >50% week-over-week
jump, which the progression validator rightly rejects. This is the **sane**
outcome: the app declines to author an unrunnable marathon plan rather than
fabricate one. It fails safely — the goal is saved, nothing crashes, no broken
plan is written.

Future improvement (not a bug): surface a "add more running days or pick a
shorter race" message for this case, and/or cap a low-frequency plan's peak
volume to what the frequency can support so even extreme mismatches author a
(clearly under-built) plan.

---

## Status

All nine fixes are committed and **deployed to prod**; the native onboarding +
goal/race date pickers shipped in **TestFlight build 227**. Re-running the
harness after deploy: **58/59 PASS**.
