# C8 — Content Inventory: iOS Extensions

iOS-specific surfaces extend the app into the system: Lock Screen, Home Screen, Siri, Notification Center, and the Watch. These are not miniature versions of the iPhone app — they are decision-cheap, glanceable surfaces tuned for the moment a user lifts their wrist, taps the Lock Screen, or yells at HomePod. The brand promise (honest, contextual, time-aware coach voice; no hype) holds, but the format collapses to one number, one verb, one tap.

Scope: this doc inventories Live Activities, Widgets, Siri Shortcuts, Push Notifications, and light Apple Watch companion management (full Watch UX is D2). Intent is content surface and behavior, not pixel layout.

---

## Live Activities

Live Activities run via ActivityKit. They appear on the Lock Screen as a card, in the Dynamic Island in three forms (compact leading + trailing, minimal, expanded), and on Apple Watch as a smart stack item. The ContentState payload is capped at ~4 KB, updates are budgeted (Apple throttles ~1/sec sustained, with bursts), and total wall-clock duration is capped at 8 hours (extendable to 12 with frequent updates, then auto-ends). Push-update payloads have stricter limits than direct in-process updates.

Five contexts qualify as Live Activities for faff.run:

### LA-1: During-Run

Triggered when an active workout starts on Watch (or phone-only fallback). Lives until workout end + 60s grace. Most updates come via push (server-driven from Watch sync) once per ~5–10s; in-process updates if phone has the workout open.

| Surface | Content |
|---|---|
| Lock Screen (default) | Top row: workout name + step (e.g. "Tempo · Interval 3 of 5"). Hero row: current pace (large) + target pace pill, distance (mi/km), elapsed time. Bottom row: HR, next-step preview ("Next: 400m float @ 8:30"). Coach pill if pace is drifting ("Pull back 10s"). |
| Dynamic Island compact (leading) | Run icon (animated stride) |
| Dynamic Island compact (trailing) | Current pace (e.g. "7:24") color-coded (green = on target, amber = drift, red = far off) |
| Dynamic Island minimal | Single pulsing dot in coach color (green/amber/red) |
| Dynamic Island expanded | Top: workout name + interval position. Center: pace hero (current vs. target with delta), distance, elapsed. Bottom: HR, cadence, next-step preview. Pause/lap buttons (deep-link to Watch Now) on the right. |
| Update frequency | Push-driven ~1 update / 5–10s during active work; ~1 update / 30s during long steady-state runs to preserve budget. Force-refresh on interval change. |
| ActivityKit constraints | ContentState ≤ ~2 KB to stay well under 4 KB cap. Total duration up to 12h with active updates (covers a marathon + buffer). Push tokens registered at workout start; revoked at end. Avoid font work / images in updates. |

### LA-2: Race Countdown

Activated 24h before a goal race; auto-ends 1h after gun time. Daily push updates; hourly within final 12h; minute-level within final 60min.

| Surface | Content |
|---|---|
| Lock Screen (default) | Race name + city. Countdown hero: "12h 04m to gun". Conditions strip: weather, wind, temp at gun time. Bottom row: bib number, start corral, gear pick (shoe + kit). Coach line: "Sleep is the workout tonight." |
| DI compact (leading) | Bib number or race-letter icon |
| DI compact (trailing) | Countdown ("12h" / "47m" / "GO") |
| DI minimal | Race-color dot |
| DI expanded | Top: race name + goal time. Center: countdown + start time (local). Conditions row. Race-day checklist completion ("4 of 6 done"). Tap → race day mode. |
| Update frequency | Push 1×/hour outside race window, 1×/15min in final 4h, 1×/min in final 30min, 1×/sec in final 60s. |
| ActivityKit constraints | Single LA per active race; replaced if user reschedules. End within 1h post-gun (race-day mode LA takes over). |

### LA-3: Today's Workout (pre-run, planned)

Optional: surfaces in the morning if the user has a workout scheduled. Exists from wake (or 6 AM, whichever earlier) until the workout starts or end-of-day. Conservative update cadence (every 1–2h max) since this is a planning surface, not a live one. Off by default; on for race-week.

