# Running App — Product Surface Research Spec

This document defines what the running app is, what surfaces it has, and what to research about each surface so the build is informed by best practice rather than assumptions. It complements `RESEARCH_TASKS.md` (which builds the knowledge base feeding the coach) by directing research into **how the user interacts with everything**.

**This is not a build spec.** It's a research-driven discovery spec. Each page lists what to research; conclusions and design decisions follow research, not the other way around.

---

## Architecture Principles

**Three layers, clearly separated:**

1. **Knowledge base** (`/research/*.md`) — generic, source-of-truth content the coach pulls from
2. **Coach (runtime)** — interprets user data + knowledge base into prescriptions, insights, and narrative
3. **Product surface** (this doc) — how the user sees and interacts with everything above

**Three product surfaces, each with a distinct job:**

1. **Web app (desktop/tablet)** — planning, analysis, deep history, plan editing, race recap, the "command center" view. Where the user goes when sitting down to think.
2. **iPhone app** — quick capture, daily check-in, on-the-go review, race day mode, Watch companion. Where the user lives day-to-day.
3. **Apple Watch app** — workout execution, real-time guidance, post-run sync. Where workouts actually happen.

The three surfaces share one source of truth (the backend / coach runtime) but are tuned to different contexts. The web app is the most expansive; the watch is the most reductive. Information density follows the device.

**Data flow:**

- **Plan flows down:** Web → backend → phone → watch. The user (or coach) builds a plan on web. It pushes to phone, which pushes the day's workout to the watch.
- **Activity flows up:** Watch → phone → backend → web. The watch records the run. Auto-syncs to phone via HealthKit + native sync. Backend reconciles with prescribed workout. Web shows the analysis.
- **External integrations bidirectional:** Strava, Apple HealthKit, Garmin Connect, Coros sync runs and biometrics in. Workouts push out to those platforms when relevant.
- **Auto-logging is the default.** Manual logging is a fallback, not a primary flow. Users should never need to manually enter "I ran 6 miles today."

---

## Design Reference (Not Spec)

A working version of the Overview page exists with a defined visual style. **Use it as brand reference, not as a spec.** When researching what each page should contain, do not feel constrained by what's already on the existing Overview.

The visual identity to preserve:

- Dark theme, navy/black background
- Hero numbers, small-caps gray labels, white values
- Color as semantic signal (green = recovery, blue = active training, purple = milestones, gold = upcoming races, red = warnings)
- Card-based layout with rounded corners and subtle gradients
- Coach voice in dedicated narrative blocks ("WHY" / "FOCUS" / "BACK OFF IF" labels)
- Honest, direct copy with personality — no sycophancy, no hype
- Density without clutter

The brand tone to preserve:

- Personality over neutrality ("Recovery is the workout. Volume drop is intentional — let the legs absorb the race.")
- Time-aware framing ("Good evening." "Day 1 of 14." "1 day since Sombrero.")
- Always show the "why," not just the "what"
- Honest, even when uncomfortable ("A bit hard — back off." "Stepping back.")

The component vocabulary already proven:

- Stat cards (hero number + small-caps label + supporting context)
- Coach voice blocks
- Phase/arc visualization
- Conditions panel (weather, shoe, route)
- Training pulse (volume + ratio metrics)

When research suggests something new should be on a page, the implementation should match this brand. When research suggests removing or replacing something currently on the Overview, that's fine — the Overview will be rebuilt with the rest.

---

## What to Research Per Surface

For each page below, the goal is the same:

1. **What's the user's job-to-be-done on this surface?** What question are they trying to answer? What action are they trying to take?
2. **What patterns exist in best-in-class running apps for this job?** Look at TrainerRoad, Runna, Garmin Connect, Strava, Final Surge, McMillan, Training Peaks, Coros, Whoop, Oura, Stryd, Hevy (for strength patterns), MyFitnessPal (for nutrition patterns), etc.
3. **What's the best-in-class approach in adjacent industries?** (Sleep tracking, finance dashboards, productivity apps — many UX patterns transfer.)
4. **What information should be surfaced and at what depth?** First glance vs. drill-down vs. archived.
5. **What's the right level of coach voice on this surface?** Too much = preachy. Too little = generic.
6. **What's the right interaction model?** Read-only, editable, conversational, all of the above?
7. **What does the data model need to support?** Implications for backend.

