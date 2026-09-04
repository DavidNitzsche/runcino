# Physical-device checklist · what code cannot prove

**Products in scope: the iPhone app and the Apple Watch app.** The Watch ships
INSIDE the iPhone build — `project.yml` embeds `FaffWatch Watch App` in the
`Faff` target — so installing TestFlight 278 installs both, and there is no
separate Watch build number to track.

**Current status: iPhone NOT VERIFIED · Watch NOT VERIFIED.** Nothing below has
been confirmed on a device. Everything asserted elsewhere in this report is
code-level.

Rule 13: a fix to something the runner sees is verified by RENDERING it with
real data. Everything below is behaviour with **no headless test surface** —
each item is listed because a test file in this repo says, in its own words,
that it cannot cover it.

## Build to install

**TestFlight 278** (source commit `b384b8b7`). Established by
`git merge-base --is-ancestor` against the ship commit AND by reading
`CFBundleVersion` out of the produced `.ipa` with PlistBuddy — not from a commit
message, and not from an upload timestamp. See `BUILD-278.md` for the full
chain.

  iPhone  CFBundleVersion 278 · `run.faff.app`
  Watch   CFBundleVersion 278 · `run.faff.app.watchkitapp`, embedded in the same `.ipa`

**Every section below is testable on 278.** Proven ancestors, each checked
individually:

| In 278 | What it gives you |
|---|---|
| `0e80296d` | HRPHASE-1 + HRGRADE-1 — an HR-graded session reads as graded |
| `39d69b71` | REDUNDANT-PACE-1, ACTIVITY-PLACEMENT-1, OVERRUN-MATCH-1, PASSIVE-SYNC-TYPE-CONFIRM-1 |
| `cd754fd3` | all treadmill runtime through TREADMILL-SKIP-1 |
| `645d540e` + `ea901bea` | the treadmill's warmup/hills/cooldown breakdown, per-phase HR |
| `d115d857` | HRCEILING-1 + HRCHANNEL-1 |
| `58c9dcc3` | HRFLATLINE-1 |

**Do NOT install or report against builds 272 or 277.** Both have a broken
provenance chain (SHIPRACE-1 in `BUILD-278.md`); 277's binary was another
agent's export uploaded by this session's `altool`, and 272's commit message
credits a fix authored 5h38m after its upload. They are kept in the record as
the failure, not as validation targets.

## SMOKE · 6 minutes, runnable the moment the build installs

Everything here needs only the app and a phone. Nothing waits for a particular
workout, a race day, a second runner, or an observation window. Run this first;
if any of it fails, stop and report rather than continuing to the long-horizon
sections.

| # | Do this | Pass looks like |
|---|---|---|
| 1 | **Rapid day taps.** Tap five different days in the week strip as fast as you can. | Each renders immediately. No spinner, no blank, no "Can't reach faff." The top bar, strip and hero stay put — only the content changes. |
| 2 | **Repeated week swipes.** Swipe back four weeks and forward four, quickly. | Same. Layout never jumps; no per-day loading shell. |
| 3 | **Offline launch.** Airplane Mode ON, force-quit, relaunch, browse from plan start to race day. | Every date opens from the local snapshot. No blocking request, no error banner. |
| 4 | **Recovery after reconnection.** Airplane Mode OFF, wait ~15 s on Today. | Content is never replaced by a loading shell or a blank while it refreshes. |
| 5 | **Today → Run identity.** Browse to a FUTURE date on Today, then open the Run tab. | Run offers **today's** workout, not the browsed one. |
| 6 | **Phone/Watch start lock.** Start a run on the watch, then try to start on the phone. Then the reverse. | Refused both ways, with a reason. |
| 7 | **Normal Watch end clears the lock.** End the watch run normally, then start on the phone. | Allowed. |
| 8 | **Treadmill automatic transition.** Start a treadmill session on a structured day; let the warm-up run out untouched. | The phase advances on its own; the header changes with it. |
| 9 | **Skip and End confirmations.** Tap Skip. Tap End. | Each asks before acting. After confirming Skip, the header does not stay on the phase you left. |
| 10 | **Live HR freshness.** Watch the HR field for ~30 s during a treadmill session. | It updates, and says so when it is stale rather than showing a frozen number as current. |
| 11 | **Audio/haptic cue.** Cross a phase boundary with the volume up. | Cue fires on the speaker and at the wrist. |
| 12 | **Post-run single execution.** Finish, let HealthKit sync. | The day shows **one** run, not two. |
| 13 | **Prescription vs override vs execution.** On the post-run card. | Three visibly separate things: what was asked, what you changed mid-run, what you actually did. |
| 14 | **Return from Run/post-run.** Back out to Today, then to another date and back. | Today is where you left it; no reload, no shell. |

**HRFLATLINE-1 note for #10:** your 2026-09-03 hill session recorded eight
distinct HR values across the whole workout, holding 134 bpm through three reps
and reading 103 during Hill 5. If the live field looks frozen during this test,
that is the same device artefact and is now refused as evidence rather than
graded — but it is worth telling me whether the wrist itself looks stuck.

---

## LONG-HORIZON · explicitly open, not closed

These need something that has not happened yet. They are listed so nobody
mistakes their absence for a pass.

| Scenario | What it needs |
|---|---|
| Supplemental run does not seal a prescription | A second runner, or an unlinked easy run on a quality day |
| Race warm-up does not seal the race | A race day |
| Over-run matching end to end on a fresh ingest | A run that goes materially long, ingested after `39d69b71` |
| Rescheduling preserves identity | A deliberate reschedule, then a run on the new date |
| Delayed duplicate creates no second seal | A late HealthKit or Strava arrival |
| Treadmill resume gap over a long background | An interrupted session left backgrounded for minutes |
| Watch race plan carries THIS race | Race morning |
| Adaptation proposes an increase in production | Two qualifying threshold sessions inside 28 days, and the shadow period |

---

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

- iPhone: SMOKE, then sections A, B, C and D confirmed on build 278.
- Watch: section E confirmed on build 278.

Until both are done, the honest status is **shipped, not physically verified** —
for either product.
