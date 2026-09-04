# Physical-device checklist · what code cannot prove

**Products in scope: the iPhone app and the Apple Watch app.** The Watch ships
INSIDE the iPhone build — `project.yml` embeds `FaffWatch Watch App` in the
`Faff` target — so installing TestFlight 275 installs both, and there is no
separate Watch build number to track.

**Current status: iPhone NOT VERIFIED · Watch NOT VERIFIED.** Nothing below has
been confirmed on a device. Everything asserted elsewhere in this report is
code-level.

Rule 13: a fix to something the runner sees is verified by RENDERING it with
real data. Everything below is behaviour with **no headless test surface** —
each item is listed because a test file in this repo says, in its own words,
that it cannot cover it.

## Build to install

**TestFlight 275** (`89f602df`). Established by `git merge-base --is-ancestor`
against the ship commit, not by reading a commit message — see TFCLAIM-1.

It contains every treadmill runtime change through `cd754fd3`
(TREADMILL-SKIP-1), **and** WORKOUTPHASES-1/2 — the treadmill's own
warmup/hills/cooldown post-run breakdown with per-phase HR from raw samples. So
section A below is fully testable on 275, including the breakdown.

Not in 275: `0e80296d` (HRPHASE-1/HRGRADE-1). If you want the HR-graded session
read, wait for the next build.

## A · treadmill runtime — 8 minutes, indoors

`TreadmillStateMachineTests` names its three uncoverable behaviours directly:
"stable-width digit rendering, the End/Skip confirmation dialogs actually
blocking a tap, and cue audio/haptics actually firing on a speaker". Those are
items 3, 4 and 5.

Start a treadmill session on a day with a structured set (hills or intervals).

1. **Automatic transitions.** Let the warm-up run out without touching the
   phone. The phase advances on its own, and the header changes with it.
2. **Original-target round trip.** Change the belt speed mid-phase so it
   disagrees with the prescription. The screen still shows what was PRESCRIBED
   beside what you are running — not the override overwriting the target.
3. **Protected Skip.** Tap Skip. It must ask before skipping, and after
   confirming, the header must not stay on the phase you just left
   (TREADMILL-SKIP-1 was exactly that staleness).
4. **Protected End.** Tap End. It must ask before ending.
5. **Cues.** Audio and haptic fire at a phase boundary, on the speaker.
6. **Digits.** The clock and pace do not jitter horizontally as they count.
7. **Honest resume gap.** Background the app for ~60s mid-phase and come back.
   The session catches up in one step and the gap is stated, not silently
   absorbed.
8. **One execution.** Finish. After HealthKit sync, the day shows ONE run, not
   two.

## B · pre-run / Run tab — 3 minutes

1. Run is the execution tab; Today does not duplicate its controls.
2. Watch, iPhone and treadmill all resolve the SAME workout for today.
3. Start on the watch, then try to start on the phone: refused. Start on the
   phone, try the watch: refused. Symmetric.
4. A legitimately mirrored watch+phone treadmill pair is ONE execution, not a
   blocked duplicate.
5. End normally on the watch: the lock clears, and the phone can start again.
6. Browse to a future date on Today, come back to Run: Run still offers
   TODAY's workout, not the browsed one.

## C · post-run — 3 minutes, after any real run

1. The verdict is explicit; nothing reads "The plan was adjusted" with no
   detail.
2. Skipped, partial and extra work are each reported as what they are.
3. Coach's Read is short, and says one thing.
4. The original prescription, any runtime override, and what you actually ran
   are visibly three separate things.
5. The same run reads the same on Today, Run Detail and the watch — same
   distance, same verdict, same plan impact.

## D · the two that need a second person

1. **Supplemental identity.** Have someone log an easy run to your account on
   an interval day, or run an unlinked easy run yourself on a quality day. It
   must count toward mileage and must NOT complete, grade or seal the interval
   prescription.
2. **Race warm-up.** On a race day, log the warm-up as a separate activity. It
   must not seal the race.

Both are covered headlessly by `lib/plan/_sealing_identity.test.ts` and now by
`EXECID-SCAN-1`; they are here because the runner is the only one who can
confirm the SCREEN agrees with the resolver.

## E · Apple Watch — 5 minutes, on the wrist

`check-watch.sh` now reports **OK, all guards executed** (223 test cases, 22
boards inside Apple's content box, run endable) — that is the simulator and the
board geometry, not the wrist. These are what remain:

1. **One workout, three surfaces.** The watch offers the SAME session the phone
   and the treadmill offer for today.
2. **The lock is symmetric.** Start on the watch → the phone refuses. End
   normally on the watch → the phone can start again.
3. **A mirrored pair is one execution.** A watch+phone treadmill session that is
   genuinely mirrored reads as ONE run after sync, not a blocked duplicate and
   not two runs.
4. **The race plan is this race's.** On a race day the watch carries THAT race's
   goal, strategy and fuelling — never the marathon's on a 10K morning.
5. **A run that ends on a recovery phase is still endable.** Every strides day
   ends on one, and that is what once left no Pause/End control at all.

## What "closure" would require

- iPhone: sections A, B, C and D confirmed on build 275.
- Watch: section E confirmed on build 275.

Until both are done, the honest status is **shipped, not physically verified** —
for either product.
