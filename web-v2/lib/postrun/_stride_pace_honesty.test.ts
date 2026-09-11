/**
 * lib/postrun/_stride_pace_honesty.test.ts · SHORT-STRIDE-PACE-1 (2026-09-09).
 *
 * David's real six strides (`runs.id -218380344929823`, 2026-09-09, read
 * read-only) each ran 20-22 s with 4-5 GPS pace samples, and the server's
 * `avgSecPerMi` for them (399, 412, 403, 405, 465, 456 s/mi) is a real
 * distance-over-duration ratio — not invented — but it is a ratio over
 * ~260 ft of GPS track, where `Research/15`'s own point ("instantaneous pace
 * is noisy even with good GPS") bites hardest. Task requirement: mark it
 * `~` modelled rather than presenting it with a mile split's precision, and
 * where a stride genuinely carries no distance/duration to divide, say
 * "Pace unavailable" rather than silently dropping the cell (Rule 11: "don't
 * know" and "measured, just approximate" are two different facts).
 *
 * FAIL-BEFORE: before this fix, `PostRunStrideWire.pace` was a bare
 * `string | null` (`fmtPaceSlash(s.paceSecPerMi)`) with no provenance at
 * all — a real stride pace and a mile-split pace were indistinguishable on
 * the wire, and a null pace was silently omitted from the row rather than
 * stated. `testBarePaceHadNoProvenance` reproduces that shape directly to
 * keep the regression named.
 *
 * PASS-AFTER: `stridePaceWire` always returns an object, always modelled,
 * and never a null `text` — the two real cases below.
 */
import { describe, it, expect } from 'vitest';
import { stridePaceWire } from './wire';

describe('SHORT-STRIDE-PACE-1 · stridePaceWire', () => {
  it('marks a real stride pace modelled — David\'s own six, verbatim', () => {
    // 399/412/403/405/465/456 s/mi, verbatim from the 2026-09-09 row.
    for (const secPerMi of [399, 412, 403, 405, 465, 456]) {
      const w = stridePaceWire(secPerMi);
      expect(w.modelled).toBe(true);
      expect(w.text).not.toBeNull();
      expect(w.text).toMatch(/\/mi$/);
    }
    expect(stridePaceWire(399).text).toBe('6:39/mi');
  });

  it('says "Pace unavailable" — never a silently dropped cell — when the phase has nothing to divide', () => {
    const w = stridePaceWire(null);
    expect(w.text).toBe('Pace unavailable');
    // Rule 11: absence and "measured, imprecisely" are different facts, even
    // though both set `modelled: true` here — the CLIENT tells them apart
    // because a phrase with no digits (`FaffValue.from`'s own rule) never
    // renders with any estimate framing, only a real number does.
    expect(w.modelled).toBe(true);
  });

  it('FAIL-BEFORE: the old bare-string shape could not carry this distinction at all', () => {
    // This is what `PostRunStrideWire.pace` used to be — one field, one type,
    // no way to say "this is estimated" or "this is absent" differently from
    // "this run genuinely had no pace field at all".
    const legacyShape = (paceSecPerMi: number | null): string | null => (
      paceSecPerMi != null ? `${Math.floor(paceSecPerMi / 60)}:${String(paceSecPerMi % 60).padStart(2, '0')}/mi` : null
    );
    // A real, if noisy, stride pace and a genuinely absent one both render as
    // "nothing" the instant paceSecPerMi is null — no sentence, no marker.
    expect(legacyShape(null)).toBeNull();
    expect(legacyShape(399)).not.toBeNull();
    // The new shape distinguishes them: absence gets a sentence, presence
    // gets a marker — neither of which the legacy shape could express.
    expect(stridePaceWire(null).text).not.toBeNull();
    expect(stridePaceWire(null).text).not.toBe(legacyShape(399));
  });
});
