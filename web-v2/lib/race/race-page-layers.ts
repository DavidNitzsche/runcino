/**
 * lib/race/race-page-layers.ts · RP-2 / RP-3 · THE FOUR LAYERS, KEPT APART.
 *
 * ── THE RULE THIS FILE EXISTS FOR ───────────────────────────────────────────
 *
 *   "The race page must not show several incompatible values under the same
 *    word 'projection'."
 *
 * Three CIM projections were once live at once — 3:22:17 on the list, 3:31:48
 * on the detail, 3:42:23 in a third rung — every one of them labelled
 * "projected". Each was individually defensible; together they were incoherent
 * (Rule 16, and `docs/MASTER_CORE_PRODUCT_PROGRAM.md` P1 · Race page).
 *
 * `PROGRESSIVE_BASELINE_DOCTRINE.md` Q7 names what the page must keep apart:
 *
 *   | Aspirational goal              3:00        never used as capacity
 *   | Active current-evidence target ~3:24 · 7:47/mi   the PROJECTION-derived
 *   |                                value, used wherever one current
 *   |                                execution number is required
 *   | Likely range                   the canonical current-evidence range
 *   | Conditional upside             ~3:13-3:15  with explicit criteria
 *
 * ── WHAT THIS FILE IS, AND IS NOT ───────────────────────────────────────────
 *
 * It is PRESENTATION. Every number it returns was resolved by its canonical
 * owner and is passed in; this module chooses no pace, fits no model, and
 * reads no database. `lib/race/race-outlook.ts` owns pace resolution and this
 * file never recomputes any part of it (Constitution: one owning service per
 * coaching decision; `DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`: one
 * canonical resolver per derived value).
 *
 * What it adds is the thing no single number can carry: the SET, with a
 * guarantee that the set is coherent. `raceLayerInvariants` is that guarantee,
 * and `_race_page_layers.test.ts` falsifies it against deliberately broken
 * sets before trusting it (Rule 18).
 *
 * ── WHY ONE ROW CAN HOLD TWO LAYERS ─────────────────────────────────────────
 *
 * Since EXECTARGET-1 the active execution target IS the current projection,
 * rounded. On the owner's live CIM they are 3:23:48 and 3:23:50 — the same
 * quantity, two seconds apart because `roundRaceTargetSec` rounds one of them.
 * Two rows two seconds apart under two labels is Rule 17's defect exactly, and
 * a runner reading them has been handed a distinction that does not exist.
 *
 * So they merge when `execution.source` says the target was derived from the
 * projection, and stay apart when it does not — as on a controlled C race,
 * where the projection is 43:04 and the day is priced at 47:05 and they are
 * genuinely two facts. That is a DISCRETE fact the engine already publishes,
 * not a tolerance on how close two numbers are (Rule 9).
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · Whether the NUMBERS are right. It asserts the set is coherent, never
 *     that `race-outlook.ts` resolved a good projection.
 *   · Whether a surface actually calls it. The route gate asserts the response
 *     shape; nothing here can see a Swift view that stops reading the field.
 *   · Whether the upside criteria are MET. Nothing in this codebase evaluates
 *     them (see `UpsideCriterionStatus`), so every one is reported
 *     `not_evaluated` and this module cannot tell a met one from an unmet one.
 *   · A race with no outlook at all. It returns null and says nothing.
 */
import type { RaceOutlook } from './race-outlook';
import { formatRaceTime } from '@/lib/training/vdot';

/** The layers a race page may show. A finish time on this page is one of these. */
export type RaceLayerKind =
  | 'aspirational_goal'
  | 'current_projection'
  | 'execution_target'
  | 'block_forecast'
  | 'conditional_upside';

/**
 * Rule 11 · three facts, never one. `not_evaluated` is not `not_met`.
 *
 * NOTHING IN THIS CODEBASE EVALUATES THESE CRITERIA, and that is deliberate:
 * `lib/training/marathon-pace-contract.ts` says so in as many words, because
 * `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` has adaptation disabled and a
 * conditional that quietly promoted itself would be exactly the automatic
 * mutation doctrine removed. Judging them needs the Evidence Engine's
 * per-activity classification, which `CLAUDE.md` records as not yet built.
 *
 * So the status is carried honestly rather than guessed. A fabricated tick
 * beside "a tune-up race consistent with the faster target" would be the app
 * telling the runner he had earned 3:13 on evidence nobody looked at.
 */
