# faff.run · site-wide redesign

**A design brief for an outside studio.**

---

## 0. The commission, and what we are deliberately not giving you

We want a fresh, site-wide redesign of faff.run: a running coaching platform, currently live, with a web surface and an iPhone surface sharing one backend.

**We are not giving you our current visual language.** Not the palette, not the typefaces, not the existing screens, not the internal design document that governs them. This is deliberate and it is the point of hiring you. Everything we could hand over would pre-load our own aesthetic into your first sketch, and we have looked at that aesthetic for long enough that we can no longer see it.

What you are getting instead is the thing that actually matters: **the information the product holds, what each piece of it means, what the runner is trying to do with it, and what we have already learned the hard way about arranging it.** Design from the information architecture up.

**The current execution is not a floor to build from.** The owner's assessment of a recent proposal built in the existing language, verbatim: *"what you have is sloppy at best. Its not high end app, its budget. the spacing, the look, everything. awful."* You are not being asked to refine the current surface. You are expected to throw all of it away. The information architecture and the coaching content are the input. The visual system is not an input, it is the deliverable.

One place we do describe the current surface: section 7, where we list specific failures. Those are stated as problems to avoid, not as layouts to fix.

**We are asking for three genuinely distinct directions before we ask for a system.** The owner has said plainly that he does not know what shape this should be, and he would rather choose between real options than approve one. Section 11 sets that out.

---

## 1. What the product is

faff.run is a **coaching platform**. Not a tracker, not a dashboard, not a log with charts on it.

The owner's framing, verbatim:

> "This is a coaching platform at its core, in every aspect, and at every level. It needs to perform that way."

> "Less is more at this stage."

The distinction is load-bearing, so here it is concretely. A tracker records what you did. A dashboard displays what is true. A coach tells you **what to do, why, and what it means afterwards** — and holds a view about whether the thing you are chasing is still realistic.

The product writes a training plan against a goal race, prescribes each day's session with real targets, sends that session to an Apple Watch to execute, reads back what actually happened, judges it honestly, and carries the story forward: this week closed like this, this phase ended here, your projected finish moved for this reason. It knows more about the runner than a coach with fifteen athletes could hold in their head, and the promise is that it uses that knowledge to say fewer, better things.

The engine behind it is deterministic and citation-bound. There is no language model anywhere in the runner-facing path. Every sentence the coach says is composed by rule from measured facts, and every training rule traces to a research document. This matters to you for one reason: **the content is trustworthy and specific, so the design can afford to be confident about it.** Nothing here is a hedge.

---

## 2. Who it is for

The product was built for, and is currently used daily by, one real runner. Ground your decisions in him.

- 41 years old. Runs a company. Two kids.
- Roughly 1,080 miles so far this year. Trains **4 to 6 days a week**.
- Races roughly **monthly**, across distances: 5K through marathon, some as goal races, most as tune-ups.
- Current headline goal: a **3:00:00 marathon** in December. Current fitness puts him around **3:20**. The app's own projection for that race currently reads **3:31**. That gap, and what the product does about it, is the emotional centre of the whole thing.
- He will not have perfect sleep. He will not have perfect readiness. He travels, he gets sick, he takes a week off, he runs a hard session on a bad night because that was the day he had. **He must never be scolded for any of this.** A product that moralises about a 6-hour night is a product he deletes.
- He is not a beginner and does not want to be spoken to like one. He knows what a threshold session is. He does not know, and should not have to know, what his acute:chronic workload ratio is.

**The product is opening to other runners.** Signup is live. Nothing may be designed around one person's habits, schedule, or data density. Onboarding already supports five distinct modes: a runner with a target race; a runner with a distance goal but no race booked; a runner who just wants to keep running consistently; a runner with an outside human coach who wants the app to observe and never prescribe; and a true beginner running zero to two days a week. Designs must survive **someone on day one with no history at all**, which is a much harder screen than the one we look at every morning.

---

## 3. The five things that matter daily

Everything else in this brief is detail. These five are the product.

