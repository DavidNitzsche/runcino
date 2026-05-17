# Running App — Design Brief

## Source of truth

This brief is the design source of truth for the running app across web, iPhone, and Apple Watch. It supersedes all prior work:

- Any light-theme layouts or mockups previously explored. The app is dark. The palette below is locked.
- Any existing components, tokens, colors, layouts, or styles in the codebase that conflict with what's specified here.
- Any default assumptions inherited from earlier iterations of the dashboard.

Nothing in the existing build is preserved by default. If a component, color, layout, or pattern doesn't match this brief, replace it. Don't try to harmonize the brief with what's already there. Don't split the difference. The brief wins.

The brief itself is not sacred. If research or implementation surfaces a real reason to change a token, a rule, or a principle, raise it and propose the change. Anything can be added, replaced, or removed. But until this document is updated, it is the spec.

---

## Read before designing

Three sources of context, in this order:

1. **Research directories** on the local machine. Training methodology, data model, knowledge base.
   ```
   /Volumes/WP/06 Claude Code/Runcino/BuildResearch
   /Volumes/WP/06 Claude Code/Runcino/Research
   ```

2. **`APP_FEATURE_SPEC.md`**. What the app is, what surfaces exist, what each surface is for.

3. **`C1-overview-and-today.md`**. Element inventories for Web Overview and iOS Today, including the conditional layouts that promote, demote, add, and remove elements based on training state.

This brief covers form. Those documents cover content. Don't design in a vacuum. Pick what each beat holds based on the canonical inventories and the user's current state.

---

## What we're making

A running platform across three surfaces, sharing one source of truth and one design language.

- **Web (desktop and tablet).** The command center. Where the athlete sits down to plan, analyze, and read deeply.
- **iPhone.** The daily companion. Glanceable, push-driven, one-thumb capture.
- **Apple Watch.** The execution layer. Reductive. Big numbers. Audio and haptic over visual. (Watch will get its own focused brief when that surface is built. Principles below apply, but expect detail later.)

Information density follows the device. Web is the most expansive. Watch is the most reductive. The same brand voice and visual language span all three.

The product's voice is honest, direct, personality without hype, time-aware. ("Good evening." "Day 1 of 14." "1 day since Sombrero.")

### The three questions

At any moment, the dashboard's job is to answer three questions at a glance:

1. **What should I do today?** The prescription.
2. **How am I doing it?** The body state. Recovery, readiness, conditions for execution.
3. **How am I doing overall?** The trajectory. Where in the arc, on track or off.

Every layout decision serves these three answers, in that order, glanceable in seconds. Everything else is depth available below the fold.

---

## Philosophy. Three rules that override everything

**One hero per screen.** Whatever the most important thing is right now, that's what gets the most space, the largest type, the most silence around it. Equal weight across the page is failure.

**Glanceable first, depth available.** Medium dense at most. The three questions answer themselves above the fold. Drill-down lives below. Information-rich is fine. Noise is not. Every element earns its place by carrying information or hierarchy.

**Typography does the work.** Hero numbers carry the page. Small-caps gray labels orient them. Coach voice carries the narrative. Weight contrast and color semantics carry hierarchy more than card boundaries do.

---

## The page is alive

The dashboard is not a fixed template with slots to fill. The composition is a function of where the athlete is right now: in the season, in the week, in the day. A page checked race week and a page checked twelve weeks out should look like cousins, not the same page with new numbers.

### Time scales

**The arc.** Where in the season. Each phase has a different center of gravity:

- **Off-season.** Patient maintenance. Gear and goals at the front.
- **Build.** Consistency, mileage, long-run progression.
- **Peak.** Load, sharpness, ACWR vigilance.
- **Taper.** Stillness. Race-week machinery emerging.
- **Race week.** Countdown is hero. Everything else recedes.
- **Race day.** The race takes the page.
- **Post-race.** Recovery hero. Days-since chip. Reverse-periodization framing.
- **Injury.** Banner overrides almost everything. Cross-training and protocol stage front and center.

**The week.** Hard, recovery, race, travel. The shape of the week determines what's worth elevating.

**The day.** Rest day morning is calm. Key workout morning is sharp and prepared. Morning after a strong long run is quietly affirming. Morning after a missed or rough session is direct and corrective without preaching. Race day morning is reverent.

### Rules for adapting

**The hero is contextual, not positional.** Whatever answers the most pressing question right now. Twelve weeks out from a race, that's probably consistency or the long arc. Five days out, the countdown. Race day morning, the race and nothing else.

