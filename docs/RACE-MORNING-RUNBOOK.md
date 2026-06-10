# RACE MORNING RUNBOOK — Americas Finest City Half · 2026-08-16

The integration fixes harden every link in the race-day chain, but three links
still depend on a phone action or have no software backstop. This is the
60-second procedure that closes them. Do it in order, before leaving for the
start.

## The night before (Aug 15)

1. Charge the watch to 100%. The crash-recovery path saves the workout data,
   but a dead battery mid-race still costs live pacing from that point on.
2. Open the iPhone app once after 6 PM. This pushes the race workout to the
   watch (foreground now re-pushes — it no longer requires a cold launch) and
   flushes any queued completions.
3. Expect the race-eve notification at 21:00. If it does not arrive,
   notifications are broken — the readiness brief and race-morning push will
   not arrive either. Check `GET /api/cron/notifications` (`delivered_24h`,
   `apns_host`) or just proceed; nothing else depends on it.

## Race morning

1. **Cold-launch the iPhone app** (swipe it out of the app switcher first,
   then open). This forces: watch context push with TODAY's race payload,
   HealthKit import, token refresh, and completion-queue flush.
2. **Verify the watch lobby shows the RACE session** (name + 13.1 + goal
   line), not yesterday's shakeout. If it shows STALE PLAN, give it ~10s
   with the phone nearby; the explicit refetch fires automatically.
3. If the watch cannot reach the phone at the start line, START ANYWAY is
   safe: the payload it holds was refreshed in step 1.

## During the race

- If the watch app crashes or the watch reboots: reopen the app. It now
  recovers the live workout session — choose RESUME (or END & SAVE if you
  are already done). The recording is not lost.

## After the finish

1. End the workout once, on the summary screen. The completion uploads
   automatically (direct LTE/WiFi lane plus the phone relay).
2. **Do not START another session on the same workout.** A cooldown jog
   goes unrecorded or in the Workouts app — a second Faff session on race
   day would file a second run against the race date (the overwrite bug is
   fixed; the clutter is not worth it).
3. Open the iPhone app once within the hour so the HealthKit twin (full
   GPS/HR series) lands and merges.
4. Enter the official finish time on the race page when posted. The re-add
   wipe bug is fixed; the result is safe once saved.

## Known residual risks (accepted)

- Phone dead + watch out of LTE: completion sits in the watch's durable
  queue and uploads on next connectivity. Data safe, just delayed.
- APNs delivery depends on the Railway APNS_* env vars being configured
  and verified with a test push BEFORE race week (see the fix recap —
  this was never configured as of 2026-06-09).
