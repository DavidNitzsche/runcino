# Apple Watch · design brief

New app. Clean start. The only design language it inherits is the **iPhone v5
design** — the one approved 2026-08-19 and now shipping. Nothing from the older
watch work carries over: not its palette, not its typography, not its faces.
Treat what exists today as a prototype we learned from and are leaving behind.

Written 2026-08-21.

---

## 1 · What the watch is

The phone is the daily companion. The web is the command centre. **The watch is
the execution layer** — it exists for the ninety minutes when someone is running
and cannot think.

That gives it one design principle everything else follows from:

> A face answers exactly one question, at arm's length, at running cadence, in
> the rain, at 170 bpm. If it takes a second look, it has failed.

The runner does not navigate the watch. The session drives the faces. Taps are
for the two or three things a person actually does mid-run.

---

## 2 · The language it inherits

Straight from the v5 iPhone design. These are the real values, not
approximations — build against them.

**Ground and surfaces**

| Token | Value | Use |
|---|---|---|
| ground | `#000000` | Every running face. Pure black, OLED-off. |
| surface 1 | `#0F1011` | Raised sheet |
| surface 2 | `#17191B` | Tile |
| surface 3 | `#212427` | Raised tile |
| surface 4 | `#2A2E32` | Control |

**Accents** — orange is the accent on this surface, and that is deliberate. It
is what makes a faff screen recognisable at a glance.

| Token | Value | Meaning |
|---|---|---|
| signal | `#FF5A1F` | The live thing. Now. Start. |
| attention | `#F2B03C` | A modelled number, and the `~` mark that marks one |
| fault | `#FF4438` | Something is wrong |

There is **no green as a grade**. Nothing on this watch tells a runner they are
being good. Read that twice — it is the single most common thing a running app
does that this one does not.

**Text** — white at three tiers, and only three: `1.0` primary, `0.72`
secondary, `0.48` quiet.

**Plot ink** — white `0.62` for a drawn line, `0.16` for its track.

**The six day-state gradients.** Three stops at 135°, locations `[0.00, 0.76,
1.85]` — the third sits past 1.0 on purpose, so the visible window is the first
part of a longer ramp. Race alone moves its middle stop to `0.72`.

| State | Stops |
|---|---|
| easy | `#3EBD41` → `#1F8A52` → `#0F4A3A` |
| rest | `#008FEC` → `#4A3A8E` → `#1C1A3A` |
| quality | `#F3AD38` → `#E85D26` → `#7A2828` |
| race | `#FF8847` → `#E85D26` → `#7A2828` |
| long | `#27B4E0` → `#1A6A9E` → `#0C2A5E` |
| phase | `#B084FF` → `#6A4ACE` → `#2A1A5A` |

They are interpolated in **oklab**, not sRGB — sRGB creases visibly at the
midpoint. Every gradient panel carries a fine fractal-noise **grain** layer at
50% opacity in overlay blend, between the gradient and the type. The grain is
what keeps white type legible on the gradient without a scrim. **It is not
decoration and it must not be dropped.**

**Shape.** Radii 6 / 10 / 14 / 18 / 22 / 26, pills at 999, and 30 on the bottom
corners of a full-bleed panel.

**Type.** Instrument Sans for text; Archivo at weight 800 / width 112 for
display. Note for engineering: Archivo 800/112 is not a named instance — it is
reached through the variable-font axes.

---

## 3 · Where the gradients go, and where they do not

David asked for the gradients, and specifically wondered about the start screen.
That instinct is right and I want to make the case for holding it there.

**Gradient: the lobby, and the finish.** The two screens where a runner is
standing still and has time to look at something. Full bleed, grain on, exactly
as the phone draws it.

**True black: every face during the run.** Three reasons, all of them real:

- On OLED a black pixel is an off pixel. A full-screen gradient held for ninety
  minutes is a battery decision, not a styling one.
- The Always-On display dims everything. A considered gradient becomes grey mud
  and the numbers on top of it lose their contrast exactly when a wrist is down.
- Maximum contrast for the one number that matters is the entire job of a
  running face.

The gradient still gets to do work mid-run without covering the screen — a state
can be carried by a single edge, a rule, or the colour of one figure. That is
where I would like to see your thinking.

**Engineering consequence, so nobody is surprised:** the watch palette is
currently locked to an older ten-colour brief by a CI gate that forbids orange.
Moving the watch onto v5 means updating that lock. That is my job, not yours —
flagging it so the change is deliberate.

---

## 4 · Apple's constraints — non-negotiable

Design to these or it gets rejected, or worse, works badly on a wrist.

**The system owns the top-right corner.** The clock is drawn there and cannot be
moved. Nothing important goes near it.

