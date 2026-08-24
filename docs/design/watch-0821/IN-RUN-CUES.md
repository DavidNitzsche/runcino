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
| Mile split | `split` | 6.0 s | Mile boundary, unless inside a rep |
| Phase change · race | phase haptic | 1.8 s | Each course segment |
| Phase change · finish | phase haptic | 2.2 s | Long-run finish segment |
| Phase change · work rep | phase haptic | 1.6 s | Entering a work rep |
| Ending countdown | `tick` ×9 + `almostDone` | live 10→0 | Last 10 s of a **time** rep |
| Almost done | `almostDone` | *no visual* | 0.25 mi / 0.03 mi from the end of a **distance** phase |
| Drift | `headsUpEaseOff` / `headsUpPickItUp` | 2.6 s | Sustained drift outside the band, work phases |
| Fuel · training | `fuel` | 5 s, persistent | Elapsed-time marks |
| Fuel · race | `fuel` | 6 s, auto-clears | Aid-station miles |
| Finish | `finish` | — | Session complete |

## What each run actually sees

| | Easy / long | Intervals · time | Intervals · distance | Threshold | Race | Just run |
|---|---|---|---|---|---|---|
| Go | ● | ● | ● | ● | ● | ● |
| Mile split | ● | — *(suppressed in rep)* | — *(suppressed in rep)* | — | ● | ● |
| Phase change | finish seg. only | each rep | each rep | each block | each segment | — |
| Ending countdown | — | ● | — | ● if time-based | — | — |
| Almost done | ● haptic only | — | ● haptic only | — | — | ● haptic only |
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

## Open, and deliberately not changed

**Almost done has no board.** It fires a haptic and draws nothing. It used to
draw the drift correction, whose "Band is …" line is untrue at a phase boundary
and rendered as "Band is /mi" on an unbanded run. §4 has no board for
almost-done — its heads-up *is* the correction — so rather than invent one the
cue is a tap. The engine already computes the remaining distance and nothing
carries it.

**A split holds twice as long as any other moment.** 6.0 s against the
handoff's stated 2–3 s for a moment. It carries three reads — mile, time,
comparison against the last — so the extra time is arguable. It is still the
one cue that does not obey the rule.

**The two fuel paths persist differently.** Training fuel stays until dismissed;
race fuel clears itself after 6 s. The design's own reasoning for the fuel
colour field is *at mile 14 a lit panel is what gets seen*, which argues for
persistence exactly where it is absent. The counter-argument is that mid-race
the pace face has to come back on its own. Both are defensible; they should not
be different by accident.

**Only three phase changes announce themselves.** Race segments, finish
segments and work reps. Entering a warm-up, a recovery or a cool-down fires the
phase haptic and no board, so a runner is announced *into* effort and never
*out* of it. The board underneath does change, which may be enough — but the
asymmetry should be a decision.

**Manual laps are unreachable.** `markLap()` has no callers since the Lap verb
was removed from controls, and `lapCount` / `lastLapElapsedSec` are still
maintained for a lap nothing can cut.
