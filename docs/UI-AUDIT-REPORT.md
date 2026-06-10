# UI AUDIT — faff.run

**Date:** 2026-06-09 · **Auditor posture:** hostile, Apple-shipped, zero patience
**Scope:** web-v2 (all 7 views + shell + globals.css), native-v2 iPhone (Theme, Fonts, all Views), live watch app (`legacy/native/Faff/FaffWatch Watch App` — FaceKit, Faces, ActiveWorkout, Summary, WatchTheme)
**Method:** every token file and every major view read directly; four exhaustive machine sweeps (color census, typography census, empty/loading/motion/responsive census, copy census) cross-checked by hand. Findings below cite file:line. Where a prior audit flagged something that is now fixed (race-day takeover, tempo-face routing, RACE-SPECIFIC phase mapping), I verified the fix in code and did **not** re-flag it.

**Priority key:** `AFC` = fix before the next race block matters (weeks). `CIM` = fix before the December marathon. `polish` = whenever.

---

## THE HEADLINE

This app has **three design systems fighting in one trench coat**, and the document that's supposed to referee them is two generations out of date.

- `Design/running-app-design-brief.md` (the locked source of truth) specifies five accents (`#FF5722` race, `#14C08C` recovery, `#4F8FF7` active, `#F43F5E` warn, `#F5C518` milestone), **one typeface**, no glass, no shadows.
- The shipped app runs a *different* palette (`--race:#FF8847`, `--green:#3EBD41`, `--goal:#F3AD38`, `--over:#FC4D64`, `--dist:#27B4E0`, `--rest:#008FEC` — globals.css:13-19, Theme.swift:34-39), **four-to-five typefaces**, glass everywhere, shadows on the tab bar.
- And the app has already moved *again*: the 2026-06-04 "charcoal idiom" (color lives on the data, page stays neutral — Shell.tsx:134-164) quietly retired the per-tab mesh idea on web… while the iPhone still ships the per-tab color meshes, including one (red Targets) the web explicitly killed for being unreadable.

Almost every individual screen shows evidence of real taste. The *system* shows evidence of nobody holding the pen. The brief itself says: "If research or implementation surfaces a real reason to change a token, raise it and propose the change." Nobody ever did. **Write brief v2 from the as-built system, then enforce it like the original was supposed to be enforced.** Half the findings below collapse into that one act.

---

# ATTACK 1 · THE COLOR SYSTEM

## System · Locked palette · BROKEN
**What's wrong:** The brief's five-accent palette is dead in the live product. `#FF5722` survives only in the brandmark sweep (globals.css brandmark / Theme.swift:86), the race-day hero gradient (TodayView.tsx:4369), and the race mesh dot (constants.ts:38). `#4F8FF7` (active blue) appears *nowhere* except the logo sweep. The app's real accents are a different six-color set that exists only in code comments.
**Why it matters:** There is no document a designer or agent can open to know what color anything should be. Every new component invents. That's how the rest of this section happened.
**Fix:** Author `Design/running-app-design-brief-v2.md` with the as-built tokens (`#FF8847 / #3EBD41 / #F3AD38 / #FC4D64 / #27B4E0 / #008FEC` + the effort temperature scale + neutrals + glass), explicitly retire the v1 accents, and state the charcoal-page/color-on-data doctrine. Delete dead tokens from globals.css and Theme.swift.
**Effort:** 1 day. **Priority:** AFC — everything else keys off this.