**Always-On is a separate design, not a dimmed one.** On Series 5 and later the
screen stays lit with the wrist down and redraws far less often. Every running
face needs an explicit Always-On board. Assume it may be a minute stale — which
means a seconds-ticking timer is a *lie* in that state. Decide what stays true
when stale, and what disappears.

**Respect the curved corners.** Content run to the edge is clipped by the bezel
radius.

**The Digital Crown scrolls. There is no force touch** — it was removed in
watchOS 7. Anything hidden behind a long press will not be found by a runner.

**Tap targets are for a moving wrist.** Full-width rows, gloves, sweat, no
precision.

**Sizes.** 40 / 41 / 42 / 44 / 45 / 46mm plus the 49mm Ultra. They share roughly
one aspect ratio. Author at Ultra (205 × 251 pt) and we scale down — a 40mm lands
near 0.79, so **anything you set at 16pt renders near 12.6pt on the smallest
watch.** Either design to survive that, or tell me you want a type floor that
does not scale and I will build one.

**Typography, and a real argument.** SF Compact exists because Apple drew a face
specifically for reading small text on a small screen at a glance. Instrument
Sans and Archivo were not drawn for that. My recommendation: **Archivo for the
hero figure only** — the one enormous number per face, which is the brand — and
SF Compact for every label, unit and secondary row. If you disagree, say so; I
would rather have the argument now than after the fleet ships.

---

## 5 · The treadmill, specifically

David wants the watch live during a treadmill session, tracking heart rate and
cadence "and anything else we can". Here is the honest hardware position.

An indoor running session can offer: **heart rate**, **cadence**, estimated
distance from the calibrated accelerometer, active energy, and on newer watches
the running-form family — running power, stride length, ground contact time,
vertical oscillation. Engineering is confirming which of those need which watch;
design as though heart rate and cadence are certain.

The design question is not *can we show cadence*. It is **which of these earns a
place on the face and which belongs in the summary afterwards.** My instinct is
that heart rate and cadence are the two a runner can act on mid-run and
everything else is noise until they stop — but that is a designer's call, not an
engineer's. Tell me what you want on the face and I will tell you what we can
actually feed it.

One thing the treadmill face has that the outdoor faces do not: there is no GPS
and no route, so it has more room. Use it.

---

## 6 · The states the watch has to answer

Derived from the v5 phone, not from the old watch app. This is the fleet — but
design the three in §7 first and let the rest follow the language.

**Before**
· Lobby — what today's session is, and start
· Nothing today — a rest day, stated as a correct answer, not an empty screen
· Not this watch — the graceful refusal when the session is not one we execute

**Running · steady**
· Easy · Long · Steady / just-run · Treadmill

**Running · structured**
· Warm-up · Work interval · Recovery interval · Strides · Tempo / threshold
· Progression

**Running · race**
· Race, which is its own thing and should feel like it

**Moments — these interrupt a face, they are not faces you sit on**
· Countdown into a session · Go · Interval change · Mile or kilometre split
· Landmark · Fuel · Pause · Heads-up, when heart rate or pace has drifted

**After**
· Complete · Summary

Two rules that govern all of them, carried straight from the phone:

- **A modelled number must never look measured.** The amber `~` is the mark, and
  it is a system rule, not one screen's fix. If the watch ever shows a projected
  or estimated figure, it is marked.
- **A refusal is a correct answer, not an empty state.** A rest day is not a
  blank screen, and it must not look like the screen we show when we have lost
  the data.

---

## 7 · What I want first — three faces

Approve the language on these three before anything else is drawn.

**1 · The lobby.** The one screen with time to be beautiful. Standing still,
about to start. The gradient goes here. It carries what today's session is, and
a start control that cannot be missed.

**2 · The steady run face.** The workhorse — what a runner looks at two hundred
times in ninety minutes. If this is right, most of the fleet is right.
**Deliver its Always-On board as a second artboard**, designed rather than
dimmed.

**3 · The work interval.** The densest state we have: rep number, target,
current, remaining, and how it is going. If the language survives this face it
survives everything. This is where a running app either holds its nerve or
collapses into a dashboard.

Deliver each at **Ultra 49mm, 205 × 251 pt** as the reference — that is what the
build scales from — plus a **40mm** rendering of each, so we can both see what
0.79 does to it before we commit.

---

## 8 · What I need back

- The three faces, both sizes, plus the Always-On board.
- **Tokens, not screenshots.** Every colour, size, weight and spacing as a value
  I can put straight into the watch theme. The v5 phone handoff did exactly this
  and it is the reason the phone build matched the design with no negotiation.
- Your answer on typography: the type floor at 40mm, and SF Compact for labels.
- Your answer on the treadmill: which metrics earn a place on the face.
- Anywhere you think the v5 language is wrong *for a wrist*, say so and say why.
  It was drawn for a phone held still in a hand. Some of it will not survive
  contact with a moving wrist, and I would rather you tell me which parts than
  quietly bend them.
