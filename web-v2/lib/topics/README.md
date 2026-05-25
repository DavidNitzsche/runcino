# Topic kinds — the truth contract layer

Each card in the deck has a corresponding topic kind. Every kind has:

1. **A Zod payload schema** — the structured fields the card needs to render
2. **A prereq function** — returns `true` iff the topic can legally surface

The prereq layer is **load-bearing**. It runs BEFORE the LLM gets the state,
so the LLM never sees a topic kind whose prereqs aren't met. This is how we
prevent hallucination:

- `cadence_experiment` requires `profile.height_cm` to be set.
  Without it, the topic isn't in the candidate list. The LLM can't invent
  a cadence target because the eligible-kinds list doesn't include one.

- `race_horizon` requires `nextARace !== null`. If you have no A-race set,
  the topic doesn't appear. The LLM doesn't get to make up a deadline.

- `run_recap` requires `latest_activity !== null`. No run today, no recap.

## Editorial vs factual

Prereqs are **factual**: does the data exist? They're never "should this
surface in this surface/mode?" — that's the surface router's job (e.g.,
post-run mode surfaces `run_recap`, rest day mode doesn't, even though the
data exists).

## Adding a kind

1. Add the payload Zod schema.
2. Add the discriminated union variant in `Topic`.
3. Add the prereq function in `TopicPrereqs`.
4. Add the React component in `components/cards/`.
5. Add a SwiftUI mirror in `native-v2/Faff/Faff/Components/`.
6. Add a gold-corpus sample in `voice-eval/gold/<surface>/<mode>/<kind>.txt`.

The schema + prereq pair is the contract. Everything downstream relies on it.
