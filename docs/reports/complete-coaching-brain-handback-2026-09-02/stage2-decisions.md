# Stage 2 · the three blocking decisions, ruled · 2026-09-02

The plan-generation agent raised three decisions it would not take alone. Each
is ruled here with its reasoning, so the implementation can proceed and the
ruling can be argued with rather than discovered later in the code.

## D1 · the post-race recovery window for an unanswered B race

**The finding.** An unanswered B race receives an uncited 4/2/1-day recovery
window, which is shorter than the engine's own doctrine-bound table
(`POST_RACE_RECOVERY_WEEKS`, from `Research/00b` §"Recovery by Distance", where
a half is 10–14 total no-quality days). The agent implemented the doctrine
window, found it trips the validator's "a RACE-SPECIFIC week prescribes
quality" rule, and reverted rather than weaken a validator.

**Ruling: use the doctrine table. Delete the uncited window.** Where the
doctrine window legitimately empties a race-specific week of quality, the
VALIDATOR accepts it through an argued, doctrine-cited exemption keyed on
"this week overlaps a post-race recovery window" — never by loosening the
general rule (CLAUDE.md Rule 7: add the exemption with an honest reason, do
not loosen the claim).

**Why this way round.** The recovery table is injury-motivated and cited; the
"race-specific weeks carry quality" expectation is a shape preference. When a
cited safety rule and an uncited shape preference disagree, the cited rule
wins and the preference learns an exception. The reverse — trimming recovery
so a validator stays quiet — is how an engine ends up prescribing quality into
a recovery window and calling it correct.

**What would change this ruling.** A `Research/` row stating that a B-priority
race at half distance warrants a materially shorter no-quality window than the
distance table gives. None was found.

## D2 · a race followed the next day by a long run

**The finding.** The owner's 2026-09-26 race followed by a 2026-09-27 15.5-mile
long run is 21.7 miles inside 24 hours, and nothing guards it.
`Research/00b` and `Research/22` both apply and appear to disagree.

**Ruling: they disagree because they are answering different questions, and
the distinction is race EFFORT, which `Research/00b` grades explicitly.**

- A graded **A or B race consumes the next day's long-run slot.** The long run
  moves or shortens, and the guard states which. A real race is a race.
- A **C race counts as a quality day for spacing but does not displace the
  long run**, because doctrine itself calls a C race "a hard workout, no
  taper" rather than a race.

Implemented in the combined-stress and placement validation, and CONTINUOUS
rather than a cliff (Rule 9): a race one day earlier must not change the plan
in kind.

**What would change this ruling.** Evidence that this runner's own C races
carry A-race cost. The effort-class pipeline already measures that, so if it
ever says so, the guard should read the measured class rather than the
declared one.

## D3 · per-step paces for ladder and cutdown sessions

**The finding.** 2,581 of 2,898 cutdown sessions ship one flat pace under a
label whose own doctrine says the pace descends. Fixing it needs per-step
paces in the segment grammar, which is a watch-contract change.

**Ruling: implement per-step paces as ADDITIVE keys.** Declining the shape is
not acceptable — a cutdown is a doctrine-standard session and the app must be
able to prescribe one honestly rather than mislabel a flat rep set.

**Why additive is safe.** An older watch ignores unknown keys and grades the
whole repetition at the row's pace, which is exactly today's behaviour: no
device gets worse, and every updated device gets the truth. Gated by
`scripts/check-wire-keys.sh`, with the compatibility argument written into the
code rather than assumed.

**What would change this ruling.** A watch build that rejects unknown keys
rather than ignoring them. The wire-key gate exists to catch precisely that.
