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
| Almost done | ● | — | ● | ● | — | — |
| Drift | ● if banded | ● | ● | ● | ● | — |
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

**Three table rows were wrong, and a simulation caught them rather than a
reader.** Drift was recorded as excluded from a race; nothing in the engine
excludes it and nothing should — going out too fast in the first 10k is the
classic marathon error and is exactly who the cue is for. Almost-done was
marked present on a just-run, which carries no distance and no working
duration, so the engine cannot fire it; and absent on a threshold, whose
three-mile blocks are distance phases that do get it. The first row was an
assumption generalised from the almost-done path's own `!isRace` guard.

**Only three phase changes announce themselves.** Race segments, finish
segments and work reps. Entering a warm-up, a recovery or a cool-down fires the
phase haptic and no board, so a runner is announced *into* effort and never
*out* of it. The board underneath does change, which may be enough — but the
asymmetry should be a decision.

**Manual laps are unreachable.** `markLap()` has no callers since the Lap verb
was removed from controls, and `lapCount` / `lastLapElapsedSec` are still
maintained for a lap nothing can cut.

---

## Recorded voice-over: tested, rejected — 2026-08-24

**Do not re-attempt fragment stitching.** David listened to it and the answer
was "the stitched one sounds really bad."

The idea was to replace Apple's synthesiser with a real recorded voice (tested
via Artlist AI VO, Eleven v3, voice "Suburb", American). It cannot work, and
the reason is structural rather than a matter of finding a better voice or a
better vendor.

**A recorded voice cannot say a sentence that does not exist yet.** A vendor
renders finished audio files ahead of time. The cues here are assembled at
run time out of numbers nobody knows until the runner produces them, so the
sentence has to be built on the wrist from parts.

**Pre-rendering whole sentences is not a way out.** One mile-split line is
mile number x pace x delta-to-goal — 26 x ~660 x ~240, low millions of clips.
At even 30 KB a clip that is tens of gigabytes, against a watch app budget
measured in tens of megabytes. Cost was never the constraint; single words
came back at 1 credit each and the whole 99-word vocabulary is ~150 credits.
Size and combinatorics are the constraint.

**So the only option was stitching**, and stitching is what sounds bad. Each
fragment is rendered in isolation, which gives every word sentence-final
intonation — falling pitch, full stop. Glued together they read as a station
announcement rather than a person. The A/B is preserved: one line rendered
whole against the same line rendered as six words and concatenated.

Two further problems that would have remained even if the seams had passed:

- **Race course segment names are unbounded.** Cues like "Hurricane climb"
  come from the course plan, cannot be pre-recorded, and would either go
  silent or fall back to the synthesiser — two voices inside one race.
- **Licensing is unresolved.** Artlist's terms cover voice-over in content.
  Shipping their AI voice as bundled assets inside a distributed app is a
  different use. Cheap to confirm before committing; expensive to unwind
  after it is in a build.

**What this leaves.** `AVSpeechSynthesizer`, which synthesises live and can
therefore say anything. Its weakness is exactly the numbers this app speaks
most, so the lever that remains is saying *less*, not saying it in a better
voice.

### The voice tier: measured, and there is no better one

Settled by enumerating the runtime rather than reasoning about it. Of the
**68** voices watchOS 26.5 offers, **all 68 report quality 1**. Not one
Enhanced, not one Premium, in any language. The en-US voices are not even
Compact — their identifiers read
`com.apple.voice.**super-compact**.en-US.Samantha`, a tier below the one
iOS and macOS start at, and the audio comes out at 22.05 kHz.

**There is no download, no setting and no code change that makes the watch
sound better.** Chasing Enhanced or Premium was the wrong instinct and cost
a detour through macOS System Settings that was irrelevant twice over: the
Mac's own tier does not travel to the wrist, and the wrist has no tier to
raise. The quality-first selector (`5d7eb4d5`) is still correct and still
changes nothing audible today — it only stops a future OS that DID ship a
better voice from being ignored.

Also worth knowing when demoing: `say -v Samantha` on a Mac renders
**compact**, which is a tier ABOVE the watch. Any sample rendered on the host
flatters the product. To hear the truth, synthesise inside the watch runtime
and pull the file out — `AVSpeechSynthesizer.write(_:toBufferCallback:)` into
an `AVAudioFile` under `NSTemporaryDirectory()`, whose simulator path is a
real host path.

So the voice is a fixed constraint. **Fewer words is the only lever**, which
is what the copy pass spends.

The selector now ranks **quality first** and uses his name preference only to
break a tie inside a tier (`5d7eb4d5`). The version before it filtered to
Samantha and only then took her best quality, which would have ignored a
better voice installed under another name — a preference for the good voice
that behaved as a preference for the bad one.

