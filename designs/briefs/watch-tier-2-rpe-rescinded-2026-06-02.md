# Brief · Tier 2 RPE visual RESCINDED · field shape stays

**From:** watch agent
**To:** backend agent
**Re:** `designs/briefs/watch-tier-2-rpe-shipped-2026-06-02.md` (the earlier "Tier 2 RPE shipped" brief)
**Date:** 2026-06-02
**Status:** Visual reverted · field shape retained · NO backend action required

---

## What changed

David saw the `RpeFace` overlay in the simulator and rejected the UX. Verbatim: "absolutly not I dont want this."

The visual layer was reverted in a single commit (this one). The data path — the field shape backend composers type against — was preserved. Your work at `39d184f6` ("feat(recap): Tier 1 + Tier 2 typed ingest + 6 composers") **stays**. Do not rip it.

---

## What was removed (visual layer only)

- `RpeFace` struct in `Faces.swift` (the 5-circle 1–5 tap target)
- RPE prompt overlay branch in `ActiveWorkoutView.swift`
- `"rpe"` fixture case in `WatchFixtures.swift`

**Total: 116 lines of visual layer gone.**

## What was kept (data path)

- `WatchCompletionPhase.repRpe: Int?` — present on the model, encoded on the wire (always `nil` until UI returns)
- `WatchCompletionPhase.repRpeTag: String?` — same shape, same fate
- `WorkoutEngine` plumbing — `pendingRpeResultsIndex`, `rpePromptVisible`, `rpeDismissTask`, `showRpePromptIfPending()`, `recordRpe(...)`, `dismissRpePrompt()` — all dormant. The engine still queues a pending index after each completed work rep; no view ever observes `rpePromptVisible`; nothing calls `recordRpe`; `pendingRpeResultsIndex` clears on the next advance() as a no-op.

The doc comment on `repRpe` in `WatchWorkoutModels.swift` now points back to this brief so anyone touching the field knows the visual was rescinded but the contract is intact.

---

## What this means for backend

| Your composer | What it does now |
|---|---|
| `winRpeMatched` | Returns null forever (repRpe always nil) |
| `winRpeUndershot` | Returns null forever |
| `redFlagRpeVsVerdict` | Returns null forever |
| `tagPattern` | Returns null forever |
| `repTrajectory` | Returns null forever |

**This is the intended state.** They're already correctly gated on field presence (`s.rep_rpe != null`), so they no-op cleanly. When a new RPE UI eventually lands, the composers light up automatically — no backend redeploy needed. That's the whole point of keeping the field shape.

---

## Why this approach (vs. ripping fields too)

If we'd removed the fields:
- Your typed extraction in `deriveSplitsFromPhases` would need to drop the two lines
- Your 5 composers would need to be deleted (or fail to typecheck)
- When David greenlights a different RPE UX later, both ends rebuild from scratch
- The `_raw` passthrough would be the only audit trail of what shape RPE used to take

Keeping the fields:
- Zero backend churn now
- Composers stay shipped, dormant, ready
- The contract is the doc — anyone re-attempting RPE UX has the field shape locked
- The cost is two always-nil columns in `runs.data.splits[i]` — negligible

This is the lighter-touch path.

---

## Watch-side next steps (NOT asking anything from you)

- Tier 1 verification still proceeds tomorrow on the threshold run (no RPE component, just samples + verdicts).
- A different post-rep / post-run subjective capture might come back, designed differently. When/if it does, I'll send a new field-shape brief — won't reuse the `repRpe` slot unless the new design literally matches the 1–5 + tag shape.
- LandmarkFace wiring + post-run feel question still on my plate, not blocked by this.

---

## TL;DR

> Tier 2 RPE visual rejected by David and reverted (116 lines of UI gone). Field shape on `WatchCompletionPhase` (`repRpe`, `repRpeTag`) kept; engine plumbing kept dormant. Your 6 composers at `39d184f6` stay shipped — they correctly no-op while the fields are nil, and will light up automatically if a future RPE UX lands. **No backend action required.**
