# faff.run — site-wide redesign brief

**For:** an outside design team, working cold.
**Deliverable:** three distinct design directions, then a system.
**Deliberately withheld:** our current colours, typefaces and screens. Design from the information up.

---

## 1. What this is

faff is a **coaching platform** for distance runners. Not a tracker, not a dashboard, not a social network.

The difference matters. A tracker records what you did. A dashboard shows you numbers. A coach tells you what to do today, why it exists, whether the last one worked, and whether the goal is still honest — and remembers you between conversations.

Everything the product does is in service of one loop: **plan → run → recap**. That loop is what a runner actually uses. Everything else supports it or should not exist.

Guiding constraint from the owner: **less is more.** The product is being simplified, not extended.

---

## 2. Who it is for

The primary runner is 41, runs a company, has two children, and ran roughly 1,080 miles this year. Marathon goal of 3:00; current fitness around 3:20. Trains four to six days a week and races about monthly.

Design implications that follow directly:

- **He is serious, and time-poor.** He opens the app at 6am before running, and again after. Not for browsing.
- **His life is not optimised and never will be.** Sleep is inconsistent, readiness is rarely perfect. A design that implies he is failing whenever a number dips is wrong for this user.
- **He is knowledgeable.** He knows what threshold pace is. Do not over-explain, and do not condescend.

The product is opening to other runners, so nothing may be built around one person's habits. Assume a range from a first-marathon runner to a sub-3 competitor.

---

## 3. The information the product holds

This is the real input. Every item below exists, is computed, and is available to design with.

**The plan.** A training block aimed at a goal race, divided into phases (base, build, peak, taper, race week, recovery), then weeks, then sessions. A session carries: type (easy, long, threshold, intervals, race, rest), distance, target pace, heart-rate ceiling, perceived-effort target, cadence range, internal structure (warm-up, work, cool-down, repetitions and recoveries), a one-line statement of what it builds, and its own history if it was moved or altered.

**Execution.** Every run: distance, time, pace, per-mile splits with heart rate and elevation, average and maximum heart rate, cadence, elevation gain, the route itself, the shoe, and the conditions it was run in. Runs are matched against the session that was prescribed, so "did you do the thing" is answerable.

**Fitness.** A single fitness number derived from race results and quality sessions, which yields predicted finish times at 5K, 10K, half and marathon. A trajectory toward the goal, the gap in minutes and seconds, and the specific levers that would close it. Also the provenance of that number — which race it came from and how stale it is.

**Readiness.** Sleep against the runner's baseline, heart-rate variability, resting heart rate, and training load. These combine into a daily reading. **Important: readiness informs, it never changes the plan.** The runner decides.

**Races.** A calendar with priorities (A = the goal, B = a tune-up raced hard, C = a hard workout with a number on). Each carries a date, distance, goal time, course elevation profile with named segments, a pacing plan, a fuelling plan, and afterwards a result with per-mile splits and a retrospective comparing plan to reality.

**Memory.** The coach's log: weeks closed, phases crossed, personal bests, patterns noticed. This is how the product stops being amnesiac.

**Voice.** Written coaching, in a specific register. See §6.

---

## 4. The five things that matter daily

If the product could show only five things, these are they. Design outward from them.

1. **Today's session** — what, why, and the targets to hold.
2. **The run itself** — executed on a watch, which must agree exactly with what the app said.
3. **The recap** — what happened, what it means, what changes because of it.
4. **The block** — where this week sits, and whether the goal is still honest.
5. **Memory** — the product noticing something and reflecting it back.

Everything else is support. A number the runner cannot act on is clutter.

---

## 5. What we have learned, stated as problems

These are the failures of the current build. They are given as problems to avoid, not solutions to apply.

- **It measured far more than it prescribed.** Roughly 120 distinct numbers across the product; only six places that told the runner what to *do*.
- **The same fact appeared repeatedly.** One four-mile easy run rendered its distance and duration three times across three adjacent panels. Every datum needs exactly one home.
- **Hierarchy was inverted.** The prescription — the reason the page exists — was given the narrowest column while a restatement of it got the widest. The primary clipped; the duplicate rendered large and clean.
- **Things popped in and moved the page.** Conditional elements above the fold pushed everything below them down as data arrived. If something is sometimes there, its space should always be there.
- **A week was drawn as seven equal cells.** A sixteen-mile long run and a rest day were rendered identically. The most variable thing about a training week — how load is distributed across it — was drawn as a constant. The largest element in each cell was the date, which is the one thing the runner already knows.
- **Failures rendered as facts.** When data failed to load, the interface stated "Not set" — asserting the runner's information was empty rather than admitting it could not fetch it.
- **Placeholder states shipped as product.** Missing values as dashes, labels clipped mid-word, charts of a single flat bar.
- **No responsive behaviour on the main screen**, so a third of it became unreachable on a phone.