Research output for each page should produce:

- **Job(s) to be done** — clear statement of user intent
- **Information hierarchy** — what's hero, what's secondary, what's drill-down, what's omitted
- **Recommended cards/sections** with rationale
- **Patterns from competitors** — what to copy, what to avoid
- **Open questions** — what's unclear, what needs user testing
- **Data model implications** — what backend support is required

---

## Web App Pages

### Web Page 1: Overview

**Job-to-be-done:** "Where am I right now and what should I do today?" Answered in <5 seconds.

**Research questions:**

- What's the right balance of "today's prescription" vs. "current state" vs. "trajectory"?
- What's the optimal information density for a desktop dashboard view of an athlete's training state?
- Which metrics should be hero-status, which should be drill-down?
- Should readiness/recovery be a single composite score, multiple scores, or a narrative?
- What's the right cadence for the coach's daily message? Always present, on-demand, contextual?
- How do best-in-class athlete dashboards (Whoop web, Garmin Connect, TrainingPeaks athlete view) structure their hero overviews?
- Should this surface show "next 7 days" planning context or only today?
- How much race / goal context belongs on the Overview vs. the Races page?
- Should fun stats / gamified content live on Overview or its own page?
- Streak mechanics — when do they help vs. harm (the "ran through injury for the streak" failure mode)?
- What should appear when the user is in different states: building, peak, taper, race week, post-race recovery, off-season, injured?

**Things to investigate as potential surface elements:**

- Today's prescribed workout (with execution affordance)
- Coach's daily message (one-line read of where you are)
- Readiness/recovery score (composite or breakdown)
- This week's plan + progress
- Multi-week training arc (phase visualization)
- Race countdown / next race context
- Mileage trends (week, month, year)
- Recent run analysis
- Training load (ACWR, fitness/freshness/form)
- HRV trend
- Sleep last night
- Personal bests
- Conditions for today's planned workout (weather, shoe rotation suggestion, route suggestion)
- Streak / consistency
- Quick action strip (log feel, move workout, view tomorrow)
- Insights / pattern detection
- Subjective wellness check-in prompt

---

### Web Page 2: Training

**Job-to-be-done:** "Show me my plan, let me edit it, and let me understand what's prescribed and why."

**Research questions:**

- What's the best UX for displaying a multi-week training plan? Calendar grid, list, timeline, hybrid?
- How do TrainerRoad, Final Surge, Training Peaks, Runna, McMillan handle plan display and editing?
- What's the right affordance for editing/moving/swapping workouts? Drag-and-drop, click-to-edit, regenerate?
- How should planned vs. actual be shown side-by-side?
- What's the optimal level of detail when viewing a single workout? (Structure, paces, fueling, why, history.)
- How should pace zones / VDOT / training paces be displayed and recalibrated?
- Should the workout library be browsable separately, or only accessible from the plan?
- How should periodization (phase) be visualized? Linear, cyclical, layered?
- How should strength training programming integrate with the running plan?
- What's the audio coaching pattern that actually helps mid-run vs. annoys?
- Should there be a "training history" view separate from "current plan," or should they be unified?

**Things to investigate as potential surface elements:**

- Plan calendar (week, month views)
- Workout detail (full breakdown of a specific workout)
- Workout library (browsable catalog)
- Pace zones / VDOT view (calibration foundation)
- Phase / periodization visualization
- Strength training schedule
- Plan editor (move, swap, regenerate)
- Plan adherence metrics
- Training history / archive
- Workout comparison (this attempt vs. previous)

---

### Web Page 3: Races

**Job-to-be-done:** "Manage my upcoming races and analyze my past races."

**Research questions:**

- How do best-in-class race-tracking surfaces structure past vs. upcoming?
- What's the right level of detail for a past-race recap? (Splits, conditions, strategy, photos, comparison to plan, lessons.)
- For upcoming races, what's the right structure for the planning hub? Countdown, course profile, weather, fueling plan, taper schedule, logistics?
- How should A/B/C goal management work? Visible commitment vs. private flex?
- How should pacing strategy be defined and displayed? Even split, negative split, terrain-aware, adjusted for conditions?
- How should course profile / elevation integrate? (Strava heatmap, Komoot, AllTrails APIs.)
- Should race photos integrate from race photo services?
- What's the right interaction model for race-day execution? (Watch-driven, with phone fallback?)
- How should multi-year race history be browsed?