| Surface | Content |
|---|---|
| Lock Screen | Workout type + duration ("Tempo · 60 min"). Target pace zones. Conditions ("18°C, light wind, 7 PM"). Coach line ("Two hard days back-to-back — protect tomorrow"). Tap → workout detail. |
| DI compact (leading) | Workout-type icon (E/T/I/L/R) |
| DI compact (trailing) | Time-of-day or "due" ("7pm" / "now") |
| DI minimal | Single dot in workout-type color |
| DI expanded | Workout name, structure summary (3 rows max), target paces, conditions. Send-to-watch button. |
| Update frequency | Push at wake, mid-day, and 30min before scheduled time. |
| ActivityKit constraints | Auto-end when workout starts (LA-1 takes over) or at midnight if skipped. Single LA at a time. |

### LA-4: Recovery Score (morning ritual)

Optional: surfaces at wake-up after the night's sleep + HRV reading is processed. Lives 2–4h, then auto-ends. Off by default; opt-in for users who want a morning ritual surface.

| Surface | Content |
|---|---|
| Lock Screen | Recovery score (large, color-coded green/amber/red). HRV today vs. baseline. Sleep duration + quality. Coach call ("Green light. Hit it." / "Yellow — cap effort." / "Red — easy or off."). Tap → Health screen. |
| DI compact (leading) | Recovery icon (heart pulse) |
| DI compact (trailing) | Score number with color |
| DI minimal | Recovery-color dot |
| DI expanded | Score, HRV/RHR/sleep grid, training-load context (ACWR, freshness), today's workout impact ("Plan calls for tempo. With this score, suggest moving"). |
| Update frequency | One push at wake; refresh once if user logs a check-in. |
| ActivityKit constraints | Short-lived (≤ 4h). Mutually exclusive with LA-3 — if both qualify, recovery wins until 9 AM, then workout takes over. |

### LA-5: Race Day Mode (during race, post-start)

Replaces LA-2 at gun time. Persists through the race + 30min post-finish for chip-time confirmation. Push-heavy.

| Surface | Content |
|---|---|
| Lock Screen | Race name + bib. Hero: live pace vs. goal pace, mile/km split count, total elapsed, projected finish. Fueling reminder if next gel due ("Gel at 8mi · 2.3mi out"). Spectator-share affordance (deep link). |
| DI compact (leading) | Race-letter icon |
| DI compact (trailing) | Projected finish vs. goal (color delta) |
| DI minimal | Pace-status dot |
| DI expanded | Pace hero (current/avg/goal), distance covered + remaining, projected finish, last split, next aid station, fueling reminder. |
| Update frequency | Push every 30s during race; every split (mile/km marker) regardless. |
| ActivityKit constraints | Replaces LA-2 at gun. Auto-end 30min after detected finish. |

### Live Activity rules of thumb

- One LA per logical context. Never stack multiple faff.run LAs.
- Coach voice fits in 40 chars or fewer per line.
- Color is semantic (green/amber/red maps to readiness, pace, score). Never decorative.
- Buttons inside DI expanded are reserved for action affordances (start, pause, lap, send-to-watch).
- Test on smallest-budget device (iPhone 14): if a state spec exceeds 2 KB serialized, simplify.

---

## Widgets

WidgetKit on iOS 17+ supports interactive widgets via App Intents (small action buttons inside widgets), animated transitions, and Smart Stack rotation. Refresh budget is system-controlled (~30–40 reloads/day per widget); use `TimelineEntry` with explicit reload-after dates rather than fixed intervals. Tap targets deep-link via custom URL scheme.

### Small (2×2)

Single piece of information, one tap, one value. Glanceable from the home screen.

