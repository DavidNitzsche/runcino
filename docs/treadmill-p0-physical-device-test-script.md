# Treadmill P0 — 5-minute physical-device test script

Run this once the validation TestFlight build is on your phone (and, ideally, your
watch on your wrist). It exercises every item in the closure brief's own physical-test
list in one short session. Total time: about 5–6 minutes including the two accelerated
work reps.

**Before you start:** connect earbuds or speaker and play music, so the audio-cue check
means something.

1. **Start** the prescribed (or any) treadmill session from the Run tab. Confirm the
   console shows the full authored structure before tapping Start — current/next phase
   info should already look populated, not blank.
2. **Warm-up → work rep 1 (automatic transition).** Let the warm-up run down without
   touching anything. Watch for: a spoken/tone cue a few seconds before the boundary,
   the console switching to "Interval 1 of N" **on its own**, and the belt's own
   speed/incline numbers changing to match — no pause/resume needed to "wake" it.
3. **Live HR.** Confirm a bpm number appears within the first ~30s of the work rep and
   keeps updating without you touching the phone. Note whether it feels closer to
   instant or a few seconds behind — both are fine, but say which.
4. **One propagated override.** During work rep 1, nudge the speed up (or down) a couple
   of notches. Let rep 1 finish, go through recovery, and reach work rep 2 (same
   prescribed target as rep 1). Confirm rep 2 opens at YOUR adjusted number, not back at
   the original target — and that the recovery in between stayed at its own
   (unadjusted) pace. Tap "Reset to plan" once you've confirmed it — the number should
   snap back to the original target immediately.
5. **Audio while music plays.** Confirm the transition cue you already heard in step 2
   ducked the music rather than stopping it or getting drowned out.
6. **Background/foreground.** Mid-recovery, background the app (home button/swipe) for
   10–15 seconds, then return. Confirm: elapsed time and belt numbers caught up
   correctly (no obvious jump backwards or frozen clock), and HR resumed updating
   within a few seconds rather than staying stuck on the pre-background number.
7. **Skip — cancel, then confirm.** With a work rep active, tap Skip. Confirm a dialog
   appears naming the phase you'd be leaving and the one you'd land on. Tap Cancel —
   confirm nothing changed. Tap Skip again and confirm this time — confirm it actually
   advances and the skipped phase doesn't get credited as completed.
8. **Cooldown.** Once you reach cooldown, confirm it shows a real target speed
   immediately (not blank, not stuck on the previous phase's number) and shows
   remaining time or distance for the cooldown itself, not just silence.
9. **End — cancel, then confirm.** Tap End. Confirm a dialog appears stating elapsed
   time/distance before anything saves. Tap Cancel — confirm the run keeps going. Tap
   End again and confirm — confirm it actually saves and takes you to the post-run
   screen.
10. **Post-run page.** Open the completed run. For the work reps: confirm it does NOT
    say "no prescribed pace" — it should describe the work as treadmill effort
    (speed/incline), not claim nothing was prescribed. Confirm the reps do not appear
    mislabeled as strides.

**What to report back, plainly, for each numbered step:** worked as described / worked
but felt off (say how) / did not work. Nothing here needs to be a perfect run — a
genuinely honest "step 6 felt laggy" is worth more than "all good."