**Things to investigate as potential surface elements:**

- Race calendar (past + upcoming)
- Race detail (past — full recap with splits, charts, conditions, coach analysis)
- Race detail (upcoming — countdown, course profile, weather forecast, pacing plan, fueling plan, race week schedule, logistics)
- Race goal calculator (predict realistic times from current fitness)
- Race day mode (during-race execution)
- Race history (multi-year archive with PR tracking)
- Course library (saved courses with profiles)
- Race report / shareable summary

---

### Web Page 4: Health

**Job-to-be-done:** "Show me my body — recovery, biometrics, sleep, nutrition, injuries."

**Research questions:**

- What's the right composite recovery score, and what inputs feed it? (Whoop, Garmin, Oura, Morpheus, Elite HRV.)
- How should HRV be displayed for athletes specifically? (LnRMSSD, daily vs. trend, baseline establishment.)
- How should sleep data be displayed and correlated with training?
- What's the right interaction model for injury logging? (Body map, list, free-text?)
- How should bloodwork / lab results integrate? (InsideTracker, Lab Insights, manual entry.)
- What reference ranges apply to endurance athletes specifically (which differ from general population for ferritin, vitamin D, etc.)?
- How should nutrition tracking integrate without forcing the user into a full nutrition app workflow?
- How should body composition be tracked respectfully (privacy, eating disorder risk)?
- How should recovery modalities (sauna, contrast, massage, IV, compression) be logged and correlated with feel/performance?
- What's the right cadence for surfacing biometric trends? (Real-time, daily summary, weekly digest.)
- Female-specific tracking — menstrual cycle, hormonal patterns, training adaptations.
- What's the line between "data dashboard" and "health insights"? (Just numbers vs. interpreted patterns.)

**Things to investigate as potential surface elements:**

- Composite recovery / readiness score
- HRV trends
- RHR trends
- Sleep dashboard (duration, quality, debt, stages)
- Body composition tracking
- Body map / injury logging
- Active injury tracker (with return-to-run protocol stage)
- Nutrition logging
- Hydration tracking
- Supplement stack
- Bloodwork / lab results
- Recovery modality log
- Subjective wellness daily check-in
- Cycle tracking (female users)
- Training load metrics (CTL/ATL/TSB or equivalent)
- Stress patterns (HRV, sleep, mood correlation)

---

### Web Page 5: Log

**Job-to-be-done:** "Show me what I've done — runs, workouts, notes, observations — and let me capture more."

**Note:** Auto-logging is the default. Workouts arrive automatically via Watch → HealthKit → backend pipeline. Manual logging is a fallback for non-tracked activities.

**Research questions:**

- How should the activity feed be structured? Reverse chronological is obvious, but what's the right level of summary per item?
- How should run detail be displayed? What's hero (pace, time, distance), what's secondary (HR, cadence, power), what's drill-down (charts, splits, weather, shoe)?
- How should workout reconciliation be visualized? (Did the actual run match the prescribed workout?)
- What's the best UX for journal/notes? (Day One, Apple Notes, athlete training log patterns.)
- Should notes be free-form, structured, or both?
- How should subjective ratings be captured? (RPE, simple 1-5, emoji?)
- How should photos integrate?
- How should multi-source activity sync conflicts be resolved and displayed?

**Things to investigate as potential surface elements:**

- Activity feed (runs, strength, recovery, notes)
- Run detail (auto-synced with reconciliation)
- Strength session detail
- Notes & journal
- Photo log
- Activity search and filter
- Export (GPX, CSV, etc.)

---

### Web Page 6: Coach

**Job-to-be-done:** "Ask the coach anything and get a contextual answer."

**Research questions:**

