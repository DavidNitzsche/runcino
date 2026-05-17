# D2 — Watch Active Workout UX

The execution layer. Where a runner stops thinking about the app and the app does the work. Big numbers, two haptics per interval, a voice that knows when to shut up.

This doc is about the mid-run screen — what's on it, what's behind it, and what the watch says, taps, and shows when. It assumes the workout has already been pushed to the watch (covered in D1) and analyzed afterward (D3). It also assumes WorkoutKit-native execution where possible (covered in F2).

**Brand reminder:** reductive, glanceable, audio + haptic over visual, no coach essays. The watch is "7:25 next mile, 4 to go," not "let's reflect on what threshold pace means today."

---

## 1. Job-to-be-done

| Question the runner is asking | Answer the watch must give |
|---|---|
| Am I on pace right now? | Current vs. target with a delta visible at arm's length |
| What rep am I in? | "MILE 3 OF 5 · THRESHOLD" — always anchored top of screen |
| How much longer in this rep? | Distance or time remaining on hero line |
| What's next? | One peek away — Up Next view or auto-spoken at T-30s |
| Am I in trouble? | Warning haptic, color shift, audio if egregious |
| When is this workout over? | Total elapsed + total remaining |
| Did it count? | Auto-save, sync, haptic confirmation |

Every other question (HR detail, cadence, elevation profile, splits chart) is drill-down. Off the hero screen by default.

---

## 2. Comparative analysis

### 2.1 Native Apple Workout (watchOS 10 / 11)

| Aspect | Implementation |
|---|---|
| Interval display | Custom Workout card: step name, target range, time/distance remaining. Up Next view shows what's coming. |
| Pace target | Visual target gauge (refreshed in watchOS 11): a horizontal range bar with current pace marker. Color shifts off-target. |
| Auto-advance | Distance/time goals auto-advance with start/stop haptic. Open goals require manual lap (Digital Crown press or side button). |
| Audio cues | Pace alerts (now also for indoor running in watchOS 11). Spoken via system voice. |
| Haptic | Step transition: prominent double-tap. Off-pace: notification haptic at threshold crossing. |
| Layout | Stacked metrics: hero on top (depending on view), step ID secondary, time elapsed on top edge. |
| Strength | Best-in-class for "keep me on pace inside a known plan." Native, free, low-friction. |
| Weakness | Limited customization of step naming until watchOS 11. Pace lag and smoothing make instant pace unreliable for short reps. No coach-voice spoken cues — just system pace alerts. |

### 2.2 Stryd

| Aspect | Implementation |
|---|---|
| Hero metric | Power (watts), not pace. Critical Power as personal anchor. |
| Visualization | Dynamic power zone bar — current value plotted on a colored band; out-of-zone shifts color. Zone bar dominates the screen. |
| Structured workouts | Imported from TrainingPeaks, Final Surge, Today's Plan. Auto-tailored to current Critical Power. Step-by-step guided flow with audio + haptic alerts. |
| Audio | Voice prompts at step transitions. Out-of-zone power alerts. |
| Haptic | Vibrational alerts when power drifts outside step target. |
| Strength | Power solves the pace-lag and terrain-variance problems. Zone bar is glanceable. |
| Weakness | Requires Stryd footpod. Not native. Power literacy required. |

### 2.3 WorkOutDoors

| Aspect | Implementation |
|---|---|
| Customization | 4+ screens, 18+ metrics per screen, 100+ metrics to choose from. Per-step screen layout (cool-down can look different from interval). |
| Mapping | Map embedded in any data screen. Routes follow live. |
| Alerts | Voice + haptic for zone exits. |
| Strength | Endless flexibility for power users. |
| Weakness | Complexity tax — requires upfront investment to configure. Anti-brand for a coached app. |

### 2.4 Garmin Forerunner / Fenix

| Aspect | Implementation |
|---|---|
| Workout mode | Imported workouts display step name, target range, lap stats. Out-of-range alerts (audio + buzz). |
| Pace bug | Long-standing complaint: workout mode displays step pace (running average within the rep), not instant pace. Many users want instant for short reps; current average for long ones. |
| Pace target | Speedometer-style range gauge during workouts. PacePro creates pace-band visualization for races. |
| Strength | Mature, reliable, deep customization. |
| Weakness | Average-pace-by-default fights short intervals; out-of-zone alerts can't be selectively disabled inside structured workouts. |

### 2.5 Runna (Apple Watch app and Workout Mirroring)

| Aspect | Implementation |
|---|---|
| Coaching model | Voice-led. Runna talks the runner through every step: "Speed up… 30 seconds left… recover." |
| Audio cues | Granular per-step prompts: speed up, slow down, rest countdown, halfway, finish. Configurable on/off per cue type. Audio ducks music briefly. |
| Workout Mirroring | Newer mode mirrors the watch screen on iPhone for setup, runs natively on watch. |
| Strength | Conversational coach voice translates structure into in-ear guidance. Runners don't have to look at their wrist. |
| Weakness | If the runner mutes audio, the watch screen falls back to a fairly generic display. Coach personality is fixed. |

### 2.6 TrainingPeaks (via WorkoutKit)