**Beats and elements promote, demote, appear, and disappear.** This vocabulary already exists in `C1-overview-and-today.md` per training state. Use it. A countdown beat does not exist four months out. A taper beat does not exist in build phase. A recovery readout makes sense after a hard session, not after a rest day. Don't render empty or default versions of beats that aren't relevant. Cut them entirely.

**Color follows the moment.** See semantic colors below. Active blue highlights what's current. Race orange appears when a race is close enough to matter. Warn rose appears only on actual risk. Color isn't decoration. It's the page's clearest hierarchy signal.

**Time horizon scales the surface.** A race four months out is a quiet line near the bottom of the page. The same race three weeks out is a working surface mid-page. Race week, it's the hero. Race day, it takes the page.

**Tone shifts by phase.** Base feels patient. Build feels purposeful. Peak feels charged. Taper feels still. Race week feels electric but quiet. Race day morning feels reverent. Post-race feels gentle. Same coach voice, different register.

**Surprise gets a moment.** A PR, a first-time-under-X pace, a streak milestone, a key workout nailed. These earn brief promotion to a beat near the top, with a single milestone-gold element marking what's new. Hierarchy carries the moment, color marks it. The next day the moment recedes and the color decays to ink.

**Live means current, not historical.** A page checked at 5am reflects the workout the athlete is about to do. After it's logged, the page shifts to reflect what just happened and what's next. Don't show yesterday as if it's still today.

---

## Tokens

### Color palette

Dark theme. The brand commits to this on every surface.

#### Core neutrals

```
--bg:        #0B0F17    primary background, near-black with cool cast
--surface:   #141923    card surface, slight lift from bg
--surface-2: #1C2230    elevated surface, hover state
--ink:       #F5F4EE    primary text, warm white
--mute:      #8B909C    secondary text, small-caps labels
--line:      #262C39    borders, dividers, axis lines
```

#### Semantic accents

Five colors. Each has one job and is never used outside it.

```
--recovery:  #14C08C    green     readiness, recovery, restoration
--active:    #4F8FF7    blue      active training, current state, "today"
--race:      #FF5722    orange    upcoming races, countdowns, race-day mode
--warn:      #F43F5E    rose      risk alerts, illness flags, injury banners
--milestone: #F5C518    gold      PRs, achievements, key moments
```

Milestone is the rarest accent. Strict rules:

- Appears only when a genuine achievement has just occurred. PR, key workout nailed, streak hit, first-time-under-X. Never as a default state.
- One milestone-colored element on the page at a time, maximum. No rows of gold stats.
- Never a surface fill. Race orange is the only filled-accent surface. Milestone is type color, chip color, or inline accent only.
- Decays fast. A PR is gold the day it happens, ink the next day, mute by week's end.

The race accent is the brand's hero color. It carries gradient treatment when used as a filled surface (the only sanctioned filled-accent surface on the page). The race-card gradient:

```
--race-grad-light:  #FF8A3D    top of gradient, warmer
--race-grad:        #FF5722    midtone (the canonical race color)
--race-grad-deep:   #E03E00    bottom of gradient, deeper

background: linear-gradient(160deg, var(--race-grad-light) 0%, var(--race-grad) 55%, var(--race-grad-deep) 100%);
```

Race orange is the only color that gets gradient treatment. Other accents stay flat.

The rule: each color has one semantic job. Recovery green never highlights a PR. Race orange never marks a streak. Milestone gold never appears outside an actual achievement moment. If a new accent need emerges that doesn't fit the five, ask. Don't add a sixth.

Race orange and warn rose are deliberately distinct. Orange leans warm-yellow, rose leans warm-pink. They should never be confused. Two layered accents on the same screen are expected (race countdown plus a warn banner on a risk alert). Three or more competing accents inside one beat is wrong. Collapse the priority.

#### Categorical encoding

Multi-color encoding is allowed when color identifies a category — course phase, training zone, energy system — and the same color means the same thing every time it appears on that surface. A chart fill, a legend swatch, a phase card left-border, and a phase label must all use the identical color. Consistency is what earns the encoding its place.

The test for any new multi-color use: are the colors a key for distinct categories that recur in the same encoding elsewhere on the page? If yes, categorical encoding applies. If the colors vary for visual interest or emphasis without each one mapping to a named category, they are ornamental. Ornamental multi-color is not allowed.

**Course phase palette.** The canonical use case is terrain visualization: elevation chart fill, phase strip, phase cards. Six phases, six colors. These live in a separate token group from the five semantic accents and are never substituted for them. A phase color is not "active blue" — it is a phase identity.

```
--phase-1: #4ade80    lime green
--phase-2: #fbbf24    amber
--phase-3: #f87171    coral
--phase-4: #38bdf8    sky blue
--phase-5: #a78bfa    violet
--phase-6: #f472b6    pink
```

