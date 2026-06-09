export interface GlossaryEntry {
  term: string;
  def: string;
  cite?: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  VDOT: {
    term: 'VDOT',
    def: "Jack Daniels' aerobic fitness index, derived from race performance. It sets your training paces — Easy, Marathon, Threshold, Interval, and Repetition. A higher VDOT means faster target paces across all zones.",
    cite: "Daniels' Running Formula",
  },
  HRV: {
    term: 'Heart rate variability',
    def: 'The millisecond variation between heartbeats. Higher HRV relative to your personal baseline means your nervous system has recovered. A single reading means little — the trend against your own history is what matters.',
    cite: 'HealthKit · Apple Watch',
  },
  ACWR: {
    term: 'Acute:Chronic Workload Ratio',
    def: "This week's mileage divided by your 4-week rolling average. Sweet spot is 0.8–1.3. Above 1.5 is a spike with sharply elevated injury risk. Below 0.8 signals detraining.",
    cite: 'Gabbett 2016 · Br J Sports Med',
  },
  LTHR: {
    term: 'Lactate Threshold Heart Rate',
    def: 'The heart rate you can sustain for roughly 60 minutes all-out. All your training zones derive from it. Best anchored by a half-marathon or marathon race with clean HR data.',
    cite: 'Friel · The Triathlete\'s Training Bible',
  },
  TSB: {
    term: 'Form score (Training Stress Balance)',
    def: 'Fitness minus Fatigue. A score of −10 to −20 is normal during a build — you are carrying load. A score of +5 to +15 is the target window for race day: fit and fresh.',
    cite: 'Banister performance model',
  },
  HRmax: {
    term: 'Maximum heart rate',
    def: 'The upper ceiling of your aerobic system. Used to set every HR training zone when LTHR is not available. Best observed from a high-effort interval or race — formula estimates are often 10–15 bpm off.',
  },
  RHR: {
    term: 'Resting heart rate',
    def: 'Your morning baseline pulse, read from Apple Watch before you get up. A rising RHR alongside a falling HRV signals under-recovery. Lower is generally better for aerobic athletes, though normal ranges vary widely.',
    cite: 'HealthKit · Apple Watch',
  },
};