| Aspect | Implementation |
|---|---|
| Architecture | No watch app. TrainingPeaks pushes structured workouts as Custom Workouts to the native Apple Workout app via WorkoutKit. |
| Sync | Auto-syncs today + next 6 days. |
| Strength | Native execution, no app to install, full WorkoutKit feature set. |
| Weakness | Bound by what WorkoutKit exposes. RPE-only steps don't sync. |

### 2.7 Strava

| Aspect | Implementation |
|---|---|
| Approach | Minimal. Time on top, current pace dominant, distance + HR bottom corners. |
| Customization | Almost none. |
| Pace | Shows "Split" (last-mile average), not current. A frequent complaint. |
| Recent additions | Saved routes, segments, navigation on watch. |
| Strength | Trivial for a casual user. |
| Weakness | Useless as an execution layer for structured workouts. |

### 2.8 Synthesis

| Pattern | Best-in-class |
|---|---|
| Hero metric | Apple (configurable), Stryd (power) |
| Step context | Apple Workout card + Up Next |
| Voice coaching | Runna |
| Glanceable target visualization | Stryd zone bar, Apple's refreshed pace target gauge |
| Customization without complexity | Apple Custom Workouts |
| Customization with complexity | WorkOutDoors |
| Watchscreen as silent screen | Apple + Runna combination |

**Take:** The faff.run watch experience should be Apple Workout's native foundation (WorkoutKit) + Runna-grade voice coaching + Stryd-style glanceable target band, all under the brand's reductive aesthetic. Power as an option for users with footpods, pace as default.

---

## 3. Structured interval display

### 3.1 The screen anchor

Every screen during a structured workout shows a one-line context anchor at the top edge:

```
MILE 3 OF 5 · THRESHOLD
```

- **Step number / total** — never miss this.
- **Step type** — `THRESHOLD`, `EASY`, `RECOVERY`, `INTERVAL`, `STRIDES`, etc. Drawn from the faff.run workout vocabulary (Research/04). Single small-caps word.
- **Color** = step type semantic. Threshold purple, intervals red, easy green, recovery gray.

This anchor never moves. The data below it changes as the runner swipes or as the watch advances views.

### 3.2 The hero line

Below the anchor, one number gets the screen. Two-thirds of vertical space, ~80–100pt:

| Step type | Hero metric | Why |
|---|---|---|
| Warmup, easy, recovery | Time elapsed in step | Pace doesn't matter; time does |
| Threshold, MP, HM | Current pace | Pace is the target |
| Intervals (I, R, 5K, 3K) | Time remaining in rep | Short reps — pace is too laggy; finish the rep |
| Distance-defined reps (e.g., 1mi at T) | Distance remaining | Where am I in this rep |
| Strides, hill sprints | Time remaining | Short, count-down focus |
| Cooldown | Time elapsed | Get home |

Step config decides which of these is hero. WorkoutKit's `goal` (distance vs. time vs. open) maps directly.

### 3.3 The target line

Directly under the hero, a single line:

```
Target 7:20–7:35
```

Or, when on track:

```
On pace · 7:28
```

Or, when off:

```
+12s slow
```

Color of this line shifts: green when in band, amber when ±5–8s/mi out, red when ±10s+ for >5 seconds.

### 3.4 Up Next

Native Apple's Up Next view is good. Replicate it. Pre-step, T-30s, and via swipe-left:

```
NEXT: 90s RECOVERY
THEN: MILE 4 OF 5 · THRESHOLD
```

### 3.5 Auto-advance vs. manual lap

| Step type | Behavior |
|---|---|
| Distance-defined (e.g., 1 mi at T) | Auto-advance on distance hit |
| Time-defined (e.g., 90s recovery) | Auto-advance on timer elapsed |
| Open (e.g., "warmup until ready") | Manual: side button or hard press |
| User-tagged "I'm done early" | Long-press hero to skip remainder |

Distance-based auto-advance is the most error-prone (GPS drift on tracks; hand-measured indoors). Allow a 0.95–1.05 grace band: if the runner laps manually within ±5% of the target distance, accept it as the canonical lap.

### 3.6 Transition cues

When a step ends and the next begins:

| Cue | When | Detail |
|---|---|---|
| Pre-warning haptic | T-10s | Single short tap |
| Voice pre-warning | T-10s | "Ten seconds — recover next" or "Ten seconds — threshold next" |
| Step start haptic | T-0 | WKHapticType.start (decisive double tap) |
| Voice step start | T-0 | "Threshold. 1 mile. 7:25 to 7:35." |
| Visual flash | T-0 | Quarter-second screen pulse to step-type color |

Volume of haptic + voice scales to step intensity contrast: easy → threshold transition gets the full announcement; threshold → harder threshold rep gets a shorter "next rep."

---

## 4. Pace target visualization

### 4.1 The pace target band

```
   slow ←———|————◉————|———→ fast
        7:35           7:20
              ◉ 7:28
```

A horizontal band, 240pt wide, 20pt tall. Two tick marks at the lower and upper bounds. A solid dot represents current pace, sliding left/right. Outside the band, dot turns amber (just out) or red (significantly out, >10s/mi from band).

Apple's watchOS 11 refreshed target view does this natively for Custom Workouts. We adopt it. For Easy and Open steps, the band is replaced by a single-anchor "drift indicator" — the average-pace-vs-target delta, since "easy" tolerates a wide range and a band-with-edges is misleading.

### 4.2 Delta indicator (compact)

