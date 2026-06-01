/**
 * lib/training/climate-normals.ts · typical race-morning conditions.
 *
 * Small editorial table of typical AM (6-9am) temps and humidity for
 * US states + a curated list of international destinations × month.
 * Used by lib/training/race-conditions.ts to fill the Conditions chunk
 * of the Targets GapPanel when a race is OUTSIDE the 16-day forecast
 * horizon (so we can't fetch a real day forecast).
 *
 * Doctrine: NOAA / Köppen climate normals, typical race-day reality
 * (most road races start 6-8am, where the morning temp is well below
 * the daily high). Values are intentionally conservative-warm · race
 * organizers shift start times in summer, but the actual line-up &
 * first miles often run into climbing temps.
 *
 * Format: tempF × humidity_pct × month_idx (0-11). null = no data
 * for that region · the panel hides the Conditions chunk gracefully.
 *
 * Coverage:
 *   · 50 US states + DC
 *   · ~25 international destinations common for marathon majors and
 *     destination races (Tokyo, London, Berlin, Paris, Boston-style
 *     northeast US covered by state, etc.)
 *
 * This is editorial doctrine · works for any user racing anywhere
 * we've editorialized. Expand the country list as new race
 * destinations get logged.
 */

export interface ClimateNormal {
  /** Typical race-morning (6-9am) temperature in °F. */
  tempF: number;
  /** Typical morning humidity %. Optional · only some keys filled. */
  humidityPct?: number;
}

/** 12-month table · index 0=Jan ... 11=Dec. */
type MonthRow = readonly [
  ClimateNormal, ClimateNormal, ClimateNormal, ClimateNormal,
  ClimateNormal, ClimateNormal, ClimateNormal, ClimateNormal,
  ClimateNormal, ClimateNormal, ClimateNormal, ClimateNormal,
];

/** Tempting macro: most states fit a "cold winter / mild shoulder / hot
 *  summer" template. We tune from a few canonical points instead of
 *  authoring 12 numbers per state by hand. */
function row(jan: number, apr: number, jul: number, oct: number, humidity?: number): MonthRow {
  const out: ClimateNormal[] = [];
  for (let m = 0; m < 12; m++) {
    // Sinusoidal interpolation across the 4 quarter anchors.
    const phase = (m / 12) * 2 * Math.PI;
    // amplitude = (max - min) / 2; center = (max + min) / 2
    // approximate from anchors: assume jul is max, jan is min
    const center = (jan + jul) / 2;
    const amplitude = (jul - jan) / 2;
    // peak in July (m=6) → phase shifted to align peak there
    // cos((m - 6) * 2π/12) = 1 at m=6, -1 at m=0
    const seasonal = Math.cos(((m - 6) / 12) * 2 * Math.PI);
    const tempF = Math.round(center + amplitude * seasonal);
    // Light adjustment so apr / oct match anchors better
    const aprCalc = Math.round(center + amplitude * Math.cos(((3 - 6) / 12) * 2 * Math.PI));
    const aprError = apr - aprCalc;
    const adj = aprError * Math.cos(((m - 3) / 12) * 2 * Math.PI) * 0.5;
    out.push({ tempF: Math.round(tempF + adj), humidityPct: humidity });
  }
  return out as unknown as MonthRow;
}

/** US states · anchor values (Jan, Apr, Jul, Oct) for typical 6-9am
 *  temps. Source: NOAA NWS climate-normals 1991-2020 · race-morning
 *  shifted ~10°F below daily-mean to reflect early-AM line-up reality. */
