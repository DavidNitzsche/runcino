# Pre-Race Verification Checklist — Big Sur 2026

Do this **the morning before race day** (Saturday 2026-04-25). Gate
every Watch haptic against a primary source. The point is that nothing
fires on race day that I haven't personally verified.

---

## Part A · Swap in the real GPX (5 min)

- [ ] On your Mac, copy your 2024 Big Sur GPX into the repo:
      ```
      cp ~/Downloads/gpx_20240428_id8679_race1_20250117093547.gpx \
         "/Volumes/WP/06 Claude Code/runcino/web/public/sample-bigsur.gpx"
      ```

- [ ] Commit it:
      ```
      cd "/Volumes/WP/06 Claude Code/runcino"
      git add web/public/sample-bigsur.gpx
      git commit -m "Swap in real Big Sur 2024 GPX (course unchanged for 2026)"
      git push
      ```

- [ ] Rebuild and re-run tests:
      ```
      cd web && npm test
      ```
      All 75 should still pass. If gpx.test fails, the real GPX's point
      count or distance is outside the synthetic's bounds — update
      the test range and re-run.

---

## Part B · Regenerate the plan from the real GPX (5 min)

- [ ] Run the pipeline:
      ```
      cd web && npm run build-plan
      ```

- [ ] Inspect the output on your terminal. Expect:
  - Distance: 26.22 mi ± 0.1 (no warning)
  - Gain: 2,182 ft ± 400 (no warning expected with real GPX)
  - Loss: 2,528 ft ± 400
  - Phases: 6, with the 6 canonical labels
  - Gels: 6
  - Landmarks: 5 (Hurricane begins, summit, Bixby, Strawberry, last climb)
  - Check: drift from goal should be 0 seconds

- [ ] Open `web/public/big-sur-3-50.runcino.json` and eyeball the
  `claude_rationale` (should say `null` — goal-setting happens on web
  before export if you use Claude) and the `intervals` array.

---

## Part C · Cross-check every landmark (15 min)

Open the **official Big Sur course map PDF**:
https://www.bigsurmarathon.org/wp-content/uploads/2023/03/BSIM_2023_MarathonCourse_v1.pdf

For each landmark in `web/data/courses/big-sur-marathon.json`, verify
the mile marker matches the PDF to within 0.3 miles. If a landmark
fails verification, open the facts file and either:
- Demote the landmark's `confidence` from `primary_source_verified`
  to `secondary_source` (it won't ship to the Watch)
- Fix the `at_mi` value if you can find the correct one in the PDF
- Delete the landmark entirely if no source supports it

| Landmark | Expected mile | Verified against PDF? |
|---|---|---|
| Hurricane Point climb begins | 10.0 | [ ] yes / [ ] no |
| Hurricane Point summit | 12.0 | [ ] yes / [ ] no |
| Bixby Bridge · halfway | 13.1 | [ ] yes / [ ] no |
| Strawberry Station | 23.2 | [ ] yes / [ ] no |
| Last real climb | 25.0 | [ ] yes / [ ] no |

- [ ] All 5 landmarks verified against the 2023 BSIM course PDF.

---

## Part D · Cross-check every phase (10 min)

Phases don't fire haptics on their own, but they are how you'll see the
plan on your iPhone and how the Watch displays "what phase am I in."

| Phase | Expected range | PDF agrees? |
|---|---|---|
| Redwood descent | 0.0–5.0 | [ ] |
| Rolling to Hurricane base | 5.0–10.0 | [ ] |
| Hurricane Point climb | 10.0–12.0 | [ ] |
| Descent to Bixby Bridge | 12.0–14.0 | [ ] |
| Highway 1 bluffs | 14.0–22.0 | [ ] |
| Carmel Highlands finish | 22.0–26.22 | [ ] |

If boundaries drift from the PDF, edit
`web/data/courses/big-sur-marathon.json` and rerun `npm run build-plan`.

---

## Part E · Swap in real weather (5 min)

- [ ] Pull the NOAA forecast for Carmel Highlands, Sunday 2026-04-26,
      6:30 AM start:
      https://forecast.weather.gov/MapClick.php?lat=36.555&lon=-121.923

- [ ] Capture: start temp, finish temp, wind speed+direction, cloud
      cover, precipitation probability.

- [ ] Run the brief generator:
      ```
      curl -X POST http://localhost:3000/api/brief \
           -H 'content-type: application/json' \
           -d '{"courseSlug":"big-sur-marathon","weatherText":"YOUR FORECAST HERE","phases":[...]}'
      ```
      (Easier: go to the web UI, enter the forecast, hit the button.)

- [ ] Review the brief's `plan_adjustments`. If Claude suggests
      +5 sec/mi on any phase due to weather, accept it or override.

---

## Part F · Rebuild the final JSON (5 min)

- [ ] Import the updated plan into the iOS app:
  1. Email yourself `web/public/big-sur-3-50.runcino.json`
  2. Open in iPhone → share sheet → "Open in Runcino"
  3. Tap "Add to Apple Watch"
  4. Confirm the workout shows on your Apple Watch in the Workout app

- [ ] Do a short (30 min) test run with the workout on your Watch to
      verify:
  - Pace haptic fires when you drift outside ±10 sec/mi
  - Phase transitions announce at the expected mile markers
  - Fueling step auto-advances after 30 seconds
  - Screen shows the right step label

---

## Part G · Race morning (minutes before the gun)

- [ ] Check the actual Watch workout one last time — does it say
      "Big Sur · 3:50:00"?
- [ ] Plane mode off, location services on
- [ ] Fully charged Watch
- [ ] Run a good race

---

## If something looks wrong mid-race

- **Pace haptic feels off:** check what phase the Watch thinks you're
  in. If phase is wrong, ignore the haptic and pace by feel. A
  pre-race-plan bug is a retrospective bug — not a race-day crisis.
- **Fueling cue didn't fire:** take the gel anyway. The cues are
  reminders, not gates.
- **You blow up at mile 20:** the plan assumed effort-equivalent
  pacing; if you went out 10 sec/mi faster than plan in phase 1-2,
  the back half was going to be hard regardless. Slow down, finish.

---

## After the race

Run the M1 retrospective (post-Big Sur build). Watch workout export +
plan + weather log → Claude writes the race report and calibrates
your personal GAP model for the next race. See
[`MASTER_PLAN.md`](MASTER_PLAN.md) M1 milestone.
