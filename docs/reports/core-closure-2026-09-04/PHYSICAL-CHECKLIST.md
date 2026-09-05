# Physical verification checklist

**Automated proof and physical proof are separated deliberately.** Everything in
part A was proven by a machine. Nothing in part B has been proven at all until
you do it on your own devices. Rule 13: a fix to something the runner sees is
verified by rendering it with real data, not by reading code.

---

## Part A · what is already proven, and by what

| Claim | Proof | Where |
|---|---|---|
| Retry calls a pool reset before refetching | source assertion, 10 call sites | `ViewsV5/HostsV5.swift` |
| A broken pooled connection is recognised | 7 unit tests, falsified | `FaffTests/StuckConnectionTests.swift` |
| `.networkConnectionLost` counts as a stuck signal | test; reverting to `.timedOut` only fails 2 tests by name | same |
| A cold start does not reset the pool | test; inverting it fails by name | same |
| An 11-hour background does reset the pool | test | same |
| The reset boundary is continuous and one-directional | walk test across 0 to 900s | same |
| A healthy parallel request cannot erase failure evidence | `recordSuccess()` is deleted; no call site remains | `API.swift` |
| The app compiles and its tests pass | BUILD SUCCEEDED, TEST SUCCEEDED, iPhone 17 Pro | xcodebuild |

**What part A cannot prove.** That `URLSession.shared.reset` actually clears a
real stuck connection on a real network. That is Foundation's behaviour and no
unit test observes it. And that the 90-second rolling window behaves correctly
against real concurrent traffic, because the window and threshold are private
policy constants no test reads.

---

## Part B · physical, on your devices

Record PASS / FAIL / NOT RUN against each. A blank is not a pass.

### B1 · STUCKCONN-2, tomorrow morning · the one that matters

This is the whole point of the build. Do it before anything else, on the first
foreground of the day.

1. **Do not touch the phone overnight.** The failure needs a real long
   background; a short one will not reproduce it.
2. **First foreground of the morning.** Open Faff and go straight to Today.
   - **Expected:** no "Can't reach faff" banner. Content is today's, not
     yesterday's.
   - **If the banner appears anyway:** do NOT tap Retry yet. Screenshot it
     first, including the age it claims. That age is the evidence.
3. **Then tap Retry once.**
   - **Expected:** the banner clears within a couple of seconds and the content
     refreshes.
   - **This is the specific thing that was broken.** Retry previously reissued
     down the same dead connection and could never succeed. If it still does
     nothing, the diagnosis was wrong and I need to know that rather than
     guess again.
4. **Airplane mode for 30 seconds, then off.** Foreground the app.
   - **Expected:** the banner appears while offline (correct, it is honest), and
     clears on its own or on one Retry once the network returns.
5. **Background the app for 10 minutes, then foreground.**
   - **Expected:** fresh content, no banner. This exercises the 5-minute pool
     reset without needing a full night.

### B2 · Phone and Watch showing the same workout phases

1. Open today's session on the phone. Note the phase list and each phase's
   target.
2. Open the same session on the Watch.
   - **Expected:** identical phases, identical order, identical targets. Not
     "similar".
3. Start the run on the Watch and let it cross one phase boundary.
   - **Expected:** the phase advances on both, and neither shows a phase the
     other does not.

### B3 · Stable-width digits

1. Watch a live pace or timer field tick through several values.
   - **Expected:** the surrounding layout does not shift as digits change. A
     `1` must occupy the same width as an `8`.
2. Check both phone and Watch.

### B4 · End and Skip dialogs actually block taps

1. Mid-run, open the End dialog.
2. Try to tap a control BEHIND the dialog.
   - **Expected:** nothing behind it responds. The dialog is modal in fact, not
     only in appearance.
3. Repeat for Skip.

### B5 · Cues firing through the speaker

1. Run with the phone unmuted and no headphones.
   - **Expected:** phase-change cues are audible through the speaker.
2. Repeat with headphones connected.
3. Note whether the silent switch suppresses them, and whether that is what you
   want.

### B6 · Pause and resume at boundaries

1. Pause exactly at a phase boundary.
2. Resume.
   - **Expected:** the phase does not double-advance, and does not rewind.
   - **Expected:** elapsed time and distance are continuous across the pause.

### B7 · Background-gap recovery during a run

1. Start a run. Background the app for 5 minutes while still moving.
2. Foreground it.
   - **Expected:** distance and time include the backgrounded period. No gap in
     the route line.

### B8 · Checkpoint resume

1. Mid-run, force-quit the app.
2. Relaunch.
   - **Expected:** the run resumes from its last checkpoint rather than starting
     over or being lost.

### B9 · Stale-connection recovery after long backgrounding, during a run

1. Start a run, background for a long period, foreground.
   - **Expected:** the run continues AND server-backed content refreshes without
     a stuck banner. B1 and B7 interact here and this is the combination.

---

## Part C · not yet buildable, and why

These were on the checklist and cannot be tested on a device yet. They are
listed rather than quietly dropped.

| Item | Status |
|---|---|
| **Move-a-Run synchronization** | The feature is in build on branch `move-a-run` and is not in any shipped build. Nothing to test. |
| **Adapted mileage appearing consistently** | There is no live upward mileage adaptation. The seam is sealed and the mileage-responsive path is in build in shadow. See `MILEAGE-TRACE.md`. Nothing to test on a device. |
| **Conditional dose changes propagating correctly** | Dose-responsive future workouts are in build on branch `dose-responsive`. Not shipped. |

When those land and ship, this checklist gains three sections. Until then,
claiming they are verifiable would be false.
