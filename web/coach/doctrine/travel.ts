/**
 * Doctrine — Travel and time-zone protocols.
 *
 * Source: Research/12-travel-timezone.md
 *
 * Engine consumers:
 *   - coach.briefRaceMorning   → JET_LAG_PROTOCOL when race travel logged
 *   - /races/[slug] page       → ARRIVAL_TIMING display */
import { cite, type Cited } from '.';

// ── Arrival timing ───────────────────────────────────────────────

export const TRAVEL_ARRIVAL: Cited<Array<{
  travelClass: string;
  recommendedArrival: string;
  rationale: string;
}>> = {
  value: [
    { travelClass: 'Same city / drive',                  recommendedArrival: 'T-1 day or T-0 morning',  rationale: 'No circadian or travel-fatigue concern' },
    { travelClass: 'Same time zone, flight',             recommendedArrival: 'T-1 day minimum',          rationale: 'Logistics + travel fatigue; T-2 preferred' },
    { travelClass: '1-3 time zones',                      recommendedArrival: 'T-2 to T-3 days',          rationale: 'Allow ~1 day per time zone; circadian shift partial' },
    { travelClass: '4-6 time zones',                      recommendedArrival: 'T-5 to T-7 days; OR T-1 punch-through', rationale: 'Either fully shift or arrive as late as possible (single-night strategy)' },
    { travelClass: '7+ time zones',                       recommendedArrival: 'T-7 to T-10 days',         rationale: 'Full circadian shift takes 1 day per zone' },
  ],
  citations: [
    cite('§Pre-Race Travel Timing', 'Travel class → recommended arrival', 'research', '12'),
  ],
};

// ── East vs west asymmetry ────────────────────────────────────────

export const EAST_WEST_ASYMMETRY: Cited<{
  eastward: { description: string; preFlightProtocol: string; harderReason: string };
  westward: { description: string; preFlightProtocol: string; easierReason: string };
}> = {
  value: {
    eastward: {
      description: 'US to Europe, US to Asia (eastward across Pacific)',
      preFlightProtocol: 'Advance bedtime 30-60 min/day for 3-5 days pre-flight. Morning bright light exposure on arrival days.',
      harderReason: 'Circadian rhythm naturally runs ~24.2 hr; advancing the clock requires shortening the day.',
    },
    westward: {
      description: 'Europe to US, US to Asia (westward across Atlantic)',
      preFlightProtocol: 'Delay bedtime 30-60 min/day pre-flight. Evening light exposure post-arrival.',
      easierReason: 'Delaying the clock matches the natural slightly-longer-than-24h drift.',
    },
  },
  citations: [
    cite('§East-Bound vs. West-Bound Asymmetry', 'Eastward harder; pre-flight bedtime adjustment 3-5 days', 'research', '12'),
  ],
};

// ── In-flight protocols ──────────────────────────────────────────

export const IN_FLIGHT_PROTOCOL: Cited<{
  hydration: string;
  movement: string;
  alcohol: string;
  caffeine: string;
  carryOnMustHaves: string[];
  watchAdjustment: string;
}> = {
  value: {
    hydration: '8 oz/hour minimum. Counter cabin dryness. Avoid sodium-poor large volumes.',
    movement: 'Stand and walk every 60-90 min (DVT prevention). Calf compression sleeves help.',
    alcohol: 'Avoid alcohol on race travel; impairs sleep recovery + circadian shift.',
    caffeine: 'Time caffeine to destination time, not origin time.',
    carryOnMustHaves: [
      'Race kit (singlet, shorts, sports bra)',
      'Race shoes',
      'Race fuel + caffeine',
      'Key medications + electrolytes',
      'Compression sleeves',
    ],
    watchAdjustment: 'Set watch to destination time on takeoff — psychological pre-shift.',
  },
  citations: [
    cite('§In-Flight Hydration + Travel Compression + Pre/In/Post-Flight Running Adjustments', 'In-flight hydration + DVT prevention + carry-on must-haves + watch adjustment', 'research', '12'),
  ],
};

// ── Light + melatonin protocols ──────────────────────────────────

export const LIGHT_MELATONIN_PROTOCOLS: Cited<{
  lightExposure: { eastwardArrival: string; westwardArrival: string; principle: string };
  melatonin: { dose: string; timing: string; warnings: string[] };
}> = {
  value: {
    lightExposure: {
      eastwardArrival: 'Morning bright light (15-30 min direct sun or 10000 lux box) for 3-5 days post-arrival. Avoid morning light at home pre-flight if shifting eastward.',
      westwardArrival: 'Evening light exposure post-arrival. Avoid bright morning light immediately post-arrival.',
      principle: 'Light is the primary zeitgeber (clock-shifter). Timing matters more than duration.',
    },
    melatonin: {
      dose: '0.3-0.5 mg low-dose preferred over 3-5 mg high-dose for circadian shifting (paradoxically more effective at low dose).',
      timing: 'Eastward: 30 min before destination bedtime, starting 1-2 days pre-flight. Westward: not typically needed; if used, evening of arrival.',
      warnings: ['Not for those on SSRIs / blood pressure meds without MD consultation', 'Test in non-race travel first', 'Drowsiness 30-60 min after dose'],
    },
  },
  citations: [
    cite('§Light Exposure Protocols + Melatonin Protocols', 'Eastward AM light; westward PM light. Melatonin 0.3-0.5 mg low-dose for circadian shift.', 'research', '12'),
  ],
};

// ── Quick-reference decision tree ────────────────────────────────

export const TRAVEL_DECISION_TREE: Cited<Array<{
  scenario: string;
  recommendation: string;
}>> = {
  value: [
    { scenario: 'Same city / drive',                                                      recommendation: 'No protocol; drive day before or morning of' },
    { scenario: '1-2 hr time zone, flight',                                                recommendation: 'T-1 arrival; minor sleep adjustments' },
    { scenario: '3-4 hr time zone (US coast-to-coast)',                                    recommendation: 'T-2 or T-3 arrival; pre-flight bedtime shift starting T-3 days' },
    { scenario: '5-7 hr time zone (US ↔ Europe)',                                          recommendation: 'T-5 to T-7 OR T-1 punch-through; full pre-flight protocol' },
    { scenario: '8+ hr time zone (US ↔ Asia/Australia)',                                  recommendation: 'T-7 to T-10 days; melatonin + light protocols' },
    { scenario: 'Same-day arrival, race tomorrow (forced)',                                recommendation: 'Sleep banking T-7 to T-2 mitigates; expect RPE rise but performance preserved' },
  ],
  citations: [
    cite('§Quick-Reference Decision Tree', '6 travel scenarios → recommendation', 'research', '12'),
  ],
};