- What's the right interaction model for an AI coach in a fitness app? (Chat, voice, structured prompts, all of the above?)
- How should the coach's responses reference user data inline? (Charts, links to runs, plan adjustments?)
- When should the coach proactively reach out vs. wait for the user?
- What's the right tone for various coach interactions? (Daily check-in, post-run feedback, race-week guidance, injury guidance, motivational, technical.)
- How does the coach explain its reasoning? When does it cite the knowledge base?
- How does the coach handle uncertainty or topics outside its expertise?
- Should the coach have voice playback? (Daily message read aloud, mid-run cues.)
- How should coach conversations be archived and searchable?
- What's the relationship between "coach chat" and the coach voice blocks scattered through the app?

**Things to investigate as potential surface elements:**

- Conversational chat interface
- Voice input
- Voice output (coach voice playback)
- Suggested questions / prompts
- Inline data references (charts, runs, plans within coach replies)
- Conversation history / search
- Coach personality customization (more direct, more encouraging, more technical, etc.)
- Proactive nudges / insights from coach

---

### Web Page 7: Insights

**Job-to-be-done:** "Show me patterns I can't see myself — what's working, what's drifting, what to watch."

**Research questions:**

- How does Whoop's weekly performance assessment work? Garmin's Training Status? Strava's progress visualizations?
- What patterns are worth surfacing for distance runners specifically? (Easy pace improvement at same HR, long run consistency, plan adherence, heat/recovery correlation.)
- What's the right cadence for insights? (Real-time, daily, weekly, monthly?)
- How should insights be ranked / prioritized when there are many?
- What's the difference between an "insight" and an "alert"?
- Should insights be in a dedicated tab, or surfaced in context across other pages?
- How does the app avoid surfacing noise as insight?
- What's the right UX for an insight that requires action vs. one that's just observational?

**Things to investigate as potential surface elements:**

- Weekly performance summary
- Pattern detection (trend annotations)
- Coach insights (system-generated observations)
- Predictive insights ("at current trajectory, here's what your race will be")
- Comparative insights (vs. last cycle, vs. last year, vs. similar athletes)
- Risk alerts (overtraining, injury risk patterns)
- Achievement / milestone surfacing

---

### Web Page 8: Plan Builder

**Job-to-be-done:** "Build me a plan, or modify my existing plan."

**Research questions:**

- How do existing plan generators work? (Runna, McMillan, Garmin Coach, TrainingPeaks, custom human coaches in apps.)
- What inputs are required for a credible plan? (Goal, current fitness, days available, peak experience, constraints.)
- What's the right balance between automation and user control?
- Should plans be generated whole or week-by-week?
- How should plan modifications be handled? (Regenerate from a point, manual edits, drag-and-drop.)
- How should plans be templated vs. fully custom?
- How should the user understand what they're committing to before accepting a plan?

**Things to investigate as potential surface elements:**

- Goal definition (race, distance, date, target time, or fitness goal)
- Current fitness assessment (recent race, field test, or estimate)
- Constraints input (days/week, max long run, must-skip days, equipment)
- Plan preview (week-by-week, peak weeks, key workouts visible)
- Plan customization (swap workouts, adjust rest days, modify long run progression)
- Plan templates (canonical Pfitzinger, Hansons, Daniels, custom)
- Multi-race planning (back-to-back races, A/B/C race seasons)

---

### Web Page 9: Gear

**Job-to-be-done:** "Track my equipment, especially shoes, and remind me when to replace."

**Research questions:**

- How does Strava handle gear tracking? Garmin Connect? What's the best UX?
- How should shoe rotation be visualized?
- How should mileage on each shoe be tracked? (Auto-attribute by activity, manual selection per run.)
- What other gear is worth tracking? (Watches, HR straps, headphones, hydration vests, GPS pods, race kit.)
- How should fueling product inventory work? (Reorder reminders, brand preferences, gut training history.)
- Should there be a "wishlist" / "to research" tracker?

**Things to investigate as potential surface elements:**

- Shoe rotation tracker (active rotation, mileage on each, replacement reminder)
- Shoe history / archive
- Other equipment (watches, straps, vests)
- Fueling product inventory
- Gear notes and reviews
- Wishlist
- Purchase tracking / cost analysis

---

### Web Page 10: Routes

**Job-to-be-done:** "Show me where to run and let me save my favorites."