1. **Today's session.** What the runner is doing, why it exists in the plan, and the targets that define whether it was done right.
2. **The run itself.** Executed on an Apple Watch, out on the road. Out of scope for you to design, but it is the reason the app exists and the moment the rest of the product orbits.
3. **The recap.** What happened, what it means, and what changes as a result. Not a stat dump. A judgement.
4. **The block.** Where today sits in a multi-week arc, and the honest answer to "is the goal still real."
5. **Memory.** The app noticing patterns and reflecting them back. "Your last five easy days averaged 79% of max. Easy is 65 to 75." "Biggest week you have ever logged." "Base done: 8 weeks, 240 miles, long run 10 to 16."

Everything else is support for these five. If a screen you design does not serve one of them, justify it or cut it.

---

## 4. The information the product holds

This is the core input. It is an inventory of what exists and what each thing means. It is written as **information, not components** — do not read the groupings below as screens.

### 4.1 The plan

The plan is the spine. It is authored once against a goal, then adapted.

**Block.** The whole arc from today to the goal race, typically 8 to 20 weeks. It has an authoring date, a snapshot of every input it was built from, and an adaptation log.

**Phase.** A named stretch of weeks with a stated intent and a citation. The phases the engine produces: **Base** (aerobic foundation, easy volume and long-run progression, no quality work yet), **Quality** (intervals and threshold work to lift the aerobic ceiling), **Race-specific** (goal-pace work integrated into long runs), **Taper** (volume drops sharply, intensity preserved), plus **Maintenance** for runners between goals and **Recovery** after a race. Block shape is distance-driven: a 5K block carries one taper week, a marathon block carries three plus four race-specific weeks.

**Week.** Seven days with a start date, a phase, and three flags that change its character entirely: *cutback* (a deliberate deload, roughly every fourth week), *peak* (the biggest week of the block), *race week*.

**Session.** One day. Every session carries:

| What | Meaning |
|---|---|
| Type | `easy`, `long`, `threshold`, `intervals`, `tempo`, `shakeout`, `race`, `race_week_tuneup`, `rest` |
| Distance | Miles, always present |
| Pace target | A single target for quality days. Easy and recovery days deliberately carry a **band** (low to high) instead, because a single number invites chasing it |
| HR cap | Derived per runner from lactate-threshold HR and max HR. Easy days have a ceiling, tempo days a target, races a cap |
| Effort | A conversational descriptor and an effort number out of ten |
| Structure | The machine-executable shape: warm-up miles, rep count, rep distance, rep pace, rest between reps, cool-down, strides, a fast-finish segment on a long run |
| Purpose | Coach prose explaining why this session exists |
| Sub-label | The short display title, e.g. `LONG · 3mi @ MP`, `EASY · 45 MIN`, `SHAKEOUT · 4×20s strides` |
| Contingency rules | Named bail-outs: "HR over 167 and climbing, finish easy, the stimulus is banked." Each is a pass, bail, or abort with a defined action |
| As-authored values | The original date, type, and distance, preserved forever so every change is auditable |

There is a **library of 54 named workouts** behind this, seeded from research, grouped into families: recovery, easy, medium-long, long, threshold, VO2max, speed, hills, fartlek, combination, marathon-specific, cutdown, ladder, race-specific, base-building, maintenance, shakeout, walk-run, rest. Each carries a prescription string, a typical dose range, the phases and experience levels it fits, and a citation. **The vocabulary is rich and the runner can browse it.** A long run is not one thing: it is a plain long run, a progression, an MP-embedded long, a fast-finish, or a dress rehearsal, and the difference matters to someone who cares.

One structural constraint worth knowing because it shapes what a week looks like: **at least 75% of every plan's mileage must be easy.** Weeks are mostly gentle with one or two sessions that matter.

### 4.2 Execution: what actually happened

Runs arrive from an Apple Watch, from Strava, or from Apple Health. Each completed run holds:

- Distance, duration, average pace, start time, and the source it came from
- **Per-mile splits**: pace, average HR, elevation change per mile. Splits are individually sanity-checked and a bad one is dropped rather than shown, so a split can legitimately be missing while its neighbours are present
- Heart rate: average, max, time in each zone, drift across the run, and an early/middle/late thirds comparison
- Elevation gain, cadence, running power, stride length, ground contact time, vertical oscillation, left-right balance
- Weather at the time of the run, and a heat adjustment derived from it
- **Grade-adjusted pace.** Terrain-corrected effort. There is a hard rule attached: grade-adjusted pace is for *judging effort* and is never displayed as what the runner ran. If a run covered 6 miles in 52:54, the pace is 8:49 and no surface may print anything else as "pace"
- GPS route, drawn as a map with the polyline coloured by pace
- Subjective: how it felt, an RPE entry, niggles reported
- Which shoes were worn, and the mileage that puts on them

