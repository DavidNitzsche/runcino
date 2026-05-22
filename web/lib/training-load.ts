/**
 * Training load (CTL · ATL · TSB) — pure derivation from coach-state
 * volume inputs, shared by the /api/health route and the /health page.
 *
 * CTL (fitness) approximates the 8-week-rolling chronic training load;
 * ATL (fatigue) the 7-day acute load; TSB (form) = CTL − ATL, per
 * Research/00a §CTL/ATL/TSB (Banister fitness-fatigue model). 1.8 and
 * 1.5 are TRIMP-per-mile coefficients tuned for easy/aerobic running
 * (will tighten once HR streams land per-activity).
 *
 * NOTE: this intentionally does NOT fabricate a per-day 30-day series.
 * The prior route-local helper synthesized a Math.sin arc around CTL,
 * which the HR/VDOT/pace audit flagged as fake per-day data. The real
 * scalars (CTL/ATL/TSB) ARE real; the series stays empty until the
 * Strava activity HR-stream pipeline supplies genuine daily TRIMP.
 */

export interface TrainingLoadInputs {
  /** 8-week rolling weekly-average mileage (state.volume.weeklyAvg8w). */
  weeklyAvg8wMi: number;
  /** Last-7-day mileage sum (state.volume.last7Mi). */
  last7Mi: number;
}

export interface TrainingLoad {
  /** CTL (fitness) — chronic load. */
  fitnessCtl: number;
  /** ATL (fatigue) — acute load. */
  fatigueAtl: number;
  /** Form = CTL − ATL. */
  formTsb: number;
  /** Peak / current window label. */
  peakWindowLabel: string;
  /** UI verdict pin ("RACE READY" / "HOLDING" / "BUILDING"). */
  verdictLabel: string;
  /** Form chip label ("▲ FRESH" / "NEUTRAL" / "BUILDING" / "OVERLOAD"). */
  formChip: string;
  /** True once there's enough volume to read meaningfully. */
  hasData: boolean;
}

/** Compute CTL/ATL/TSB + verdict labels from volume inputs. Pure. */
export function buildTrainingLoad(inputs: TrainingLoadInputs): TrainingLoad {
  const ctl = inputs.weeklyAvg8wMi > 0 ? Math.round(inputs.weeklyAvg8wMi * 1.8) : 0;
  const atl = inputs.last7Mi > 0 ? Math.round(inputs.last7Mi * 1.5) : 0;
  const tsb = ctl - atl;
  const formChip = tsb > 10 ? '▲ FRESH' : tsb > 0 ? 'NEUTRAL' : tsb > -20 ? 'BUILDING' : 'OVERLOAD';
  const verdictLabel = tsb > 10 ? 'RACE READY' : tsb > 0 ? 'HOLDING' : 'BUILDING';

  return {
    fitnessCtl: ctl,
    fatigueAtl: atl,
    formTsb: tsb,
    peakWindowLabel: ctl > 0 ? `CURRENT CTL ${ctl} · ATL ${atl}` : 'INSUFFICIENT VOLUME DATA',
    verdictLabel,
    formChip,
    hasData: ctl > 0,
  };
}
