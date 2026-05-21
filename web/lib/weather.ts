/**
 * NOAA weather fetcher — free, no auth.
 *
 * Two-step flow:
 *   1. GET https://api.weather.gov/points/{lat},{lon} → forecast URL
 *   2. GET that forecast URL → array of periods (morning / afternoon / etc.)
 *
 * Returns a compact summary ready to feed into the /api/brief Claude
 * prompt (or to render on the UI directly).
 */

const USER_AGENT = 'faff/0.1 (personal use; david nitzsche)';

export interface WeatherSummary {
  location: { lat: number; lon: number; city?: string };
  start_period: WeatherPeriod;
  /** Second period — typically afternoon, useful for finish-line temp */
  second_period: WeatherPeriod | null;
  narrative: string;
  fetched_at: string;   // ISO
}

export interface WeatherPeriod {
  name: string;                 // "Sunday morning"
  start_iso: string;
  temperature_f: number;
  wind_speed_mph_min: number | null;
  wind_speed_mph_max: number | null;
  wind_direction: string;       // "NW"
  short_forecast: string;       // "Partly cloudy"
  precipitation_pct: number;    // 0-100
}

/** Parse "8 to 12 mph" → {min: 8, max: 12}; "10 mph" → {min: 10, max: 10}. */
function parseWind(raw: string | undefined | null): { min: number | null; max: number | null } {
  if (!raw) return { min: null, max: null };
  const m = raw.match(/(\d+)\s*(?:to\s*(\d+))?\s*mph/i);
  if (!m) return { min: null, max: null };
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return { min: a, max: b };
}

export async function fetchNoaaWeather(lat: number, lon: number): Promise<WeatherSummary> {
  const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
  });
  if (!pointRes.ok) {
    throw new Error(`NOAA points API ${pointRes.status}`);
  }
  const pointData = await pointRes.json();
  const forecastUrl: string | undefined = pointData?.properties?.forecast;
  const city: string | undefined = pointData?.properties?.relativeLocation?.properties?.city;
  if (!forecastUrl) throw new Error('NOAA points API did not return a forecast URL');

  const fcRes = await fetch(forecastUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
  });
  if (!fcRes.ok) throw new Error(`NOAA forecast API ${fcRes.status}`);
  const fcData = await fcRes.json();
  const periods: unknown[] = fcData?.properties?.periods ?? [];
  if (periods.length === 0) throw new Error('NOAA forecast returned 0 periods');

  const asPeriod = (p: unknown): WeatherPeriod => {
    const obj = p as Record<string, unknown>;
    const wind = parseWind(obj.windSpeed as string | undefined);
    const prob = (obj.probabilityOfPrecipitation as Record<string, unknown> | undefined)?.value;
    return {
      name: (obj.name as string) ?? '',
      start_iso: (obj.startTime as string) ?? '',
      temperature_f: (obj.temperature as number) ?? 0,
      wind_speed_mph_min: wind.min,
      wind_speed_mph_max: wind.max,
      wind_direction: (obj.windDirection as string) ?? '',
      short_forecast: (obj.shortForecast as string) ?? '',
      precipitation_pct: typeof prob === 'number' ? prob : 0,
    };
  };

  const start_period = asPeriod(periods[0]);
  const second_period = periods.length > 1 ? asPeriod(periods[1]) : null;

  const narrative = buildNarrative(start_period, second_period);

  return {
    location: { lat, lon, city },
    start_period,
    second_period,
    narrative,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Open-Meteo historical weather fetcher — free, no auth.
 *
 * Used to surface "what the weather was like last year on this date
 * at this race" before we're close enough for a real NOAA forecast.
 * Returns the same WeatherSummary shape as fetchNoaaWeather so the
 * UI can render either source uniformly.
 *
 * Endpoint: https://archive-api.open-meteo.com/v1/archive
 * Coverage: global, 1940-present, hourly. No API key required.
 *
 * Race start is assumed to be 7am local — typical for road races.
 * We pull the start hour + 2 hours later to approximate start +
 * mid-race conditions, mirroring how NOAA's "morning / afternoon"
 * periods feed the brief.
 */
export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  dateISO: string,                // YYYY-MM-DD
  startHourLocal: number = 7,     // race start, default 7am local
): Promise<WeatherSummary> {
  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}` +
    `&start_date=${dateISO}&end_date=${dateISO}` +
    `&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&timezone=auto`;

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Open-Meteo archive ${res.status}`);
  const data = await res.json() as {
    hourly: {
      time: string[];                              // local-time ISO, hourly
      temperature_2m: number[];
      relative_humidity_2m: number[];
      dew_point_2m: number[];
      wind_speed_10m: number[];
      wind_direction_10m: number[];
      precipitation: number[];
      weather_code: number[];
    };
    timezone?: string;
  };

  const startIdx = startHourLocal;          // hourly array is local-aligned
  const finishIdx = Math.min(startHourLocal + 2, 23);
  const at = (idx: number, label: string): WeatherPeriod => {
    const dir = degreesToCompass(data.hourly.wind_direction_10m[idx]);
    const wind = Math.round(data.hourly.wind_speed_10m[idx]);
    const code = data.hourly.weather_code[idx];
    const precip = Math.round(data.hourly.precipitation[idx] * 100) / 100;
    return {
      name: label,
      start_iso: data.hourly.time[idx],
      temperature_f: Math.round(data.hourly.temperature_2m[idx]),
      wind_speed_mph_min: wind,
      wind_speed_mph_max: wind,
      wind_direction: dir,
      short_forecast: weatherCodeToText(code),
      precipitation_pct: precip > 0 ? 100 : 0,    // historical actuals — fell or didn't
    };
  };

  const start_period = at(startIdx, 'Race start');
  const second_period = at(finishIdx, 'Mid-race');

  return {
    location: { lat, lon },
    start_period,
    second_period,
    narrative: buildNarrative(start_period, second_period),
    fetched_at: new Date().toISOString(),
  };
}