### 4.3 Fitness

**VDOT** is the single fitness number, on a scale of 30 to 85. It is derived from race performances (and, under a strict honesty gate, from hard training runs of at least four miles). From VDOT the system derives every training pace: easy, marathon, threshold, interval, repetition.

**Freshness is a first-class property of this number.** A performance is full value for 56 days, then fades, then expires at 84. The design needs somewhere to say *how old the evidence is*, because a projection anchored to a five-month-old race is a different claim from one anchored to last Sunday.

**Projections.** Predicted finish times per distance: mile, 5K, 10K, half, marathon, 50K, 100K. Plus a daily snapshot time series, so the projection has a history and can be drawn as a trend.

**Trajectory.** A forward-looking model: given current fitness, the plan as written, weeks remaining, and how well the runner has been executing, where does fitness land by race day. It outputs current, projected and goal values, the gap between them, whether the goal is reachable, and — importantly — **where the blame sits**: `planUnderBuilt` (the plan is the limiter), `runwayLimited` (the calendar is the limiter, so the honest word is "runway limited" not "stalled"), `aheadOfGoal`.

### 4.4 The gap

The gap is the difference between the projected finish and the goal, and it is the most emotionally loaded number in the product.

It carries: the signed difference in seconds, a confidence value from 0 to 1 based on data density and stability, weeks remaining, and a **status** from four: `closing`, `static`, `widening`, `unclosable`.

It also carries **what would close it**, in the coach's own words: *"One more strong long run plus threshold day per week closes roughly 15 to 30 seconds a week."* *"Threshold density is the lever: 2 quality days a week versus your current 1."* *"Gap is wider than what's typically closable in 14 weeks."*

And a decomposition into four contributions: **fitness, conditions, course, execution.**

When the gap has been unclosable for five straight days, the system proposes a **revised target band** rather than deleting the goal. The stated goal stays on the board as the season ambition. This is an important product value and the design should honour it: **the app negotiates, it does not overrule.**

### 4.5 Readiness

Read every morning from Apple Watch data:

- **HRV**, weighted heaviest, as a 7-day median against a 30-day baseline
- **Sleep**, as a 7-night average against target, with full stage architecture (deep, REM, light, awake) available
- **Resting heart rate**, as a 3-day rolling average against a 30-day baseline
- **Heart-rate recovery**
- **Training load**, applied as a modifier on the composite rather than as an input in its own right

These compose into a score out of 100 and a band, judged **against the runner's own distribution** rather than an absolute scale.

**Readiness informs. It never changes the plan.** This is a locked ruling and the reason for it is worth reading, because it tells you what the product believes:

> Across 78 days the old absolute bands produced 18 "pull back" days. The runner trained through 12 of them. On his lowest score ever recorded he ran 8 miles and then raced a half marathon that the projection model called to within two seconds. A flag that fires a quarter of the time and reverses every third day is measuring ordinary life variance in a 41-year-old running a company with two kids, not overreaching.

So readiness is context, not command. **The plan stands, the score informs.** Design it as something the runner reads on the way out of the door, not as a gate in front of the session.

The one exception proves the rule. A separate detector, requiring a sustained *and* corroborated multi-day signal, may **propose** downgrading today's quality session to easy. It only ever touches today, never a future day, and the runner has to accept it. It arrives as a coach decision (section 4.8), not as a plan that silently changed overnight.

There is also a body of longer-arc health data: injury history by body part with flare dates and severity, recovery phase after a race, day-of-week patterns, what predicts the runner's best runs, heat acclimatisation, and (for female runners) cycle-and-performance context.

### 4.6 Races

Races are the skeleton the whole calendar hangs from.

A race carries: name, date, location, distance, and a **priority of A, B or C**. The priority is not a label, it is an instruction to the plan engine. An **A race** is what everything points at, and the plan tapers into it and recovers out of it. A **B race** gets a mini-taper and a real day in the plan. A **C race** simply converts a quality day, with no taper and no recovery debt.

Also stored:

- Goal time, and a B goal (the safe target)
- **Course profile**: uploaded GPX, elevation geometry, net gain, notable miles
- **Pacing plan** broken into named phases with target paces, e.g. "Point Loma Climb 7:08", "The Drop 6:39", "Mission Bay 6:51"
- **Fuelling plan**: gel brand, carbs per gel, target intake per hour, an on-course schedule
- **Logistics**: gun time, wave, bib, packet pickup, shuttle, parking, aid stations, pacers, spectator spots, time limit, gear check, typical weather for that date and place
- **Result**, with strict provenance. A confirmed chip time is authoritative. A watch time is labelled *"Watch time · chip time to lock in"*. A time inferred from a matched training run is labelled *"Training effort · race to lock in"*. **A provisional time may never be displayed as a personal record.** This is a hard rule and there is a real bug history behind it
- **Retrospective**: per-mile splits, per-phase actual versus target with the delta, VDOT this race implies, the projection before and after, and what it now predicts for the next race

### 4.7 The coach's log and memory

The app writes to a running log. Entry kinds: **week close, phase boundary, first-ever, fitness shift, easy-day discipline.**

Real examples:

- *"42.1 mi of 44 planned · both quality days landed."*
- *"A zero week went in the book. The plan resumes where you are, not where the calendar says."*
- *"Base done · 8 weeks, 240 mi, long run 10 to 16. Build starts today."*
- *"Longest run you have ever logged · 18.2 mi. Old mark 16.4."*
- *"New fitness read · VDOT 47.9 · your paces just moved."*

There is an anti-nag rule baked in: the easy-discipline observation is written **at most twice per pattern**, once when it establishes and once when it resolves, never in between. *"This is an observation, not a per-run grade."*

This log is the closest thing the product has to a relationship. It is currently underserved by the design and we would like you to have a view about where it lives.

### 4.8 Coach decisions

Sometimes the coach needs the runner to choose. These currently come in three flavours and they should share one grammar:

- **Needs a decision.** *"Your CIM goal needs a call. The plan projects 3:31:48 against your 3:00:00 goal. Hold the goal and I keep writing the plan to it. Move the goal and the paces get honest."* Options: hold, move, decide later.
- **A proposal.** *"Your last measured anchor is 63 days old. A 30 minute solo time trial next Thursday replaces the guesswork before the block opens."*
- **Already applied, nothing to decide.** *"Sunday's 16 moved to next Saturday and this week's quality dropped one notch. Nothing for you to do."*

The buttons are always concrete verbs in the coach's own language. Never "Accept" and "Dismiss".

### 4.9 Settings, and what the runner controls

Worth knowing because several of these reshape the plan: experience level, days per week, long-run day, rest day, quality days, which days are available to run at all, weekly mileage target, lactate-threshold HR, max HR, units, timezone behaviour, race fuelling preferences, notification categories, and a shoe garage with per-shoe run-type assignment and retirement mileage.

---

## 5. Surfaces in scope

**Web · the command centre.** Used for planning and review, at a desk, with time. Today, the plan, goals and races, activity history, race detail, run detail, settings.

**iPhone · the daily companion.** Used before and after runs, standing up, one thumb, often outdoors in bright light at 6am.

They share one backend and should read as **one product without being identical**. The phone is not the web layout scaled down; the web is not the phone with more whitespace. Same system, different jobs.

**Apple Watch is out of scope for this brief.** It executes the session and it already exists.

For reference, the current structure is **five tabs on both surfaces: Today, Train, Health, Goal, Activity** — with the phone replacing one tab slot with a centre "RUN" action and demoting Activity to a sub-page. We are telling you this so you can **challenge it, not inherit it.** We are not attached to five tabs, to those five names, or to a tab bar at all. The names have already drifted: the tab labelled "Goal" is called "targets" in the code and lives at the URL `/races`, which is a fair sign that nobody has decided what that surface actually is. **We would rather you tell us what the right navigation is than accept ours.**

---

## 6. Explicitly out of scope

- **Strength training and cross-training.** Removed by owner ruling. Do not design for them.
- **Social features.** No feeds, no following, no kudos, no clubs.
- **Gamification and streaks.** Ruled against explicitly: a streak rewards running on a rest day, which fights the plan. The plan is the thing. Do not reintroduce streaks in another costume.

---

## 7. What we learned the hard way

These are stated as problems we have already caused, not as solutions we want repeated. Each is measured, not felt.

