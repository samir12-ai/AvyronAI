-- 048 — P-2 Final Phase: Performance Loop decision verdicts + cycle reports.
--
-- performance_decision_verdicts: one append-only row per (window, recommended
-- decision). Verdict vocabulary is locked: WINNER / LOSER / INCONCLUSIVE /
-- NOT_EXECUTED / NEEDS_MORE_DATA. Sales (paying_customers COUNT from user
-- truth) is the only primary success metric; NULL is never coerced to 0.
-- The unique index freezes a window's verdicts at the first COMPLETE cycle —
-- superseded truth never rewrites history.
--
-- performance_cycle_reports: one row per (campaign, window) — the full weekly
-- review artifact (verdict counts, preserve/reject/uncertain/not-executed
-- lists, next-cycle recommendation, answers to the 7 evaluation questions).

CREATE TABLE IF NOT EXISTS performance_decision_verdicts (
  id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             VARCHAR NOT NULL,
  campaign_id            VARCHAR NOT NULL,
  cycle_run_id           VARCHAR NOT NULL,
  window_id              VARCHAR NOT NULL,
  window_index           INTEGER NOT NULL,
  plan_id                VARCHAR NOT NULL,
  platform               TEXT    NOT NULL,
  decision_dimension     TEXT    NOT NULL,
  decision_value         TEXT    NOT NULL,
  decision_source        TEXT    NOT NULL,
  executed               BOOLEAN NOT NULL,
  executed_post_count    INTEGER NOT NULL DEFAULT 0,
  window_start           TIMESTAMP NOT NULL,
  window_end             TIMESTAMP NOT NULL,
  sales_before           INTEGER,
  sales_after            INTEGER,
  sales_delta_rel        DOUBLE PRECISION,
  funnel_context         TEXT,
  content_context        TEXT,
  market_context         TEXT,
  confounders            TEXT    NOT NULL DEFAULT '[]',
  verdict                TEXT    NOT NULL,
  verdict_reason         TEXT    NOT NULL,
  evidence_strength      TEXT    NOT NULL,
  confidence             DOUBLE PRECISION,
  attribution_confidence TEXT,
  memory_write_status    TEXT,
  test_label             TEXT,
  verdict_version        TEXT    NOT NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS perf_decision_verdicts_uniq
  ON performance_decision_verdicts (campaign_id, window_id, decision_dimension, decision_value);
CREATE INDEX IF NOT EXISTS perf_decision_verdicts_campaign_idx
  ON performance_decision_verdicts (account_id, campaign_id, window_index);

CREATE TABLE IF NOT EXISTS performance_cycle_reports (
  id                        VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                VARCHAR NOT NULL,
  campaign_id               VARCHAR NOT NULL,
  cycle_run_id              VARCHAR NOT NULL,
  window_id                 VARCHAR NOT NULL,
  window_index              INTEGER NOT NULL,
  plan_id                   VARCHAR NOT NULL,
  platform                  TEXT    NOT NULL,
  status                    TEXT    NOT NULL,
  sales_before              INTEGER,
  sales_after               INTEGER,
  business_verdict          TEXT,
  attribution_confidence    TEXT,
  decisions_total           INTEGER NOT NULL DEFAULT 0,
  verdict_counts            TEXT    NOT NULL DEFAULT '{}',
  preserve                  TEXT    NOT NULL DEFAULT '[]',
  reject                    TEXT    NOT NULL DEFAULT '[]',
  uncertain                 TEXT    NOT NULL DEFAULT '[]',
  not_executed              TEXT    NOT NULL DEFAULT '[]',
  next_cycle_recommendation TEXT,
  interpretation_status     TEXT,
  seven_answers             TEXT    NOT NULL DEFAULT '{}',
  test_label                TEXT,
  cycle_version             TEXT    NOT NULL,
  created_at                TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS perf_cycle_reports_window_uniq
  ON performance_cycle_reports (campaign_id, window_id);
CREATE INDEX IF NOT EXISTS perf_cycle_reports_campaign_idx
  ON performance_cycle_reports (account_id, campaign_id, created_at);