/** Compass dir from degrees. 0/360 = N, 90 = E, 180 = S, 270 = W. */
function degreesToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/** Open-Meteo WMO weather codes → short text. Just the families we
 *  care about for race-morning context. */
function weatherCodeToText(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Mixed';
}

/* ─────────────────────────────────────────────────────────────────
 * Per-run weather — compact conditions at a run's GPS start + time,
 * for run recaps + the coach take. Open-Meteo, no key. Recent dates
 * come from the forecast endpoint (serves recent past), older from the
 * archive endpoint. Exposes humidity (the archive WeatherSummary path
 * doesn't), since heat+humidity is what inflates HR.
 * ───────────────────────────────────────────────────────────────── */

export interface RunWeather {
  tempF: number;
  humidityPct: number;
  windMph: number;
  code: number;
  label: string;
  /** Conditions that plausibly inflate HR / RPE (heat or humidity). */
  isHot: boolean;
}

/** Fetch weather at a run's start. null on any failure — enrichment only. */
export async function fetchRunWeather(
  lat: number | null | undefined,
  lon: number | null | undefined,
  startISO: string | null | undefined,
): Promise<RunWeather | null> {
  if (lat == null || lon == null || !startISO) return null;
  const date = startISO.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const ageDays = Math.floor((Date.now() - new Date(date + 'T12:00:00Z').getTime()) / 86_400_000);
  const apiBase = ageDays > 80
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';
  const url = `${apiBase}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`
    + `&start_date=${date}&end_date=${date}`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, next: { revalidate: 86_400 } });
    if (!res.ok) return null;
    const h = (await res.json() as { hourly?: {
      time?: string[]; temperature_2m?: number[];
      relative_humidity_2m?: number[]; wind_speed_10m?: number[]; weather_code?: number[];
    } }).hourly;
    if (!h?.time || !h.temperature_2m) return null;

    const startHour = new Date(startISO).getHours();
    let idx = h.time.findIndex((t) => new Date(t).getHours() === startHour);
    if (idx < 0) idx = Math.min(12, h.time.length - 1);
    if (idx < 0) return null;

    const tempF = Math.round(h.temperature_2m[idx] ?? NaN);
    if (!Number.isFinite(tempF)) return null;
    const humidityPct = Math.round(h.relative_humidity_2m?.[idx] ?? 0);
    const windMph = Math.round(h.wind_speed_10m?.[idx] ?? 0);
    const code = h.weather_code?.[idx] ?? 0;
    return {
      tempF, humidityPct, windMph, code,
      label: weatherCodeToText(code),
      isHot: tempF >= 75 || humidityPct >= 70,
    };
  } catch {
    return null;
  }
}

function buildNarrative(a: WeatherPeriod, b: WeatherPeriod | null): string {
  const lines: string[] = [];
  lines.push(
    `${a.name}: ${a.temperature_f}°F, ${a.short_forecast.toLowerCase()}`
  );
  if (a.wind_speed_mph_max !== null && a.wind_speed_mph_max > 0) {
    const wind = a.wind_speed_mph_min === a.wind_speed_mph_max
      ? `${a.wind_speed_mph_max} mph`
      : `${a.wind_speed_mph_min}-${a.wind_speed_mph_max} mph`;
    lines.push(`Wind ${a.wind_direction} at ${wind}`);
  }
  if (a.precipitation_pct > 10) {
    lines.push(`${a.precipitation_pct}% chance of precip`);
  }
  if (b) {
    lines.push(`${b.name}: ${b.temperature_f}°F, ${b.short_forecast.toLowerCase()}`);
  }
  return lines.join('. ') + '.';
}
