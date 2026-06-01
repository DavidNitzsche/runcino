-- Migration 130 · course_library net_elevation_ft
-- ----------------------------------------------------------------------
-- Adds the signed net elevation change (finish_elev_ft - start_elev_ft)
-- to course_library so the Targets GapPanel's Course chunk can apply
-- Daniels' elevation correction with directional accuracy:
--
--     time_impact_sec_per_mi = +10 * (net_climb_ft_per_mi / 100)
--                              - 7 * (net_drop_ft_per_mi / 100)
--
-- Without a signed net, a downhill marathon (CIM · ~-340 ft net) looks
-- the same as a flat one, even though the runner gets ~30-60 sec of free
-- time. With it, the Course chunk reads honestly per race.
--
-- The existing `elevation_gain_ft` column stays as the GROSS climbed-feet
-- (sum of positive deltas across the course) and continues to drive the
-- fatigue-cost component. Net + gross are independent inputs to the model.
--
-- Nullable: stub courses leave it null and the panel hides the chunk
-- gracefully. Editorial courses seed it explicitly below.
-- ----------------------------------------------------------------------

ALTER TABLE course_library
  ADD COLUMN IF NOT EXISTS net_elevation_ft INTEGER;

COMMENT ON COLUMN course_library.net_elevation_ft IS
  'Signed net elevation change in feet (finish_elev - start_elev). Positive = net climb, negative = net drop. Null = unknown. Used by lib/training/course-impact.ts for Daniels elevation correction.';

-- Seed the 4 known editorial courses. Numbers from race-website
-- elevation profiles + USGS:
--   AFC Half     · ~flat with a few rollers. Net ~0.
--   CIM          · Folsom → Sacramento. Famous net-downhill marathon.
--                  Wikipedia: 340 ft net drop end-to-end.
--   Big Sur      · Carmel → Big Sur. Net climb finish higher than start.
--                  ~+260 ft net (Hurricane Point + uphill last 4 mi).
--   Sombrero     · loop course in San Diego. Net ~0.
UPDATE course_library SET net_elevation_ft =    0 WHERE slug = 'americas-finest-city';
UPDATE course_library SET net_elevation_ft = -340 WHERE slug = 'cim';
UPDATE course_library SET net_elevation_ft = +260 WHERE slug = 'big-sur-marathon';
UPDATE course_library SET net_elevation_ft =    0 WHERE slug = 'sombrero-half';