export type UpsideCriterionStatus = 'met' | 'not_met' | 'not_evaluated';

export interface RaceUpsideCriterion {
  text: string;
  status: UpsideCriterionStatus;
}

export interface RaceLayer {
  kind: RaceLayerKind;
  /** The ONE label this quantity is ever given on this surface (Rule 16). */
  label: string;
  /** Formatted finish time. Null when this layer has no time to show. */
  display: string | null;
  sec: number | null;
  /** Formatted pace, no unit suffix. Null where a pace would not be honest. */
  pace: string | null;
  range: { lo: string; hi: string; loSec: number; hiSec: number } | null;
  /**
   * Rule one of the iPhone design contract: a modelled number must never look
   * measured. Only the aspirational goal is not a model output; it is the
   * number the runner typed.
   */
  modelled: boolean;
  /** EXACTLY ONE layer in a coherent set is the number to run to. */
  actionable: boolean;
  /** One sentence saying what this layer is, and what it is not. */
  note: string | null;
  /** Only `conditional_upside` carries these. */
  criteria: readonly RaceUpsideCriterion[] | null;
}

export interface RaceLayers {
  layers: readonly RaceLayer[];
  /**
   * The owner's own framing of the temporality, which is the sentence the four
   * layers exist to make true. Null when there is no active target to anchor
   * it, because a sentence about a number we do not have is a sentence to
   * leave unsaid (Rule 16).
   */
  temporality: string | null;
  /**
   * `execution_target` and `current_projection` rendered the same string and
   * were merged into one row. Reported so a caller can say why it drew three
   * rows and not four, and so the gate can assert the merge happened for the
   * right reason.
   */
  collapsedProjectionIntoTarget: boolean;
  /** Non-empty means the SET is incoherent. A caller should refuse to draw it. */
  findings: readonly string[];
}

