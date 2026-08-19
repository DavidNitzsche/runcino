-- 151_shoes_shoe_type.sql
-- Shoe retirement (iPhone design, 2026-08-19): a shoe's CATEGORY.
--
-- The design draws a progress bar against "that model's retirement mileage",
-- and `Research/17-footwear.md` § "Mileage Lifespan by Category" bands that
-- mileage per category (super shoe 150-250 mi, daily trainer 400-500, …).
-- Nothing in the schema said which category a shoe is, so every surface fell
-- back to a hardcoded number and five different ones were in use.
--
-- Why a column and not a read-time derivation: category cannot be inferred.
-- Deciding from brand/model text whether a pair is a super shoe or a daily
-- trainer needs a lookup table of every shoe ever made; guessing it would be
-- fabrication of exactly the kind the doctrine gate exists to stop. It is new
-- information only the runner has.
--
-- The DEFAULT stays read-time (lib/shoe/lifespan.ts · resolveShoeCapMi), so
-- this migration writes nothing and back-fills nothing:
--   · NULL shoe_type reads as 'daily_trainer' (DEFAULT_SHOE_TYPE) — the same
--     400 mi those rows are already drawn against, so no existing bar moves.
--   · An explicit shoes.mileage_cap still wins over the doctrine default, so
--     every row that already has one (all 8 in prod at time of writing) is
--     completely unaffected.
--
-- Additive only: new nullable column, no drop, no rename, no NOT NULL on
-- existing data, no default. Idempotent.

ALTER TABLE shoes ADD COLUMN IF NOT EXISTS shoe_type TEXT;

COMMENT ON COLUMN shoes.shoe_type IS
  'Shoe category, one of lib/shoe/lifespan.ts ShoeType (daily_trainer, max_cushion, '
  'tempo_trainer, super_shoe, racing_flat, trail, track_spike, stability). NULL reads '
  'as daily_trainer. Sets the default retirement mileage from Research/17-footwear.md; '
  'an explicit mileage_cap overrides it.';