**Research questions:**

- How does Strava's routes feature work? Komoot? Garmin Course Creator?
- How should weather-aware route suggestions work? (Shaded routes for hot days, sheltered for windy.)
- Should the app generate routes or only catalog user-saved routes?
- How should Strava segments integrate?
- How should route safety information surface? (Time of day, lighting, traffic, isolation.)

**Things to investigate as potential surface elements:**

- Saved routes (favorites, frequently run)
- Route library (suggestions by distance, terrain, time of day)
- Route generator (loops, out-and-backs, point-to-point)
- Strava segment integration
- Weather-aware route suggestions
- Route safety information
- Elevation profile previews
- Route sharing

---

### Web Page 11: Settings / Profile

**Job-to-be-done:** "Manage my account, integrations, and preferences."

**Research questions:**

- What's the right structure for settings in a multi-surface app?
- How should integration management work? (Connect, disconnect, troubleshoot, sync status.)
- What permissions need granular control? (HealthKit categories, notification categories, data sharing.)
- What does data export need to support? (User portability, GDPR compliance, switching apps.)

**Things to investigate as potential surface elements:**

- User profile (demographics, fitness baselines, goals)
- Integration management (Strava, Apple Health, Garmin, Coros, Whoop, Oura)
- Notification preferences (granular by category)
- Privacy settings
- Subscription management
- Data export
- App preferences (units, time format, week start day, etc.)
- Account management (email, password, sign-out, delete account)

---

## iPhone App

The iPhone app is the user's daily companion. Not a smaller web app — a different surface tuned for mobile context.

### Design philosophy for iPhone

- **Glanceable first.** Home screen answers "what am I doing today and how am I doing?" in 2 seconds.
- **Push-driven.** App reaches out to user (notifications) more than user reaches into app.
- **Quick capture.** Logging anything should be 1-2 taps.
- **Watch is the runner.** Phone is the planner, reviewer, connector. Keep running execution on the watch.
- **Same brand.** Same dark theme, hero numbers, color semantics, coach voice as web.

### iPhone Page 1: Today

**Job-to-be-done:** "What am I doing today and how am I doing?"

**Research questions:**

- How do best-in-class fitness apps structure their mobile home screen? (Whoop, Oura, Garmin Connect, Runna, Athlytic.)
- How much information density is right for mobile vs. web?
- Should the home screen be customizable (cards user can rearrange)?
- What's the right "send to watch" affordance for today's workout?
- How should pull-to-refresh, scroll behavior, and gestures work?
- What's the right balance between scrolling depth and tab navigation depth?

**Things to investigate as potential surface elements:**

- Today's workout card
- Recovery / readiness hero
- Coach's daily message
- Weekly progress
- Quick action strip
- Conditions for today's workout
- Send-to-watch affordance
- Recent run recap (if just completed)
- Insights ticker
- Race countdown (if relevant)

### iPhone Page 2: Plan

**Job-to-be-done:** "See my training plan, edit it on the go."

**Research questions:**

- What's the best mobile UX for calendar/plan view? (List, grid, week swipe, infinite scroll.)
- What can the user actually edit on mobile vs. should defer to web?
- How should drag-and-drop work on touch?

### iPhone Page 3: Workout Detail

**Job-to-be-done:** "Show me what I'm about to do, push it to my watch, and start."

**Research questions:**

- What's the optimal pre-workout briefing on mobile? (Concise summary vs. full detail.)
- What's the right send-to-watch flow? (One tap, confirmation, what arrives on watch.)
- Should the phone offer a "start workout from phone" path for non-watch users?
- How should fueling plans surface for long runs?

### iPhone Page 4: Run Recap

**Job-to-be-done:** "Just finished a run — show me how it went."

**Research questions:**

- How do Strava, Garmin, Runna handle post-run summary on mobile?
- What's the right hierarchy in a recap? (Hero stats, prescription match, coach analysis, splits, drill-down.)
- When should the recap auto-prompt vs. wait for user to open?
- What's the right subjective rating capture? (1-10, 1-5, emoji, freetext.)
- Should sharing (Strava, Instagram, etc.) be primary or secondary?

### iPhone Page 5: Coach Chat

