-- 113_shoe_color2.sql
-- #168: second accent color per shoe → gradient cards on /profile.
-- Existing `color` column stays as primary; new `color2` is optional secondary.
-- When both set, the shoe card renders linear-gradient(135deg, color, color2).
-- When only color set, render a single-color tint.
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/113_shoe_color2.sql

ALTER TABLE shoes
  ADD COLUMN IF NOT EXISTS color2 text;

COMMENT ON COLUMN shoes.color  IS 'Primary accent color (hex). Renders as gradient origin on the rotation card.';
COMMENT ON COLUMN shoes.color2 IS 'Optional secondary accent color (hex). When set, card renders a two-tone gradient.';
