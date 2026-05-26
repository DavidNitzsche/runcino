/**
 * GET /api/tips
 *
 * Form-metric tip library, serialized for the iPhone Tips view. The web
 * /tips page reads `lib/training/form-tips.ts` directly; this is the
 * JSON wrapper. Returns the same shape, minus the `classify` function
 * (not transportable).
 */
import { NextResponse } from 'next/server';
import { allTips } from '@/lib/training/form-tips';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tips = allTips().map((t) => ({
    key: t.key,
    title: t.title,
    unit: t.unit,
    one_liner: t.oneLiner,
    what_it_is: t.whatItIs,
    why_it_matters: t.whyItMatters,
    bands: t.bands.map((b) => ({
      band: b.band,
      range: b.range,
      label: b.label,
      meaning: b.meaning,
    })),
    drills_when_flagged: t.drillsWhenFlagged,
  }));
  return NextResponse.json({ tips });
}
