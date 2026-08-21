# Apple Watch · design brief

For the designer. Written 2026-08-21 against the code as it actually stands, not
against what we wish were there.

The watch is the **execution layer**. The phone is the daily companion and the
web is the command centre; the watch exists for the moments when someone is
running and cannot think. Everything below follows from that.

---

## 0 · One decision I need from David before you start

**The gradients are a phone language, and the watch is governed by a different,
locked brief.**

`Design/running-app-design-brief-v2.md` governs web and watch. It specifies a
ten-colour palette that is byte-identical across surfaces and **forbids orange**.
CI enforces it — `scripts/check-palette-sync.sh` fails the build if the watch
palette drifts. The iPhone v5 design (pure black, signal orange `#FF5A1F`, six
day-state gradients) explicitly supersedes brief v2 **for the phone only**.

So "use our gradients on the watch" is a real amendment to a locked brief, not a
styling choice. David should make it deliberately.

**My recommendation, and I think it is the strongest version of what he asked
for:** put the gradient on the **lobby / start face only** — the one screen a
runner looks at while standing still, before anything begins. Then true black
for every face during the run. That gets you:

- The brand moment where there is time to notice it.
- No OLED cost during the part that drains the battery. On an OLED panel a black
  pixel is an off pixel; a full-screen gradient held for 90 minutes is not free.
- No fight with the Always-On display, which dims everything and would turn a
  considered gradient into grey mud.
- Maximum contrast for the numbers that matter, which is the entire job of every
  other face.

If David wants the gradient during the run too, that is his call to make — but it
needs a brief v2 amendment and a documented exemption in the palette gate, and I
will need to know so I can wire it. **Do not design a gradient run face until he
has said yes.**

The six day-state gradients are defined in
`native-v2/Faff/Faff/DesignV5/TokensV5.swift` and rendered by `PanelV5.swift` —
oklab-interpolated, with a fixed-seed grain layer at 0.085 amplitude. If the
lobby gradient is approved I will port that renderer, so you can design against
the phone's exact gradients rather than approximations.

---

## 1 · What the watch is for

One thing at a time, at arm's length, at running cadence, in the rain, with a
heart rate of 170.

- **A face answers one question.** What am I doing right now, and am I doing it
  right. Everything else is a different face.
- **Glance, not read.** If it takes a second look, it has failed.
- **The runner does not navigate.** The workout drives the faces; taps are for
  the two or three things a runner actually does mid-run.
- **Never scold.** A missed target is stated, not judged. Coach voice applies
  here exactly as it does on the phone: short, direct, no hype, no exclamation
  marks, no emoji, no em dashes.

---

## 2 · Apple's constraints — these are not negotiable

Design to these or the app gets rejected, or worse, works badly on a wrist.

**The system owns the top-right corner.** The clock is drawn there during almost
everything and cannot be moved. Nothing important goes near it.

**Always-On is a separate design, not a dimmed one.** On Series 5 and later the
screen stays on with the wrist down, redrawing far less often. Design an explicit
Always-On state for every run face: assume it may be a minute stale, so a
seconds-ticking timer is a lie in that state. Decide what stays true when it is
stale — elapsed minutes, distance, the current interval — and what disappears.

**Respect the curved corners.** Content that runs to the edge gets clipped by the
bezel radius. Apple gives us a container shape that follows it.

**The Digital Crown scrolls; there is no force touch.** It was removed in
watchOS 7. Any design that hides an action behind a long press needs to justify
it — a runner will not find it.

**Tap targets are for a moving wrist.** Full-width rows. Nothing that needs
precision. Assume gloves and sweat.

**Sizes.** 40 / 41 / 42 / 44 / 45 / 46mm, plus the 49mm Ultra. They share
roughly one aspect ratio, so we author once and scale — see §5, which has a
problem you need to know about.

**Type.** SF Compact is Apple's watch face and it is drawn specifically for this
screen at these sizes. We currently bundle Bebas Neue, Inter and Oswald. See §5.

---

## 3 · The fleet — 23 faces already exist

This is a **redesign of a working fleet**, not a greenfield. Everything below is
built and shipping in `legacy/native/Faff/FaffWatch Watch App/Faces.swift`. The
three you design first (§6) set the language; the rest ripple.

**Before the run**
`LobbyFace` · `CalibrateFace` · `TodayDoneFace`

**Running — the steady states**
`EasyFace` · `SteadyRunFace` · `TempoFace` · `ProgressionFace` · `JustRunFace`
`HRFace` · `LiveRaceFace`

**Running — the structured states**
`WarmupFace` · `WorkIntervalFace` · `RestFace` · `StridesFace`

**Interruptions and moments**
`GoFace` · `CountdownView` · `PhaseChangeFace` · `HeadsUpFace` · `MileSplitFace`
`LandmarkFace` · `FuelFace` · `LivePauseFace`