Phase colors appear only in terrain or phase-based visualizations. They do not appear in pills, eyebrows, coach blocks, or any element that uses the five semantic accents.

The race countdown pill and "RACE A" pill remain race orange (`--race`). Phase colors are for terrain encoding only. Do not confuse the two.

### Typography

One family. A tight geometric or grotesque sans (Söhne, Inter Display, Neue Haas Grotesk Display, or similar). Tabular figures for every stat.

```
Hero numeral:   120–160px  /  700  /  -0.04em
Display H1:     72px       /  700
Section:        36px       /  600
Stat:           48px       /  700  /  tabular
Body:           15px       /  400
Eyebrow:        11px       /  500  /  uppercase  /  0.12em  /  --mute
```

Use these steps. No in-between. Don't reach for a second typeface.

The "small-caps gray label" pattern is the brand's eyebrow. It sits above every hero number.

### Space

8px base grid. Card padding 24–40px depending on density. Outer gutter 32px on desktop, 20px on iOS. Major section spacing 48–80px.

The brand reads as glanceable, not crowded. Each beat is internally clean and externally separated by enough space to read as its own beat. If the eye has to work to find the boundaries, the spacing is too tight.

### Surface

Cards are `--surface` with a 1px `--line` border. A subtle top-light gradient on cards is acceptable when it helps separate stacked surfaces. Very mild, never a focal point. No drop shadows. No glassy blurs.

The race-day card uses the orange gradient as its surface fill. That's the single sanctioned filled-accent surface. It appears once on the page when warranted, never more.

---

## Hierarchy. Three weights, no more

1. **Hero.** One per screen. Display type. Accent color if it deserves it (the semantic that fits). Real silence around it.

2. **Working surface.** Two or three elements the athlete will read in detail or act on this morning. Section headlines, real data, meaningful space.

3. **Reference.** Everything else. Quiet type, mute color, no chart frames, no captions. Type alone is enough. If a number doesn't earn its way up, it lives here in a flat row of small stats or a strip.

When in doubt, push down a tier, not up. The C1 inventory grades elements as `must / should / nice / later`. Use those grades as a starting hint, not a fixed assignment, since the grade can shift with state.

---

## Composition

### Editorial beats, not a tile grid

A 4×3 grid of equal-weight cards is the SaaS look we're avoiding. Build the page as vertical beats with real silence between them. Each beat has one job. Beats descend in priority. The further down the page, the quieter the surface and smaller the type.

Beats are not fixed. They exist when the state warrants them and disappear when it doesn't.

The three beats that almost always lead, in this order, are the three questions: what to do, how I'm doing it, how I'm doing overall. The exact form of each beat changes with state, but the order rarely does.

### One thesis per beat

Each beat answers one question. If a section needs a paragraph to explain itself, it's doing too much. Cut until one thesis is obvious in two seconds.

### No redundancy

If a fact appears once, it's information. If it appears twice, it's noise. Race date, goal pace, today's session, the countdown. Each lives in exactly one place on the page.

### Charts are a last resort

A chart is justified when a trend across time is the point. Otherwise the number alone is more honest. Tiny ornamental sparklines inside stat cards that can't be read are decoration. Strip them. When a chart does belong, give it enough space to be read: simple line, mute color, accent dot at the now-point, no axis labels beyond start and end markers.

The PMC chart, HRV trend with baseline ribbon, and long-run progression are the few places a real chart earns a working surface. Most other "metrics" should be a number with a delta, not a chart.

---

## Surface variants

The same job is answered differently on each surface. Same brand, different density.

### Web (desktop and tablet)

The command center. The athlete sits down for two minutes to read.

- Multi-column where it earns it. Typically a left or center column for hero and working content, a right rail for reference.
- Inline drill-down. Expand sections in place. Don't bounce to detail pages for first-tier reads.
- Medium density. Not sparse, not crowded. The three questions answer above the fold; supporting depth lives below.
- Charts and arcs render at full size when included.

### iPhone Today

The 2-second glance. Single-column scroll. The athlete is standing, phone in hand.

- Single column. No grids.
- Composite hero (recovery score, today's workout, or race countdown — whichever is the moment's hero) at the top.
- Drill-down via sheets and modals, not nested screens.
- Send-to-Watch is the canonical primary action. Its CTA is persistent on the workout card.
- Live Activities and widgets surface today's hero outside the app.
- Subjective check-in auto-prompts on first morning open. Web shows a passive prompt instead.
- Layout is opinionated, not customizable. Hide/show toggles per card live in settings. No drag-to-rearrange.

### Apple Watch

