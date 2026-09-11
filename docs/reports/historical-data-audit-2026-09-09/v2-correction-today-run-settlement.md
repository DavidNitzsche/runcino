# Forensic Audit — Correction & Completion Pass (v2)

**Scope:** settle v1's central Domain D dispute (§9 of the consolidated handback) with a live render where possible; fix v1's phase-table arithmetic; and answer four specific sub-questions about stride/recovery pace evidence and the `targetDurationSec`/`prescribedSec` gap. Read-only throughout — one write path was used (see below) and it targets a local throwaway database, never production.

**Commits cited:** `8559245496bf498d3d4b0479e1117ae416988c4a` = the v1 pin (labeled **[PIN]** below). `ae91e30668df7e14b1279cb6e4d20db87de5250e` = current `origin/main` as of this pass (labeled **[MAIN]**). Where behavior differs between them, both are stated. `8559245...` is confirmed `[SOURCE]` to be an ancestor of `ae91e30668...`.

**A methodological note before the findings:** this pass used `docs/VISUAL_WALK_SUBSTRATE.md`'s documented harness (`web-v2/scripts/walk-substrate.sh` + `walk-server.sh`) to stand up a local, throwaway Postgres copy of RUNNER_DAVID's real rows (built from `DATABASE_URL_RO` only) and call the *actual live* `/api/v5/today` route at current `main` against it. The build script itself reports "0 mutating" statements issued against production on every run. This produced genuine `[RENDER]`-grade evidence (the real server code, run against a real copy of the real row) rather than a hand simulation, and is what settles Part 1 below. The substrate was fully torn down (`dropdb` + token removal) at the end of this pass — nothing persists.

---

## PART 1 — The `sectionPieces`/`workoutPhasePieces` dispute: SETTLED

### 1.1 The TestFlight build, and why it matters

**`[PROD-QUERY]` (live App Store Connect API, read-only GET, via `web-v2/scripts/_asc_max_build.mjs` / `_asc_review_status.mjs`):** the highest build ever uploaded for `run.faff.app` is **build 290**, uploaded 2026-09-07T17:20:17-07:00, `processingState: VALID`, `internalBuildState: IN_BETA_TESTING`. No build 291 or later exists on App Store Connect as of this pass (2026-09-09/10). This was independently corroborated `[SOURCE]` by `git log --all` over `legacy/native/.asc.build`'s own commit history (the ship script's counter file, bumped only immediately after a real, verified upload) across every branch reachable in this repo — the most recent entry is the same build 290, and no `chore(ship)`/`TestFlight build` commit postdates it anywhere in `git log --all`.

The commit that shipped build 290 names its own source explicitly: `git log` shows commit `b6bf7c31470a3d6b8d782d7e87b8a0aa608a1981`, message *"chore(ship): TestFlight build 290 · PLANSNAPSHOT-SINGLEFLIGHT-1 / Source commit 0dce24f23..."* `[SOURCE]`. So **build 290's source commit is `0dce24f23617df31b51fc09e8cf438af8acbb074`**, dated 2026-09-07T17:12:10-07:00.

**`[PROD-QUERY]` (`device_tokens` table, `faff_readonly`):** RUNNER_DAVID's most recently-active device token (`last_seen_at = 2026-09-09 23:55:16 UTC`, i.e. the day of the run, after it) carries `app_version = '3.0.1'`. This is **not** a build number — `[SOURCE]` `native-v2/Faff/Faff/NotificationsAppDelegate.swift:71` sends only `Bundle.main.infoDictionary["CFBundleShortVersionString"]` (the marketing version) to `/api/notifications/register`; `[SOURCE]` `web-v2/app/api/notifications/register/route.ts` stores exactly that string into `device_tokens.app_version` and nothing else. The actual build number (`CFBundleVersion`, what `CURRENT_PROJECT_VERSION` is stamped to at archive time) is read only for on-screen display in `SettingsV5.swift` and is **never transmitted to the server anywhere in the codebase** — confirmed by grep across `web-v2/lib` and `web-v2/app/api` for any header, body field, or User-Agent parse that would carry it. Marketing version `3.0.1` has been unchanged since `213bf6d72` (2026-05-30) and covers roughly 200 build numbers, so it cannot disambiguate.