**Job-to-be-done:** "Ask the coach a quick question."

**Research questions:**

- How do mobile chat interfaces handle voice + text + media?
- What's the right keyboard / input pattern?
- How should suggested questions surface?
- Should responses be readable in 1-2 screen heights, or expandable?

### iPhone Page 6: Health

**Job-to-be-done:** "How's my body today?"

Mobile-condensed version of web Health. Same research questions apply, scaled to mobile.

### iPhone Page 7: Races

**Job-to-be-done:** "What's coming up and how did the last one go?"

Mobile-condensed version of web Races. Race day mode is critical here (see iPhone Page 8).

### iPhone Page 8: Race Day Mode

**Job-to-be-done:** "I'm racing right now — guide me."

**Research questions:**

- What's the optimal race day mode UX? (Garmin Race Predictor, Stryd Race, Runna Race Day.)
- Should race day mode override normal app behavior automatically?
- What information is critical mid-race? (Pace vs. target, fueling reminders, splits, distance to next aid station.)
- How does race day mode interact with the watch? (Watch is primary screen mid-race; phone is secondary.)
- How should race recap auto-trigger immediately post-finish?

### iPhone Page 9: Settings

Mobile version of web settings.

### iPhone-specific surfaces

- **Live Activities (Lock Screen):** during runs, race countdowns, today's workout
- **Widgets (Home Screen):** small/medium/large variations of today, recovery, race countdown
- **Siri Shortcuts:** voice commands for common actions
- **Push Notifications:** structured by category, user-toggleable
- **Apple Watch companion management:** install, settings, complications

**Research questions for iPhone-specific surfaces:**

- What Live Activities patterns work for fitness? (Strava, Nike Run Club, Apple Fitness.)
- What widget content actually gets used vs. ignored?
- What Siri Shortcuts are worth providing? (Voice access patterns for athletes.)
- What's the optimal notification cadence? (Burnout from too many, irrelevance from too few.)
- What notification categories should exist and what's the right copy tone?

---

## Apple Watch App

The execution layer. Where workouts actually happen.

### Design philosophy for Watch

- **Reductive.** Show only what's needed in the moment.
- **Glanceable mid-run.** Big numbers, high contrast, readable with sweat in eyes.
- **Active workout is the priority job.** Everything else secondary.
- **Audio + haptic over visual.** User shouldn't be staring at watch mid-run. Tap on wrist for interval changes, voice cue for what's next.
- **No coach essays on the watch.** Save prose for phone/web. Watch is "7:25 next mile, 4 to go."

### Watch Screen 1: Today

**Job-to-be-done:** "What am I doing today, let me start it."

**Research questions:**

- How do Garmin watches, Apple Workout, Strava watch app, Runna watch app handle workout selection?
- What's the right pre-workout briefing on watch? (Single screen, swipe through, audio summary.)
- Should the watch offer alternatives if user wants to deviate?

### Watch Screen 2: Active Workout (the hero)

**Job-to-be-done:** "Guide me through this run."

**Research questions:**

- What metrics are essential mid-run vs. nice-to-have? (Pace, target pace, HR, distance, time, cadence, power, elevation.)
- What's the optimal screen layout for structured intervals? (Garmin's workout mode, Stryd's structured workouts, Apple's interval workouts.)
- How should target pace be communicated visually? (Color, position, delta indicator.)
- What audio cues actually help? (Interval changes, splits, target pace deviations, halfway, finish.)
- What haptic patterns work? (Single tap for split, double for warning, etc.)
- How should manual lap, pause, end interactions work?
- What should happen at workout end? (Auto-save, prompt for rating, sync flow.)
- Battery optimization patterns?

### Watch Screen 3: Quick Log

**Job-to-be-done:** "I did something not auto-tracked — log it."

**Research questions:**

- What's worth logging from watch vs. requires phone? (Strength, cross-training, recovery activities.)
- What's the minimum viable input? (Type + duration + rating.)

### Watch Screen 4: Recovery / Today's State

**Job-to-be-done:** "Quick check on my recovery and today's plan."

**Research questions:**

- How do Whoop, Oura, Garmin watches surface daily readiness?
- What's worth showing on watch vs. requires phone deep-dive?