**The app measured far more than it prescribed.** An audit counted roughly **120 distinct numbers** across the product against **six surfaces that told the runner what to do.** That ratio is the whole diagnosis. *A number the runner cannot act on is clutter.* Every metric you place should survive the question "what does he do differently because of this."

**Duplication.** A single four-mile easy run rendered its distance and duration **three times** across three adjacent cards on one screen. The word "easy" appeared **five times** above the fold. **Every datum needs exactly one home.**

**Hierarchy inverted.** The prescription — the actual thing the runner came for — was given a 300px column while the card that merely restated it got 480px. The primary content clipped mid-word ("TARGET PA…") while its own duplicate rendered large and clean beside it.

**Conditional elements that pop in and reflow the page.** The owner: *"I also dont want pop ups like this is messed with the flow/layout."* Data arrives asynchronously; cards appeared and shoved everything below them down the screen. **If a thing is sometimes there, its space is always there.** Nothing above the fold may appear conditionally.

**A week rendered as a constant.** The week view was seven equal date cells. A 16-mile long run and a rest day drew **identically**, and the largest character in each cell was the date, which is the one thing the runner already knows. Load — the highest-variance and most informative property of a training week — was encoded nowhere. Hard versus easy was a single 8px dot with no legend on the page.

**Failure states rendered as authoritative data.** When a fetch failed, a field displayed "Not set" — which reads as a fact about the runner rather than a fact about the network. **An error must never be indistinguishable from a value.**

**Empty and truncated states shipped as product.** Em-dashes standing in for missing values. Labels clipped mid-word. Sections that rendered "0 mi" against a finished block. The rule we arrived at: **anything that cannot say something true today does not render at all** — but its space is still reserved.

**No responsive handling on the home screen whatsoever.**

**And the structural failure underneath all of them: there was no system.** Every element is a bordered card. Spacing is cramped and inconsistent because it was chosen per-component. Type has essentially two registers — 8px uppercase micro-labels and 52px numerals — with nothing in between, so anything of middling importance has nowhere to sit and gets crammed into a caption. The surface decayed exactly the way surfaces without systems decay: one reasonable local decision at a time.

---

## 8. The voice

The coach's voice is the product's real differentiator and it must survive the redesign. It is short, direct, and never hyped. **No exclamation marks. No emoji. No em dashes.** These are machine-enforced in the codebase, not stylistic preferences. The separator between clauses is a middot.

There is a second rule with teeth: no PhD jargon. The internal note reads *"mitochondrial density, VO2max, lactate threshold, slow-twitch oxidative: none of that lands. The science is in the rules, it is not in the words."*

And a third: when the app cannot honestly judge something, it says nothing. A treadmill run with unknown incline gets no pace verdict, because *"saying nothing beats saying something unfalsifiable."* **Silence is a designed state.** You will need to design it.

Real lines, verbatim from the codebase:

> "You took the bail at mile 6 · smart, not a fail. The stimulus was already banked; forcing the rest buys fatigue, not fitness."

> "Keep it truly easy. Nose-breathing pace the whole way."

> "The long run is the single most important run of your marathon week. Time on feet builds the endurance you need for the back half of race day."

> "Your HR climbed 9 bpm by the end (152 to 161). That's normal in heat like this · the body works harder to cool itself, not because you're slowing down."

> "You don't need a junk mile to feel productive. Resting IS the work today."

> "Bail if it feels off. One missed tempo doesn't cost a build."

> "Your last 5 easy days averaged 79% of max. Easy is 65 to 75. Run the easy ones under 148 and let the pace fall where it wants."

> "You raced yesterday. The result stands whether you confirm it now or later. This week is for absorbing it, not chasing it."

These sentences are between 8 and 40 words. They are the most valuable thing on any screen they appear on. **The design must give this voice somewhere to live. It cannot be squeezed into caption text under a number.** At present it usually is, and that is the single biggest wasted asset in the product.

---

## 9. Observed direction

The owner has supplied references. They are direction, not our existing system. Read them for their principles.

### 9.1 The quality bar, in his own references

**Runna. Nike. Strava. Apple.**

They are not the same product, and each is named for a different reason:

- **Runna** is the nearest competitor and the closest analogue: plan-centric, calm, generous with space, high polish. This is the bar for "a training plan rendered well."
- **Nike** brings editorial confidence. Big type doing the work. High contrast. Attitude. Type *as* the graphic rather than type labelling a graphic.
- **Strava** brings respect for the data itself: splits, maps, and the run treated as an artifact worth looking at rather than a row in a table.
- **Apple** brings systematic restraint: a real spacing scale, hierarchy achieved through weight and space rather than borders, and the discipline to leave things out.

**The through-line worth naming: all four structure with space and typography, not with boxes and hairline borders. And all four are systems, not collections of screens.** That is precisely where faff currently fails on both counts.

**The tension to resolve deliberately, not by averaging.** Nike is loud and editorial. Apple is quiet and systematic. Runna sits between them. Strava is data-dense. **State where on that axis you are landing and why**, given this is a coaching product for a serious athlete with a serious job. It is not a social app and it is not a dashboard.

**One practical note:** three of those four are phone-first. faff's web surface is a planning-and-review command centre and the phone is the daily companion. The *feel* must carry across both. The *layout* should not simply be scaled.

### 9.2 "Simple and graphic UI"

That is the owner's phrase, supplied alongside two images.

**Read the images that follow as evidence of taste, not as a specification of layout.** They tell you what this owner finds confident and what he finds cheap. They do not tell you what shape faff should be. His words on that, verbatim:

> "Is it a sheet? Is it tiles? I dont know. Explore."

Whether this app is tiles, a continuous sheet, a feed, a canvas, or something none of us have a name for yet is exactly what we are hiring you to work out. Nothing below should be read as "make it a grid of widgets."

**The first** is a dense grid of saturated widget tiles: weather, world clocks, distances, watch faces. Flat saturated colour blocks used as identity. Tiles of varying size in one grid. Very high contrast. Huge numerals. Essentially no chrome. No gradients used as decoration — colour is the subject, not a finish.

**The second is the more instructive one.** A vertical stack of light rounded cards on pure black:

- *Temperature / 24°* beside a black-to-rust gradient bar with **L.18°** and **H.29°** marked at its ends
- *Compas / W~270°* beside a compass arc with a live tick
- *Diffused light / ON* beside a curved intensity gauge reading **int. 80%**
- *Battery / 78%* beside a bar graph of vertical strokes fading out
- *19:53 / Thursday 26 September*

**The principles to take from these** (principles, not layouts):

1. **Separation by fill and contrast, never by border.** There is not a single hairline border in either reference. The current app borders everything, which is the main reason it reads as a wireframe somebody coloured in.
2. **One idea per element.** One label, one value, one graphic. Not a four-stat grid crammed into a box.
3. **The value is enormous and confident.** Tight tracking, heavy weight, dominant in its space.
4. **The label is small, plain and quiet.** Note it is sentence case, not 8px uppercase letterspaced micro-type. The current app's label treatment is a tell.
5. **Every metric gets a purpose-built graphic that encodes its value.** A gradient bar for a temperature range. An arc for a bearing. A curved gauge for intensity. Bar strokes for charge. These are not generic chart components and they are not decoration: **the graphic is the data.**
6. **Generous padding.** Space is the structuring device.
7. **Restrained palette.** One accent against a neutral ground.

### 9.3 Value in a range

A third reference reinforces the same instinct: dark rounded sensor cards (Light, Humidity, Watering, Soil). Each is a plain label; a small qualifying sub-label ("Partial Sun", "Moderate", "Low demand"); an enormous value with its unit set small beside it; a small icon top-right; and beneath it **a bespoke horizontal scale showing where that value sits** — a segmented gradient with the **range endpoints labelled** (3000 … 4000, 40 … 80, Day 7 … Day 14, pH 4 … 10) and a dot marking the current position.

**One metric, one big number, one purpose-built scale that shows where the value sits within its meaningful range.**

This maps onto faff's quantities almost one-for-one, and it is exactly what the current app renders as bare digits:

| faff quantity | Its meaningful range |
|---|---|
| Today's pace | The target band, with its low and high endpoints |
| Heart rate | Against the Z2 ceiling for this session |
| Readiness | Against **the runner's own normal and spread**, not an absolute 0-100 |
| Weekly mileage | Against the plan's target for this week |
| Effort | Against the prescribed effort for this session type |
| VDOT | Current, against the VDOT the goal requires |
| Projected finish | Against the goal time, with the gap as the distance between them |
| Long run | Against the longest of the block, and the longest ever |
| Shoe mileage | Against its retirement cap |
| Anchor freshness | Days since the last real performance, against the 56-day full-value window |