## System · The orange census · BROKEN
**What's wrong:** **~24 distinct oranges** ship today. The worst cluster, all doing "important warm thing": `#FF8847` (--race, tempo), `#FF5722` (brief race / race dot), `#E85D26` (watch C.orange, WatchTheme.swift:25), `#EE6038` (RUN tab menu accent, hardcoded in RootTabView.swift:116), `#FF7733` (PEAK phase, TrainView.tsx:120), `#FF8870` (execution <80%, TrainView.tsx:751), `#F18847` (tempo mesh stop), `#FF7A45` (race mesh c2), `#FF9560` (Zone z4), `#FFB07A` (conditions label), `#FFCE8A` (eyebrow amber), `#FFE7C2`, `#FFC25C`, `#FFB24D`, `#FF8A5C`, `#FF9A55`…
**Why it matters:** When 24 oranges coexist, orange stops meaning anything. The brand's hero color becomes texture.
**Fix:** Collapse to four sanctioned warms: `#FF8847` (race/tempo accent), `#F3AD38` (goal/long/attention), `#FFCE8A` (eyebrow amber), `#F5C518` (PR gold). Everything else maps to the nearest of those. The mesh stop colors are exempt (they're gradient ingredients, not semantics) but should live only in the mesh tables.
**Effort:** 1–2 days mechanical. **Priority:** AFC.

## System · The green census · BROKEN
**What's wrong:** "Good" is **~14 different greens**: `#3EBD41` (canonical), `#34D058` (readiness "sharp", hardcoded TodayView.tsx:189), `#34C194` (strength-done badge TodayView.tsx:407 + health mesh), `#2faf7c` (TrainView easy, TrainView.tsx:80), `#56E0B0` (execution ≥95% + taper), `#7BE8A0`, `#86EFA0`, `#3ED06a`, `#8af0a6`, `#37c98f`, `#9ad9b0`, `#9af0bf`, `#14C08C`, and `#2CA82F` (watch glance green, WatchTheme.swift:23).
**Why it matters:** SHARP vs READY readiness bands are two near-identical greens (`#34D058` vs `#3EBD41`) — a distinction the system thinks it's drawing that no human perceives. And the watch's on-pace green differs from the phone's on-pace green for the *same metric on the same run*.
**Fix:** Three greens, period: `#3EBD41` (state: good/on-track), `#7BE8A0` (text-on-dark mint for inline good values), `#14C08C` (easy-effort identity only). SHARP gets differentiated by *treatment* (e.g., filled vs ring) not by a fourth green.
**Effort:** 1 day. **Priority:** AFC.

## Cross-surface · Same semantic, different hex · BROKEN
**What's wrong:** The registration marks disagree across surfaces, and each side claims the other is canonical:
- **Easy dot:** web `#48B3B5` (constants.ts:20) vs iPhone `#14C08C` with the comment "per --eff-easy" (Theme.swift:207). The web's own `--eff-easy` *is* `#14C08C` (globals.css:18) but the week strip uses the `dot` field. Same run, different dot per device.
- **Race dot:** web `#FF5722` (constants.ts:38) vs iPhone `#D63E4E` "per --eff-race" (Theme.swift:212).
- **On-pace green:** watch in-run `#3EBD41` (FaceKit.swift:36) vs watch glance/treadmill `#2CA82F` (WatchTheme.swift:23) — *two greens on one wrist*.
- **Drift amber:** faces `#F3AD38` vs WatchTheme `#D4900A`.
**Why it matters:** The single most learnable thing in this app — "this color = this effort" — is unlearnable because it changes per device. Theme.swift's header claims "mirrored here verbatim… iOS does NOT reinterpret colors" (Theme.swift:5-8). That claim is false in at least four places.
**Fix:** One `EFFORT_COLORS` table, one hex per effort, mirrored byte-for-byte to Swift, with a CI grep that diffs them.
**Effort:** half day + the diff script. **Priority:** AFC.

## Web Today · Off-track colored race-orange · BROKEN
**What's wrong:** THE GAP tile colors a *behind-goal* projection `#FF8847` (TodayView.tsx:4471-4475, 4487-4490) — the same orange that is the brand's race-day celebration color, the tempo identity, and the RACE DAY tile next door. Meanwhile the actual warn color (`#FC4D64`) sits unused.
**Why it matters:** Orange simultaneously means "your race!" (good), "tempo" (neutral), and "you're failing" (bad) within one screen. The brief's core rule — each color has one job — is violated at the page's most emotional moment.
**Fix:** Off-track = `#FC4D64`. Watching = `#FFCE8A` (as now). On-track = `#3EBD41`. Race orange never signals failure.
**Effort:** 30 min. **Priority:** AFC.

## Web Today · DETRAINING and LOADED share a color · BROKEN
**What's wrong:** The Training Form ring maps both `LOADED` (too much stress) and `DETRAINING` (too little) to `#F3AD38` (TodayView.tsx:4556-4563).
**Why it matters:** The two ambers mean *opposite corrective actions* (back off vs build up). Color is the ring's only encoding since the text label was deliberately dropped (TodayView.tsx:4586-4592). A runner glancing at an amber ring cannot know which direction they're wrong in.
**Fix:** DETRAINING → `#27B4E0` (cool/info — "too fresh" reads cold, which is also semantically apt) or restore a one-word label for the two amber states.
**Effort:** 15 min. **Priority:** AFC.

## Web Shell · The sidebar runs a sixth color system · INCONSISTENT
**What's wrong:** Nav-active icon = `--brand2 #008FEC`, avatar = purple→blue gradient (`#9013FE→#008FEC`), Pro chip = purple glow (globals.css sidebar block). None of these hues appear anywhere else in the product except the rest-day token.
**Why it matters:** The first 250px of every web session belong to a brand (corporate blue/purple) the other 90% of the app abandoned. It reads like the nav was shipped by a different company.
**Fix:** Nav active = white + `rgba(255,255,255,.1)` pill (already there); avatar = neutral surface w/ amber initial; kill brand1/brand2 outside the logo.
**Effort:** 1 hour. **Priority:** CIM.

## Mesh · "Shifts by tab" is now false on web, chaotic on iPhone · INCONSISTENT
**What's wrong:** On web, *five of seven* views share the identical neutral charcoal mesh (`MESH.targets` — Shell.tsx:134-164); only Race (ember) and Profile/Spectator (teal) differ. On iPhone, *every* tab differs: Today = time-of-day palettes (Theme.swift:317-342), Train = amber, Health = teal, Targets = **the red intervals mesh** (Theme.swift:297) — the exact green-on-red contrast failure the web killed on 2026-06-04 ("the worst contrast pair," constants.ts:47-53). iPhone tempo/intervals meshes are also the web's retired **v1** stops (Theme.swift:232 vs constants.ts:30 v3), and iPhone race day reuses the intervals mesh because "no separate race mesh in the spec" (Theme.swift:237-241) — but the web shipped a dedicated race mesh on 2026-06-08 (constants.ts:38).
**Why it matters:** The product's signature visual idea — the living mesh — currently has no single answer to "what does the background mean?" Web says "nothing, stay calm." iPhone says "time of day" on one tab and "tab identity" on four others. The same race morning renders a charcoal page on web and a red rave on the phone.
**Fix:** Decide the doctrine once (recommendation: charcoal pages + effort color on the hero card, time-of-day allowed on Today as the one expressive surface — i.e., the web doctrine), then port: iPhone Targets → charcoal, iPhone tempo/intervals → v3 stops, iPhone race → the web race mesh.
**Effort:** 1 day. **Priority:** AFC (the red Targets tab is actively hostile to its own status colors).

## Web · Two zone palettes for the same five zones · INCONSISTENT
**What's wrong:** TIME IN ZONES uses `Zone` (`#54DDD0/#8EF0B0/#FFE0A0/#FF9560/#FF5A52`, Theme.swift:98-104, mirrored on web) while SPLITS/pacing uses `ZoneSplit` (`#48B3B5/#3EBD41/#F3AD38/#FF8847/#FC4D64`, Theme.swift:107-113). Z4 is `#FF9560` in one chart and `#FF8847` in the other, on the same run detail.
**Why it matters:** Categorical encoding only earns its place if "the same color means the same thing every time it appears on that surface" — the brief's own test. Two palettes for one taxonomy fails it.
**Fix:** One zone palette (keep `ZoneSplit` — it's built from the semantic accents), delete `Zone`.
**Effort:** 1–2 hours. **Priority:** CIM.

## Web · 120+ hardcoded hexes in components · WEAK
**What's wrong:** The color sweep found 120+ raw hex literals in TSX (readiness ring colors TodayView.tsx:188-193, HR deltas `#8af0a6/#ff8a5c/#ff6a6a` TodayView.tsx:2328-2350, exec strip TrainView.tsx:748-751, `#FC6076` shoe wear, `.cdbig` even has a hardcoded default `#FF8847` in globals.css:1083…).
**Why it matters:** Hex-in-component is how the 24-orange situation reproduces after you fix it.
**Fix:** Sweep to CSS vars / Theme tokens; add a lint rule banning `#[0-9a-f]{6}` in .tsx outside the token files.
**Effort:** 2 days. **Priority:** CIM.

---

# ATTACK 2 · TYPOGRAPHY

## System · One brand, five typefaces · BROKEN
**What's wrong:** The brief mandates one family. Live: **Anton** (brandmark), **Oswald** (display), **Inter** (body) on web+iPhone — defensible trio — but the watch's in-run faces use **HelveticaNeue-Bold** exclusively (FaceKit.swift:102), and the watch's glance/treadmill surfaces use **Bebas Neue** + Inter + Oswald (WatchTheme.swift:30-32). The most brand-critical surface (mid-run) is set in a font that exists nowhere else in the product, and the watch alone carries two type systems.
**Why it matters:** "Same designer made it" fails at the font level the moment the wrist lights up. HelveticaNeue-Bold was clearly chosen for numeral quality — fine — but then it's the *de facto* display face of the brand's execution layer and should either be canonized everywhere numbers matter, or replaced by Oswald on the watch.
**Fix:** Pick one: (a) canonize "HelveticaNeue-Bold for in-run numerals" in brief v2 and kill Bebas on the glance surfaces, or (b) move faces to Oswald (test glyph width at 130pt first — Oswald's condensed width may actually fit *more*). Either way the watch ends with one system.
**Effort:** (a) half day · (b) 2 days incl. re-calibration of FaceKit's capRatio/LSB tables. **Priority:** CIM.

## Web · 47 distinct font sizes · WEAK
**What's wrong:** The census counted 47 sizes in globals.css, dozens used once (7.5px PEAK labels TrainView.tsx:671, 8.5px pills, 9.5px sublabels, 11.5/12.5/13.5/14.5 between-steps…). The brief's ladder ("use these steps, no in-between") never had a chance.
**Why it matters:** Size is your main hierarchy tool on a dark UI. With 47 steps, nothing means anything: 13 vs 13.5 vs 14 is noise the reader pays for in scan time.
**Fix:** Define the real as-built ladder — 62-68 hero / 30 stat / 15 body / 13 secondary / 11 eyebrow / 9.5 micro — and snap everything to it. Allow exactly one micro size below 9.5, not five.
**Effort:** 1 day. **Priority:** CIM.

## All surfaces · Eyebrow tracking is ten different values · INCONSISTENT
**What's wrong:** ALL-CAPS label letter-spacing spans `0.3px → 3px`: `.ptag/.htag` 3px, `.fll` 2px, `.stats .k` 1.2px, `.zhead` 0.4px (web); iPhone defaults 2.0 but secondary labels run 0.4–0.6 (RaceDayView, HealthView); watch FaceLabel = 2 fixed.
**Why it matters:** The small-caps gray eyebrow is *the* brand signature per the brief. It currently renders with a different voice on every card.
**Fix:** Two values, total: 1.2px for ≤11px labels, 2px for hero eyebrows ≥12px. Codify in `.eyebrow` class / `Font.eyebrow()` and delete per-site values.
**Effort:** half day. **Priority:** CIM.

## iPhone · Oswald used as a 10–12pt label font · WEAK
**What's wrong:** TrainView.swift alone has `.display(10)`, `.display(11)`, `.display(12)`, `.display(12.5)` on chips and metadata (TrainView.swift:198-1421). Oswald is a condensed display face; at 10pt its apertures close up and it's strictly worse than Inter for labels.
**Why it matters:** "Oswald = display, Inter = body/labels" is the one typography rule the team actually held on web. iPhone is quietly eroding it from below.
**Fix:** Rule: Oswald never below 16pt. Swap sub-16 `.display()` calls to `.label()`/`.body()`.
**Effort:** 2 hours. **Priority:** polish.

## Cross-page · Two label grammars (CAPS vs sentence case) · INCONSISTENT
**What's wrong:** Today/Train speak ALL-CAPS ("THE GAP", "EXECUTION", "KEY WORKOUTS TO RACE", "LOG IT"); the Targets rebuild speaks sentence case ("Closing the gap", "Personal records · measured against the goal", "On track" pills, "+ New goal"); Health mixes both on one header row ("+ Log Niggle" Title Case buttons above "WHAT IS DRIVING IT" caps). The machine copy-census claimed consistency; reading the pages side-by-side disproves it — Targets is a different dialect.
**Why it matters:** Section labels are wayfinding. Two grammars make sibling pages feel like different apps — and Targets, the *newest* page, is the defector, which tells you the drift is accelerating, not converging.
**Fix:** Pick the Targets dialect (sentence-case section eyebrows, caps only for data labels) or the legacy dialect, and sweep. My vote: Targets' is calmer and more readable; migrate Today/Train/Health to it.
**Effort:** 1 day. **Priority:** CIM.

---

# ATTACK 3 · INFORMATION DENSITY

## Web Today · State-driven heroes · STRONG
What's right, on the record: race morning takes the page with the brief's exact sanctioned gradient (RaceDayHero, TodayView.tsx:4348-4448, tiles suppressed at 780); pull-back days promote readiness to the hero with the workout demoted below (TodayView.tsx:572-652); completed days pivot to the result. This is the "page is alive" doctrine actually implemented. Rare. Most shipping dashboards never get this far.

## Web Today · The pre-hero gauntlet · WEAK
**What's wrong:** Before the hero, the page can stack: ReconnectBanner → AdaptationCard → ProfileGapCard → missed-yesterday pill → CoachProposalCards (×N) → PlanProposalCards (×N, including *auto-applied* ones) → WorkoutProposalBanners (×N) → week label → week strip → strength status line (TodayView.tsx:162-545). Seven distinct interruption classes ahead of "what am I doing today."
**Why it matters:** On a two-banner morning at 1280×800 the workout title is at or below the fold. The brief: "One hero per screen… the most space, the largest type, the most silence." The hero gets the leftovers.
**Fix:** Cap pre-hero interruptions at ONE (highest priority wins, others collapse into a counter chip: "2 more coach notes ›"). Auto-applied proposals don't belong above the hero at all — they're receipts, not decisions; move below tiles.
**Effort:** 1 day. **Priority:** AFC.

## Web Today · Week strip leads every day, even race day · INCONSISTENT
**What's wrong:** The `.band` containing the week strip renders unconditionally above the hero (TodayView.tsx:301-518) — including race morning, where the tiles were correctly suppressed but the strip survives.
**Why it matters:** The strip is good furniture (it's the day-picker driving the hero) but it is *navigation*, and on race morning the brief says the race takes the page. A strip of next week's easy runs above "TODAY / CIM" dilutes the one moment the app has been building toward for 26 weeks.
**Fix:** `{isRaceDay ? null : <weekBand/>}` — race morning gets eyebrow + hero + nothing else. Bonus: on rest days, collapse strip cards' empty meta rows (rest cards currently reserve a meta row of nothing — wkstrip-v2 fixed-height design trades honesty for alignment; acceptable, but rest cards could drop to 60% opacity to recede).
**Effort:** 30 min. **Priority:** AFC.

## Web Today · The four tiles are the SaaS grid the brief bans · WEAK
**What's wrong:** THE GAP / RACE DAY / WEEKLY VOLUME / TRAINING FORM render as four equal cards (`.tiles` 4×1fr, globals.css:1058). Worse, two of them are the same tile wearing different hats: THE GAP and RACE DAY both carry the race name in their label, and both draw `.cdbar` progress bars **filled from the same `goalPct` value** (TodayView.tsx:4485, 4518). The goal time also appears twice *inside* THE GAP alone ("Goal 2:59:00 ·…" sub + "On track for 2:59:00" footer, TodayView.tsx:4480-4505).
**Why it matters:** "Equal-weight cards across a row when one is genuinely more important" and "showing the same fact in more than one place" are both named anti-patterns in the brief. The race countdown is a number, not a tile: it's already in THE GAP's context.
**Fix:** Three tiles: THE GAP (absorbs days-to-go as its footer line, one progress bar), WEEKLY VOLUME, TRAINING FORM. Delete the duplicate goal-time footer line. THE GAP gets 2-col width — it's the story.
**Effort:** half day. **Priority:** CIM.

## Web Today · FORM ring encoding is opaque · WEAK
**What's wrong:** Ring fill = `|TSB delta| / 50` (TodayView.tsx:4578-4581). A 30%-full ring means… delta 15? In which direction? The sign lives only in the centered number; the fill direction never changes.
**Why it matters:** A radial gauge implies "fullness toward something." This one is an absolute-value of a signed quantity — the single most confusable encoding choice available.
**Fix:** Replace with a horizontal diverging bar (center = 0, left = fatigued, right = fresh, colored by band). The brief prefers "number with a delta" over decorative rings anyway.
**Effort:** half day. **Priority:** CIM.

## Web Train · The ramp · STRONG
The 13-week volume ramp answers the user's hard question correctly: PEAK is labeled on the bar (TrainView.tsx:667-675), cutbacks get ↓ arrows (676-684), phases color the bars with a grid-aligned phase axis (704-731), race week is a distinct checkered bar. You can scan the macro plan in ~3 seconds. The de-duplication pass (each fact appears once — comments at 576-581, 616-621, 632-635) shows real editorial discipline. Two nits: PEAK at 7.5px/0.9 tracking is sub-legible (bump to 9px), and the `·A` adapted-week glyph (TrainView.tsx:780-786) is a private code nobody will crack — use the rotate glyph the week strip already taught.

## Web Train · Execution strip semantics are unlabeled · WEAK
**What's wrong:** Bar color encodes ≥95% green / ≥80% amber / <80% **orange-`#FF8870`** (TrainView.tsx:747-751), and the influence dot uses a fifth palette (`EXEC_INF_COLOR`, TrainView.tsx:85-88). No legend, no tooltip on the thresholds; `#FF8870` is yet another almost-race-orange meaning "bad."
**Why it matters:** The strip *is* scannable ("green green amber green") but the meaning of amber-vs-orange is private knowledge, and failure-orange collides with brand-orange again.
**Fix:** `<80% → #FC4D64`. Title the right column: "EXECUTION · % of planned mi". Influence dot inherits the same three colors instead of its own five.
**Effort:** 1 hour. **Priority:** CIM.

## Web Train + Today + Goal · Three different gap visualizations · INCONSISTENT
**What's wrong:** The same fact — projected finish vs goal — renders as (1) a tile progress bar (Today, `.cdbar`), (2) a SLOWER/FASTER centered axis with chip (Train PROJECTION, TrainView.tsx:980-997), and (3) a slower→faster band with CI zone and dot-captions (Targets ProjectionBand, TargetsView.tsx:346-415). Different geometry, different colors, different center conventions (Train centers the goal; Targets pins goal at 77%).
**Why it matters:** A runner who learns to read one cannot transfer to the next. This is the app's most important number and it has three unrelated faces.
**Fix:** The Targets ProjectionBand is the best of the three (it has CI + honest labels). Make it the canonical component, render it small in the Train card, and reduce the Today tile to number + delta + status color (no bar).
**Effort:** 1 day. **Priority:** CIM.

## Web Health · WHAT TO DO does not lead · BROKEN
**What's wrong:** The page order is: hero band (gauge + drivers + aerobic fitness + 7-day bars) → *then* THE STORY / WHAT TO DO row (HealthView.tsx:571-747), with WHAT TO DO in the right-hand column of row two.
**Why it matters:** The product's own doctrine (and David's explicit ask that birthed the panel — comment at 698-706) is that actions lead. A readiness *score* is a diagnosis; WHAT TO DO is the prescription. Prescription beats diagnosis — that's the entire brand thesis ("What should I do today?" is question #1 in the brief). Right now the most actionable content on the page is the fifth thing you see.
**Fix:** Promote WHAT TO DO into the hero band's right column (where aerobic fitness sits — aerobic fitness is a trend, it can live below). Gauge left, actions right, one band answers "how am I + what do I do."
**Effort:** half day. **Priority:** AFC.

## Web Health · The hero band holds four jobs · WEAK
**What's wrong:** One "hero" grid contains: score gauge + verdict + baseline math, driver rows, an entire AEROBIC FITNESS sub-card with its own eyebrow/value/delta/chip/summary/what-it-is paragraph (HealthView.tsx:599-635), and the 7-day bars. That's four theses in one beat.
**Why it matters:** "One thesis per beat. If a section needs a paragraph to explain itself, it's doing too much." The aerobic-fitness blurb is literally a paragraph explaining itself, inside the hero.
**Fix:** Hero = gauge + drivers + WHAT TO DO (per previous finding). Aerobic fitness becomes its own band below THE STORY. 7-day bars move into the gauge column under the score (they're the score's own history).
**Effort:** half day, same PR as above. **Priority:** AFC.

## Web Health · Body tiles · WEAK
**What's wrong:** BODY renders every metric as an equal `hmc` BarCard, plus a five-tile SLEEP STAGES grid (duration + deep + REM + light + awake) (HealthView.tsx:509-514).
**Why it matters:** Awake-time and light-sleep tiles are trivia given the page already shows a sleep-architecture verdict line; HRV/RHR/sleep-duration are the three that drive decisions and they get no extra weight.
**Fix:** HRV, RHR, SLEEP get the top row at full width with baselines; stages collapse into one stacked-bar tile; weight/cadence/VO₂ live in a quiet third row.
**Effort:** half day. **Priority:** polish.

## Web Goal (Targets) · The narrative page · STRONG
Section flow (the answer → the path → the work → the record → the calendar, TargetsView.tsx:4-24) is the best-structured page in the product, and the only one that reads like an editorial layout rather than a dashboard. The gap is the visual hero (goal time 1, projection band 2). The CI band renders honestly with "where today's fitness lands" (TargetsView.tsx:383-404). The status ladder's "You are here" (471-530) is genuinely original coaching UI. Keep all of it.
Residual nits: the VDOT sparkline is 120×40px (VdotSparkline, TargetsView.tsx:544-546) — at that size a 6-week trend is texture, not reading; double its width and add start/end value labels per the brief's chart rules. And the GapPanel decomposition's segment labels vanish under 9% share (GapPanel.tsx:567) with no legend fallback — fine for the bar, but the section needs each component named in the rows below regardless of share.

## Web Goal · Page identity crisis · INCONSISTENT
**What's wrong:** Tab label "Goal" (Sidebar.tsx:21) → route `/races` → ViewKey `targets` → page header "Race" when a goal exists and "Goal" when it doesn't (TargetsView.tsx:47 vs 102).
**Why it matters:** Three names + a state-dependent title for one surface. Users build mental URLs; this page refuses to have one.
**Fix:** It's "Goal" everywhere: header always "Goal", route `/goal` (redirect `/races`), ViewKey rename when convenient.
**Effort:** 1 hour (header), half day (route). **Priority:** CIM.

## iPhone Today · The workout is in the basement · BROKEN
**What's wrong:** Pre-run hierarchy: greeting header → THIS WEEK strip → readiness panel (108pt ring + 24pt headline + WHY rows + six stat chips, TodayReadinessPanel.swift:194-289) as the hero — while today's actual prescription lives in a **200pt-tall collapsed peek at the bottom of the screen** (DragSheet, TodayView.swift:497-516). Web Today makes the *workout* the hero and readiness a 56px chip. Same brand, opposite answer.
**Why it matters:** C1's iOS inventory is explicit: the composite hero is "recovery score, today's workout, or race countdown — *whichever is the moment's hero*." iPhone hardcodes readiness as hero every single morning. On a tempo Tuesday the 2-second glance answers "you slept 7h" instead of "TEMPO · 6mi @ 6:59 · before 7am." That's the wrong answer to the surface's one job.
**Fix:** Make the iPhone hero state-driven like the web's: quality-day mornings lead with the workout card (readiness compresses to ring-chip in the header); pull-back/rest days lead with readiness. The DragSheet stays as the detail layer.
**Effort:** 2–3 days. **Priority:** AFC — this is the daily surface.

## iPhone Today · Six equal chips, one of them is VO₂ MAX · WEAK
**What's wrong:** The chip grid is LAST NIGHT / THIS WEEK / VO₂ MAX // BEST WINDOW / TO RACE / NEXT HARD, all equal weight (TodayReadinessPanel.swift:276-289), each rendering "—" when absent.
**Why it matters:** VO₂ MAX moves monthly; it has no business on a *daily* glance surface — it's the definition of a number that doesn't earn its place. TO RACE — per the brief, the top motivator — is buried at position 5. And on a fresh install the panel renders six em-dashes: a dashboard of dashes.
**Fix:** Order by daily utility: TO RACE / NEXT HARD / BEST WINDOW // LAST NIGHT / THIS WEEK. Drop VO₂ MAX to Health. Chips with no data don't render (the grid reflows; brief: don't render empty beats).
**Effort:** 1 hour. **Priority:** AFC.

## iPhone Today · The white sheet · BROKEN (as a brand decision nobody made)
**What's wrong:** The DragSheet body is `Color.white` with white section cards (TodayView.swift:506-512), and the shoe picker is "cream bottom sheet per design package #3" (TodayView.swift:613). Theme.swift's own header: "Single dark skin (no Paper revert in v3)" (Theme.swift:10).
**Why it matters:** The brief's first commitment is "Dark theme. The brand commits to this on every surface." The single most-touched surface on the daily companion is a white page. Maybe the paper-briefing idiom is *good* — it does create a "morning briefing card" feel — but it currently exists in direct contradiction to both the brief and the codebase's own doctrine comment, and nothing else in the product follows it (web drag-equivalents are dark). This is the largest single same-app-different-app moment in the product.
**Fix:** Decide explicitly. (a) Dark sheet: recolor to `Theme.card` + existing dark card idioms — 1 day. (b) Canonize "paper briefing" in brief v2 with rules for when paper is allowed (sheets only, never pages) and bring web's WorkoutDetail overlay along. My vote: (a). The dark mesh peeking around a white sheet reads as two apps stacked.
**Effort:** 1 day. **Priority:** AFC.

## iPhone Train · 60pt phase word · STRONG (with one condition)
The `.display(60, weight: .bold)` phase word (TrainView.swift:179) mirrors web's 66px `.t-ptitle` — cross-surface consistency done right, and BASE/BUILD/PEAK/TAPER is exactly the one-word answer to "where am I in the arc." It earns the weight *because* the ramp and focus line sit directly under it. Keep. Condition: it must never render "—" at 60pt (TrainView fallback when no phase) — a 60pt em-dash is a billboard for "we have no idea." Cold-start should swap the whole block for the plan-builder CTA.

## Watch · See Attack 4. iPhone Health · WHAT TO DO card exists and leads correctly (HealthView.swift:267-273) — the web should copy its own phone.

---

# ATTACK 4 · THE WATCH FACES

## System · NumberFace grammar · STRONG
On the record: FaceKit is the most disciplined piece of design engineering in this codebase. One locked recipe (rows fill top→bottom, uniform derived gaps, labels ride the *measured* OS clock baseline — FaceKit.swift:160, per-glyph LSB compensation tables at 247-260, em-dash width traps documented at 262-280), role-based color grammar (live/goal/dist/neutral/over/rest/bonus), every face a parameterization. The "distance is always blue" rule is the kind of dumb-simple invariant that makes a system learnable at 180bpm. Whoever locked this knew exactly what they were doing. It is better than Apple's own Workout app in information discipline.

## All faces · Hierarchy is color-only; size never votes · WEAK
**What's wrong:** Every big row shares one computed glyph size (FaceKit layout equation; "big numbers always need the approved line spacing. always." FaceKit.swift:313-317). On WorkIntervalFace that's four equal numbers + label + strip (Faces.swift:94-105).
**Why it matters:** At 0.5-second glance with sweat in your eyes, position+color does carry it *if* you've learned the grammar — but row 1 (live pace) is objectively the only number that can change your behavior this second. Four equal rows tax the glance to find it.
**Fix:** Don't break the locked gap math — instead allow a single `emphasis` row whose glyph gets +18% while others derive smaller. Live pace gets it on every active face. (If David's "NEVER space things out" lock extends to size, then at minimum dim non-actionable rows to 0.72 opacity — the grammar already has `.mute`.)
**Effort:** 1 day in FaceKit. **Priority:** CIM.

## TempoFace · 11 seconds slow requires mental subtraction · WEAK
**What's wrong:** Live 7:28 over target 7:17 renders as two same-size stacked times; the only "you're slow" signal is the live row's drift color (Faces.swift:213-235).
**Why it matters:** The color says *that* you're off; the magnitude — the thing that decides "surge or be patient" — demands subtracting two mm:ss numbers mid-threshold. Garmin's pace screens print the delta for exactly this reason.
**Fix:** Row 2 becomes the signed delta (`+0:11`, role-colored), target moves to the top label ("TEMPO · 7:17 · ♥149"). One glance, zero arithmetic.
**Effort:** 2 hours. **Priority:** AFC — this is mid-race-relevant for AFC tune-ups.

## EasyFace · The ceiling behavior · STRONG / one gap
The rotating guardrail (HR ↔ cadence, 60s engine-driven rotation) with **red override that holds** when HR breaches the ceiling (Faces.swift:154-186) is exactly right — the alert can't be swiped away or missed. The gap: the ceiling *value* is never on the face — the runner sees live HR turn red but not the number to get back under. The user's question "should `<144` be visual?" — it already is; what's missing is the 144. **Fix:** breach state shows "152 / 144" or appends the cap to the top label ("EASY · <144"). 1 hour. Priority: CIM.

## WorkIntervalFace · Rep 3 of 4 decision support · STRONG
Live pace (drift-colored) + HR-replaces-distance on quality reps with floor reference in the label ("REP 3/4 · ♥162+", Faces.swift:59-91) + time-left + strip = push/hold is answerable in one glance. The HR-for-distance swap is a genuinely smart prioritization. No fix.

## Post-run summary · Receipt without a verdict · WEAK
**What's wrong:** CompleteFace = type label + pace/distance/elapsed/HR rows (Faces.swift:754-801); the rep ladder lives on page 2 (SummaryView.swift:179-224). No HIT / CLOSE / MISSED anywhere on the wrist.
**Why it matters:** The runner's first post-stop question is binary: did I do the thing? The phone answers it with verdicts; the watch — the screen actually in front of them at the moment of maximum curiosity — answers with a CSV row.
**Fix:** Top label becomes the verdict, colored (`HIT · THRESHOLD` in live-green / `CLOSE` amber / `OFF` warn), computed from the same plan-vs-actual the phone already gets. Numbers stay. Rep ladder is adequate at watch scale (number + per-rep bar) — leave it.
**Effort:** half day (verdict already computable server-side). **Priority:** CIM.

## Watch non-run surfaces · Second design system · INCONSISTENT
**What's wrong:** ReadinessGlanceView / TreadmillHRView / WorkoutRootView run WatchTheme (Bebas display, `#2CA82F/#D4900A/#E85D26`) while every face runs FaceKit (HelveticaNeue-Bold, `#3EBD41/#F3AD38`). WatchTheme.swift:6 claims "the same semantic hues as the phone" — none of its four hues exist on the phone.
**Why it matters:** A runner goes glance → lobby → run → summary and crosses a brand boundary twice, on a 44mm screen.
**Fix:** Port the three WatchTheme consumers to FaceKit roles + fonts; delete WatchTheme.C.
**Effort:** 1 day. **Priority:** CIM.

---

# ATTACK 5 · MOTION

## Web · The mesh is alive and budgeted · STRONG
Blobs drift on 22–30s loops with a 17s breathe, freeze when Today isn't the active view (globals.css:59-60), collapse to a static gradient under `prefers-reduced-motion` (64-67), cross-fade all six stops over 0.7s on day re-theme, and the whole field desaturates over 0.55s when a day is skipped. That last one — the world literally draining color when you skip a run — is the most emotionally intelligent motion in the app. Keep all of it.

## All surfaces · No motion scale · WEAK
**What's wrong:** Durations in the wild: 0.11, 0.12, 0.15, 0.18, 0.22, 0.3, 0.35, 0.36, 0.42, 0.5, 0.55, 0.6, 0.7s. iPhone *has* tokens (Theme.Motion, Theme.swift:69-80) and views still freelance (`easeInOut(0.22)` RootTabView.swift:136, `easeOut(0.22)` SignInView, 0.6 ring ease TodayReadinessPanel.swift:350).
**Why it matters:** Motion timing is a voice. Thirteen durations is mumbling.
**Fix:** Four tokens everywhere: tap 0.12 / state 0.22 / sheet 0.42 / mesh 0.7. Web gets them as CSS vars; lint inline durations.
**Effort:** half day. **Priority:** polish.

## Web · View switches are hard cuts · WEAK
**What's wrong:** Shell view swaps and iPhone tab swaps render instantly (`Tab swap is instant… matches the design's hard-cut behavior`, RootTabView.swift:105-107); on web the mesh cross-fades but content pops.
**Why it matters:** Defensible as a "snappy" doctrine — but combined with five-views-share-one-charcoal-mesh, switching Today→Train on web produces *zero visual acknowledgment* anywhere except the sidebar pill. Disorienting in the exact opposite way slow transitions are.
**Fix:** 120ms content fade-up on view entry. Nothing fancier.
**Effort:** 1 hour. **Priority:** polish.

## Loading states · One charming, the rest missing · INCONSISTENT
**What's wrong:** The coach card has a genuinely branded loader ("COACH · HAVING A FAFF" + pulse + shimmer bars + 3s fallback — BriefingLoader). Then: run summary = raw "Loading run…" text (TodayView.tsx:950); Health/Activity charts = nothing (content pops in); **iPhone cold start = an empty void** (`case .checking: Color.clear` while the gate decides — FaffApp.swift:202-203, which renders as a black screen on the dark window) with no wordmark; watch pace pre-GPS = "—:—" (correct, locked grammar).
**Why it matters:** First frame of the iPhone app, every launch, is `#000000` nothing. That's the brand's opening note.
**Fix:** Cold-start gate shows bg + brandmark sweep (the asset already exists and animates). Run-summary text → 3 shimmer rows reusing BriefingLoader's bars. That's the whole standard: shimmer for cards, brandmark for gates.
**Effort:** half day. **Priority:** AFC (the black void), polish (the rest).

---

# ATTACK 6 · EMPTY STATES

## Web · Routes as copy · BROKEN
**What's wrong:** "Pick a primary race on /races" (Today tile, TodayView.tsx:4484/4516; Train projection, TrainView.tsx:1023).
**Why it matters:** A URL path in user-facing prose is developer voice leaking through coach voice — and `/races` isn't even what the tab is called (it's "Goal").
**Fix:** "Pick a goal race →" as an actual link/button that opens the New Goal sheet directly.
**Effort:** 1 hour. **Priority:** AFC (it's on the default Today for any new user).

## Web Health · "no data yet" whisper · WEAK
**What's wrong:** Metric tiles render 10px, 60%-opacity "no data yet / trend builds with daily syncs" (HealthView.tsx:191-193) — honest, but inert: no link to connect Apple Health, no differentiation between "never synced" and "sync broken."
**Fix:** Empty tiles get one shared CTA row above the grid: "Connect Apple Health to light these up → " (deep-links the iPhone flow). 2 hours. **Priority:** CIM.

## iPhone · Dashboard of dashes · WEAK
**What's wrong:** Fresh-install Today can show six "—" chips simultaneously (every StatChip falls back to "—"), plus "—" rows on the watch LobbyFace when no workout is loaded (the lobby renders dash rows with no "Rest day — nothing scheduled" message).
**Why it matters:** The brief: don't render empty versions of beats with nothing to say. A grid of em-dashes is the app shrugging at you six times.
**Fix:** Chips hide when valueless (grid reflows); watch lobby with no workout renders the JustRun face as primary instead of a dash lobby.
**Effort:** 2 hours. **Priority:** CIM.

## The good ones · STRONG
For the record, these are *right*: GuestPanel's per-view sign-in copy (Shell.tsx:362-409 — honest, specific, no fake data); "No structured spec for this run yet."; "No matched run yet for this day."; readiness `BUILDING BASELINE` instead of a fake score (HealthView.tsx:519-521); the 7-day label that honestly shrinks to "3-DAY READINESS" with partial data (HealthView.tsx:636-642); the physiology nudge card that fires after 3 days instead of nagging at minute one (TodayView.tsx:129-160). This app is unusually honest about absence. Protect that.

---

# ATTACK 7 · RESPONSIVE & EDGE

## Web · Breakpoints exist; heroes don't scale · WEAK
**What's wrong:** The breakpoint set is real (1180/980/960/880/680/640/380 — tiles 2-up at 960, sidebar→top strip at 680, week strip 2-col). But `.hero-v2 .htitle` is a fixed 62px and `.ptitle` 66px at every width; only RaceDayHero went fluid (`clamp(64px,17vw,112px)`, TodayView.tsx:4384).
**Why it matters:** At 375px, a 62px Oswald title + 3-col stats grid is cramped; the one component that solved it (race hero) proves the team knows the fix.
**Fix:** `clamp(40px, 8vw, 68px)` on `.htitle/.ptitle/.cdbig`; audit the 3-col `.stats` to 2-col under 640.
**Effort:** 2 hours. **Priority:** polish (web is desktop-first by spec; phone-width web is a courtesy).

## iPhone · Zero Dynamic Type · BROKEN (accessibility)
**What's wrong:** Every font is a fixed point size via `Font.custom` (Fonts.swift); no `relativeTo:` anywhere. Accessibility text sizes change nothing.
**Why it matters:** This is a runner's app — a 50-year-old marathoner with reading glasses off mid-morning is your *core* demographic, and iOS's one system-wide accessibility lever does nothing.
**Fix:** `Font.custom(_:size:relativeTo:)` mapping in the three helpers (display→.largeTitle, body→.body, label→.caption); spot-check the four layout-critical surfaces with AX1–AX3.
**Effort:** 1–2 days incl. layout fixes. **Priority:** CIM.

## iPhone · Dark-only, confirmed · polish
`preferredColorScheme(.dark)` is enforced (FaffApp.swift:31). Light mode doesn't exist and would break everything if unlocked. That's *consistent with the brief* ("the app is dark") — fine — but document it in brief v2 so nobody "fixes" it.

## Watch · Geometry-derived layout · STRONG
Every size is a fraction of screen H with measured constants per device class (FaceKit). This is how all three surfaces should think.

---

# ATTACK 8 · THE LANGUAGE

## Voice overall · STRONG
The copy corpus is the most on-contract part of the product: zero exclamation marks, zero emoji, zero em-dashes in user copy, no corporate-speak, honest guardrails ("Slower than feels right is correct", "Don't freelance", "When's the gun?"). The coach reads like a coach. Three leaks:

## Post-race chips · "CRUSHED GOAL" · BROKEN (voice contract)
**What's wrong:** `CRUSHED GOAL` chip (PostRunCheckinChips.tsx:125) and "Goal crushed…" / "Crushed it and gave everything…" canned replies (checkin-reply-canned.ts:75,77).
**Why it matters:** "No 'crushing it'" is verbatim in the brief's banned list. It's the only hype leak in ~300 strings — which is exactly why it sticks out.
**Fix:** "BEAT GOAL" / "Goal beaten with room to spare. That's a level shift." **Effort:** 15 min. **Priority:** AFC (it fires after races).

## Errors · Status codes and dead ends · BROKEN
**What's wrong:** "HTTP 403" surfaces raw (StravaPushButton.tsx:95), "Failed: {raw error}" (RaceRetrospectiveForm.tsx:128), "Couldn't reach the reconnect endpoint" (ReconnectBanner.tsx:105), bare "network error" (InlineGapEditor, RunDetailModal), "Something went wrong" with no action (Step3Confirm.tsx:110).
**Why it matters:** The coach persona dies the instant it says "endpoint." Every error needs a next move.
**Fix:** One `friendlyError()` helper (the pattern already exists — `friendlyAcceptError`, TodayView.tsx:1382-1388 — it's just not used everywhere). Map all failures to: what happened in plain words + the action ("Couldn't save. Check your connection and try again.").
**Effort:** half day. **Priority:** CIM.

## Jargon · Z-lanes and LOADED unexplained · WEAK
**What's wrong:** The SessionBlueprint Y-axis is Z1–Z5 with no explanation anywhere on the surface (TodayView.tsx:1092-1104); the form label vocabulary (LOADED/PRODUCTIVE/OVERREACH…) is explained on the Today tile helper but surfaces bare elsewhere (iPhone `formLine`). VDOT/HRV/LTHR/ACWR are properly glossaried with WHY buttons — the infrastructure exists, these two just never got entries.
**Fix:** Z-lane tap → glossary ("Z4 · comfortably hard, threshold"); add LOADED-family glossary entries. **Effort:** 2 hours. **Priority:** polish.

## Punctuation · The middot is doing four jobs · polish
`·` is the metadata separator ("6.2 mi · 8:40"), the sentence splice ("Running hot · Productive but watch sleep"), the empty placeholder (" · "), and a decorative bullet. As a *separator* it's a nice brand tic; as an em-dash substitute mid-sentence it produces case errors the codebase literally has a brief about (sentence-case-after-middot, TodayView.tsx:4564-4567). Rule for brief v2: middot separates data fragments; periods separate clauses; placeholder is "—". Sweep later.

---

# ATTACK 9 · THE FIRST IMPRESSION

## iPhone onboarding · STRONG, with a void in front of it
The three steps are confident and honest: "Bring your history in." → real Health/Strava connects with truthful per-source states (no fabrication — verified, the connect states map to actual importer state, OnboardingView.swift:214-230) → "What are you chasing?" with "When's the gun?" → "A bit about you. … Skip anything you'd rather not share." That's a premium voice and a 3-minute path. Two failures around it:
1. **The first frame of every launch is pure black** (RootContainer gate) — covered in Attack 5, but it matters most here: before the app says "WELCOME TO FAFF·RUN" it says nothing at all.
2. **Web first impression is a wall**: every view renders sign-in copy ending "WEB SIGN-IN COMING SOON… sign in on the iPhone app" (Shell.tsx:398-405). Honest, but it means the web's first impression for any evaluator is a 48px Oswald apology. If web sign-in isn't shipping soon, this screen at least deserves the product's visual best — mesh + brandmark + one real screenshot — instead of text floating in void.

## Main app first-sight · the "this is good" and the "hmm"
First good moment: the hero card's effort gradient over charcoal with an Oswald verdict — unmistakably *this* product. First "hmm": the pre-hero banner gauntlet (Attack 3) and four equal tiles — the moment it stops feeling like a coach and starts feeling like a dashboard. Second "hmm": sidebar purple/blue (Attack 1). The fixes are already filed above; first impressions inherit them.

---

# ATTACK 10 · THE COMPETITIVE AUDIT

**Where Faff beats them all:** voice and narrative. Garmin Connect is a widget warehouse; TrainingPeaks is a spreadsheet wearing a chart; Strava is a social feed with training bolted on. None of them can render "Your HM PR is 1:34. The goal is 1:30 · a 4:12 gap, about 19s/mi. That's the distance the build is built to close." (TargetsView anchorline). The Goal page's answer→path→work structure, the status ladder's "You are here," the drift-signal evidence rows — no competitor has a *story of the goal*, and that page is the product's crown jewel. The watch's role-color number grammar is also cleaner than Garmin's data fields or Apple's Workout rings.

**What to steal:**
- **From Garmin:** the printed pace *delta* on target screens (filed: TempoFace fix) and the one-word training-status chip with a stable legend. Garmin also labels every chart axis; Faff's bare sparklines (VDOT 120×40) under-inform by comparison.
- **From TrainingPeaks:** the actual PMC chart. Faff compresses CTL/ATL/TSB into a ±delta donut (Today FORM tile) — power users training for CIM deserve the 90-day fitness/fatigue/form line chart on Health, which C1 already lists as a "should" (item 22). A number-with-delta is right for Today; the *chart* belongs on Health and is currently nowhere.
- **From Strava:** the run card. Faff's Activity rows are utilitarian text; Strava leads every run with the route shape. Faff *has* polylines (RouteMap on web run detail) — putting a small route thumbnail on Activity rows and the iPhone run feed would close most of the "feels less premium than Strava" gap for logged runs.

**What's genuinely original here:** the effort-temperature system (one hue family per effort, mesh as weather), the skip-grayscale moment, the coach-voice verdict lines on every surface, and the watch grammar. These are the brand. Everything in this report is about clearing the noise *around* them.

---

# THE VISUAL SCORECARD

| Surface | Hierarchy | Consistency | Readability | Emotional register | Polish |
|---|---|---|---|---|---|
| Web Today | 6 | 5 | 7 | 7 | 6 |
| Web Train | 7 | 6 | 7 | 7 | 6 |
| Web Health | 5 | 6 | 6 | 6 | 6 |
| Web Goal | **8** | 7 | 7 | **8** | 7 |
| Web Activity | 6 | 6 | 6 | 5 | 5 |
| iPhone Today | 4 | 4 | 6 | 6 | 5 |
| iPhone Train | 7 | 6 | 7 | 7 | 6 |
| iPhone Health | 7 | 6 | 6 | 6 | 6 |
| Watch · in-run | **9** | 8 | **9** | **9** | 8 |
| Watch · non-run | 6 | 4 | 7 | 7 | 5 |
| **Cross-surface (one app?)** | — | **3** | — | — | — |

That bottom-right 3 is the whole story. Individually, four surfaces are a 7+ product. Collectively they are three apps that share a logo.

---

# THE ONE THING

**One meaning, one color, one source — lock the effort-temperature scale as the only color authority in the product.**

Not a refactor of everything; one decision: the effort scale (recovery cyan → easy teal → long amber → tempo orange → intervals coral → race ember) plus three status colors (good `#3EBD41`, watch `#F3AD38`, off `#FC4D64`) and gold for PRs is the *entire* permitted palette, identical hex on web, iPhone, and watch, and everything that isn't one of those ten colors is a neutral. That single act kills the 24 oranges, the 14 greens, the orange-means-failure tile, the two-green watch, the purple sidebar, the red iPhone Targets tab — and it does it by strengthening the one visual idea this brand owns that Garmin, Strava, and TrainingPeaks don't: **color = effort temperature**. Write it in brief v2, mirror it byte-for-byte into Theme.swift and FaceKit, and add the CI check that fails the build when a hex appears outside the table.

# HONEST VERDICT

**Race day on the wrist: yes, today.** The watch in-run experience is genuinely world-class — I'd put NumberFace's discipline against anything Garmin ships, and I'd race a marathon on it tomorrow. Fix the tempo delta and the summary verdict and it's untouchable.

**The app as a primary training tool: almost — the bones are right and the voice is right, and both are rare.** The state-driven Today heroes, the Goal page's narrative, the honesty of the empty states — those are the hard parts, and they're done. What's not done is the part that's supposed to be easy: agreeing with yourself. Three palettes, five typefaces, two label grammars, opposite hero doctrines on web vs iPhone, a white sheet in a dark brand, a brief nobody updated. A competitive runner will trust this app's *advice* immediately and its *craft* incompletely — and on race morning, trust is the product.

What would make me proud to show a designer I respect: brief v2 written from the as-built truth, the ten-color lock, the iPhone Today hero made state-driven, WHAT TO DO leading Health, and the banner gauntlet capped at one. That's roughly three focused weeks. The result wouldn't just survive that designer's scrutiny — the Goal page and the watch would make them jealous.

---

## APPENDIX · FIX LIST BY PRIORITY

**AFC (do now):**
1. Brief v2 + ten-color lock (Attack 1 headline + One Thing)
2. iPhone Today: state-driven hero; workout leads on quality days (A3)
3. iPhone Today: white DragSheet → dark, or canonize paper (A3)
4. Web Health: WHAT TO DO into the hero band (A3)
5. Web Today: cap pre-hero banners at one; hide week strip on race morning (A3)
6. Off-track ≠ race orange; DETRAINING ≠ LOADED amber (A1)
7. iPhone Targets mesh off red; iPhone meshes synced to v3/race (A1)
8. TempoFace signed delta row (A4)
9. "CRUSHED GOAL" → contract-clean copy (A8)
10. "/races" route-as-copy → real CTA (A6); iPhone chip grid reorder, drop VO₂ MAX, hide empty chips (A3)
11. iPhone cold-start black void → brandmark gate (A5)

**CIM (before December):**
Type ladder + eyebrow tracking + label grammar unification (A2) · gap-viz canonicalization on ProjectionBand (A3) · tiles 4→3 + FORM diverging bar (A3) · watch verdict + ceiling value + WatchTheme retirement + emphasis row (A4) · Dynamic Type (A7) · friendlyError everywhere (A8) · zone palette merge, hex-lint sweep, sidebar de-branding, Goal page naming (A1/A3) · Health empty-state CTA (A6).

**Polish:** motion scale tokens · view-entry fade · Oswald ≥16pt rule · body-tile hierarchy · Z-lane glossary · middot doctrine · fluid web heroes · Strava-style route thumbnails on Activity · PMC chart on Health.
