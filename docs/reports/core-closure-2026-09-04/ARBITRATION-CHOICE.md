# The arbitration doctrine choice · exact sentences, and A / B / C

Nothing in this file has been changed in code. It exists so the choice can be
made from the actual text rather than from my summary of it.

## The two sentences that cannot both be satisfiable

**Sentence 1 — the acceptance sentence.** `lib/adaptation/canonical/arbitration.ts`
header, quoting `docs/ADAPTATION_ENGINE_CONTRACT.md`, and named by that file as
"this file's acceptance test":

> "Your threshold evidence supports a faster threshold pace, but this week
> already contains enough total demand, so the change is deferred until the next
> appropriate boundary."
>
> "That is not one lever improperly suppressing another. It is independent
> evidence followed by coherent plan-level arbitration."

**Sentence 2 — rule 2.** Same file, the four rules:

> "2 · It does NOT automatically suppress a threshold-pace proposal. The word
> doing the work is AUTOMATICALLY: a small pace correction that preserves the
> intended stimulus may proceed, and only a MATERIAL demand increase is caught
> by rule 1. Implementing rule 1 without rule 2 gives you an engine where any
> hold anywhere freezes everything, which the contract names directly: 'Do not
> let one unrelated HOLD freeze the entire engine.'
>
> Rule 2 is the one that is easy to get wrong, because rule 1 alone feels safer,
> and 'safer' is how this codebase arrived at zero upward adaptations in 309
> production intents. **A suppression rule with no exception is a freeze.**"

## Why they conflict

Sentence 1 requires that a threshold-pace proposal CAN be deferred for demand.
Sentence 2 requires that a small pace correction CANNOT be, and that the
exception must actually fire. Whether both hold depends entirely on where
"material" sits — and a threshold-pace change is, by the constants file's own
admission, a tiny fraction of weekly demand:

> `contract-constants.ts`: "Quality is roughly a quarter of a week's demand, so
> changing its INTENSITY by one doctrine step moves the weekly total by well
> under one percent. A threshold-pace proposal could therefore never be material
> at any plausible bar, which made the contract's own acceptance sentence
> unreachable."

## The code, as it stands

```ts
// arbitration.ts
const increasesDemand = s.demandShare > 0;                        // ANY increase
if (loadLeverHeld && increasesDemand && s.material
    && s.verdict.lever !== heldLever && rank > heldRank) { suppress }

// arbitration.ts · isMaterial
if (v.lever === 'THRESHOLD_PACE') {
  return delta >= THRESHOLD_ORDINARY_STEP_SEC_PER_MI * MATERIAL_SHARE_OF_ORDINARY_STEP;
}

// contract-constants.ts
export const THRESHOLD_ORDINARY_STEP_SEC_PER_MI   = 3;
export const THRESHOLD_MAX_STEP_SEC_PER_MI        = 5;
export const THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI = 1;
export const MATERIAL_SHARE_OF_ORDINARY_STEP      = 0.5;   // bar = 1.5 s/mi
```

The exception's live window is **[1, 1.5) s/mi**, narrower than a single
ordinary step. Measured across David's entire history: **14 threshold proposals,
all of them the ordinary 3 s/mi, exception fired 0 times, 10 suppressed citing
`WEEKLY_VOLUME`.** Pinned by `ARBREACH-1`.

---

## The three choices

### A · Keep materiality in the lever's OWN units — today's behaviour

Change nothing.

- Sentence 1: **reachable** — the engine can say it, and does, ten times.
- Sentence 2: **effectively dead** — window [1, 1.5), fired 0 of 14.
- Effect on David: his threshold anchor moves roughly once a quarter. It moved
  3 s/mi in three months while his evidence supported more.
- Honest framing: "a pace change is a real change, and a loaded week should not
  take two changes at once."
- Risk: this is the disposition Rule 21 was written about, one level up. The
  engine no longer fails to *propose*; it fails to *apply*.

### B · Measure materiality as a share of weekly DEMAND

`isMaterial(THRESHOLD_PACE)` becomes a demand-share test.

- Sentence 1: **unreachable** — a pace step is <1% of demand, so it can never be
  deferred for demand, and the acceptance sentence can never truthfully be said.
- Sentence 2: **reachable** — every ordinary pace correction proceeds.
- Effect on David: the anchor moves whenever two corroborating sessions exist,
  regardless of that week's load. Materially more movement than today.
- Risk: a week already at its ceiling still gets a pace increase on top. This is
  the reading `contract-constants.ts` explicitly tried and rejected.

### C · Ask rule 1 the question it actually poses — **my recommendation**

Rule 1's own words are *"this week already contains **enough total demand**"*.
That is a question about **the week**, not about **the proposal's size**. Split
the two:

- **Rule 1** (suppression) tests whether the week is at or over its own demand
  bound — a property of the week, whatever the proposal.
- **Rule 3** (one material lever per cycle, for attributability) keeps
  own-units materiality exactly as it is.

- Sentence 1: **reachable** — said on a full week, which is when it is true.
- Sentence 2: **reachable** — a pace correction proceeds on a week with room.
- The two stop competing because they stop measuring the same thing. This is
  Rule 16 applied to arbitration: one quantity, one name, and right now one
  predicate is answering two different questions.
- Cost: needs a defensible "the week is at its ceiling" bound. The volume lever
  already owns one, so no new number is invented.
- Effect on David: on his real history, the ten `WEEKLY_VOLUME` suppressions
  would be re-tested against whether those weeks were actually full. I have not
  run that counterfactual — doing so is the first task after the choice is made,
  and it is cheap because the replay already exists.

---

**No code has been changed. `ARBREACH-1` pins the current behaviour so it cannot
drift while the choice is open.**