| Widget | Content | Refresh policy | Tap target |
|---|---|---|---|
| Today's Workout | One line: workout type + duration ("Tempo · 60min"). Pace pill if defined. | Refresh at midnight + 30min before scheduled time. | Workout Detail screen. |
| Recovery Score | Score number (large, colored), HRV-vs-baseline arrow, label ("Green / Hit it"). | Refresh after morning HRV processing (~7 AM); again if user logs check-in. | Health screen. |
| Days to Race | Race name (truncated), countdown number ("D-23"), goal time. | Refresh daily at 12:01 AM. | Race detail (upcoming). |
| Last Run Quick Stats | Distance + pace + RPE emoji from most recent run. | Refresh on activity sync. | Run recap. |
| Week Mileage Progress | Ring (% of week target), miles done / planned ("28 / 42 mi"). | Refresh on activity sync + at week start. | Plan view (current week). |
| Streak | Day count ("17-day streak"), one-line status. | Refresh once at 11 PM (warning if at risk) and after each qualifying activity. | Insights / streak detail. |
| Tomorrow's Workout Teaser | "Tomorrow: Long · 18mi · 6 AM start". Conditions hint. | Refresh at 6 PM and at midnight rollover. | Tomorrow's workout detail. |

### Medium (4×2)

Two pieces of related context. The most-used widget size.

| Widget | Content | Refresh policy | Tap target |
|---|---|---|---|
| Today's Workout Detail | Workout name, structure (3 lines max: warm-up / main / cool-down), target pace, conditions row. Send-to-watch button (interactive). | Refresh at midnight + at 30min before scheduled time. | Workout detail. |
| Week Progress + Recovery | Left half: week ring + miles done/planned. Right half: recovery score + label. | Refresh on activity sync, at wake, at week start. | Today (Overview). |
| Recovery + Next Race | Left: recovery score. Right: race name + countdown + goal. | Refresh at wake and on race-week transitions. | Today. |
| Recent Run + Shoe | Last run hero (distance/pace/time/RPE), shoe used + total mileage on shoe. | Refresh on activity sync. | Run recap. |
| Upcoming Workouts (next 3) | List of next 3 workouts: day, type, duration. | Refresh at midnight + on plan edit. | Plan view. |

### Large (4×4)

Multi-section dashboard. Used by power users; lower install rate but high engagement.

| Widget | Content | Refresh policy | Tap target |
|---|---|---|---|
| Mini Overview | Recovery (top-left), today's workout (top-right), week progress (bottom-left), next race countdown (bottom-right). | Refresh at wake, mid-day, on activity sync, on plan edit. | Today (Overview). |
| Full Week-at-a-Glance | 7-day strip: each day shows planned workout type icon + actual completion mark. Mileage total at top, coach voice line at bottom. | Refresh at midnight + on activity sync. | Plan (week view). |
| Health Snapshot | HRV trend (sparkline 14d), RHR trend, sleep last night, recovery score, today's training-load advisory. | Refresh at wake; again if user logs sleep/HRV manually. | Health. |
| Training Pulse | Volume this week vs. 4-week avg, ACWR, freshness/form, phase indicator (Base/Build/Peak/Taper), coach narrative line. | Refresh on activity sync + at week start. | Insights. |
| Race Countdown + Plan + Readiness | Top: race countdown hero. Middle: this week's race-week schedule (4–7 lines). Bottom: readiness traffic light + coach line ("Two more easy days. Sleep first."). | Refresh at midnight + on activity sync; daily during race week. | Race day mode (if race < 24h) or race detail. |

### Widget global behavior

| Concern | Approach |
|---|---|
| Multiple-widget support | Yes — user can install multiple of any size, with different configs (e.g. two Days-to-Race widgets for two different races). Configurable via WidgetConfigurationIntent. |
| Lock Screen widgets (iOS 16+) | Inline + circular + rectangular variants of: Recovery score (rectangular), Days to Race (rectangular), Streak (circular), Today's workout type (inline). |
| StandBy mode | Large widgets re-rendered at higher contrast for ambient display. Today's workout + race countdown the priority StandBy candidates. |
| Smart Stack | Provide TimelineEntry relevance scores so today's workout floats up in morning, recent run after activity, recovery early AM. |
| Refresh budget | Stay well below 40/day. Coalesce updates. Avoid network calls inside the timeline provider — use the app's background refresh + App Group container. |
| Deep-link scheme | `faff://today`, `faff://workout/{id}`, `faff://race/{id}`, `faff://run/{id}`, `faff://health`, `faff://insights`, `faff://plan`. |
| Visual identity | Same dark navy/black, hero numbers, small-caps gray labels, white values, semantic color. Widgets feel like cropped slices of the app, not foreign UI. |