### Watch Screen 5: Coach (voice)

**Job-to-be-done:** "Ask the coach a quick question via voice."

**Research questions:**

- What's the right voice interaction pattern on watch?
- Should answers be summarized to fit watch screen, with full reply on phone?

### Watch Complications

**Research questions:**

- What complications do athletes actually use? (Garmin Connect IQ, Apple Watch native fitness complications.)
- What's the right info per complication slot size?

**Things to investigate:**

- Recovery score
- Today's workout
- Days to race
- Week progress
- Last run summary
- Streak / consistency
- HRV / RHR

---

## Sync & Integration Architecture

### Source-of-truth hierarchy

For any data point, multiple sources may provide conflicting values. Research needed:

- How do Strava, Garmin Connect, Apple Health handle conflicting workout records?
- What's the right deduplication approach? (Time window + distance + duration overlap.)
- What's the right conflict resolution for biometrics? (HRV from Oura vs. Garmin vs. Apple.)
- Should the user pick a primary source, or should the system pick the highest-fidelity source automatically?

### Sync flows to research

- **Plan flow:** how do plans push from backend → phone → watch?
- **Activity flow:** how do completed workouts flow watch → phone → backend → web?
- **External sync:** how should Strava, Garmin, Coros integrations work bidirectionally?
- **Conflict handling:** what happens when the same workout exists in 3 places?
- **Offline behavior:** what works without network on watch, phone, web?

### External services to integrate

For each, research the integration patterns, scopes, and best practices:

- **Apple HealthKit** — required, native iOS
- **Strava** — bidirectional, OAuth 2.0
- **Garmin Connect** — bidirectional, Garmin Health API
- **Coros** — bidirectional, Coros Open API
- **Whoop** — read-only, Whoop API
- **Oura** — read-only, Oura API v2
- **Stryd** — read-only via Garmin/Apple Health
- **Final Surge / TrainingPeaks** — optional, for users migrating from those platforms

**Research questions per service:**

- API capabilities and limitations
- OAuth flows and permission scopes
- Rate limits
- Data freshness and sync latency
- Webhook support vs. polling
- Cost (some APIs require commercial agreements)

---

## Onboarding

**Job-to-be-done:** "Get from install to first useful workout fast."

**Research questions:**

- How do Runna, TrainerRoad, Whoop, Oura, Garmin Connect onboard users?
- What's the minimum viable input to generate a useful first plan?
- What can be deferred to "set up later"?
- How long should onboarding take? (3 min sweet spot per industry research.)
- What's the right balance between data input and explaining the app?
- How should integrations be prompted? (All at once, contextually, deferred?)

**Things to investigate as onboarding stages:**

- Welcome / value prop
- Sign up
- Demographics (sex, age, height, weight)
- Goal definition (race, distance, fitness goal)
- Recent fitness assessment (race time, field test, estimate)
- Days/week available
- HealthKit connection
- Optional integrations (Strava, Garmin, etc.)
- Watch app installation
- Notification permissions
- First plan generation
- Tutorial / tour (or defer to in-context help)

---

## Notification Strategy

**Job-to-be-done:** "Reach out when valuable, stay silent otherwise."

**Research questions:**

- What's the right notification cadence for fitness apps? (Frequency studies.)
- Which categories drive engagement vs. which trigger uninstall?
- What's the optimal copy style for each category?
- How should quiet hours work?
- How should race day / race week notifications differ from normal?
- What's the right default state? (Most on, most off, opt-in to specific.)

**Things to investigate as notification categories:**

- Workout reminders
- Post-run prompts
- Recovery alerts
- Plan adjustments
- Race countdowns
- Coach insights
- Milestones / streaks (with care)
- Service updates

---

## Cross-Surface Components

Reusable components that should work across web, phone, and (where applicable) watch.

**Research questions:**

- What's the right component vocabulary for a multi-surface app?
- How should components scale across screen sizes?
- What's the right design system structure? (Tokens, primitives, composites.)

**Things to investigate as core components:**

