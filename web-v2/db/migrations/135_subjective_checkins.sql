-- Migration 135 · subjective_checkins
-- ----------------------------------------------------------------------
-- Daily morning "how do you feel" rating · 0-10 scale. The strongest
-- single recovery signal per Saw et al. 2016 systematic review · when
-- the runner's subjective read disagrees with the objective composite
-- by ≥15 pts, subjective wins (locked doctrine in
-- lib/coach/readiness-brief.ts subjectiveOverride block).
--
-- One row per (user, date) · re-answering overwrites via UPSERT so the
-- runner can correct a tap-mistake within the day.
--
-- Read by lib/coach/readiness-brief.ts to populate:
--   · subjectiveCheckin · { answeredAt, rating, answered } envelope
--   · subjectiveOverride · when |objective - subjective×10| ≥ 15
--
-- Web agent brief · readiness-brief-field-additions.md §1.
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS subjective_checkins (
  id         BIGSERIAL PRIMARY KEY,
  user_uuid  UUID NOT NULL,
  date       DATE NOT NULL,
  rating     INTEGER NOT NULL CHECK (rating >= 0 AND rating <= 10),
  notes      TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (user_uuid, date)
);

CREATE INDEX IF NOT EXISTS subjective_checkins_user_date_idx
  ON subjective_checkins (user_uuid, date DESC);

COMMENT ON TABLE subjective_checkins IS
  'Daily 0-10 subjective wellness rating. Per Saw et al. 2016 · the strongest single recovery signal · overrides objective composite when |delta| ≥ 15 pts. Composer reads via lib/coach/readiness-brief.ts.';

COMMENT ON COLUMN subjective_checkins.rating IS
  '0-10 · 0 = wrecked, 5 = average day, 10 = primed. UI captures 2/4/6/8/10 buttons but column accepts 0-10 for flexibility.';