**Conclusion on the build:** `[PROD-QUERY]` + `[SOURCE]` jointly establish that build 290 is the newest build ever made available to RUNNER_DAVID, and it was distributed to internal testers ~40 hours before his run. There is no queryable record of the exact build his phone was running at the moment of the run — that specific fact is `[BLOCKED: CFBundleVersion is never sent to the server by any code path in this repo]`. But since no build newer than 290 has ever existed, and his device was actively in use that day, **build 290 (or something older) is the only possibility** — I treat "build 290, source `0dce24f23`" as the best-evidenced `[INFERENCE]` for what his phone was running, not a certainty.

### 1.2 Is build 290 before or after `154edbf97`?

**`[SOURCE]`, direct `git merge-base` checks:**
- `0dce24f23` (build 290's source) **is an ancestor of** `154edbf97aa87efe597b4666bba14fee2698352a` ("fix(today-after): seven post-run defects on the owner's 2026-09-08 tempo", dated 2026-09-08T11:55:25-07:00).
- `154edbf97` is **not** an ancestor of `0dce24f23`.

So build 290 predates `154edbf97` by about 18.5 hours, and `154edbf97` landed the day *after* build 290 shipped and the day *before* the run.

### 1.3 What `154edbf97` actually did — the piece both v1 passes missed

`154edbf97` touches 12 files including **both** `web-v2/app/api/v5/today/route.ts` (21 lines) **and** `native-v2/Faff/Faff/ViewsV5/TodayAfterV5.swift` (376 lines). Domain D's original pass and its reviewer both debated only the *server-side* `routePhases` construction and the *gated* `sectionPieces.isEmpty ? workoutPhasePieces : sectionPieces` fallback that exists at the pin. Neither noticed that `154edbf97`'s diff **deletes an entire, separate, unconditionally-rendered UI component**:

```diff
-    // MARK: - WORKOUTPHASES-1 · the session's own executed structure
-    /// David, live, on a treadmill interval session: "its not showing my
-    /// treadmill breakdown though. the warm up, hills, etc." — `routePhases`
-    /// (the other candidate for this) is keyed by GPS mile and is always
-    /// empty indoors; `workoutPhases` reads the watch's own completion
-    /// payload directly and carries every phase regardless.
-    private var workoutPhasesTile: some View { ... }
-    private func phaseTrailingText(_ phase: V5WorkoutPhase) -> String {
-        var parts: [String] = []
-        if let clock = ... { parts.append(clock) }
-        if let hr = phase.avgHr { parts.append("\(hr) bpm") }
-        if let speed = phase.speedMph { ... }
-        if phase.completed == false { parts.append("not completed") }
-        return parts.joined(separator: " · ")
-    }
```

This component (`workoutPhasesTile`) was introduced by an earlier commit, `645d540e676a5ab80f3ed8ea88d0868938cdc26a` ("feat: WORKOUTPHASES-1 — the treadmill's own warmup/hills/cooldown breakdown", 2026-09-04T11:12:20-07:00), and was gated like this **`[SOURCE]`, verbatim from the commit immediately before `154edbf97`**:

```swift
if !model.groups.isEmpty {
    groupsTile
} else if !model.workoutPhases.isEmpty {
    workoutPhasesTile
}
```

`model.groups` is *never* populated on an after-run response (confirmed by the surrounding comment), and `model.workoutPhases` reads `runs.data.phases` **directly, verbatim, "NEVER gated on indoor"** (`web-v2/app/api/v5/today/route.ts`'s own `WORKOUTPHASES-1` comment). For today's run this array has 14 real entries. So `workoutPhasesTile` renders **unconditionally** — it does not care whether `sectionPieces`/`routePhases` is empty or not; it is a *second*, independent "Piece by piece" list that appears *higher up* on the screen, before the `breakdownSection` (`sectionPieces`/`workoutPhasePieces`) that both v1 passes exclusively debated. `154edbf97`'s own commit message names this explicitly as its #2 fix item: *"'Piece by piece' rendered twice, back to back, on every structured post-run day."*

Critically, `phaseTrailingText` — the function that rendered each row of this now-deleted tile — **never had a pace field at all**. Its Swift wire type, `V5WorkoutPhase` (`[SOURCE]` `native-v2/Faff/Faff/DesignV5/APIV5.swift:311-325`, quoted verbatim):

```swift
struct V5WorkoutPhase: Decodable, Equatable {
    let type: String?
    let label: String?
    let durationSec: Int?
    let avgHr: Int?
    let maxHr: Int?
    let completed: Bool?
    let speedMph: Double?
    let inclinePct: Double?
}
```

has no pace property of any kind. And it stamps the literal string `"not completed"` for **any** phase type whose raw `completed` flag is `false` — with zero regard for phase type, i.e. it applies the exact same rule to a recovery walk-back as to a stride.

### 1.4 Reconciling with today's data

`[PROD-QUERY]` raw `runs.data.phases` for run `-218380344929823`: 5 of the 6 walk-back recovery phases have `completed: false` (durations 30/43/24/38/8s against a 60s model; only the 61s one is `true`). Feeding these into build-290's `workoutPhasesTile`/`phaseTrailingText` produces exactly: *duration, HR, no pace, "not completed"* for five rows — **precisely** what the background material describes the physical screenshot showing.

### 1.5 What the server-side `routePhases`/`sectionPieces` mechanism *actually* does — confirmed by a live render, not a trace

I hit the real, current-`main` `/api/v5/today` route through the walk-substrate against a full copy of this exact row. `[RENDER]`, verbatim from the response body:

- `routePhases` has **14/14 entries** — one per raw phase, exactly as `web-v2/app/api/v5/today/route.ts:1790`'s `grade.phases.flatMap(...)` construction (filtered only on `mi>0 && sec>0`) predicts. It is **phase-keyed, not GPS-mile-keyed** — confirmed live, not by inference.
- Every recovery phase carries a real, non-null `actual_pace` string: `"12:43"`, `"13:49"`, `"16:44"`, `"12:13"`, `"11:15"`, `"5:05"`.
- Every recovery phase's `verdict`/`status_label` is `null` — never `"not completed"`.
- The literal string `"not completed"` occurs **zero** times anywhere in the ~14KB response body.

This confirms Domain D's *reviewer* was right about the server mechanism at the pin and at current `main`: `routePhases` is phase-keyed, `sectionPieces` (fed by it) has 14 usable entries, and `breakdownPieces` (`sectionPieces.isEmpty ? workoutPhasePieces : sectionPieces`) selects `sectionPieces` — the honest-silence lane, never the fallback that can print `"not completed"`. `[SOURCE]` I additionally traced `phaseVerdictPhrase()` (`RepBreakdownV5.swift:202-226`, quoted in full internally) and confirmed the string `"not completed"` does not exist anywhere in that function for any input — it is structurally impossible for `sectionPieces` to produce it. So *if* the current server logic and a current-`main` client were both live, today's run would show honest pace-carrying rows with no "not completed" label.

One more wrinkle worth naming precisely: **even the actual `154edbf97`/WALKBACK-1 fix authors mis-diagnosed the mechanism.** `154edbf97`'s own surviving comment on the *replacement* fallback (`workoutPhasePieces`, current `main`) still says *"the only structure this screen had: `routePhases` is keyed by GPS mile"* — a claim my own direct trace of `route.ts` disproves for this run. And WALKBACK-1's commit message (`7b0163c85`, 2026-09-09) repeats the identical, unverified "GPS-mile-keyed... can't represent a sub-mile stride+walkback session" framing, and explicitly states its own reverse-falsification *"was reasoned from the 2-line diff rather than executed, due to a disk-space infrastructure failure at the time — noted honestly, not hidden."* So the WALKBACK-1 fix (correct and harmless in itself — it suppresses `"not completed"` for `type == "recovery"` inside `workoutPhasePieces`) was written against a **misdiagnosed** mechanism that had already been fixed structurally weeks earlier (`WORKOUTPHASES-1`/field-name fix, 2026-09-01) and doesn't even fire for this run's data. This is a live instance of exactly the Rule 18/20 pattern this codebase's own CLAUDE.md warns about: a stale comment ("GPS-mile-keyed") was carried forward and cited as the reason for a fix, without anyone re-verifying it against the code it was fixing.

### 1.6 The actual settlement

**Both v1 passes were looking at the wrong mechanism, for opposite reasons:**

- The **original** diagnosis ("routePhases is GPS-mile-keyed, forcing the fallback lane, which prints `not completed`") is wrong about *why*, but its symptom claim was real — it just attributed it to the wrong, already-fixed code path instead of the separate `workoutPhasesTile` that was actually still live on the runner's phone.
- The **reviewer's** rebuttal ("routePhases is phase-keyed, sectionPieces is non-empty, so nothing should be wrong") is **correct about the server/client mechanism it examined**, and is now confirmed by a live render — but it implicitly concluded "so the runner's screen was fine," which does not follow, because it never considered the *separate*, unconditionally-rendered `workoutPhasesTile` that both the original diagnosis and the reviewer missed entirely.

**Current-`main` expected behavior (confirmed live, `[RENDER]`):** no `"not completed"` text anywhere; real pace on every phase, including every recovery. **The exact window at which the physical screenshot's behavior reproduces:** any commit in `[645d540e6 .. 154edbf97)` — i.e. from 2026-09-04T11:12:20-07:00 (introduction of `workoutPhasesTile`) up to but not including 2026-09-08T11:55:25-07:00 (its deletion). Build 290's source commit `0dce24f23` (2026-09-07T17:12:10-07:00) is confirmed `[SOURCE]` to fall inside this window.

**And the practical consequence, which neither v1 pass surfaced:** the fix (`154edbf97`'s deletion of the old tile, plus WALKBACK-1/WALKBACK-2's later patch to the new fallback) is **merged into `main` but has never shipped in any TestFlight build**. Build 290 remains the newest build on App Store Connect as of this pass — confirmed live, seconds before writing this. **RUNNER_DAVID's phone, right now, will still show this exact defect on any future run with a shortened walk-back**, until a new build is archived and distributed. This is the single most actionable fact in this whole Part: the fix exists in source and is dormant, exactly the "wired, tested, inert" failure class Rule 20/21 names elsewhere in this project's own doctrine.

I did **not** attempt an actual Swift-side simulator render of build 290 specifically (which would require building `native-v2` pinned to `0dce24f23`, a meaningfully larger undertaking than the server-side render given this repo's own extensively-documented watch-gate/simulator instability history). I judged the marginal evidentiary value low relative to the cost, given the git-history proof of exactly which code was compiled into the only build ever shipped is already unambiguous, and the server-side mechanism is now confirmed by an actual live call rather than a trace. This is a deliberate, disclosed stopping point, not a silent gap — the JSON fixture delivered alongside this report includes exact instructions (via the walk-substrate) for a future session to build `native-v2` at `0dce24f23` and complete that render if the extra confirmation is wanted.

**Fixture delivered:** `run_-218380344929823_fixture.json` (sent to you as a file) — the real 14 phases, the real `workout_spec`, the live current-`main` server response's relevant fields, and step-by-step reproduction instructions using the repo's own `docs/VISUAL_WALK_SUBSTRATE.md` harness.

---

## PART 2 — Stride/recovery pace evidence: four distinct questions, answered separately

**(a) Does the raw data exist?** Yes. `[PROD-QUERY]`: every one of the 14 raw stored phases carries a positive `actualDistanceMi` and `actualDurationSec` (smallest: idx 12, 0.03mi/8s). Additionally, every phase except the final `overtime` tail carries a watch-computed `actualPaceSPerMi` field directly on the raw JSON (e.g. idx 12: `actualPaceSPerMi: 305`) and a `paceSamples[]` array.

**(b) Is there enough precision to compute an average pace for a segment?** Yes, trivially, by both hand arithmetic and the watch's own stored value. Worked example per the task's own prompt: idx 1 (stride), 0.05mi in 20s → `20/0.05 = 400 s/mi = 6:40/mi`; the watch's own stored `actualPaceSPerMi` for that phase is 399 — a one-second-per-mile agreement. For the shortest recovery, idx 12 (0.03mi/8s): hand arithmetic gives `8/0.03 ≈ 267 s/mi ≈ 4:27/mi` (using the *display-rounded* 0.03mi); the watch's own `actualPaceSPerMi = 305` (≈5:05/mi) is computed from the unrounded GPS distance and is the more precise figure. Both exist; both are usable; this is not a limiting factor.

**(c) Enough precision/density for a finer, short-stride-specific metric (sub-splits, cadence-derived pace curve)?** **No, and this scales with phase length, not with a fixed threshold.** `[PROD-QUERY]`, `paceSamples`/`hrSamples` counts per phase: the long 5.01mi phase carries 507 samples over 2607s (≈1 per 5.1s); every short phase scales the same way — 20-24s phases get 4 samples, the 61s recovery gets 12, and the **shortest phase in the entire run (idx 12, 8 seconds) gets exactly 1 sample** (`{"tSec": 5, "distMi": 0.0186, "paceSPerMi": 413}`). One sample cannot produce a delta, let alone a sub-split or a cadence-derived pace curve within the segment — you need at least two points in time to compute anything about change *within* a phase. The single average-pace value (per (b)) is real and usable; a finer intra-phase metric genuinely is not supportable on the shortest walk-backs, purely because of fixed ~5-second sampling density against sub-10-second phase durations, not because of any GPS/precision limitation on the distance or duration numbers themselves.

**(d) Did the UI choose not to show pace despite (a) and (b) being true?** **Yes — and I can name the exact structural gate, on both sides of the dispute:**

- **The mechanism actually live on RUNNER_DAVID's phone (build 290's `workoutPhasesTile`/`phaseTrailingText`)** never carries pace *at all*, for any phase, of any type — not a threshold, a blanket omission. Quoted above in full (§1.3): the function reads only `durationSec`, `avgHr`, `speedMph`, `inclinePct`, `completed`; its wire type `V5WorkoutPhase` (quoted in full, §1.3) has no pace field. The design comment for this whole mechanism (`WORKOUTPHASES-1`) reasons about a **treadmill** phase specifically ("a treadmill phase has no GPS distance") — correct reasoning for a belt, but it was applied *unconditionally* to outdoor runs too (the gate is never `indoor`-checked), even though outdoor sub-mile phases do have real GPS-derived pace sitting right there in `actualPaceSPerMi`/`paceSamples`, simply never wired into this component's wire type.
- **The current-`main` successor (`workoutPhasePieces`, gated fallback), even post-WALKBACK-1**, makes the same choice even more explicitly, with a direct, quotable comment (`[SOURCE]` `TodayAfterV5.swift`):
  ```swift
  // NOTHING, NOT A DASH. There is no pace to read off a belt
  // phase, and `FaffValue.measured(nil)` would draw a fault-red
  // "—" that means "we tried to read this and could not".
  actualPace: nil,
  askedPace: nil,
  ```
  This is an unconditional `nil`, for the whole component, regardless of phase type or whether real pace data exists for the specific session that happens to fall into this fallback lane.
- **By contrast, `sectionPieces` (the honest, non-fallback lane, confirmed live to be what actually fires for this run) reads real pace unconditionally**: `actualPace: p.actualPace.map { "\($0)/mi" }`, no type-based gate at all.

So the answer to (d) is precise: the UI's pace-suppression is real, structural, and correctly reasoned for a treadmill — but it was written into a component whose *gating condition* (raw-phase-non-empty) does not distinguish indoor from outdoor, so it silently withheld pace on an *outdoor* GPS run too, on the only mechanism actually compiled into what RUNNER_DAVID's phone was running.

---

## PART 3 — Corrected phase table (recovery tolerance math)

**The predicate, quoted exactly** (`web-v2/lib/training/execution-semantics.ts`, both PIN and MAIN — unchanged by the WALKBACK-2 diff in this specific line):
```ts
return known.every(
  (r) => Math.abs(r.actualSec! - r.prescribedSec!) <= r.prescribedSec! * RECOVERY_DURATION_TOLERANCE,
);
```
with `RECOVERY_DURATION_TOLERANCE = 0.5`. For `prescribedSec = 60`, the tolerance is `60 × 0.5 = 30`, and the comparison is **`<=` (inclusive)** — a delta of exactly 30 PASSES.

**Mechanically recomputed against the real data** (verified by a standalone script executing this exact logic, not by hand alone):

| idx | prescribed | actual | Δ = \|actual−prescribed\| | tolerance | v1's table said | **Corrected** |
|---|---|---|---|---|---|---|
| 2  | 60 | 30 | **30** | 30 | FAIL (v1 wrote "Δ36 > 30" — arithmetic error: 60−30=30, not 36) | **PASS** (30 ≤ 30, inclusive) |
| 4  | 60 | 43 | 17 | 30 | (no verdict stated) | **PASS** |
| 6  | 60 | 61 | 1  | 30 | PASS | **PASS** (confirmed correct) |
| 8  | 60 | 24 | 36 | 30 | FAIL | **FAIL** (confirmed correct) |
| 10 | 60 | 38 | 22 | 30 | (no verdict stated) | **PASS** |
| 12 | 60 | 8  | 52 | 30 | FAIL | **FAIL** (confirmed correct) |

**Corrected count: 2 of 6 recoveries fail (idx 8 and idx 12) — 4 pass (idx 2, 4, 6, 10).**

**Does v1's prose count survive?** Yes, by coincidence of independent correctness, not because the table was right: v1's *prose* stated "2 of 6, phases 8 and 12" — which is the mechanically correct answer — even though the *table itself* wrongly marked idx 2 as FAIL via a wrong Δ computation (36 instead of 30) *and* an inclusive-vs-exclusive boundary error (even a correct Δ=30 would need the exclusive reading to fail, and the predicate is inclusive). Two compounding errors in one row, whose conclusion happened not to propagate into the summary sentence. This is worth flagging precisely because it is exactly the shape Rule 18 warns about: a wrong per-row computation sitting next to a right final number, which makes the wrong row easy to trust by association.

**Important downstream correction, found while verifying this:** whether "2 of 6 fail" actually denies the run's `'executed'` verdict is a *separate* question from the tolerance arithmetic, and the answer to that separate question is **no** — see Part 4, which is the more consequential finding of this pass.

---

## PART 4 — Why `targetDurationSec` is null on recovery phases, and where the 60 v1 assumed actually comes from (or doesn't)

**The exact call site**, quoted verbatim (`web-v2/lib/execution/verdict.ts`, unchanged between PIN and MAIN):

```ts
const recoveries = phases
  .filter((p) => p.type === 'recovery')
  .map((p) => ({
    prescribedSec: p.targetDurationSec ?? opts.prescribedRecoverySec ?? null,
    actualSec: p.actualDurationSec,
  }));
```

and, feeding `opts.prescribedRecoverySec`, `resolveWorkoutVerdict()`'s entry point:

```ts
const restS = spec ? num(spec.rep_rest_s) : null;
...
return gradeStoredPhases(args.phases, sessionClass, {
  prescribedRecoverySec: restS,
  ...
});
```

**Trace of the actual value on this run:**

1. `p.targetDurationSec` — confirmed `[PROD-QUERY]` null on all 6 recovery phases (only `targetPaceSPerMi` is carried; no writer anywhere in the codebase populates `targetDurationSec` on a recovery phase — 0/162 rows account-wide, per Domain A's own count).
2. `opts.prescribedRecoverySec` = `restS` = `num(spec.rep_rest_s)`. `[PROD-QUERY]`, the real `workout_spec` for `wko_d19936ca5659c63b`: `{"kind":"easy", "strides_reps":6, "strides_duration_s":20, "strides_recovery_s":60, ...}` — **`rep_rest_s` does not exist as a key on this spec at all.** `num(undefined)` returns `null` (verified against `run-shape.ts`'s own `num()` implementation, quoted: `if (v == null || v === '') return null;`).

**So `prescribedSec` resolves to `null ?? null ?? null = null` for every one of the 6 recovery phases — not 60.** This is not a guess; I built a standalone script replicating this exact logic verbatim against the real raw JSON and the real spec (delivered inline above and executable from the fixture), and it prints:

```
recoveries[] actually passed into recoveriesHonestOf():
  {"idx":2,"prescribedSec":null,"actualSec":30}
  {"idx":4,"prescribedSec":null,"actualSec":43}
  {"idx":6,"prescribedSec":null,"actualSec":61}
  {"idx":8,"prescribedSec":null,"actualSec":24}
  {"idx":10,"prescribedSec":null,"actualSec":38}
  {"idx":12,"prescribedSec":null,"actualSec":8}
known.length = 0
recoveriesHonestOf(recoveries) = null
sessionLadder gate `recoveriesHonest !== false` evaluates to: true
```

`recoveriesHonestOf`'s own contract (`if (known.length === 0) return null;`) means it returns `null` — "no signal" — not `false`. `sessionLadder`'s `'executed'` gate checks `recoveriesHonest !== false`; `null !== false` is `true`. **This tolerance check does not block, and never blocked, the `'executed'` verdict for today's run**, on the actual live code path — contrary to v1's §2.3/§9/transfer-section headline claim that "today's run is denied the `'executed'` verdict" because of this mechanism.

**Where the 60 v1 saw actually lives, and why the code never reaches it:** `strides_recovery_s = 60` is real, and it is a genuinely separate, parallel field from `rep_rest_s`:
- `rep_rest_s` is written by `web-v2/lib/plan/spec-builder.ts` for **rep/interval-shaped workouts** (`rep_count`, `rep_distance_mi`, `rep_pace_s_per_mi`, `rep_rest_s` — a coherent quartet for structured reps with rest between them) and is read back by `resolveWorkoutVerdict()` for exactly this purpose.
- `strides_recovery_s` is written by the *same file*, `spec-builder.ts` (constant `STRIDE_RECOVERY_S`), for **strides appended to an easy run** — a structurally different workout shape — and is consumed **only** by `web-v2/lib/training/expand-spec.ts` (which builds the watch's live prescription/countdown), never by the grading path.

I confirmed this is systematic, not a one-row data artifact: grepping every non-test reference to `rep_rest_s` across `web-v2/lib` shows it consistently paired with the rep-workout vocabulary (`spec-builder.ts`, `expand-spec.ts`, `prescription-parser.ts`, `glance-adapter.ts`), and `strides_recovery_s` never appears alongside it. `resolveWorkoutVerdict()` is the **sole entry point** for this grading path — confirmed by finding every non-test caller (`route.ts` ×2, `postrun/load.ts`, `postrun/detail-load.ts` ×2, `coach/glance-state.ts`, `training/goal-projection.ts`, a replay script) and confirming all of them go through it, none construct `prescribedRecoverySec` any other way. **This is still unfixed on current `main`** — I re-checked `verdict.ts:560` at `ae91e30668...` and it is byte-identical (`const restS = spec ? num(spec.rep_rest_s) : null;`), even after WALKBACK-1/WALKBACK-2 merged.

**Is this intentional legacy encoding, or an unaddressed defect?** **An unaddressed field-semantics defect**, for three reasons: (1) the exact analogous mechanism — read a fallback prescribed-duration off `workout_spec` when the phase's own `targetDurationSec` is absent — clearly *was* intended as a general design (it exists and is live for the rep-workout case), just never extended to the strides-workout case; (2) nothing in the codebase — not a comment, not WALKBACK-1/2's own commit messages (which modify this exact file the same week) — argues strides-recovery should be exempt from grading; (3) the actual consequence is not even the safe "conservative denial" v1 assumed — it's the opposite: the check silently returns `null` (no signal, no penalty, no credit) for the **entire category** of any day with appended strides, which is precisely the Rule 11 shape ("don't know", "measured zero", and "the read failed" collapsed into one) this codebase's own doctrine treats as its most productive bug pattern. Two genuinely short recoveries (Δ36s and Δ52s against the runner's own model) are real, checkable facts about this run's execution, and they are currently being discarded as "unknown" rather than evaluated, for every strides day this account has ever run or will run, until `rep_rest_s` and `strides_recovery_s` are both read (or a single canonical resolver replaces both, per this project's own Rule 16).

**Corroboration from the live render:** the real `/api/v5/today` response's top-level `verdict` narrative for this run reads *"Easy run stayed controlled. Six strides completed."* — positive, with no denial language — consistent with `recoveriesHonest` never having been `false` for this run's actual grading.

---

## Summary of what changes in the canonical ledger

1. **§9's central dispute is settled**, not left open: both v1 sides examined the wrong mechanism. The actual explanatory code — `workoutPhasesTile`/`phaseTrailingText`, deleted by `154edbf97` (2026-09-08) — was still compiled into TestFlight build 290 (the only build ever shipped, confirmed live via ASC), predates the fix by ~18.5 hours, is pace-blind by wire-type design, and stamps `"not completed"` for any `completed:false` phase regardless of type, independent of whatever `sectionPieces`/`routePhases` does. That mechanism, confirmed live, matches the physical symptom exactly.
2. **The fix is merged but not shipped.** `154edbf97` + WALKBACK-1 (`7b0163c85`) + WALKBACK-2 (`e80524809`/`7c916a1f7`) are all ancestors of current `main`. No build has been uploaded to App Store Connect since build 290. RUNNER_DAVID's phone will keep showing this defect on his next shortened walk-back until a new build ships — this is the one clearly actionable item from Part 1.
3. **v1's phase-table math had a real arithmetic error at idx 2** (FAIL should be PASS), but the prose's final count ("2 of 6, phases 8 and 12") happens to survive correction.
4. **v1's — and the phase table's own — assumption that grading used `prescribedSec = 60` is false.** The live code reads `workout_spec.rep_rest_s` (absent on this strides-shaped spec), never `strides_recovery_s` (=60, present but unread by this function). `recoveriesHonestOf` therefore returns `null`, not `false`, for this run, and **does not deny the `'executed'` verdict** — contradicting v1's own headline framing of this as "a live, present-tense instance of the WALKBACK-2 defect class." This is a genuinely new, more consequential finding than either v1 pass produced, and it is still live on current `main`.
5. **Pace evidence for strides/recovery phases exists and is precise enough for the average-pace figure already shown in `sectionPieces`**, but genuinely too sparse (as low as one sample) for any finer intra-phase metric on the shortest phases — a real physical limit, not a bug.

**Files most relevant for a follow-up engineering pass** (described, not fixed, per this task's scope): `web-v2/lib/execution/verdict.ts` (`resolveWorkoutVerdict`'s `rep_rest_s`-only read), `native-v2/Faff/Faff/ViewsV5/TodayAfterV5.swift` (the stale "GPS-mile-keyed" comment on `workoutPhasePieces`, carried forward from before the 2026-09-01 fix), and `scripts/ship-testflight-v2.sh` (no build has run since 290).