**Every one of those is a value in a range with endpoints that mean something.** We would like a designed vocabulary for them, treated as a first-class part of the work rather than as chart components pulled from a library. Whatever container they end up living in is your call; the encoding is the point.

This is also the clearest worked example of the principle in 9.6. "Your pace is a little quick for an easy day" is a sentence the app currently has to write. A mark sitting above the top of its band does not need the sentence.

### 9.4 The system sheet

A fourth reference is a design-system sheet ("NEO-BRUTALIST DESIGN SYSTEM · BOLD. LOUD. SYSTEMATIC. USABLE."): usage rules at the top, colour tokens with values, a type scale (96 / 64 / 48 / 32 / 18 / 14), a spacing scale (4 8 12 16 24 32 48 64 96), elevation tokens, then components — buttons in filled, outline and text at three levels plus disabled and destructive; inputs with error and helper states; checkboxes, toggles, tabs, steppers, breadcrumbs, pagination — then data display — card, list item, badge, avatar, table, tooltip — then feedback — toast stack, alert banners in success, warning and error; modal confirm; progress bar; empty state.

This one is included for a different reason than the others. It is not about how faff should look; it is about **the completeness we expect once a direction is chosen**. A system at that level of coverage is what stops an app drifting back into inconsistency the moment someone adds a feature, which is exactly how the current surface decayed. See section 11.

### 9.5 The references, read together

They do not agree on surface. The system sheet is squared, thick-stroked and loud. The sensor cards are soft, rounded, dark and quiet. Nike is editorial, Apple is restrained, Runna sits between, Strava is data-dense. **The owner supplied all of them, and he is not asking you to average them.**

What every one of them has in common is **systematic, graphic, confident**. Not a corner radius, not a colour temperature, not a density. That is the taste. The form is open.

### 9.6 The principle that governs everything above

The owner's phrase, and the single most useful sentence in this brief:

> "The simplicity of the graphics do the talking, not the words."

The interface should be **self-evident from its graphics**. It should not need explanatory copy, micro-labels, legends or captions telling the runner how to read it. The current app leans on words to do work a good graphic would do without them:

- A pace against its target band is written as a **sentence**, when it is a **position on a scale**
- Readiness is a number plus a paragraph, when it is **a mark against the runner's own normal**
- A week is seven labelled cells, when it is **a shape**
- Progress toward a goal is prose about being off pace, when it is **a distance between two points**

**Draw this distinction carefully, because it is easy to over-read.** What should shrink is **interface language**: labels, legends, captions, explanations, chrome, the running commentary a design writes about itself.

**What must survive is the coach's voice.** That is content, not decoration, and it is the product's actual differentiator:

> "Keep it truly easy. Nose-breathing pace the whole way."

> "You took the bail at mile 6 · smart, not a fail."

Those sentences are the reason someone would pay for this rather than use Strava. They need a real home in whatever you design, not a caption slot.

---

## 10. The commission, stated as one question

This is the challenge, and it is what will separate a good answer from a Strava clone:

> **How much of what this app currently says in words can be said by a graphic instead — and what is left over that genuinely needs a coach's sentence?**

Everything in section 4 is a candidate. Work through it. A pace, a heart-rate ceiling, a week's load distribution, a taper, a gap to a goal, twelve weeks of projection history, a race's course profile, the freshness of the evidence behind a prediction: every one of those is currently rendered as digits with words around them, and most of them are shapes.

Then find the residue. Some of it will be irreducibly verbal, because it is a judgement rather than a quantity:

> "You took the bail at mile 6 · smart, not a fail. The stimulus was already banked; forcing the rest buys fatigue, not fitness."

No graphic says that. **That residue is the product.** Design a home worthy of it.

Your own named references show both halves being done well. **Apple** gives a sentence its own scale and its own air with no container around it. **Nike** makes editorial type *be* the graphic. Neither treats prose as a caption under a number, which is what we currently do.

Related problems worth thinking through:

- The coach sometimes has **nothing to say**, by design, because saying something unfalsifiable is worse than silence. What occupies that space, given nothing may reflow?
- Some days the coach needs a **decision**, and it must read as a coach asking rather than an app interrupting.
- Over a season the log accumulates into something like a **relationship**. Is that a feed, a timeline, an archive, or something we have not named?
- A graphic that needs a legend has failed. If your value-in-range scales need a key on the page, they are not finished.