- **Stat card** — hero number + label + supporting context (multiple variants)
- **Coach voice block** — narrative block in coach voice
- **Conditions card** — weather + environmental context for a workout
- **Phase bar / arc** — periodization visualization
- **Pace pill** — inline pace display ("7:25/mi · M")
- **Workout card** — compact and expanded variants
- **Body map** — interactive body diagram for injury logging
- **Trend chart** — line/bar chart for biometric trends
- **Calendar grid** — week and month views
- **Activity row** — feed-style activity entry
- **Recovery score** — composite or breakdown display

---

## Data Model Implications

Backend entities to support all surfaces:

**Primary entities:**

- **User** — profile, fitness baselines, goals, preferences, integrations
- **Activity** — runs, strength, cross-training, recovery (synced or manual)
- **Workout** — planned workout (template + date + plan ref)
- **Plan** — training cycle (goal race, contains workouts)
- **Race** — past or future (goal times, conditions, splits, recap)
- **Note** — user-written, attached to date / activity / race
- **HealthMetric** — HRV, RHR, sleep, weight, body comp, bloodwork
- **Injury** — location, severity, status, return-to-run protocol stage
- **Shoe** — model, mileage, status, paired with activities
- **FuelingPlan** — for workout or race
- **CoachInsight** — system-generated observations and prescriptions
- **SubjectiveLog** — daily wellness ratings (energy, soreness, mood, motivation)
- **Route** — saved routes
- **Equipment** — non-shoe gear

**Critical relationships:**

- Activities → Workouts (reconciliation)
- Workouts → Plans (cycle context)
- Plans → Races (training for what)
- HealthMetrics → ReadinessScore (computed daily from inputs)
- Activities → Shoes (mileage tracking)
- Notes → anything (flexible attachment)

**Research questions for data model:**

- How to handle multi-source activity sync?
- How to version plans (when modified)?
- How to handle plan vs. actual reconciliation?
- How to model coach insights (versioned, expiring, dismissible)?
- How to handle privacy categories (some data more sensitive)?

---

## Build Sequencing (Tentative — Revise After Research)

After research is complete, suggested build order:

**Phase 1 — Foundation:**
1. Backend data model and core APIs
2. Authentication and user management
3. HealthKit and Strava integration (the two essential integrations)
4. Apple Watch workout execution (the core differentiator)
5. Auto-sync pipeline (watch → phone → backend)

**Phase 2 — Core training loop:**
6. iPhone Today screen
7. iPhone Workout Detail + Send-to-Watch
8. Watch active workout (structured intervals)
9. iPhone Run Recap
10. Web Overview (rebuilt based on research findings)
11. Web Run Detail

**Phase 3 — Plan & race system:**
12. Web Plan view
13. Web Race detail (upcoming + past)
14. iPhone Race Day Mode
15. Plan Builder / generation

**Phase 4 — Health & recovery:**
16. Web Health dashboard
17. iPhone Health
18. HRV/biometric integration
19. Body map / injury tracking

**Phase 5 — Coach & insights:**
20. Coach chat (web + phone)
21. Insights surface
22. Daily coach message integration

**Phase 6 — Ancillary:**
23. Workout library
24. Strength training programming
25. Nutrition logging
26. Gear / Shoe rotation
27. Routes
28. Notes & journal
29. Settings refinement

Build sequence should be revised after research completes, based on findings.

---

## Final Note for Claude Code

Two parallel research tracks:

1. **`RESEARCH_TASKS.md`** — builds the knowledge base feeding the coach (training science, recovery, fueling, etc.)
2. **This doc** — investigates UX patterns and surface design before building any new pages

Both research tracks should complete (or at least be substantially complete) before product building begins in earnest. The exception is foundational work (data model, auth, integrations, basic Watch workout execution) which can begin in parallel with research since it's not pattern-dependent.

For each page surface listed above, produce a research output file:

- `/docs/research/[surface-name]-research.md` summarizing findings
- Each file should include: jobs-to-be-done definition, information hierarchy recommendations, recommended cards/sections with rationale, competitor pattern analysis, open questions, data model implications

When all surface research is complete, produce:

- `/docs/PRODUCT_DECISIONS.md` documenting design decisions made based on research
- Then begin building per the (revised) sequence above

The visual brand established in the existing Overview is the design north star — every new page should feel like the same designer made it. But what's *on* each page is open to research-driven redesign.