export const CLIMATE_NORMALS_US: Readonly<Record<string, MonthRow>> = {
  AL: row(36, 56, 75, 56, 75),    // Alabama
  AK: row(10, 28, 52, 30, 70),    // Alaska
  AZ: row(38, 54, 80, 60, 30),    // Arizona (Phoenix-weighted)
  AR: row(32, 52, 72, 53, 70),    // Arkansas
  CA: row(45, 55, 65, 60, 65),    // California (coastal-weighted)
  CO: row(20, 38, 60, 40, 50),    // Colorado (front-range altitude)
  CT: row(20, 40, 65, 45, 70),    // Connecticut
  DE: row(28, 46, 70, 50, 70),    // Delaware
  DC: row(28, 48, 72, 52, 65),    // DC (Marine Corps Marathon)
  FL: row(54, 65, 76, 70, 80),    // Florida (statewide)
  GA: row(36, 54, 73, 56, 75),    // Georgia
  HI: row(65, 68, 73, 73, 70),    // Hawaii (year-round mild)
  ID: row(22, 38, 58, 38, 55),    // Idaho
  IL: row(18, 42, 68, 48, 70),    // Illinois (Chicago Marathon)
  IN: row(20, 42, 66, 46, 70),    // Indiana
  IA: row(14, 40, 65, 44, 70),    // Iowa
  KS: row(22, 46, 70, 48, 65),    // Kansas
  KY: row(26, 46, 68, 48, 70),    // Kentucky
  LA: row(42, 60, 75, 60, 80),    // Louisiana
  ME: row(12, 34, 60, 40, 70),    // Maine
  MD: row(28, 46, 70, 50, 70),    // Maryland
  MA: row(20, 40, 65, 46, 70),    // Massachusetts (Boston Marathon · April)
  MI: row(18, 38, 62, 42, 70),    // Michigan
  MN: row(8, 36, 64, 40, 65),     // Minnesota (Twin Cities Marathon)
  MS: row(36, 54, 73, 56, 78),    // Mississippi
  MO: row(22, 46, 70, 48, 70),    // Missouri
  MT: row(15, 35, 56, 38, 55),    // Montana
  NE: row(16, 42, 66, 44, 65),    // Nebraska
  NV: row(28, 50, 76, 52, 35),    // Nevada (Las Vegas-weighted)
  NH: row(14, 35, 60, 42, 70),    // New Hampshire
  NJ: row(24, 44, 68, 48, 70),    // New Jersey
  NM: row(28, 46, 66, 48, 45),    // New Mexico
  NY: row(22, 42, 66, 48, 65),    // New York (NYC Marathon · November)
  NC: row(34, 52, 70, 54, 72),    // North Carolina
  ND: row(2, 36, 60, 38, 70),     // North Dakota
  OH: row(22, 42, 65, 46, 70),    // Ohio
  OK: row(28, 50, 72, 52, 65),    // Oklahoma
  OR: row(36, 44, 60, 48, 75),    // Oregon (Portland-weighted)
  PA: row(22, 42, 65, 46, 70),    // Pennsylvania
  RI: row(22, 42, 66, 46, 70),    // Rhode Island
  SC: row(38, 54, 73, 56, 75),    // South Carolina
  SD: row(10, 38, 62, 40, 65),    // South Dakota
  TN: row(30, 50, 70, 52, 72),    // Tennessee
  TX: row(40, 56, 76, 58, 65),    // Texas (statewide)
  UT: row(24, 42, 65, 44, 45),    // Utah
  VT: row(12, 35, 60, 42, 70),    // Vermont
  VA: row(28, 48, 70, 50, 70),    // Virginia
  WA: row(34, 44, 60, 46, 78),    // Washington (Seattle-weighted)
  WV: row(24, 44, 65, 46, 75),    // West Virginia
  WI: row(10, 38, 62, 42, 70),    // Wisconsin
  WY: row(15, 32, 56, 36, 50),    // Wyoming
};

/** International race destinations · 2-letter ISO country code. */
export const CLIMATE_NORMALS_INTL: Readonly<Record<string, MonthRow>> = {
  GB: row(36, 44, 60, 48, 75),    // UK (London Marathon · April)
  DE: row(28, 44, 62, 48, 75),    // Germany (Berlin Marathon · September)
  FR: row(36, 48, 64, 52, 70),    // France (Paris Marathon · April)
  IT: row(38, 50, 70, 56, 65),    // Italy
  ES: row(42, 54, 72, 58, 60),    // Spain
  NL: row(32, 44, 60, 48, 80),    // Netherlands
  IE: row(34, 42, 56, 46, 80),    // Ireland (Dublin Marathon · October)
  JP: row(34, 50, 74, 58, 75),    // Japan (Tokyo Marathon · March)
  KR: row(22, 48, 72, 54, 70),    // South Korea (Seoul Marathon)
  AU: row(70, 60, 50, 60, 70),    // Australia (S hemisphere · Jul is winter)
  NZ: row(60, 55, 45, 55, 75),    // New Zealand
  CA: row(10, 38, 62, 40, 65),    // Canada (broad average · Toronto/Boston-like)
  MX: row(54, 62, 64, 60, 60),    // Mexico (CDMX altitude moderates)
  BR: row(72, 70, 60, 66, 75),    // Brazil (S hemisphere)
  KE: row(58, 62, 56, 60, 65),    // Kenya (Eldoret/Nairobi altitude)
  ET: row(48, 56, 54, 52, 65),    // Ethiopia (Addis altitude)
  ZA: row(64, 56, 46, 56, 60),    // South Africa (Comrades)
  CH: row(26, 42, 60, 44, 75),    // Switzerland (Jungfrau)
  AT: row(28, 44, 62, 46, 75),    // Austria
  PT: row(46, 54, 65, 58, 70),    // Portugal
  GR: row(46, 58, 76, 64, 60),    // Greece (Athens)
  TR: row(36, 50, 70, 56, 60),    // Turkey (Istanbul Marathon)
  CZ: row(26, 42, 62, 44, 75),    // Czechia (Prague)
  HU: row(26, 46, 66, 48, 70),    // Hungary
  PL: row(22, 42, 62, 44, 75),    // Poland
  SE: row(22, 38, 60, 42, 75),    // Sweden
  NO: row(20, 36, 56, 38, 75),    // Norway
  DK: row(28, 40, 60, 44, 80),    // Denmark
  FI: row(14, 32, 58, 38, 75),    // Finland
  SG: row(76, 78, 76, 76, 85),    // Singapore (year-round equatorial)
};

