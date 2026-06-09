-- 141_shoes_baseline_mi.sql
-- AUDIT-FIXES.md item 16-A: pre-app starting mileage.
-- Shoes that had miles on them before the runner joined the app showed 0.
-- Display mileage = baseline_mi + on-read computed sum (lib/shoe/mileage.ts).
-- Idempotent: IF NOT EXISTS is safe to re-run.

ALTER TABLE shoes ADD COLUMN IF NOT EXISTS baseline_mi NUMERIC(7,2) NOT NULL DEFAULT 0;