---

## Siri Shortcuts

App Intents framework (iOS 16+) exposes shortcuts to Siri, the Shortcuts app, Spotlight, Action Button, and Apple Watch (via Smart Stack and complications). Each shortcut is one App Intent with parameters and a return value (string + custom view).

| # | Voice phrase | Intent | Parameters | Response format | Notes |
|---|---|---|---|---|---|
| S1 | "Log how I feel" | `LogSubjectiveStateIntent` | `energy: 1–5`, `soreness: 1–5`, `mood: 1–5`, `motivation: 1–5`, `sleep_quality: 1–5`, `note: String?` | Inline picker for each rating (Siri-confirmable). Returns: "Logged. Recovery looks {state}; {coach_line}." | Defaults to mid-rating if user says only "log how I feel" — opens app to complete. |
| S2 | "What's my workout today?" | `GetTodaysWorkoutIntent` | None | Spoken: "Today is a {type}, {duration}, target pace {paces}. {coach_one_line}." Visual: workout card. | Cached; works offline if today's workout already loaded. |
| S3 | "Send my workout to my watch" | `SendWorkoutToWatchIntent` | `workout_id: WorkoutEntity?` (defaults to today) | Spoken: "Sent. Open the watch when you're ready." Returns success state. | Hits WatchConnectivity. Fails with copy-able error if watch unreachable. |
| S4 | "How am I doing?" | `GetTrainingStatusIntent` | None | Spoken: "{recovery state}. {load context}. {next-event context}." Visual: mini overview card. | Combines recovery + ACWR + race context into a 2-sentence status. |
| S5 | "Log a sauna session" | `LogRecoveryModalityIntent` | `modality: enum (sauna / contrast / massage / IV / compression / cold plunge)`, `duration: Measurement<Duration>?`, `note: String?` | Inline confirm. Returns: "Logged {modality} for {duration}." | Single intent covers all recovery modalities; modality enum populates Siri suggestions. |
| S6 | "Move today's workout to tomorrow" | `RescheduleWorkoutIntent` | `from_date: Date?` (default today), `to_date: Date?` (default +1 day), `swap_with: WorkoutEntity?` | Spoken: "Moved {type} to {day}. {coach_line if it changes load picture}." | Confirms before executing if it creates back-to-back hard days. Plan reconciliation runs server-side. |
| S7 | "What pace should I run?" | `GetTargetPaceIntent` | `workout_type: enum?` (default: today's), `distance: Measurement<Length>?` | Spoken: "{type} pace today: {min}–{max}. {RPE descriptor}." | If no workout today, returns guidance for an "easy run" by default. |
| S8 | "Start my workout" | `StartWorkoutIntent` | `workout_id: WorkoutEntity?` | Spoken: "Starting {workout name} on your watch." | Triggers Watch app launch via WatchConnectivity. iPhone-only fallback also possible. |
| S9 | "What's the weather for my run?" | `GetRunWeatherIntent` | `time: Date?` (default: today's scheduled or next 2h) | Spoken: "{temp}, {conditions}, wind {speed} from the {direction}. {coach_kit_line}." Visual: conditions card. | Pulls from saved location + WeatherKit. Includes one-line gear/kit suggestion. |

### Additional system surfaces these shortcuts power

- **Lock Screen Action Button** (iPhone 15 Pro+): default mappable to S1 (log feel) or S8 (start workout).
- **Spotlight suggestions**: all 9 surface in Spotlight as suggested actions when relevant (e.g. S2/S7 in morning, S1 at evening).
- **Apple Watch Smart Stack**: S2, S3, S4, S8 surface as wrist suggestions during the day.
- **Donations**: every time the user manually performs an action (e.g. logs feel via app), donate the equivalent intent so Siri learns to suggest it at the same time tomorrow.

### Shortcut response style

- Coach voice, never assistant voice. "You're tired — back off" not "Your recovery indicates suboptimal readiness."
- One sentence preferred. Two if context demands.
- Numbers spoken naturally ("seven twenty-five per mile", not "7 colon 25").
- Custom view returned for visual responses includes the same hero-number-plus-small-caps treatment as the app.

---

## Push Notifications

The default state is opt-in to a **curated set** at install: Workout reminder + Post-run prompt + Race countdown + Recovery alert (high-signal). Everything else off by default; granular toggles in Settings → Notifications. Quiet hours: default 9 PM–7 AM, user-configurable per category (e.g. race-week reminders override). Time Sensitive interrupt level reserved for race day morning + critical recovery alerts. Critical Alerts are not used.

### Category table

| Category | Trigger | Cadence | Default | Quiet hours respected | Coach-voice copy templates | Action buttons | Bad copy to avoid |
|---|---|---|---|---|---|---|---|
| Workout reminder | T-30min before scheduled workout (or T-60 for long runs) | Per workout (1–7×/wk) | On | Yes (suppress, deliver at 7 AM if possible) | "Tempo in 30. {weather one-liner}. Send to watch?" / "Long run at 6. Carbs prepped?" / "Easy 45 today — keep it boring." / "Strength tonight. 30 min, no equipment." / "Skipping it is also data." | Send to Watch · Snooze 30m · Move to tomorrow | "Don't skip your workout!" — guilt-tripping; "Time to crush it!" — hype; emoji-stacked subject lines |
| Post-run prompt | T+5min after sync of completed activity | Per run | On | No (delivered post-run regardless) | "Solid 8 at 7:42. How'd it feel?" / "Tempo nailed — splits held. Anything off?" / "Long one done. Note for the journal?" / "That was rough on paper. Tell me what happened." | RPE 1 · 2 · 3 · 4 · 5 · Add note | "Great job!" — generic; "You crushed it!" — sycophancy; ignoring actual run quality |
| Recovery alert | Recovery score crosses threshold (red, or down 20%+ from baseline 7d) | Max 1×/day, time-sensitive if pre-workout | On | No (overrides for red) | "HRV dropped overnight. Today's tempo can move." / "Two yellow days back-to-back. Recovery is the workout." / "Red. Sleep, hydrate, light walk only." / "Sleep was 4h. Plan needs a softer day." | Move workout · Make easy · Open Health | "Your body is failing!" — alarmist; "Rest day suggested" — generic; daily nags below threshold |
| Plan adjustment | Coach detects need for plan change (missed 2+ workouts, illness flag, race added, ACWR spike) | When triggered, max 1×/day | On | Yes (deliver at 7 AM next day) | "Missed two — I rebalanced this week. Tap to review." / "Adding the Sombrero half. Plan adjusts." / "Load spiked. Pulling Friday's intervals back." | Review changes · Keep as-is | "Plan modified" — opaque; auto-changes without user review |
| Race countdown | T-30 days, T-14, T-7, T-3, T-1, race morning T-3h | Sparse, race-relative | On | Yes except race morning | "30 days to {race}. Build phase wraps Sunday." / "Race week. Sleep > miles." / "Tomorrow. Lay it out tonight." / "Three hours. Eat. Caffeine if normal. Move." | Open race plan · Logistics checklist | "T-minus 7 days!" — over-formal; daily countdowns inside taper |
| Coach insight | Pattern detected with high confidence (easy pace dropping at same HR; heat-day form; long-run consistency) | Max 2×/week | Off | Yes | "Your easy pace at 145bpm is 18s/mi faster than 6 weeks ago. Aerobic engine working." / "Three Saturdays of strong long runs. Race execution loading." / "Heat slowed every run last week. Normal — adapting takes 10–14 days." | View insight · Mute this insight | "Interesting trend detected!" — vague; weekly summaries no one asked for |
| Milestone / streak | First time hit (PR, distance milestone, plan-week 100% complete, streak 30/100/365) | Per event, dedup window 7d | Off | Yes | "First sub-7 mile in this build. Aerobic floor lifting." / "100 miles this month — your highest in a year." / "30 straight days. Sustainable beats heroic." | View · Share to Strava | Streak guilt; pushing user to run when injured; gamified pressure |
| Service update | Sync error, integration disconnected, plan generation done, new feature | When triggered | On (errors) / Off (features) | Yes | "Strava reconnect needed — tap to fix." / "Garmin sync caught up — 3 runs imported." / "Your plan is ready. Review tonight." | Reconnect · Open · Dismiss | Marketing pushed as service; "Check out our new feature!" |
| Weather warning | Heat index, AQI, lightning forecast within run window | Max 1×/day, only if workout planned | On | No (delivered ahead of workout) | "31°C and 70% RH at 6 PM. Move to morning?" / "AQI 165 — indoor or skip." / "Lightning in forecast 5–7 PM. Start by 4." | Move workout · Make easy · Skip | Generic weather alerts duplicating system Weather app |
| Shoe replacement reminder | Active rotation shoe crosses 80% / 100% of replacement threshold | Max 1×/shoe/threshold | Off | Yes | "Saucony Endorphin at 480mi. Order replacement before race." / "Vaporfly at 90mi — save them for race day." / "Nimbus retired. Want to log the next pair?" | Mark replaced · View shoe · Snooze 50mi | Cross-promotional; brand-spam; weekly mileage updates |
| Recovery-week reminder | Plan enters down-week phase | 1× at week start, 1× midweek | On | Yes | "Down week. Volume drop is intentional — let the legs absorb." / "Easy means easy. Resist the bonus mile." | Open plan · Why down weeks? | "You've earned a break!" — paternalism; equating recovery with weakness |
| Subjective state daily check-in | Morning, if no check-in logged by 9 AM | 1×/day max | Off | Yes (delivered at 7–9 AM only) | "How'd you sleep?" / "Energy this morning, 1 to 5." / "Quick: soreness anywhere?" | Rate 1 · 2 · 3 · 4 · 5 · Note · Skip today | Multi-question forms in a notification; daily nags after 3+ skips |
| Race day morning logistics | Race morning, ~T-3h to gun | 2 max (T-3h prep, T-30min focus) | On (locked) | No (race day overrides) | "3 hours. Eat 300–400 cal carbs now. Caffeine if normal." / "Bib pinned, gels packed, watch charged. Bus at 6:15." / "Thirty minutes. Light jog, two strides, deep breaths." | Open race day mode · Checklist | Generic motivation; new tactics on race day; over-detailed |
| Carb-load reminder | T-3 days, T-2 days, T-1 day before A-race | 3 sparse, only for A-races | Off | Yes | "Carb-load day 1. 8–10g/kg today — easier than it sounds with sports drinks." / "Day 2. Stay on it. Don't try new foods." / "Last day. Familiar carbs only. Hydrate." | Macro target · Meal ideas · Mute for this race | Diet shaming; rigid macro lectures; generic meal plans |

### Notification interaction rules

- **Coalesce.** Never deliver more than 4 faff.run notifications in a single day except race day.
- **Decay.** If user dismisses a category 3 times without action, prompt to mute that category.
- **Time Sensitive interrupt level**: race day morning, recovery alerts (red), plan adjustment when illness flagged. Everything else default level.
- **Notification grouping**: Apple's auto-grouping by thread; we set thread IDs per category so a long run + post-run + recovery alert collapse cleanly.
- **Action button limits**: 4 max per notification (Apple limit); first one is the primary action, last one is "Dismiss" or destructive.
- **Rich notifications**: post-run prompt + race countdown include a small chart preview (Notification Service Extension).
- **Granular toggles**: every category individually toggleable in Settings; quiet hours per category; race-week override toggle.

---

## Apple Watch companion management

The Watch app has its own design (D2). The iPhone surface for it is a single Settings section: Watch.

| Setting | Behavior |
|---|---|
| Install / uninstall | Standard iOS Watch app pattern. Launch in-app deep link to the Watch app on phone if the user wants to manage from faff.run. |
| Complication selection guidance | Suggestions in Settings → Watch → Complications: small (recovery score, days to race, week progress), medium (today's workout, last run), large (recovery + workout combo). Deep-link to the Watch face editor. |
| Glance preferences | Choose what shows on Smart Stack: Today, Recovery, Days to Race, Streak. Reorderable. |
| Workout app default settings | Choose default audio cue cadence (every km / every mile / interval-only / silent), screen layout (3-field / 5-field / structured), pace display (current / lap / both), HR display (BPM / zone / both). |
| Battery saver toggle | "Long run mode" — disables continuous HR streaming, drops GPS to 5s sampling, mutes non-interval audio cues. Enable manually or auto-suggest for runs > 90min. |
| Auto-start Live Activity | Toggle: "Start Live Activity when watch detects a run" (default on). |
| Send-to-Watch behavior | Always send today's workout? Or prompt each time? Default: always send at 30min before scheduled time. |
| Watch storage | Number of cached workouts (default 7-day window) and history (last 30 runs). |
| Disconnect / re-pair help | Diagnostics + reconnect button. Visible last-sync timestamp. |

---

## Quick competitor scan

- **Strava Live Activity**: simple — pace, distance, elapsed, HR. No coach voice, no targets, no structure. DI shows pace + distance trailing. Works because it's clean; misses the "what should I be doing" question.
- **Nike Run Club**: notification-heavy (daily nudges, milestones, social). Live Activity during guided runs shows coach name + step. Coach voice is encouraging-bordering-on-saccharine; many users mute. Widgets are visually loud, content-thin.
- **Apple Fitness widgets**: rings + activity metrics, simple and reliable. No training context (no plan, no race). Sets the visual bar for clarity but ceiling for usefulness.
- **Garmin Connect widgets**: dense and useful (Body Battery, training status, recovery time). Coach voice nonexistent; pure data. Inspiration for our Health Snapshot Large widget.
- **Whoop Live Activity**: persistent recovery score on lock screen for the morning. Great cadence (low frequency), great content (single number with color). Direct inspiration for our Recovery Score LA.
- **Athlytic widgets**: Whoop-derived recovery + load on widgets, well-executed. Same pattern: small widget = single key number; large = composite.

What we steal: Whoop's morning ritual cadence; Strava's during-run simplicity (but with target-pace overlay); Garmin's data depth on Large widget; Apple's visual restraint.

What we avoid: Nike's nag rate; Strava's "no context" (we always tie pace to a target); Garmin's coach-voice-free numbers (we add the one-line read).

---

## Open questions

- **Auto-start Live Activity when watch detects a run?** Default proposed: on. Risk: false-positive starts (treadmill walk that auto-detects). Mitigation: 90-second confirmation window before LA launches publicly; cancellable from watch.
- **Default notification opt-in stance?** Proposed: opt-in to 4 high-signal categories (workout reminder, post-run prompt, recovery alert, race countdown). All else off, easy to enable. Alternatives considered: most-on (risks early-uninstall fatigue), opt-in-all (under-notifies, dampens engagement). Wants user testing.
- **Voice in Siri responses — coach voice TTS or system Siri voice?** Proposed: system voice for now (cheap, reliable). Future: optional coach voice TTS (ElevenLabs or similar) tied to a paid tier. Risk: uncanny-valley if voice doesn't match the written voice.
- **Lock Screen widget rectangular variant — recovery or race countdown?** Both are valid; should we ship both and let user pick, or only one? Survey after beta.
- **Live Activity vs. push notification overlap on race morning** — both are firing. Need to confirm system handles dedup gracefully and the LA's Lock Screen card is the primary surface, not a duplicate banner.
- **Carb-load notifications**: turn on automatically for A-races, or always opt-in? ED-risk consideration: any food-related nudge is sensitive territory and needs explicit consent.
- **Streak notifications**: do we ship them at all? Streaks are documented to encourage running through injury. Proposed: ship streak widget but no streak notifications — the widget is pull, not push.
- **Action Button (iPhone 15 Pro+) default**: log feel (S1) or start workout (S8)? Power-user setting, defer to user choice in Settings.
- **Smart Stack relevance scoring**: how aggressively do we score Today widget on top in the morning? Risk of stealing slot from Calendar/Mail.

---

## Data model implications

For the iOS extensions surface to function, the backend and iOS-local data model need to support:

- **App Group container**: shared UserDefaults + Core Data (or SwiftData) container readable by main app, widget extension, Live Activity, and Watch extension. Today's workout, recovery score, race countdown, last-sync timestamps all cached here for widgets to read without launching the app.
- **TimelineEntry pre-baking**: at midnight, a background task generates the next 24h of widget timeline entries (today's workout transitions, race countdowns ticking, recovery score expiring, etc.) and writes to App Group store.
- **Push token registry per Live Activity**: each LA registration sends a push token to backend; backend matches `(userId, activityType, contextId)` so the right token gets the right update. Tokens revoked on LA end.
- **Notification Content Service Extension**: rich notifications (charts in post-run prompts, conditions cards in workout reminders) need a Service Extension target that can fetch image data from backend on receipt.
- **App Intent entities**: `WorkoutEntity`, `RaceEntity`, `RunEntity`, `ShoeEntity`, `RecoveryModalityEntity` — each needs `AppEntity` conformance with `displayRepresentation` and `defaultQuery`. Server provides Spotlight-indexable entity dumps.
- **Subjective log model** must accept partial submissions from Siri (S1 may only set energy + soreness; rest left null).
- **Recovery score must be deterministic and cached**: widget cannot afford to compute on launch. Backend or background-refresh writes a final score to App Group store with timestamp + freshness flag.
- **Plan adjustment intent (S6)**: server-side reconciliation must run async; client returns optimistic confirmation, then push notification on actual adjustment if it differs.
- **Race detection for LA-2 → LA-5 swap**: needs reliable gun-time signal (race entity has `start_at: Date`, transitions LA at gun). Late-start tolerance: ±15min slip before falling back.
- **WatchConnectivity payloads**: send-to-watch (S3, S8) needs a versioned workout payload schema so Watch app can decode independent of phone version.
- **Quiet-hours model per notification category**: stored per user, with per-category override flags. Race-week mode toggles a global override.
- **Notification deduplication keys**: backend tags every push with a `(category, contextId, day)` key; client suppresses duplicates within a 4h window.
- **Activity-sync to widget refresh hook**: when a new run syncs, the activity ingestion pipeline triggers a widget timeline reload via `WidgetCenter.shared.reloadTimelines(ofKind:)` from the main app. Same for plan edits.
- **Coach insight model**: insights stored with `confidence: Float`, `expires_at: Date`, `dismissed: Bool` so notification delivery can filter to high-confidence + non-expired + non-dismissed.

---

## Done

Element counts: 5 Live Activities (during-run, race countdown, today's workout, recovery score, race day mode), 17 widgets (7 small, 5 medium, 5 large) + 4 Lock Screen widget variants, 9 Siri Shortcuts spanning logging/queries/control, 14 push categories with 3–5 copy templates and bad-copy guardrails each, plus 9 Watch companion settings. Notable: streak notifications dropped (widget-only) due to injury-risk pattern; race-day morning + recovery red are the only Time Sensitive categories; Live Activities mutually exclude (recovery vs. today's workout) before 9 AM; opt-in default = 4 high-signal categories not all-on; Action Button default deferred to user.
