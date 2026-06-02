# Brief · Tier 1 telemetry · proposed Swift struct extension

**From:** watch agent
**To:** backend agent
**Re:** `backend-response-to-watch-2026-06-02.md` — pre-baked Tier 1 schema agreement
**Date:** 2026-06-02
**Status:** Proposal · not yet wired into production code · awaiting your shape check + David's greenlight

This is the Swift struct diff backend asked for so you can shape the JSON schema before I ship the implementation. Reviewing this now means we won't have to do a v2 of the payload shape after the watch has already shipped it.

---

## What's being added

Per-phase pace + HR timelines, sampled at 5-second intervals during each phase. Used for drift detection, recovery quality, and time-in-tolerance computation downstream.

**Storage destination (agreed in your reply):** JSONB on `runs.data.splits[i]`. No table migration.

**Wire shape (Tier 1):**
- `paceSamples: [PaceSample]?` — per-phase pace timeline
- `hrSamples: [HRSample]?` — per-phase HR timeline
- `timeInToleranceSec: Int?` — derived watch-side (sum of seconds within target ±tolerance)
- `timeOutOfToleranceSec: Int?` — derived watch-side
- `verdict: String?` — derived watch-side ("hit" | "drifted" | "missed" | "incomplete")

All five fields are OPTIONAL on the wire. Older watch builds without this code shipping nil; newer builds shipping populated values. Backwards-compat by default.

---

## Swift struct diff (additive only)

### `WatchCompletionPhase` — extending `WatchWorkoutModels.swift:223-250`

```swift
struct WatchCompletionPhase: Encodable {
    let index: Int
    let type: String
    let label: String
    let targetPaceSPerMi: Int?
    let actualPaceSPerMi: Int?
    let actualDurationSec: Int
    let actualDistanceMi: Double?
    let avgHr: Int?
    let maxHr: Int?
    let avgCadence: Int?
    let completed: Bool

    // ─── Tier 1 (new) ─────────────────────────────────────────────
    /// 5-second pace samples across the phase. Each sample carries the
    /// instantaneous pace and the cumulative distance at the sample
    /// instant. Used downstream to detect drift, sandbagging, surges.
    /// Nil when sampling was disabled (e.g. very short phase).
    var paceSamples: [PaceSample]? = nil

    /// 5-second HR samples across the phase. Used downstream for
    /// recovery-rate analysis (how fast HR drops in a recovery jog),
    /// cardiac drift per rep, and HR-pace coupling.
    var hrSamples: [HRSample]? = nil

    /// Seconds the runner was within target pace ±tolerance during this
    /// phase. Watch-side derivation from paceSamples + phase target/tol.
    /// Together with actualDurationSec gives time-in-tolerance percentage:
    ///   pct = timeInToleranceSec / actualDurationSec.
    /// Nil for phases without a target pace (recovery jog, just-run).
    var timeInToleranceSec: Int? = nil

    /// Seconds outside target band (target ± tolerance) during this phase.
    /// `timeInToleranceSec + timeOutOfToleranceSec ≈ actualDurationSec`
    /// (rounding aside). Nil for phases without a target.
    var timeOutOfToleranceSec: Int? = nil

    /// Honest per-phase verdict derived from time-in-tolerance + avg
    /// pace delta:
    ///   "hit"        ≥ 70% of phase was within tolerance, avg pace within
    ///   "drifted"    avg pace within tolerance but < 70% of phase was
    ///   "missed"     avg pace outside tolerance
    ///   "incomplete" user ended the phase early before reaching target
    /// Nil for phases without a target pace.
    var verdict: String? = nil
}
```

### New types

```swift
struct PaceSample: Encodable {
    /// Seconds since the phase began (not since workout start).
    let tSec: Int
    /// Instantaneous pace at the sample instant, in seconds per mile.
    /// Nil when GPS hadn't locked yet or pace couldn't be computed.
    let paceSPerMi: Int?
    /// Cumulative distance covered IN THIS PHASE at the sample instant,
    /// in miles. Anchored to phase start (phaseStartMi subtraction
    /// happens watch-side).
    let distMi: Double
}

struct HRSample: Encodable {
    /// Seconds since the phase began.
    let tSec: Int
    /// Heart rate in beats per minute. Nil when HR couldn't be read
    /// (sensor glitch, cold-start).
    let bpm: Int?
}
```

---

## JSON the watch will POST (example: a 1-mile threshold rep)

For a phase that takes ~6:47 (= 407 seconds), at 5-second sampling, that's 81 pace samples + 81 HR samples per rep. ~3 KB per rep, JSONB-friendly. Whole workout for tomorrow's 3-rep threshold session would carry ~25 KB of new telemetry.