function pace(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function time(sec: number | null | undefined): string | null {
  return sec == null || !Number.isFinite(sec) ? null : formatRaceTime(sec);
}

/** "23:50" · "1:02" · "45s". A gap the runner reads, not a raw seconds count. */
function gapWords(sec: number): string {
  const s = Math.round(Math.abs(sec));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
}

function rangeOf(r: readonly [number, number] | null | undefined): RaceLayer['range'] {
  if (!r) return null;
  const lo = time(r[0]);
  const hi = time(r[1]);
  if (lo == null || hi == null) return null;
  return { lo, hi, loSec: Math.round(r[0]), hiSec: Math.round(r[1]) };
}

/**
 * Build the layer set from an already-resolved outlook.
 *
 * Every value below is read straight off `RaceOutlook`. The only decisions
 * this function makes are editorial: which layers are worth a row, what each
 * one is called, which single one is actionable, and whether two of them have
 * collapsed onto the same rendered string.
 */
export function raceLayers(o: RaceOutlook | null | undefined): RaceLayers | null {
  if (!o) return null;

  const distanceMi = o.race.distanceMi;
  const isControlled = o.execution.effortCharacter === 'controlled_c_effort';
  const perMi = (sec: number | null | undefined): number | null =>
    sec != null && distanceMi > 0 ? sec / distanceMi : null;

  const layers: RaceLayer[] = [];

  // ── 1 · the aspirational goal ───────────────────────────────────────────
  //
  // Echoed and compared, NEVER capacity. `PLAN_SIMPLIFICATION_DOCTRINE`
  // invariant 10 forbids deriving current capacity from it, and the owner's
  // standing rule is that the coach projects and never renegotiates a stated
  // goal. It is the one number here the runner supplied, so it is the one
  // number that is not modelled.
  //
  // It carries the GAP, because the stat plate that used to carry it yields to
  // this set (Rule 17: two components that can both draw a value, one yields).
  // Measured against the ACTIVE TARGET rather than the block forecast, since
  // the target is the number this page is about and a gap against a forecast
  // is a gap against something that has not happened.
  if (o.statedGoal.sec != null) {
    const goalSec = o.statedGoal.sec;
    const targetSec = o.execution.targetSec;
    const gapSec = targetSec != null ? Math.round(targetSec - goalSec) : null;
    const gapPhrase = gapSec == null
      ? null
      : gapSec > 30
        ? `${gapWords(gapSec)} faster than today’s evidence.`
        : gapSec < -30
          ? `${gapWords(-gapSec)} slower than today’s evidence.`
          : 'Level with today’s evidence.';
    layers.push({
      kind: 'aspirational_goal',
      label: 'Your goal',
      display: time(goalSec),
      sec: goalSec,
      pace: pace(o.statedGoal.paceSecPerMi),
      range: null,
      modelled: false,
      actionable: false,
      note: gapPhrase == null
        ? 'Yours. The coach never changes it and never races off it.'
        : `${gapPhrase} Yours, and the coach never changes it.`,
      criteria: null,
    });
  }

  // ── 2 · what today's evidence supports ──────────────────────────────────
  if (o.currentProjection.expectedSec != null) {
    layers.push({
      kind: 'current_projection',
      label: 'Today’s evidence',
      display: time(o.currentProjection.expectedSec),
      sec: o.currentProjection.expectedSec,
      pace: pace(perMi(o.currentProjection.expectedSec)),
      range: rangeOf(o.currentProjection.likelyRangeSec),
      modelled: true,
      actionable: false,
      note: 'What you could race now, from what you have already demonstrated.',
      criteria: null,
    });
  }

  // ── 3 · the active execution target · THE ACTIONABLE NUMBER ─────────────
  //
  // Q7: "the PROJECTION-derived value, used wherever one current execution
  // number is required". On an A or B race it equals layer 2 by construction
  // since EXECTARGET-1, and the two collapse below. On a controlled C effort
  // it is deliberately SLOWER than the projection, and then they stay two rows
  // because they are two facts.
  if (o.execution.targetSec != null) {
    const band = o.execution.paceBandSecPerMi;
    const lo = band ? pace(band[0]) : null;
    const hi = band ? pace(band[1]) : null;
    layers.push({
      kind: 'execution_target',
      label: isControlled ? 'Run the day at' : 'Race it at',
      display: time(o.execution.targetSec),
      sec: o.execution.targetSec,
      pace: pace(o.execution.paceSecPerMi),
      range: band && lo != null && hi != null
        ? { lo, hi, loSec: Math.round(band[0]), hiSec: Math.round(band[1]) }
        : null,
      modelled: true,
      actionable: true,
      note: isControlled
        ? 'The week’s hard session, not a race. Take the work, not the result.'
        : 'The number to run to. It moves when your evidence moves.',
      criteria: null,
    });
  }

  // ── 4 · where the block is designed to move it ──────────────────────────
  //
  // A FORECAST WITH A NAMED ASSUMPTION, never a prescription
  // (`PROGRESSIVE_BASELINE_DOCTRINE.md` "what every meaningful progression
  // must state" §6: "A forecast with a named assumption can be replaced by
  // evidence; an unlabelled number cannot").
  //
  // Refused on a controlled C effort: a hard workout is not a peak day, gets
  // neither the taper nor the day, and telling the runner where a training
  // race is "designed to land him" invites him to race it.
  //
  // Refused too when the basis is `current_projection` rather than
  // `trajectory`, because there the forecast IS the projection with no runway
  // behind it, and drawing it as a separate row is one number under two
  // labels (Rule 16).
  if (!isControlled && o.expectedRaceDay.expectedSec != null && o.expectedRaceDay.basis === 'trajectory') {
    layers.push({
      kind: 'block_forecast',
      label: 'Where this block is built to get you',
      display: time(o.expectedRaceDay.expectedSec),
      sec: o.expectedRaceDay.expectedSec,
      pace: pace(perMi(o.expectedRaceDay.expectedSec)),
      range: rangeOf(o.expectedRaceDay.likelyRangeSec),
      modelled: true,
      actionable: false,
      note: 'A forecast of the training still to come, not something you have done yet.',
      criteria: null,
    });
  }

  // ── 5 · the conditional upside, with what it waits on ───────────────────
  //
  // REFUSED ON A CONTROLLED C EFFORT. `race-outlook.ts` derives the upside
  // from the fast edge of the block forecast's range without consulting
  // `effortCharacter`, so on the owner's Dodgers 10K it emits 42:05 · 6:46/mi
  // beside an execution target of 47:05 whose own sentence reads "run it as
  // the week's hard session, not as a race" (measured live, 2026-09-02).
  // Drawing both is exactly the incompatible-values defect this page exists to
  // prevent, and its five criteria are marathon criteria on a 10K besides.
  //
  // Declining to DRAW it is presentation and is this file's call. Whether the
  // outlook should EMIT it at all belongs to that module's owner and is
  // reported rather than patched here.
  if (!isControlled && o.conditionalUpside != null) {
    layers.push({
      kind: 'conditional_upside',
      label: 'Available if the block earns it',
      display: time(o.conditionalUpside.targetSec),
      sec: o.conditionalUpside.targetSec,
      pace: pace(o.conditionalUpside.paceSecPerMi),
      range: null,
      modelled: true,
      actionable: false,
      note: 'Not the target. It becomes the target only when the evidence below arrives.',
      criteria: o.conditionalUpside.criteria.map((text) => ({ text, status: 'not_evaluated' as const })),
    });
  }

  // ── the collapse (Rule 17) ──────────────────────────────────────────────
  //
  // ── WHY THIS IS A PROVENANCE TEST AND NOT A COMPARISON ──────────────────
  //
  // It began as string equality on the two rendered displays, and the LIVE
  // payload falsified it on the first render: `currentProjection.expectedSec`
  // is 12228 and `execution.targetSec` is 12230, because `roundRaceTargetSec`
  // rounds the prescription and the projection is raw. So the runner was shown
  // "Today's evidence 3:23:48" directly above "Race it at 3:23:50" — one
  // quantity, two labels, two seconds apart. Exactly the defect the collapse
  // exists to prevent, surviving the check meant to catch it.
  //
  // A TOLERANCE WOULD BE THE WRONG FIX. Rule 9: a threshold standing in for a
  // question it cannot actually ask is the strongest form of that defect, and
  // "are these two numbers close enough" is not the question. The question is
  // "is the target the projection?", and the engine already answers it
  // discretely: `execution.source === 'current_evidence'` means the target IS
  // the projection, rounded (EXECTARGET-1 in `race-outlook.ts`), while
  // `controlled_c_effort` means the day is deliberately priced slower and they
  // are genuinely two facts.
  //
  // So the decision rests on a discrete honest fact and there is no threshold
  // on a continuous quantity left to smooth.
  const projection = layers.find((l) => l.kind === 'current_projection');
  const target = layers.find((l) => l.kind === 'execution_target');
  let collapsed = false;
  if (projection && target && o.execution.source === 'current_evidence') {
    // One row, both facts. The target keeps the actionable flag and takes the
    // projection's RANGE, which is the uncertainty Q39 requires be preserved;
    // the execution pace band is narrower and answers a different question, so
    // it survives as the pace rather than as the range.
    target.range = projection.range ?? target.range;
    target.note = 'What you could race now, from what you have already demonstrated. It moves when your evidence moves.';
    layers.splice(layers.indexOf(projection), 1);
    collapsed = true;
  }

  // ── the temporality sentence ────────────────────────────────────────────
  //
  // The owner's own framing, 2026-09-02, built from the live numbers rather
  // than hardcoded: "Based on what you have demonstrated today, the executable
  // plan is approximately 3:24. The current block is designed to move that
  // forward. Approximately 3:13-3:15 is available as an upside outcome if
  // marathon-specific workouts, tune-up racing, and accumulated training
  // support it."
  const activeDisplay = target?.display ?? null;
  const upside = layers.find((l) => l.kind === 'conditional_upside');
  const temporality = activeDisplay == null
    ? null
    : isControlled
      ? `Today’s evidence puts you at ${projection?.display ?? activeDisplay}. This day is priced at ${activeDisplay} on purpose, because it is training and not a race.`
      : [
          `Based on what you have demonstrated today, the executable plan is ${activeDisplay}.`,
          layers.some((l) => l.kind === 'block_forecast') ? 'This block is designed to move that forward.' : null,
          upside?.display != null
            ? `${upside.display} is available as an upside outcome if marathon-specific workouts, tune-up racing and accumulated training support it.`
            : null,
        ].filter(Boolean).join(' ');

  return {
    layers,
    temporality,
    collapsedProjectionIntoTarget: collapsed,
    findings: raceLayerInvariants(layers),
  };
}

/**
 * THE COHERENCE GUARANTEE. Returns a finding per violation; empty means the
 * set is safe to draw.
 *
 * Falsified in `_race_page_layers.test.ts` against deliberately broken sets
 * before it is trusted (Rule 18) — a check that has never failed is a
 * hypothesis, not a guarantee.
 */
export function raceLayerInvariants(layers: readonly RaceLayer[]): string[] {
  const out: string[] = [];
  if (layers.length === 0) return out;

  // A set that reached here with no actionable number is a set nobody can act
  // on, which is the defect this page was built to remove.
  const actionable = layers.filter((l) => l.actionable);
  if (actionable.length !== 1) {
    out.push(`ACTIONABLE_NOT_EXACTLY_ONE · ${actionable.length} of ${layers.length} layers claim to be the number to run to`);
  }

  // Rule 16 · one quantity, one name.
  const labels = layers.map((l) => l.label.toLowerCase());
  if (new Set(labels).size !== labels.length) {
    out.push('DUPLICATE_LABEL · two layers carry the same words');
  }

  // THE RULE THE PAGE EXISTS FOR. Three CIM numbers were once live at once,
  // all labelled "projected". At most one layer may wear the word.
  const projectionWorded = layers.filter((l) => /projec/i.test(l.label));
  if (projectionWorded.length > 1) {
    out.push(`MULTIPLE_PROJECTIONS · ${projectionWorded.length} layers labelled with the word "projection": ${projectionWorded.map((l) => l.label).join(' / ')}`);
  }

  // Two labels over one number is the same defect wearing different words.
  const byDisplay = new Map<string, RaceLayer[]>();
  for (const l of layers) {
    if (l.display == null) continue;
    byDisplay.set(l.display, [...(byDisplay.get(l.display) ?? []), l]);
  }
  for (const [display, group] of byDisplay) {
    if (group.length > 1) {
      out.push(`SAME_NUMBER_TWO_LABELS · ${display} is drawn as ${group.map((l) => l.label).join(' and ')}`);
    }
  }

  // The goal is never capacity, so it is never the number to run to.
  if (layers.some((l) => l.kind === 'aspirational_goal' && l.actionable)) {
    out.push('GOAL_IS_ACTIONABLE · the stated goal is being prescribed as the execution target');
  }

  // A modelled number that claims to be measured is rule one of the design
  // contract, and the only unmodelled layer is the runner's own goal.
  for (const l of layers) {
    if (!l.modelled && l.kind !== 'aspirational_goal') {
      out.push(`MODELLED_LOOKS_MEASURED · ${l.label} is a model output presented as a read`);
    }
  }

  // An upside that is not faster than the target is a second name for the same
  // number (Rule 16), and one with nothing stated about what it waits on is
  // a faster time dangled with no path to it.
  const target = layers.find((l) => l.actionable);
  const upside = layers.find((l) => l.kind === 'conditional_upside');
  if (upside?.sec != null && target?.sec != null && upside.sec >= target.sec) {
    out.push(`UPSIDE_NOT_FASTER · upside ${upside.display} is not faster than the target ${target.display}`);
  }
  if (upside != null && (upside.criteria == null || upside.criteria.length === 0)) {
    out.push('UPSIDE_WITHOUT_CRITERIA · a faster number with nothing stated about what it waits on');
  }

  // A forecast the runner could read as a prescription must say it is a
  // forecast (`PROGRESSIVE_BASELINE_DOCTRINE.md` §6).
  const forecast = layers.find((l) => l.kind === 'block_forecast');
  if (forecast != null && (forecast.note == null || forecast.note.length === 0)) {
    out.push('FORECAST_UNLABELLED · the block forecast carries no sentence saying it is a forecast');
  }

  return out;
}

/** The wire shape. snake_case, additive, nothing computed here. */
export function raceLayersPayload(l: RaceLayers | null | undefined) {
  if (!l) return null;
  return {
    temporality: l.temporality,
    collapsed_projection_into_target: l.collapsedProjectionIntoTarget,
    findings: l.findings,
    layers: l.layers.map((x) => ({
      kind: x.kind,
      label: x.label,
      display: x.display,
      sec: x.sec,
      pace: x.pace,
      range: x.range ? { lo: x.range.lo, hi: x.range.hi, lo_sec: x.range.loSec, hi_sec: x.range.hiSec } : null,
      modelled: x.modelled,
      actionable: x.actionable,
      note: x.note,
      criteria: x.criteria ? x.criteria.map((c) => ({ text: c.text, status: c.status })) : null,
    })),
  };
}
export type RaceLayersPayload = ReturnType<typeof raceLayersPayload>;
