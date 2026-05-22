/**
 * Coach-decided carb intake rate.
 *
 * The user shouldn't have to pick "60 g/hr vs 90 g/hr", that's the
 * coach's job. The rate scales with effort duration, with a floor at
 * 30 g/hr (any race under ~60 min doesn't really benefit from gels)
 * and a ceiling at 90 g/hr (the upper bound most guts tolerate).
 *
 * Research basis:
 *   - <90 min efforts:  fuel pre-race; in-race rate is optional/30 g/hr
 *   - 90-180 min:       60 g/hr is the classic sweet spot
 *   - 180+ min:         70-90 g/hr if the gut is trained for it
 *
 * @research Research/14-fueling-during-runs.md §Intake by duration
 */
export function coachCarbRate(finishS: number): number {
  if (!finishS || finishS <= 0) return 60;
  const hours = finishS / 3600;
  if (hours < 1)    return 30;  // Sub-hour: token gel, mostly pre-race
  if (hours < 1.5)  return 50;  // Half marathon at ~1:20-1:30
  if (hours < 2.5)  return 60;  // Standard half / fast marathon
  if (hours < 3.5)  return 70;  // 3-hour marathon territory
  if (hours < 4.5)  return 80;  // 4-hour marathon
  return 90;                    // Ultra / 4.5+ hour effort
}