---

## 11. What we want back

In two stages. Do not skip to the second.

### Stage one · three genuinely distinct directions

**We want options, and the owner has said plainly that he does not know the answer himself.** So: three directions, not one refined answer.

- **Distinct in structure, not in colourway.** Three treatments of the same layout is not three directions. We are asking about the shape of the thing: whether the app is a sheet, a set of tiles, a feed, a canvas, a document, a single continuous surface, or something none of us have named.
- **Each with a stated point of view.** One paragraph: what this direction believes, what it optimises for, what it deliberately gives up.
- **Each taken far enough to compare honestly.** The **same two or three real screens** in all three, at real fidelity with real content from section 4. Comparing a finished screen against a sketch is not a comparison.

Which screens is your call, but at least one should be a hard state rather than a happy path: the day after a race, a week off, a runner on day one with no history, or a goal that has stopped being realistic.

**Also state, per direction, where it lands on the loud-to-quiet axis and why** — measured against a coaching product opened at 6am by someone who is about to run.

### Stage two · the system, once a direction is chosen

This is what follows the decision, and it is what stops the app decaying again. The current surface fell apart precisely because there was no system to fall apart from: every feature made its own reasonable local decision. Screens alone will drift back into inconsistency the first time someone ships a feature after you leave.

The coverage we expect, at roughly the completeness of the reference in 9.4:

**1 · Foundations**
- Usage rules stated up front. What the system is for and what it forbids
- Colour tokens with values, and **stated semantics** — what each colour is allowed to mean, and what it may never mean. We have been burned by one colour carrying two meanings
- A type scale with a real middle register. Our current failure is having micro-labels and hero numerals and nothing in between
- A spacing scale, applied consistently. Space is the structuring device, per 9.2
- Elevation, radius, and the treatment that replaces borders

**2 · Components, with every state drawn**
- Buttons across variants and levels, including disabled and destructive
- Inputs with error and helper states
- Selection controls and navigation, whatever form the chosen direction gives them
- Whatever containers and list forms the direction uses, plus badges and tabular data
- Feedback: alerts, confirmations, progress, transient messages

**3 · The data-graphic vocabulary**
- The value-in-a-range scales from 9.3, designed as a family with shared logic, covering the faff quantities listed there
- Splits, elevation profiles, route maps, and the trend-over-a-season chart, in the same language. Note the editorial reference the owner supplied for this: a bar chart with **exactly one bar picked out** in accent colour, a large headline percentage with a small qualifying label, and secondary numbers sitting in a quiet row beneath without competing. **One deliberate highlight communicates more than a chart where every bar is coloured**

**4 · States as first-class deliverables, inside the system**
- **Loading**: data arrives asynchronously and must not reflow anything
- **Empty**: day one, no history, no race, no plan. This is a real screen a real new user sees
- **Error**: must be visually distinguishable from a value. "Not set" is not an error state
- **Silence**: the coach has nothing honest to say. Designed, not defaulted
- **First run**: five onboarding modes, per section 2

**5 · Information architecture**

This one is really part of stage one, because a direction that does not have a view on structure is only a skin. Bring it early.

- A point of view on navigation. **Challenge the five tabs.** Tell us what the surfaces should be
- For each surface, what earns the top, and why
- The state-driven question: race week, race morning, the day after a race, mid-base, a week off, injury, and off-season should produce **meaningfully different screens**, not the same layout with different numbers

**6 · Responsive behaviour**
- Phone and desktop, from the same system, without one being a scaled copy of the other

**7 · Enough screens to prove the grammar covers the whole app**
- Including the difficult states, not only the happy paths

**Plus a written rationale.** Why this structure, why this typographic system, why these colours, why this hierarchy, and — most of all — **your answer to the question in section 10**: what you converted from words into graphics, and what you decided genuinely needed a coach's sentence.

---

## 12. How we will judge it

One question, in two halves:

**Can a runner open this, know what to do today and why, and close it — and over a season, does it feel like being coached rather than being measured.**

That is the whole test. A beautiful surface that fails the first half is a dashboard. A useful surface that fails the second half is a tracker. We have both of those already.
