-- 103_learn_articles.sql
-- Closed loop §8.5: the in-app "Read the research →" reader.
-- Faff owns the article surface. Coach-voice prose + structured citations.
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/103_learn_articles.sql

CREATE TABLE IF NOT EXISTS learn_articles (
    id              bigserial PRIMARY KEY,
    slug            text NOT NULL UNIQUE,     -- e.g. 'why-rest-works', 'hrv', 'vo2-max'
    title           text NOT NULL,
    eyebrow         text,                     -- e.g. 'RECOVERY', 'PHYSIOLOGY'
    body_md         text NOT NULL,            -- coach-voice prose, 3-4 paragraphs
    citations_json  jsonb NOT NULL DEFAULT '[]'::jsonb,
                                              -- [{ author, year, title, journal?, doi?, url? }]
    related_slugs   text[] NOT NULL DEFAULT '{}',
    updated_ts      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learn_articles_slug_idx ON learn_articles (slug);

COMMENT ON TABLE learn_articles IS
  'Curated coach-voice explainers. Linked from fun_fact cards. Citations point to actual papers/DOIs.';