**After**
`CompleteFace` · `SummaryView`

Two locked layout rules the current faces already follow, and which I would keep
unless you have a strong reason:

- The small top label sits on the **OS clock's baseline**, so the app's own
  eyebrow and the system time read as one line.
- `TOP_MARGIN == BOTTOM_MARGIN`, with the big rows and their gaps derived from
  what is left. It is what stops the faces looking like they slid up the screen.

---

## 4 · The treadmill ask — what the hardware can actually give

David wants the watch running during a treadmill session, tracking heart rate and
cadence "and anything else we can". Here is the honest state of it.

**What happens today.** When the phone runs a treadmill session it opens a
heart-rate bridge to the watch and pings a dead-man timer every two minutes. That
bridge collects **heart rate only**. The watch's own workout tracker collects
four things: heart rate, distance, active energy, and running speed. **Cadence is
not captured anywhere.**

**There is also a bug**, which an engineer is fixing now: a run started on the
watch is always recorded as an *outdoor* workout, even on a treadmill. That
matters beyond labelling — HealthKit treats indoor and outdoor running
differently, indoor leaning on the accelerometer rather than GPS.

**What the hardware can give us on an indoor run.** Subject to engineering
confirming the deployment target and which models qualify, an indoor running
session can offer: heart rate, cadence (step rate), estimated distance from the
calibrated accelerometer, active energy, and on newer watches the running-form
family — running power, stride length, ground contact time, vertical oscillation.

**So the design question for you** is not "can we show cadence" — it is *which of
these earns a place on a treadmill face, and which is noise*. My instinct: heart
rate and cadence are the two a runner can act on mid-run, and everything else
belongs in the summary afterwards. But that is exactly the call I want a designer
to make rather than an engineer.

Design a treadmill face on the assumption that heart rate and cadence are live,
and tell me what else you want; I will come back with what is actually available
on which watch.

---

## 5 · Two things in the current build you should know about

**The uniform downscale.** Every face is authored once at Ultra size (205 × 251
points) and scaled uniformly to fit smaller watches — about 0.95 on a 45mm, 0.86
on a 41mm, **0.79 on a 40mm**. It was the right call at the time: it killed a
whack-a-mole of per-device tweaks and it guarantees the proportions you approve
are the proportions that ship.

The cost is that type shrinks with everything else. Something authored at 16pt
lands near 12.6pt on a 40mm. If the design leans on small labels, they will be
small on the smallest watch. Either design to survive 0.79, or tell me you need a
type floor that does not scale, and I will build one.

**The custom typefaces.** We bundle Bebas Neue for display, Inter for body,
Oswald for sub-labels. They are the brand and they look right at hero sizes. But
SF Compact exists because Apple drew a face specifically for reading small text
on a small screen at a glance, and none of ours were. My recommendation: keep the
custom face for the **hero number only** — the one enormous figure per face — and
move every label, unit and secondary row to SF Compact. If you disagree, say so;
it is a real design argument and I would rather have it now than after the fleet
ships.

---

## 6 · What I want first — three faces, then the ripple

Design these three and we approve the language before anything ripples.

**1 · The lobby.** The one screen with time to be beautiful. The runner is
standing still, about to start. This is where the gradient goes if David approves
it (§0). It has to carry: what today's session is, and a start control that is
unmissable.

**2 · The steady run face.** The workhorse — `EasyFace` / `SteadyRunFace`. This is
the one a runner looks at two hundred times in ninety minutes. If it is right,
most of the fleet is right. **Deliver its Always-On state as a second board**,
designed rather than dimmed.

**3 · The work interval.** The densest state we have — `WorkIntervalFace`. Rep
number, target, current, time or distance remaining, and how it is going. If the
language survives this face it survives everything. This is where a design either
holds or collapses into a dashboard.

**Deliver each at Ultra 49mm (205 × 251 pt) as the reference**, since that is
what the build scales from, plus a 40mm rendering of each so we can both see what
0.79 does to it.

Once those three are approved, the ripple order is: the remaining steady states,
then the structured states, then the interruption moments, then before-and-after.

---

## 7 · What I need back

- The three faces above, at both sizes, plus the Always-On board.
- Tokens, not screenshots: every colour, size, weight and spacing as a value I
  can put in `WatchTheme.swift`. The phone's v5 handoff did this and it is why
  the phone build matched the design without a negotiation.
- Where you have deliberately broken a rule from brief v2, say so and say why, so
  I can either amend the brief or push back — silently diverging is the one thing
  that costs us a week later.
- Your answer on §5: the type floor, and SF Compact for labels.
- Your answer on §4: which treadmill metrics earn a place on the face.

Anything in the current build that is wrong, say so plainly. Twenty-three faces
exist; that is a reason to be careful about what we throw away, not a reason to
keep any of it.