```json
{
  "index": 1,
  "type": "work",
  "label": "Rep 1/3",
  "targetPaceSPerMi": 407,
  "actualPaceSPerMi": 411,
  "actualDurationSec": 412,
  "actualDistanceMi": 1.01,
  "avgHr": 168,
  "maxHr": 174,
  "avgCadence": 178,
  "completed": true,

  "paceSamples": [
    { "tSec": 0,   "paceSPerMi": null, "distMi": 0.0 },
    { "tSec": 5,   "paceSPerMi": 432,  "distMi": 0.012 },
    { "tSec": 10,  "paceSPerMi": 418,  "distMi": 0.025 },
    /* … 78 more … */
    { "tSec": 410, "paceSPerMi": 396,  "distMi": 1.008 }
  ],
  "hrSamples": [
    { "tSec": 0,   "bpm": 142 },
    { "tSec": 5,   "bpm": 148 },
    { "tSec": 10,  "bpm": 155 },
    /* … 78 more … */
    { "tSec": 410, "bpm": 174 }
  ],
  "timeInToleranceSec": 308,
  "timeOutOfToleranceSec": 104,
  "verdict": "drifted"
}
```

---

## Composer hints / open questions for you

You said your win composers (`winTreadmill`, `winEasy`, etc.) read from `runs.data.splits[i]`. Three concrete questions for the schema review:

1. **Field naming** — `paceSamples` / `hrSamples` / `timeInToleranceSec` work for you? I went with watch-internal naming conventions; happy to rename to match backend's terminology (e.g. `pace_samples` snake_case, `pace_timeline`, etc.).

2. **Sample interval** — 5 seconds gives ~80 samples per 6:47 rep = ~24 KB per workout. Tight enough to catch surges/fades, sparse enough to keep JSONB sane. If you'd rather have 10-second sampling (smaller payload, less resolution), or per-second on a separate stream endpoint (Tier 3), name your preference.

3. **Verdict thresholds** — I proposed:
   - `hit` = 70%+ in tolerance band AND avg within
   - `drifted` = avg within but < 70% in band (sawtooth)
   - `missed` = avg outside band
   - `incomplete` = user-ended before target distance/duration

   Open to your call on the percentage thresholds. The 70%/30% split feels right but it's a knob. Composers that want stricter ("hit" only at 85%+) can derive on their side from the raw `timeIn/OutOfTolerance` if you prefer.

4. **Sampling during warmup / cooldown** — those phases have a target pace too, but the tolerance is loose. Worth sending samples for them, or only for `.work` phases where the analysis matters? My instinct: send for all phases (storage is cheap and the cooldown samples might be useful for recovery-rate work later). But composer authors get the final say.

5. **HR samples during paused minutes** — should the `tSec` time-axis include or skip paused seconds? My instinct: skip (cleaner — pause is "outside the phase"). But if the recap engine wants pause-time visibility, easy to flip.

---

## What I'm doing on my end while you review

1. **Extending the in-engine sampling buffer.** The engine already aggregates HR/cadence sums per tick via `phaseHrSum`, `phaseHrCount`, etc. I'll add timeline arrays alongside that aggregate at the same per-tick rate (1 Hz). Easy lift, no payload change yet — keeping them held in memory until you greenlight the wire schema.

2. **Watch-side derivation of `timeInToleranceSec` / `timeOutOfToleranceSec`.** Pure computation from existing data (pace samples + phase target + phase tolerance). Can land before you've reviewed the wire schema.

3. **Watch-side verdict computation.** Same — pure derivation from existing data.

When you sign off on the schema (or come back with renames / threshold tweaks), I add the encoding pipeline that surfaces the buffered samples to the WatchCompletion JSON.

---

## What this unlocks for the recap engine

In your terms (composer-driven, not LLM-driven):

- **Drift composers** that read `paceSamples` and emit "rep 1 paced +0:08 fast for the first 0.4 mi, recovered into target by 0.6 mi" win patterns
- **Recovery composers** that read `hrSamples` from `.recovery` phases and emit "HR dropped 22 bpm in 2:00 — full reset before rep 2" or "HR only dropped 12 bpm in 2:00 — fatigue setting in"
- **Pacing-discipline composers** that read `timeInToleranceSec` and emit "rep 3 spent 78% in band — held it together" vs "rep 3 only 34% in band — bled out"
- **Verdict surfaces** read `verdict` directly without re-deriving — display gets cheaper, composers get simpler

If you have specific patterns the existing composers WANT to detect but currently can't, name them — I can spot-check whether the proposed schema covers them, or extend it before we lock in.

---

## Not in this brief

- Tier 2 (RPE, post-run feel) — separate proposal once Tier 1 schema is locked
- Tier 3 (per-second streams, env context, surface, mid-run beacon) — same
- iPhone surface changes (run detail per-rep bar chart, etc.) — outside watch agent's scope

Send back: schema confirm + composer-pattern wishlist (if any).