Reductive. Mid-run readability is the only thing that matters during the active workout. Pre-run is one-screen briefing only.

- Big numbers, high contrast.
- One target metric in the center, one secondary above and below.
- Audio and haptic carry the moment. Visual is glance-only.
- No coach prose. Save narrative for phone and web.

The same component vocabulary exists on each surface, in different scale and density. A "stat card" on web is a hero number with three lines of supporting context. On iOS it's a number and a label. On watch it's a number, period.

---

## Component vocabulary

The brand has proven primitives. Use them. Don't invent new component types unless none of these fits.

- **Stat card.** Hero number, small-caps label, supporting context line(s).
- **Coach voice block.** Narrative block in coach voice. Often labeled `WHY`, `FOCUS`, `BACK OFF IF`.
- **Phase / arc visualization.** Periodization timeline showing where the athlete is in the cycle.
- **Conditions panel.** Weather and environmental context. Temp, dew point, wind, AQI, sunrise/sunset.
- **Training pulse.** Volume and ratio metrics. Week mileage, intensity distribution, ACWR.
- **Pace pill.** Inline pace display. (`7:25/mi · M`)
- **Workout card.** Compact and expanded variants. Expanded shows structure, paces, fueling.
- **Trend chart.** Line for biometric trends (HRV, RHR, fitness). Baseline ribbon when relevant.
- **Calendar grid.** Week and month views with prescribed and actual reconciliation.
- **Activity row.** Feed-style entry for run, strength, recovery, note.
- **Recovery score.** Composite display, with breakdown on tap.
- **Body map.** Interactive body diagram for injury logging.

When the C1 inventory or research directs a new pattern, design it to read as a member of this family. Same type system, same color logic, same eyebrow style.

---

## Tone of voice

Coach voice, not app voice. The athlete is doing the hard work. The page just confirms what's true.

- Short. Direct. Plain prose.
- No exclamation marks.
- No "crushing it," "locked in," "let's go," or any hype line.
- No emoji.
- No em dashes. Use periods.
- Stats speak first. Words add context only when they add real meaning.
- A coaching note is one or two sentences. Never three.
- Time-aware framing where natural. ("Good evening." "Day 1 of 14." "1 day since Sombrero.")
- Honest, even when uncomfortable. ("A bit hard, back off." "Stepping back." "Recovery is the workout.")
- Always show the why, not just the what.

Coach voice blocks use canonical labels where applicable: `WHY` (context for the prescription), `FOCUS` (the one thing to do well), `BACK OFF IF` (honest guardrails).

If a caption sounds like a fitness app trying to be a friend, delete it.

---

## Anti-patterns. Never do these

- Multi-color charts where each bar is a different shade for decoration
- A hype caption under every stat
- Equal-weight cards across a row when one of them is genuinely more important
- Drop shadows
- Glassy blurs or material-style depth effects
- Decorative gradients on non-race surfaces (subtle card-depth gradients only, when functional)
- Decorative icons next to every label
- Showing the same fact in more than one place on the page
- Tiny sparklines that exist for visual texture rather than legibility
- Pills or badges that repeat what the surrounding type already says
- Using a semantic color outside its assigned role (no race orange for a generic highlight)
- Three or more accent colors competing within one beat
- More than one milestone-gold element on the page at the same time
- Milestone gold appearing on anything that isn't a fresh achievement
- Rendering empty or default states of beats that have nothing to say right now
- Showing a race countdown when there's no race in the meaningful future
- Treating every day as if it has the same shape
- Showing yesterday as if it's still today
- Coach prose on the watch
- Multi-column layouts on iOS Today
- Drag-to-rearrange card order on iOS (hide/show only)
- Nesting full plan editing into iPhone surfaces (defer to web)
- Streak mechanics that punish smart rest days
- Forcing a chart where a number with a delta would do

---

## The tests

**The three-question test.** A stranger looks at the page for two seconds, then looks away. They should be able to say:

1. What this athlete is doing today
2. How they're doing right now (body state)
3. How they're doing overall (trajectory)

If any of those takes longer than two seconds or requires reading small type, the hierarchy is wrong.

**The 4-month test.** If the same page were rendered four months from today, it should look meaningfully different. Not just different numbers in the same slots. Different beats present, a different hero, a different center of gravity. If it would look the same with new numbers, the page isn't alive. It's a template.

**The surface-fit test.** The web overview, iOS Today, and watch screen for the same morning should each answer the surface's job correctly:

- Web: full picture in 2 minutes
- iOS: what now in 2 seconds
- Watch: guide me through this run, in glances

If iOS Today reads like a smaller web overview, or watch reads like a smaller iOS, the density isn't tuned to the surface.
