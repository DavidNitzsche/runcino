import { describe, expect, it } from 'vitest';
import {
  formatHMS, formatPace, formatPaceMi, parseHMS,
  metersToMiles, M_PER_MI, FT_PER_M,
} from '../time';

describe('time utilities', () => {
  it('formats hours:minutes:seconds', () => {
    expect(formatHMS(0)).toBe('0:00:00');
    expect(formatHMS(61)).toBe('0:01:01');
    expect(formatHMS(13800)).toBe('3:50:00');   // Big Sur 3:50 goal
    expect(formatHMS(13200)).toBe('3:40:00');   // LA baseline
  });

  it('rounds subsecond values', () => {
    expect(formatHMS(59.4)).toBe('0:00:59');
    expect(formatHMS(59.5)).toBe('0:01:00');
  });

  it('formats pace in m:ss', () => {
    expect(formatPace(520)).toBe('8:40');
    expect(formatPace(595)).toBe('9:55');
    expect(formatPace(300)).toBe('5:00');
  });

  it('formats pace with /mi suffix', () => {
    expect(formatPaceMi(520)).toBe('8:40/mi');
  });

  it('parses h:mm:ss', () => {
    expect(parseHMS('3:50:00')).toBe(13800);
    expect(parseHMS('0:15:45')).toBe(945);
    expect(parseHMS('badinput')).toBeNull();
    expect(parseHMS('3:50')).toBeNull();     // require h:mm:ss
  });

  it('converts meters to miles with 2-decimal rounding', () => {
    expect(metersToMiles(42195)).toBe(26.22);
    expect(metersToMiles(1609.344)).toBe(1.0);
    expect(metersToMiles(0)).toBe(0);
  });

  it('has correct unit constants', () => {
    expect(M_PER_MI).toBeCloseTo(1609.344, 3);
    expect(FT_PER_M).toBeCloseTo(3.28084, 4);
  });
});
