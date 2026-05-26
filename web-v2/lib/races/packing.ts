/**
 * P36 — race-week packing list.
 *
 * Doctrine-driven static list, parameterized by distance + race priority +
 * weather forecast (if available). Surfaces on race-detail in race week
 * mode (T-7 through T-0). Per-runner overrides live in races.meta.packing
 * (jsonb array of {item, packed: boolean}); this function provides the
 * baseline.
 *
 * Categories: gear, fueling, race-day, recovery. Each item has a
 * priority (must / recommended / optional) so the runner can skim.
 */

export interface PackingItem {
  item: string;
  category: 'gear' | 'fueling' | 'race_day' | 'recovery' | 'logistics';
  priority: 'must' | 'recommended' | 'optional';
  packed?: boolean;
  why?: string;
}

interface PackingInputs {
  distance_label: string | undefined;
  priority: 'A' | 'B' | 'C' | null | undefined;
  weather: { temp_f?: number | null; conditions?: string | null } | null;
}

export function defaultPackingList(input: PackingInputs): PackingItem[] {
  const dist = (input.distance_label ?? '').toLowerCase();
  const isMarathon = dist.includes('marathon') && !dist.includes('half');
  const isHalf = dist.includes('half') || dist === '13.1';
  const isLong = isMarathon || isHalf;
  const isHot = (input.weather?.temp_f ?? 0) >= 75;
  const isCold = (input.weather?.temp_f ?? 100) <= 45;
  const isWet = ['rain','rain_shower','snow','snow_shower','thunderstorm'].includes(input.weather?.conditions ?? '');

  const items: PackingItem[] = [
    // ── GEAR ──
    { item: 'Race shoes', category: 'gear', priority: 'must', why: 'Race-day pair — broken in but fresh.' },
    { item: 'Race kit (singlet/shorts)', category: 'gear', priority: 'must' },
    { item: 'Race-day socks', category: 'gear', priority: 'must', why: 'No new socks on race day.' },
    { item: 'Body Glide / anti-chafe', category: 'gear', priority: 'must', why: 'Long runs get unforgiving.' },
    { item: 'GPS watch (charged)', category: 'gear', priority: 'must' },
    { item: 'HR strap (charged)', category: 'gear', priority: 'recommended', why: 'Watch HR drifts on hard efforts.' },

    // ── FUELING ──
    { item: 'Pre-race breakfast (familiar)', category: 'fueling', priority: 'must', why: 'No new foods.' },
    { item: 'Caffeine source', category: 'fueling', priority: 'recommended' },
  ];

  if (isLong) {
    items.push(
      { item: 'Race-day gels (practiced)', category: 'fueling', priority: 'must', why: 'Same brand + flavor you trained with.' },
      { item: 'Electrolyte tabs', category: 'fueling', priority: 'recommended', why: 'Especially hot/humid days.' },
      { item: 'Hydration pack or bottle (if needed)', category: 'fueling', priority: 'optional' },
    );
  }

  // ── RACE DAY ──
  items.push(
    { item: 'Race bib + safety pins', category: 'race_day', priority: 'must' },
    { item: 'Timing chip (if not on bib)', category: 'race_day', priority: 'must' },
    { item: 'Throwaway warmup layer', category: 'race_day', priority: 'recommended', why: 'Discard at the start line.' },
    { item: 'Lubricant for feet', category: 'race_day', priority: 'recommended' },
    { item: 'Sunscreen / lip balm', category: 'race_day', priority: 'recommended' },
  );

  if (isHot) {
    items.push(
      { item: 'Sun hat / visor', category: 'race_day', priority: 'must' },
      { item: 'Sunglasses', category: 'race_day', priority: 'recommended' },
      { item: 'Extra electrolytes', category: 'race_day', priority: 'must' },
    );
  }
  if (isCold) {
    items.push(
      { item: 'Gloves + arm warmers', category: 'race_day', priority: 'must' },
      { item: 'Beanie or headband', category: 'race_day', priority: 'recommended' },
      { item: 'Vaseline (face / hands)', category: 'race_day', priority: 'optional' },
    );
  }
  if (isWet) {
    items.push(
      { item: 'Brim cap (keeps rain off face)', category: 'race_day', priority: 'must' },
      { item: 'Plastic bag for soaked clothes', category: 'race_day', priority: 'recommended' },
    );
  }

  // ── RECOVERY ──
  items.push(
    { item: 'Dry clothes for after', category: 'recovery', priority: 'must' },
    { item: 'Recovery shoes/sandals', category: 'recovery', priority: 'recommended' },
    { item: 'Recovery snack (high-carb + protein)', category: 'recovery', priority: 'must', why: 'Glycogen window: first 30 min post-finish.' },
    { item: 'Compression socks', category: 'recovery', priority: 'optional' },
  );

  // ── LOGISTICS ──
  items.push(
    { item: 'Race confirmation email / packet pickup info', category: 'logistics', priority: 'must' },
    { item: 'Photo ID', category: 'logistics', priority: 'must' },
    { item: 'Cash for parking / start village', category: 'logistics', priority: 'optional' },
    { item: 'Pre-race playlist / podcast', category: 'logistics', priority: 'optional' },
  );

  if (input.priority === 'A') {
    items.push(
      { item: 'Race-day plan written out', category: 'logistics', priority: 'must', why: 'Pacing strategy, fueling intervals, mile-15 mantra.' },
      { item: 'Course map / elevation profile printed', category: 'logistics', priority: 'recommended' },
    );
  }

  return items;
}

/**
 * Merge runner-saved packing state (from races.meta.packing) with the
 * generated default list. Order is preserved; runner edits to `packed`
 * carry through.
 */
export function mergePackingList(
  defaults: PackingItem[],
  saved: Array<{ item: string; packed?: boolean }> | undefined,
): PackingItem[] {
  if (!Array.isArray(saved)) return defaults;
  const byItem = new Map(saved.map((s) => [s.item.toLowerCase(), s]));
  return defaults.map((d) => {
    const s = byItem.get(d.item.toLowerCase());
    return s ? { ...d, packed: Boolean(s.packed) } : d;
  });
}
