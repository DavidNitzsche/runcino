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

const USER_AGENT = 'runcino/0.1 (personal use; david nitzsche)';

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