---

## 6. The voice

This is the product's actual differentiator and it must survive the redesign. Short, direct, no hype, no exclamation marks, no emoji.

Real examples:

> "Keep it truly easy. Nose-breathing pace the whole way."

> "You took the bail at mile 6 · smart, not a fail. The stimulus was already banked; forcing the rest buys fatigue, not fitness."

> "Recovery is easy running, not rest. 17 miles across 4 days this week, all of it easy."

> "Base-building, not a workout. Keep it boring and bank the aerobic volume. The point is time on feet, not pace."

These are **content, not decoration.** They need a real home in the design, not caption text at the bottom of a card.

---

## 7. The central design question

The owner's direction: **"Simple and graphic. The simplicity of the graphics do the talking, not the words."**

The product currently uses sentences to do work a graphic would do silently:

- A pace against its target band is written as a sentence. It is really a position on a scale.
- Readiness is a number plus a paragraph. It is really a mark against this runner's own normal.
- A week is seven labelled cells. It is really a shape.

Note that almost every quantity in this product is **a value inside a meaningful range**: pace against a target band, heart rate against a ceiling, readiness against a personal baseline, weekly mileage against the plan, current fitness against the goal. Ranges with endpoints that mean something. Today they are all rendered as bare digits.

**So the question we are commissioning an answer to:**

> How much of what this product currently says in words can be said by a graphic instead — and what is genuinely left over that needs a coach's sentence?

Be careful with the distinction. What should shrink is **interface language**: labels, legends, captions, explanations, chrome. What must survive is the **coach's voice** in §6.

---

## 8. Quality bar

The owner's references: **Runna, Nike, Strava, Apple.**

They are not the same product, and the differences are instructive. Runna is the nearest competitor — plan-centric, calm, generous. Nike brings editorial confidence, big type doing the work. Strava respects the data itself: splits, maps, the run as an artifact worth looking at. Apple brings systematic restraint — hierarchy through weight and space, and the discipline to leave things out.

What all four share, and what the current build fails at: **they structure with space and typography, not with boxes and hairline borders.** They are systems, not collections of screens.

Additional direction the owner has supplied by example: flat, confident colour; one idea per element; enormous, assured numerals with small plain labels; and **bespoke graphics that encode a value rather than generic chart components** — a gradient bar showing a range with its endpoints marked, an arc for a bearing, segmented scales with a position marker.

**State honestly:** the current build reads as budget. Cramped spacing, everything bordered, a type scale that jumps from micro-labels straight to huge numerals with nothing between. It is not a floor to build from. You are free — expected — to discard the entire existing surface.

---

## 9. Surfaces

- **Web** — the command centre. Planning, review, race preparation, history.
- **iPhone** — the daily companion. Used before and after a run.
- **Apple Watch** — executes the session. Out of scope for this brief, but note the watch must never contradict what the phone said.

Web and phone share one backend and should feel like one product without being identical. Three of the four reference apps are phone-first; our web surface is a genuine planning tool. **The feel should carry across both; the layout should not simply be scaled.**

---

## 10. Out of scope

- Strength training and cross-training (removed by owner ruling).
- Social features, sharing, feeds.
- Gamification and streaks. Streaks are explicitly rejected: they reward running on a rest day, which fights the plan.

---

## 11. What we want back

**First: three genuinely distinct directions.** Different in structure, not three colourways of one layout. Is it tiles? A continuous sheet? A feed? Something we have not named? We do not know, and we would rather see options than a single refined answer. Take each far enough on the same two or three real screens that they can be compared honestly, and state the point of view behind each.

Please challenge the current five-section structure (today, plan, goals and races, activity, health) rather than inheriting it.

**Then, once a direction is chosen: a system.** Not a set of screens — a system:

- Colour tokens with values, and the rules for using them
- A type scale with intent per step
- A spacing scale
- A component inventory with **every state drawn**: default, hover, focus, active, disabled, error
- Loading, empty, error and first-run states treated as first-class
- Responsive behaviour
- The data-graphic vocabulary — how a value-in-a-range is drawn, consistently, everywhere it appears

The system matters as much as the look. The current surface decayed into a dozen overlapping eras of styling precisely because there was no system to add features into.

---

## 12. How we will judge it

One question:

> Can a runner open this, know what to do today and why, and close it — and over a season, does it feel like being coached rather than being measured?

---

## 13. Practical notes

- Dark and light are both open. The current build is dark; that is not a requirement.
- Accessibility is not optional: contrast, focus states, and hit targets. It is used outdoors, in sunlight, sometimes mid-run.
- The runner is often tired, sometimes cold, occasionally in the dark, and frequently in a hurry.