When real estate is tight (e.g., interval rest screen, AOD), use the delta indicator only:

```
+12s     // slow by 12s/mi
−3s      // 3s fast
✓        // in band
```

Color-coded. ≤2 characters fits any size.

### 4.3 Pace lag and the "instant pace lie"

Apple's instant pace is heavily smoothed and lags ~5–10 seconds behind reality. For short reps (under 90s), instant pace is misleading. Mitigations:

| Rep length | Pace source |
|---|---|
| ≤ 60s | Hide pace; show time-remaining as hero. Optionally: "running step pace" (rolling 30s average) on swipe-down. |
| 60s – 3 min | Step average pace as hero; instant pace as secondary on swipe. |
| > 3 min | Instant pace as hero (smoothed); step average on swipe. |
| Easy/long | Smoothed instant pace; alert if persistent drift >15s/mi from prescribed easy band. |

This is the single most important pace-display decision. Garmin's long-running complaint (workout mode shows step average not instant pace) lands here.

### 4.4 Power as an alternative anchor (optional)

If the user has Stryd or supports running power: show power, in watts, with the same band visualization. Power is responsive (sub-second), terrain-corrected, and elevation-corrected. Default off; opt-in in setup. Pace remains the public metric in summaries (power for execution, pace for comparison).

### 4.5 HR as an anchor for easy days

