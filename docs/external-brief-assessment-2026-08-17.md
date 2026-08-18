# Outside product brief · assessment

**Assessed 2026-08-17 against the shipped codebase, David's rulings from today, and his own
training data.** Not canonical. This is a read on someone else's document, kept so the take list
below is a work item rather than a memory.

---

## The headline

The brief was written cold, by an agent that had not seen the app. It independently proposes a
**four-model split — Athlete, Goal, Training, Response** — hours after David locked a
**three-model split — Fitness, Adaptation, Prescription** — arrived at from the opposite
direction, by auditing why his own block failed.

Those are the same architecture. Fitness ≈ Athlete, Adaptation ≈ Response, Prescription ≈
Training. Two independent processes converging on the same decomposition is real evidence the
decomposition is right, and it is the most useful thing in the document.

It also proposes, in §"Training principles":

> Progression can come from frequency, duration, volume, workout density, terrain, intensity, or
> specificity. These variables should not all increase simultaneously without a clear reason.

That is `lib/prescription/levers.ts`, committed today, including the one-lever-at-a-time rule.

**Where the brief is weak is not its principles. It is that it has no facts about us** — what we
have shipped, what David has ruled, and what his data has already disproved.

---

## 1 · Right, and already shipped

| Brief principle | Where it lives |
|---|---|
| Recommendation before evidence | `lib/today/composition.ts` — the session is beat 1 in every state |
| Avoid false precision ("67" vs a plain read) | `lib/fitness/fitness-model.ts` — fitness is a range with a confidence, never `1:38:17` |
| No single metric gets veto power | `lib/coach/readiness.ts` personal z-scoring; the adaptation model excludes unreadable dimensions rather than zeroing them |
| Pain and illness are not ordinary fatigue | Vetoes in `adaptation-model.ts` route to PROTECT; the injury protocol keeps its clearance gate |
| State drives composition | Locked in CLAUDE.md; race week and base week compose differently |
| Plans are hypotheses | `lib/plan/adapt.ts`, `race-lifecycle.ts` |
| Every session has a purpose | The "what it builds" line, shipped |
| Coach voice: no hype, no emoji, comfortable with uncertainty | `Design/coach-voice-brief.md`, David's own, and sharper than the brief's version |
| Evidence hierarchy with citations | The doctrine gate — 78 citations resolving against `Research/` at CI time |

---

## 2 · Right, and we do NOT do it · the take list

Six things worth building. Ordered by value.

### 2.1 · The five-part recommendation schema

> Action · Change · Reason · Consequence · Confidence

Our coach lines carry action and reason. They rarely carry **consequence** ("what this protects")
and almost never carry **confidence**. Both matter: consequence is what makes a cutback feel like
coaching rather than punishment, and confidence is what stops the app sounding certain when it is
guessing. This should become the output type every composer returns, not a style note.

### 2.2 · Readiness is specific to the intended stimulus

> A runner may be unsuitable for intervals but suitable for an easy run.

We treat readiness as one scalar against one baseline. This says the question is not "is he ready"
but "is he ready **for this**". It is a genuinely better formulation and it is compatible with the
locked informs-never-acts ruling: a stimulus-specific read still only speaks.

### 2.3 · Provenance and confidence on every fact

> known · reported · inferred · conflicting · missing, visibly distinguished

We do this in exactly one place (`anchorSource: 'provisional_mileage'`) and it is the same place
today's audit found the worst remaining leak: `conservativeVdotFromMileage` fabricates a VDOT from
weekly mileage at cold start, persists it as `season_anchor_vdot`, and it is then read back as an
anchor by three separate consumers — outliving the cold start that created it. Generalising
provenance is the structural fix for a defect we already have.

### 2.4 · Adjust the smallest necessary unit, with an explicit ladder

> today's session → the next few days → the week → the block → the goal

We have session-level adaptation and whole-plan rebuild, and very little between. The ladder is the
right frame and the middle rungs are missing.

### 2.5 · Ask only questions that could change the advice

David stopped answering check-ins in June because nothing came back. This is the principle that
would have prevented it, stated cleanly.

### 2.6 · Rules record what would cause them to change

The doctrine registry records the claim, the citation and the check. It does not record the
falsifier. Adding one line per claim — *what evidence would make this wrong* — is cheap and turns
the registry from a lock into an argument.

---

## 3 · Wrong

Three kinds, and the distinction matters.

### 3.1 · It thinks we are greenfield

> For the current workspace milestone, authentication, cloud sync, live health data, plan
> generation, external integrations, native apps, and production deployment remain out of scope.
> The preview uses typed local fixtures.

All of that is in production. David raced a half marathon on it yesterday and the app predicted his
finish to within seconds. The entire "Delivery and validation" section — first product slice, first
release, fixture-backed preview — describes a product we shipped months ago. **Discard it whole.**
Adopting it would be a large deliberate regression.

### 3.2 · It contradicts rulings David made today

- **Strength and cross-training** appear throughout — in the training model's adaptation list, in
  week construction, in the session taxonomy. Both were removed from all surfaces today. Discard
  those references.
- **"Recommendations are proposals. The runner can accept, edit, or decline."** This is the thing we
  tested and it failed. David went **0-for-52** on proposals he was asked to approve and **4-for-4**
  on repairs that auto-applied. Mechanical plan repairs now auto-apply with undo. Approval is not
  the control mechanism; reversibility is. The brief's principle is reasonable a priori and wrong
  against our evidence.
- **Readiness as a training decision.** The brief's own "no single metric gets veto power" supports
  David, but its readiness section drifts back toward readiness driving the plan. Locked ruling
  stands: readiness informs, never acts. His numbers back it — the old detector fired on 23% of days
  and was measuring a 41-year-old with two kids and a company, not overreaching.

### 3.3 · It proposes a navigation it has not earned

Today / Plan / Review / Athlete is a defensible IA and close to where we are heading. But it is a
third opinion, competing with our current five sections and with the outside design agency's brief,
which deliberately asks them to **challenge** the structure rather than inherit it. A nav proposed
by a document that has never seen the app should not pre-empt that work. Note the convergence; let
the design pass resolve it.

---

## 4 · Where we are ahead

The brief has no theory of **evidence versus time**. It says demand should increase only when recent
work has been tolerated — correct, and the same idea as our progression gate — but it never says the
sharper thing:

> Time passing, plan completion, or scheduled progression alone cannot increase or decrease
> demonstrated fitness.

That sentence is David's, locked this morning, and it is the deepest bug in the product. Two
violations of it shipped and were fixed today: a pace blend that walked threshold pace 40 s/mi
faster across a block on the calendar alone, and a downward re-anchor that let one bad race
overwrite a stable model. Neither is a failure the brief's framework would have caught, because it
treats progression and fitness as one axis.

It is also softer than us on two safety-adjacent points: it has no equivalent of the execution gate
(*you cannot earn more stress by not doing the work* — skip the sessions and every physiological
signal reads pristine, because the stimulus that would have taxed them was never delivered), and no
equivalent of the probe/evidence separation (*a successful hard session is one observation, not new
fitness*).

---

## Verdict

Take §2 — six items, all real. Discard §3.1 entirely and the strength, proposals and readiness
passages in §3.2. Let §3.3 wait for the design work. Keep our own doctrine where the two disagree
on evidence and time, because ours was derived from a block that actually failed.

The convergence in §"The headline" is the finding worth holding onto. It is the second independent
confirmation that the three-model split is the right shape, and it arrived before a line of the
split had been wired.
