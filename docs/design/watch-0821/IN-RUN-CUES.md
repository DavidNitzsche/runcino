# In-run cues — what fires, when, and on which run

Audited 2026-08-24. The brief: *each run will need to be different and unique
but the idea should be the same.* So this is two questions, and they have
different answers.

**Is each run different?** Yes, and correctly so — an interval session, an easy
run and a race see genuinely different cue sets, driven by phase type and by
what is measurable.

**Is the idea the same?** Not everywhere. Three cues had drifted into using
another cue's texture, another cue's duration, or firing on one path and not
its sibling.

---

## The cue table

| Cue | Texture | Holds | Fires when |
|---|---|---|---|
| Start countdown | `tick` ×3 | 3 s | Every run |
| **Go** | phase haptic + chime | 1.2 s | Start of every run |
| Mile split | `split` | 3.0 s | Mile boundary, unless inside a rep |
| Phase change · race | phase haptic | 1.8 s | Each course segment |
| Phase change · finish | phase haptic | 2.2 s | Long-run finish segment |
| Phase change · work rep | phase haptic | 1.6 s | Entering a work rep |
| Ending countdown | `tick` ×9 + `almostDone` | live 10→0 | Last 10 s of a **time** rep |
| Almost done | `almostDone` | 2.6 s | 0.25 mi / 0.03 mi from the end of a **distance** phase |
| Drift | `headsUpEaseOff` / `headsUpPickItUp` | 2.6 s | Sustained drift outside the band, work phases |
| Fuel · training | `fuel` | 6 s, auto-clears | Elapsed-time marks |
| Fuel · race | `fuel` | 6 s, auto-clears | Aid-station miles |
| Finish | `finish` | — | Session complete |

## What each run actually sees

| | Easy / long | Intervals · time | Intervals · distance | Threshold | Race | Just run |
|---|---|---|---|---|---|---|
| Go | ● | ● | ● | ● | ● | ● |
| Mile split | ● | — *(suppressed in rep)* | — *(suppressed in rep)* | — | ● | ● |
| Phase change | finish seg. only | each rep | each rep | each block | each segment | — |
| Ending countdown | — | ● | — | ● if time-based | — | — |
| Almost done | ● | — | ● | — | — | ● |
| Drift | ● if banded | ● | ● | ● | — *(race is excluded)* | — |
| Fuel | ● if planned | ● if planned | ● if planned | ● if planned | ● aid stations | — |

---

## Fixed in this pass

**A race fired no mile splits at all.** The split gate asks *is this a work
phase*, which is right for an interval session and wrong for a race, because a
race's course segments are also typed `.work`. A marathon failed every
exemption — several work phases so not a single-work session, no finish segment
so not a long build — and `allowSplitFlash` was false for the whole race. Both
the board and the haptic live inside that branch, so every mile boundary passed
in complete silence. The most-wanted number in a marathon was the one thing the
watch would not say. A course segment is not a rep; the gate now says so.

**Race fuel fired the wrong texture.** `Haptics.almostDone()` — the "your effort
is nearly over" tap — at mile 8 of a marathon. The training path uses `.fuel`.
The two paths differ only in what triggers them, elapsed time against
aid-station miles, and that difference is deliberate and documented. The cue
itself is one idea and now feels like one.

**Almost done got the board the engine always described.** Its own comment has
said since it was written that the cue is *a one-shot flash with the remaining
miles (0.25 LEFT)*. It borrowed `.headsUp`, which the router draws as the drift
correction — a board naming the band, at a boundary where no band is being
asked for. It has its own cue and its own board now: one figure, one word.

**And it was computed in miles whatever the runner reads in.** A kilometre
runner was told "0.25 left" a quarter of a *mile* from the end, which is 0.4 km.
Everything else converts at the edge through `WFmt`; this number computed
itself and skipped it. The unit is named on the board now rather than implied.

**A split held twice as long as any other moment** — 6.0 s against the stated
2–3. Newly noticeable once a race splits every mile, where six seconds of every
eight minutes had no pace on screen. Now 3.0.

**The two fuel paths persisted differently** by accident — training until
dismissed, race after six seconds. They differ in trigger on purpose; they now
behave the same. A gel cue you miss is recoverable; a pace face you cannot get
back is the failure the router already had to patch with a tap gesture.

**Manual laps are gone.** `lap()` had no callers once the Lap verb went.

---

## Open, and deliberately not changed

**Plan completion is a haptic on a single-phase run.** When the last phase ends
the engine fires `finish` and enters overtime. On a structured session the face
visibly changes — the phase board gives way to Page 1, because there is no rep
to be inside of any more. On an easy, long or just-run session Page 1 was
already showing, so the runner crosses 6.00 miles and *the screen is identical*.
The engine's comment says a full-screen wordmark flash "was clutter", and that
was a deliberate call — but it was made when the live face still flipped its
distance row to a purple bonus state, which no board in 0821 does. So the
signal it relied on is gone and the decision has not been revisited.

**Only three phase changes announce themselves.** Race segments, finish
segments and work reps. Entering a warm-up, a recovery or a cool-down fires the
phase haptic and no board, so a runner is announced *into* effort and never
*out* of it. The board underneath does change, which may be enough — but the
asymmetry should be a decision.

**Manual laps are unreachable.** `markLap()` has no callers since the Lap verb
was removed from controls, and `lapCount` / `lastLapElapsedSec` are still
maintained for a lap nothing can cut.