For easy/recovery steps, HR-based prescriptions work better than pace-based. Optional swap: instead of "Easy 7:50–8:30 pace," use "Easy <140 bpm" with the band visualization driven by HR. HR lag (15–60s for the watch's optical sensor) is acceptable on long easy efforts.

---

## 5. Audio cue specification

### 5.1 Voice strategy

**Two voices, one chosen at setup:**

1. **System voice (default)** — uses the watch's built-in TTS. Free, multi-language, low memory cost. Personality flat.
2. **Coach voice (premium)** — pre-recorded clips for ~80 canonical phrases stitched together. Personality: brand-aligned (direct, honest, slight warmth). Stitched template: `"<step>. <target>. <duration>."` Plays through headphones if connected, watch speaker otherwise.

Hybrid possible: coach voice for canned cues; system TTS for parameterized cues ("400m repeat. 1:36 target."). Brand directs which.

### 5.2 What to say, when

| Cue | Trigger | Default copy |
|---|---|---|
| Workout start | T-0 of warmup | "Warmup. 10 minutes easy." |
| Step pre-warning | T-10s of step end | "Ten seconds." (no narration if recovery → recovery transition) |
| Step start (work) | T-0 | "Threshold. One mile. 7:25 to 7:35." |
| Step start (recovery) | T-0 | "Recover. 90 seconds." |
| Halfway in step | mid-step, work only | "Halfway." (only on reps ≥90s, only on first 2 of any series) |
| Off-target persistent | 8+ seconds outside band | "Pace check. Pick it up." or "Ease back." |
| Last rep callout | Start of final rep | "Last one. Make it count." |
| Mile/km splits | Per mile | "One mile. 7:31. Average 7:28." (off by default during structured workouts) |
| Workout halfway | 50% total time elapsed | "Halfway. Three reps to go." |
| Cooldown start | T-0 of cooldown | "Cool down. Easy back." |
| Workout end | T-0 of last step end | "Workout complete." (single beat) |

### 5.3 What NOT to say

- No "Great job!" / "You're crushing it!" — anti-brand.
- No mile splits during interval workouts (the splits aren't the unit; reps are).
- No HR readouts mid-rep unless the runner explicitly opted into HR-driven steps.
- Never repeat the same cue within 20 seconds.
- Suppress all non-critical audio if the runner is on a phone call.

### 5.4 Audio routing

| State | Where audio plays |
|---|---|
| AirPods / BT headphones connected | Headphones, music ducks 50% |
| Watch only | Watch speaker (loud enough outdoors) |
| Phone-paired headphones (no watch BT) | Phone routes |
| User on call | Suppress non-critical; haptic only |

### 5.5 User controls

- Master mute (haptic-only fallback retains everything via taps).
- Per-category toggles: transitions, halfway, splits, off-target warnings, last-rep callout.
- Voice volume independent of music volume.

---

## 6. Haptic specification

watchOS exposes `WKHapticType` (start, stop, success, failure, retry, click, notification, directionUp, directionDown). No CoreHaptics on watchOS — the Taptic Engine pattern set is fixed and rate-limited. Design within those constraints.

| Event | WKHapticType | Pattern | Why |
|---|---|---|---|
| Step start (work) | `.start` | Single decisive double-tap | Distinct, motivating |
| Step start (recovery) | `.success` | Two soft taps | Gentler — you earned the rest |
| Step pre-warning (T-10s) | `.click` | Three quick taps | Anticipatory |
| Off-target (entry) | `.notification` | Standard notification pattern | Recognizable as alert |
| Off-target (sustained) | none | (none — voice handles) | Avoid haptic spam |
| Mile/km split | `.directionUp` | Single short tap | Subtle, easy to miss if focused |
| Halfway | `.directionDown` | Single longer tap | Distinct from split |
| Last rep | `.start` + delay + `.start` | Two start patterns 200ms apart | "Pay attention" |
| Workout end | `.success` × 3 | Triple success — a celebration | Earned signal |
| Pause acknowledged | `.stop` | Single sharp tap | Confirms input |
| Resume acknowledged | `.start` | Single tap | Confirms input |
| Manual lap | `.directionUp` | Short tap | Confirms |
| End-confirmed | `.success` | Single | Saved |
| Saved successfully (post-end) | `.success` | Single soft | Sync confirm |

### 6.1 Rate-limiting

The Taptic Engine drops haptics that overlap. Enforce ≥250ms between events. If two would collide, queue and drop the lower-priority one.

### 6.2 Haptic-only mode

Users running silent (race day, library, sleeping kid) can mute audio entirely. Haptic pattern set must convey workout state without speech. Accept this as a real use case — design accordingly. No haptic combinations should be ambiguous.

---

## 7. Outdoor readability

### 7.1 Font sizes

The most repeated complaint about the native Apple Workout app: text is too small to read in motion in sun. We solve this with two principles: fewer metrics per view, larger metrics that remain.

| Element | Size | Weight | Notes |
|---|---|---|---|
| Step anchor (top) | 14pt | Semibold, small-caps | Always visible |
| Hero metric | 80–100pt | Heavy / Black | Tabular figures (monospace digits) |
| Target line | 22pt | Medium | Two lines max |
| Secondary metric | 18pt | Regular | One only on hero screen |
| AOD hero | 56pt | Heavy | Reduced size |
| Up Next title | 16pt | Medium, small-caps | |
| Up Next body | 24pt | Semibold | |

Minimum interactive target: 44×44pt per HIG. End/Pause buttons: 88×88pt.

### 7.2 Contrast and color

- Black background (always — even if user's watch face is light).
- White text minimum default.
- Step-type accent only on the anchor stripe and the hero halo.
- Off-pace amber: WCAG AAA contrast against black.
- Off-pace red: red 200 (light, high-contrast variant), not deep red.
- Avoid green-on-black for hero text under bright sun — desaturates fast.

### 7.3 Sweat / sun considerations

- No tap targets near edges (palm sweat triggers).
- No fine-grained scrubbing (the wrist is wet and bouncing).
- AOD must keep the step anchor and hero metric readable. Drop the target band visualization to a delta number under AOD.
- Brightness: full bright by default during workout (override system auto-brightness).

### 7.4 Always-On Display

Apple Watch AOD reduces battery cost ~5–20% during workouts. With AOD ON during a 2-hour workout, expect battery hit ~10–15%. The brand bias: keep AOD on. Glanceable without arm flicks is the brand promise.

AOD layout differs from active layout:

```
ACTIVE                          AOD
═══════════════════             ═══════════════════
MILE 3 OF 5 · THRESHOLD         MILE 3 · THRESHOLD
                                
   7:28                            7:28
                                
[━━━━●━━━]                         +3s
Target 7:20–7:35                
                                0:42 / 5:00
0:42 / 5:00                     
HR 168                          
═══════════════════             ═══════════════════
```

AOD drops: secondary metrics, target band visualization, HR. Keeps: step anchor, hero pace, delta to target, step time elapsed/total.

### 7.5 Per-step view selection

WorkoutKit allows different views per step (watchOS 11). Use it. Default mapping:

| Step type | Default view |
|---|---|
| Warmup | Time view (mm:ss elapsed + "warming up") |
| Easy / recovery | Drift view (delta from easy band) |
| Threshold / MP | Pace target view (band) |
| Short intervals | Time-remaining view + delta |
| Strides | Stride counter (reps done / total) + time |
| Cooldown | Time view |

User can override per-step; the default is opinionated.

---

## 8. Interaction model

### 8.1 Buttons and gestures

| Action | Input | Result |
|---|---|---|
| Pause | Side button (single press) or 2-finger long-tap on screen | Pauses workout, screen dims, "Paused" overlay |
| Resume | Same as pause | Resumes |
| Manual lap | Digital Crown press | Advances step, single haptic confirm |
| Skip rest of step | Long-press hero (1.5s) | Confirmation: "Skip remaining? Yes / No" |
| End workout | Side button + crown together | Same as native — kills accidental ends |
| Swipe up | Up Next view | Shows next 1–2 steps |
| Swipe down | Music / now playing | Standard system control |
| Swipe left | Secondary metrics page | HR, cadence, elevation, etc. |
| Swipe right | Controls (lock, water lock, end) | Standard |
| Digital Crown turn | Adjust visual display brightness | Standard |
| Long-press anywhere | Lock screen | Required during rain/sweat |

### 8.2 Accidental tap protection

| Risk | Defense |
|---|---|
| Sleeve-rub pause | Pause requires side button OR sustained tap, not single tap |
| Sweat-triggered end | End button reveal requires firm or sustained press |
| Mid-rep accidental skip | Long-press confirmation modal |
| Race-day accidental crown | Auto-lock available; crown press still passes through |

Lock during workout is one swipe-right + lock tap. Water Lock for hard rain / pool. The native gesture (firm-press menu) was deprecated in newer watchOS — fall back to swipe-right control panel.

### 8.3 End-of-workout flow

```
   ┌────────────────────────┐
   │  WORKOUT COMPLETE      │
   │                        │
   │  5 × 1 mi · Threshold  │
   │  7:31 avg · 7:25 tgt   │
   │  ✓ All reps in band    │
   │                        │
   │  [Save & Sync]   [End] │
   └────────────────────────┘
```

- Auto-save in 10s if no input. Haptic cue at 5s remaining.
- "How did that feel?" RPE prompt: 1–5 emoji scale (deferred to phone if user dismisses on watch).
- "Save & Sync" is default. "Discard" requires confirmation modal. "Resume" if user tapped end accidentally — resume window 30s.
- Sync: pushes to phone (HealthKit + app DB) within 30s on Bluetooth. If no phone in range, queues until reconnect.

### 8.4 First-rep affordance

The runner's hardest cognitive moment is "is this thing doing what I think?" — first rep starts. Belt and suspenders:

1. Spoken cue: "Threshold, mile one, target 7:25 to 7:35."
2. Visual: full-screen "READY → THRESHOLD" pulse for 1s.
3. Haptic: start pattern.
4. Hero metric and band visible from second 0.

Mile 1 of 5 always gets the full announce. Subsequent reps shorten to "Mile 4. 7:25 to 7:35."

---

## 9. Battery considerations

### 9.1 Budget

Target: a 22-mile long run completable on a single Series 9/10 charge. Apple Watch Ultra/Ultra 2 has more headroom; Series watches are the constraint.

| Setting | Battery cost during workout |
|---|---|
| AOD on | +10–20% over AOD off |
| Music streaming over BT | +10–15% |
| Standard GPS sampling (1 Hz) | baseline |
| Reduced GPS (1 ping / 2 min) — Low Power Mode | −30–40% drain |
| HR continuous (1 Hz) | baseline |
| HR reduced (once/min) | −5–10% |

### 9.2 Defaults

- AOD ON during workout (brand: glanceable).
- Standard GPS sampling for all structured workouts.
- HR continuous (used for zone alerts on easy steps).
- Brightness fixed at workout-bright preset.

### 9.3 Long-run mode

Optional toggle, surfaced on workouts ≥2 hours: "Long Run Mode" — Apple's Low Power equivalents (reduced GPS, HR sampling, AOD off after 30 min idle). Pace alerts continue to work; resolution drops. User opts in.

### 9.4 Race-day mode

Pre-race screen offers: Standard / Race (max accuracy) / Long Race (battery prioritized). Race pulls dual-frequency GNSS at 1 Hz, AOD on, HR continuous. Long Race relaxes GPS to 0.5 Hz with HR every 30s. Both override default for the duration of the race; revert post-race.

---

## 10. Recommended layouts

### 10.1 Structured interval — work step (hero)

```
┌────────────────────────────┐
│ MILE 3 OF 5 · THRESHOLD    │  14pt small-caps, purple accent
│                            │
│       7:28                 │  ~96pt heavy
│                            │
│ [━━━━━━●━━━━]              │  240×20 band, current=◉
│ Target 7:20–7:35           │  22pt
│                            │
│ 0:42 left · 4:18 elapsed   │  18pt secondary
│                            │
│ ♥ 168                      │  18pt, optional
└────────────────────────────┘
```

### 10.2 Recovery between intervals

```
┌────────────────────────────┐
│ RECOVER · BEFORE MILE 4    │  gray accent
│                            │
│       0:48                 │  ~96pt countdown
│                            │
│ ♥ 142 ↓                    │  HR with trend arrow
│                            │
│ Up Next: Mile 4 · 7:20–7:35│  18pt
│                            │
│ Take it easy.              │  16pt italic — single line
└────────────────────────────┘
```

Countdown style: large, monospace, ticks down. At T-10s, color shifts to step-next color (purple). Voice cue triggers.

### 10.3 Easy run (no structure)

```
┌────────────────────────────┐
│ EASY · 60 MIN              │  green accent
│                            │
│       7:48                 │  current pace
│ ✓ in easy band             │  smaller delta line
│                            │
│ 4.21 mi · 32:48            │  18pt distance + time
│                            │
│ ♥ 138                      │
└────────────────────────────┘
```

Easy runs don't show a target band — just a drift confirmation. Voice silent except mile splits if user opted in (off by default for easy).

### 10.4 Workout end (default)

```
┌────────────────────────────┐
│ ✓ WORKOUT COMPLETE         │
│                            │
│ 5 × 1 mi · Threshold       │
│ 7:31 avg                   │
│ ✓ All in band              │
│                            │
│ ♥ 172 avg                  │
│ 0:48:22                    │
│                            │
│ Saving in 8s…              │
│                            │
│ [Discard]    [Save now]    │
└────────────────────────────┘
```

### 10.5 Up Next (swipe up)

```
┌────────────────────────────┐
│ UP NEXT                    │
│                            │
│ NOW · Mile 3 of 5          │
│   Threshold · 7:20–7:35    │
│                            │
│ NEXT · 90s recovery        │
│                            │
│ THEN · Mile 4 of 5         │
│   Threshold · 7:20–7:35    │
└────────────────────────────┘
```

### 10.6 Always-On Display

```
┌────────────────────────────┐
│ MILE 3 · THRESHOLD         │  dim
│                            │
│       7:28                 │  60pt
│       +3s                  │  18pt delta
│                            │
│ 0:42 · 4:18                │  small step time
└────────────────────────────┘
```

Drops: target band, HR, secondary lines. Keeps: step ID, hero pace, delta.

### 10.7 Pause overlay

```
┌────────────────────────────┐
│       PAUSED               │  centered, dim background
│                            │
│  Mile 3 of 5 · Threshold   │
│  At 0:42 of 5:00           │
│                            │
│  [Resume]   [End]          │
└────────────────────────────┘
```

Auto-pause via accelerometer optional (off by default — too aggressive on stoplights for some users).

---

## 11. WorkoutKit implications

### 11.1 What's natively supported

| Capability | WorkoutKit since |
|---|---|
| Custom Workouts (warmup, work, recovery, cooldown) | watchOS 10 / iOS 17 |
| IntervalBlock with iterations | watchOS 10 |
| Goal types: time, distance, energy, open | watchOS 10 |
| Alert types: heart rate range, power range, speed range, cadence range | watchOS 10 |
| Indoor running pace alerts | watchOS 11 |
| Step `displayName` | watchOS 11 |
| Custom step names rendered in workout views | watchOS 11 |
| Refreshed visual target view for all custom workouts | watchOS 11 |
| Distance goals across more activity types | watchOS 11 |
| Composition import/export to file | iOS 17 |

WorkoutKit lets us define the entire structure (warmup → 5×(1mi T + 90s recovery) → cooldown) and push it to the native Workout app from the phone. The runner taps Start, the watch handles step transitions, target alerts, and haptics natively.

### 11.2 What requires custom rendering

Anything beyond the native Workout app's capabilities means our own SwiftUI watchOS app:

| Feature | Native | Custom |
|---|---|---|
| Coach-voice (pre-recorded) audio cues | ✗ | Required |
| "Up Next" view with our typography | partial | Override |
| Halfway / last-rep callouts | ✗ | Required |
| Custom haptic patterns beyond `WKHapticType` | n/a | Use `WKInterfaceDevice` patterns |
| RPE prompt at end | ✗ | Required |
| Brand-styled step anchor and color semantics | ✗ | Required |
| Reading workout mid-execution from external API for live coach adjustments | ✗ | Required (coach v2 ambition) |
| Power as primary metric (with Stryd) | partial (cycling power) | Required for running |
| Coach voice line-by-line that talks the runner through each step | ✗ | Required |
| Auto-skip-to-cooldown logic (e.g., user struggles) | ✗ | Required |

### 11.3 The hybrid recommendation

Build a native watchOS app. Use WorkoutKit's data model (`WorkoutComposition`, `WorkoutStep`, `IntervalBlock`) as the canonical representation — the same composition can either run in our app OR be exported to the native Workout app for users who prefer that.

Default flow: open faff.run on watch, today's workout is loaded, tap start. Runs in our app for full coach-voice experience. Power users can also accept the WorkoutKit-pushed version into native Workout app and run it there with degraded coach voice but full system reliability.

### 11.4 Health-flow

`HKWorkoutBuilder` records the workout to HealthKit regardless of which path. Step boundaries write as `HKWorkoutEvent` markers (lap events). This guarantees Strava, Coros, downstream apps see correctly segmented runs.

---

## 12. Open questions

1. **Pace source default for short reps** — instant vs. step-rolling-average. Need 5–10 user runs to confirm short-rep readability is sane.
2. **Voice persona** — the brand voice in audio. Tonal range: "honest and direct" or "warmer coach"? Pre-recording vs. TTS economics.
3. **Halfway cue for short reps** — does anyone want it for 3-min reps? User test.
4. **AOD default ON or OFF** — battery vs. brand. Quantify on Series 10 over 3 typical workouts.
5. **Auto-pause** — runners hate false positives at stoplights, runners hate forgetting to pause. Default to off; opt-in.
6. **End-confirmation timer** — 10s default reasonable? Some athletes pull off the watch immediately.
7. **Power as primary metric for Stryd users** — show power with pace as secondary, or pace with power as secondary? User segmentation.
8. **Coach voice during race** — should the watch shut up entirely on race day, or still coach? Race Day mode default to silent + haptic.
9. **HR-driven easy steps vs. pace-driven** — when easy is prescribed by HR, do we hide pace entirely or show it as informational?
10. **Running power without Stryd** — use Apple's native running power? Calibration story is messier than Stryd's.
11. **Strides on watch** — how does the watch count strides? Cadence-based, or a 30s rep timer? GPS distance is too noisy at 80m.
12. **Cooldown auto-extend** — if the runner is still 1km from home when cooldown ends, do we extend or stop? Strava just stops; users complain. Suggest auto-extend as easy until manual end.

---

## 13. Sources

### Apple
- [Designing for watchOS — Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/designing-for-watchos)
- [Workouts pattern — Apple HIG](https://developer.apple.com/design/human-interface-guidelines/patterns/workouts/)
- [WorkoutKit framework documentation](https://developer.apple.com/documentation/workoutkit)
- [Customizing workouts with WorkoutKit](https://developer.apple.com/documentation/workoutkit/customizing-workouts-with-workoutkit)
- [Build custom workouts with WorkoutKit — WWDC23](https://developer.apple.com/videos/play/wwdc2023/10016/)
- [Build custom swimming workouts with WorkoutKit — WWDC24](https://developer.apple.com/videos/play/wwdc2024/10084/)
- [Build a workout app for Apple Watch — Apple Developer](https://developer.apple.com/documentation/healthkit/workouts_and_activity_rings/build_a_workout_app_for_apple_watch)
- [Create a Custom Workout on Apple Watch — Apple Support](https://support.apple.com/guide/watch/create-a-custom-workout-apd66fcd5c5c/watchos)
- [Customize workout views on Apple Watch — Apple Support](https://support.apple.com/guide/watch/customize-workout-views-apd6b0679060/watchos)
- [Workout views and running metrics on Apple Watch — Apple Support](https://support.apple.com/guide/watch/workout-views-and-running-metrics-apd1f24d4d35/watchos)
- [Use the Always On feature with your Apple Watch — Apple Support](https://support.apple.com/en-us/105074)
- [Use Low Power Mode on your Apple Watch — Apple Support](https://support.apple.com/en-us/108320)
- [Choose alert sounds and haptics on Apple Watch — Apple Support](https://support.apple.com/guide/watch/choose-alert-sounds-and-haptics-apd58cffe6a4/watchos)
- [WKHapticType — Apple Developer Documentation](https://developer.apple.com/documentation/watchkit/wkhaptictype)
- [Use buttons and gestures on your Apple Watch — Apple Support](https://support.apple.com/en-us/105063)
- [Calibrate your Apple Watch for improved Workout and Activity accuracy](https://support.apple.com/en-hk/105048)

### Stryd
- [How to use the Apple Watch and Stryd? — Stryd Help Center](https://help.stryd.com/en/articles/8970460-how-to-use-the-apple-watch-and-stryd)
- [New Stryd Update for Apple Watch (March 2024)](https://blog.stryd.com/2024/03/07/new-stryd-update-for-apple-watch-a-premium-running-experience/)
- [Stryd's Apple Watch App Enables Structured Run Power Workouts](https://blog.stryd.com/2019/04/17/run-power-structured-workouts-on-apple-watch/)
- [How to do a Structured Workout — Stryd](https://help.stryd.com/en/articles/6879318-how-to-do-a-structured-workout)
- [Train at the perfect intensity with guided power-based workouts on your watch](https://blog.stryd.com/2020/10/07/structured-workouts-on-watch/)
- [Add Visual Zone Bar — Stryd](https://support.stryd.com/hc/en-us/articles/4403022079639-Add-Visual-Zone-Bar-and-Numerical-Zone-information-to-the-Garmin-watch)

### Runna
- [Using Your Apple Watch With Runna](https://support.runna.com/en/articles/6306200-using-your-apple-watch-with-runna-and-getting-the-most-out-of-it)
- [Setting Up and Managing Your Audio Cues — Runna](https://support.runna.com/en/articles/8159780-setting-up-and-managing-your-audio-cues)
- [Apple Watch Workout Mirroring — Runna](https://support.runna.com/en/articles/13620108-apple-watch-workout-mirroring)
- [Personalized Apple Watch training plans — Runna](https://www.runna.com/integrations/apple-watch)

### WorkOutDoors
- [WorkOutDoors — official site](http://www.workoutdoors.net/)
- [WorkOutDoors review — Tom's Guide](https://www.tomsguide.com/wellness/smartwatches/i-run-marathons-and-this-apple-watch-running-app-is-the-best-usd8-ive-ever-spent)
- [Apple Watch App Review — WorkOutDoors (Full Potential)](https://www.fullpotential.co.uk/post/apple-watch-app-review-workoutdoors)
- [WorkOutDoors review — MyHealthyApple](https://www.myhealthyapple.com/workoutdoors-the-most-customizable-and-fully-functional-workout-app-for-apple-watch/)

### Garmin
- [Setting a Training Target — Forerunner Owner's Manual](https://www8.garmin.com/manuals/webhelp/forerunner245/EN-US/GUID-C3DF6A79-08C1-419E-9027-9245A6CA8628.html)
- [Customizing the Data Screens — Fenix](https://www8.garmin.com/manuals-apac/webhelp/fenix7series/EN-SG/GUID-DC0DF3E1-1624-4D38-BD1B-D3BD25AF0E9E-589.html)
- [Playing Audio Prompts During Your Activity — Forerunner](https://www8.garmin.com/manuals/webhelp/forerunner945/EN-US/GUID-4FD1E429-DE3B-4A8F-870B-82D8C482B20E.html)
- [Activity Alerts — Garmin Customer Support](https://support.garmin.com/en-US/?faq=rn7xvyAETh7PWV9ryU7DY7)
- [Bug: workout pace target shows step pace not instant pace — Garmin Forums](https://forums.garmin.com/sports-fitness/running-multisport/f/forerunner-945/167532/bug-in-the-interval-workout-screen-with-pace-as-target-the-watch-doesn-t-use-instant-pace)
- [Disable 'Out of Zone' alerts in structured workouts — Garmin Forums](https://forums.garmin.com/outdoor-recreation/outdoor-recreation/f/epix-2/303351/disable-out-of-zone-alerts-when-in-a-structured-workout)
- [Display structured run workout target pace range — Garmin Forums](https://forums.garmin.com/outdoor-recreation/outdoor-recreation/f/instinct-2-series/341016/display-the-structured-run-workout-target-pace-range)

### TrainingPeaks
- [TrainingPeaks and Apple Watch — TrainingPeaks Help](https://help.trainingpeaks.com/hc/en-us/articles/360039727152-TrainingPeaks-and-Apple-Watch)
- [Apple Watch + TrainingPeaks integration — DC Rainmaker](https://www.dcrainmaker.com/2023/12/training-integration-applewatch.html)
- [TrainingPeaks adopts Custom Workout APIs — Endurance Sports Wire](https://www.endurancesportswire.com/trainingpeaks-to-adopt-new-custom-workout-apis-for-apple-watch-workout-app/)
- [Apple Watch + TrainingPeaks (the5krunner)](https://the5krunner.com/2023/12/14/training-peaks-apple-watch-how-to-link-and-execute-your-structured-workouts/)

### Strava
- [Strava launches redesigned Apple Watch app, now with Live Segments](https://press.strava.com/articles/strava-launches-redesigned-apple-watch-app-now-with-live-segments)
- [App Design Critique: Strava Apple Watch app — Madison Draper](https://medium.com/mzdraper/thinking-about-the-design-of-the-strava-apple-watch-app-f48b86bcca44)
- [Why I won't be ditching my running watch for Strava's new Apple Watch app — Wareable](https://www.wareable.com/running/strava-apple-watch-app-review-8334)
- [Strava Apple Watch app — community feedback](https://communityhub.strava.com/strava-features-chat-5/strava-apple-watch-app-underwhelming-9949)

### Audio cue and voice coaching
- [Audio Cues in the Runkeeper App — ASICS](https://runkeeper.com/cms/app/audio-cues-in-the-runkeeper-app/)
- [Voice Feedback — MapMyFitness](https://support.mapmyfitness.com/hc/en-us/articles/1500009133081-Voice-Feedback)
- [Runkeeper Audio Stat Guide](https://support.runkeeper.com/hc/en-us/articles/201109396-The-Audio-Stat-Guide)
- [How to Train With Voice Coach Running Apps — Run Smarter Daily](https://runsmarterdaily.com/voice-guided-coaching/running-cues-voice-coach-app/)

### Battery and accuracy
- [The best setting for maximizing Apple Watch battery in GPS workouts — Wareable](https://www.wareable.com/apple/apple-watch-ultras-new-low-power-workout-mode-watchos-91-8992)
- [Apple Watch Ultra: Lower-Power Workout Mode — DC Rainmaker](https://www.dcrainmaker.com/2022/10/apple-watch-ultra-lower.html)
- [60-hour battery — Apple Watch Ultra (MacRumors)](https://www.macrumors.com/how-to/get-60-hours-battery-life-apple-watch-ultra/)
- [Watch pace wrong during runs — Mostly Media](https://mostly.media/why-my-apple-watch-pace-is-off-during-runs-how-low-power-mode-distorts-accuracy/)
- [Apple Watch pace accuracy discussion](https://discussions.apple.com/thread/253713300?page=2)
- [I Ran a 50 Mile Ultra Testing the New Apple Watch Ultra 2 — Running with Miles](https://runningwithmiles.boardingarea.com/i-ran-a-50-mile-ultra-testing-the-new-apple-watch-ultra-2-heres-how-it-did/)

### Tap protection and accidental input
- [How to Lock Your Apple Watch Screen — OSXDaily](https://osxdaily.com/2024/03/06/how-lock-apple-watch-screen-prevent-accidental-touch/)
- [Effortlessly End Workouts on Apple Watch — Wisepickers](https://wisepickers.com/how-to-end-a-workout-on-apple-watch/)
- [Best ways to protect Apple Watch while working out — iMore](https://www.imore.com/best-ways-protect-apple-watch-while-working-out)

### Haptics
- [Haptic Feedback in Wellness Apps — Ravi Shankar](https://www.rshankar.com/haptic-feedback-in-wellness-apps-apple-watch/)
- [Custom Haptics on Apple Watch — Apple Developer Forums](https://developer.apple.com/forums/thread/681215)
- [Haptics on Apple platforms — Eidinger](https://blog.eidinger.info/haptics-on-apple-platforms)
- [WatchKit haptic feedback with Taptic Engine — Sneaky Crab](https://www.sneakycrab.com/blog/2015/6/22/haptic-feedback-with-the-taptic-engine-in-watchkit-and-watchos-2-wkinterfacedevice-and-wkhaptic)

### Reviews and synthesis
- [Apple Watch Workout app upgrade for runners — Tom's Guide](https://www.tomsguide.com/news/the-apple-watch-workout-app-is-getting-a-huge-upgrade-especially-for-runners)
- [How to use custom workouts and workout views — MyHealthyApple](https://www.myhealthyapple.com/how-to-use-custom-workouts-and-workout-views-on-your-apple-watch/)
- [How Custom Workouts on Apple Watch make you a better Athlete — Apple Watch Triathlete](https://theapplewatchtriathlete.com/blog-1/2022/8/23/how-using-custom-workouts-on-apple-watch-will-make-you-a-better-athlete-and-everything-you-need-to-know-about-creating-them)
- [Best Running Apps for Apple Watch — the5krunner](https://the5krunner.com/2021/03/15/best-running-app-apple-watch-iphone/)
- [Over-Engineering My Morning Run with WorkoutKit — Dev Genius](https://blog.devgenius.io/over-engineering-my-morning-run-with-apples-workoutkit-7b3e76346bf4)