/**
 * Resolve a climate normal from a free-text location string + a race
 * date. Returns null when we can't parse the location to a known
 * region. Robust to common patterns:
 *
 *   "San Diego, CA"         → CLIMATE_NORMALS_US.CA[month]
 *   "London, UK"            → CLIMATE_NORMALS_INTL.GB[month]
 *   "Berlin, Germany"       → CLIMATE_NORMALS_INTL.DE[month]
 *   "New York, NY"          → CLIMATE_NORMALS_US.NY[month]
 *   "Carmel-by-the-Sea, CA" → CLIMATE_NORMALS_US.CA[month]
 *   null / empty            → null (panel hides chunk)
 */
export function climateNormalForLocation(
  location: string | null | undefined,
  dateISO: string,
): ClimateNormal | null {
  if (!location) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateISO)) return null;
  const month = Number(dateISO.slice(5, 7)) - 1;  // 0-11
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;

  // 1. US state · trailing ", XX" (2-letter state code).
  const stateMatch = location.match(/,\s*([A-Z]{2})\b/);
  if (stateMatch) {
    const state = stateMatch[1].toUpperCase();
    if (state in CLIMATE_NORMALS_US) {
      return CLIMATE_NORMALS_US[state][month];
    }
  }

  // 2. Country · trailing country name OR 2-letter country code.
  // Common patterns: "London, UK" / "Berlin, Germany" / "Tokyo, Japan".
  const tail = location.split(',').pop()?.trim() ?? '';
  const countryAlias: Record<string, string> = {
    // ISO codes
    'UK': 'GB', 'US': 'US', 'USA': 'US',
    // Common names
    'UNITED KINGDOM': 'GB', 'ENGLAND': 'GB', 'SCOTLAND': 'GB', 'WALES': 'GB',
    'GERMANY': 'DE', 'FRANCE': 'FR', 'ITALY': 'IT', 'SPAIN': 'ES',
    'NETHERLANDS': 'NL', 'HOLLAND': 'NL', 'IRELAND': 'IE',
    'JAPAN': 'JP', 'KOREA': 'KR', 'SOUTH KOREA': 'KR',
    'AUSTRALIA': 'AU', 'NEW ZEALAND': 'NZ',
    'CANADA': 'CA', 'MEXICO': 'MX', 'BRAZIL': 'BR',
    'KENYA': 'KE', 'ETHIOPIA': 'ET', 'SOUTH AFRICA': 'ZA',
    'SWITZERLAND': 'CH', 'AUSTRIA': 'AT', 'PORTUGAL': 'PT',
    'GREECE': 'GR', 'TURKEY': 'TR', 'CZECHIA': 'CZ', 'CZECH REPUBLIC': 'CZ',
    'HUNGARY': 'HU', 'POLAND': 'PL', 'SWEDEN': 'SE', 'NORWAY': 'NO',
    'DENMARK': 'DK', 'FINLAND': 'FI', 'SINGAPORE': 'SG',
  };
  const tailUpper = tail.toUpperCase();
  const code = countryAlias[tailUpper] ?? (tail.length === 2 ? tailUpper : null);
  if (code && code in CLIMATE_NORMALS_INTL) {
    return CLIMATE_NORMALS_INTL[code][month];
  }

  return null;
}
