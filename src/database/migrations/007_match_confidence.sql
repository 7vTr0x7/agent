ALTER TABLE match_decisions
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000
    CHECK (confidence >= 0 AND confidence <= 1);

CREATE INDEX IF NOT EXISTS idx_match_decisions_confidence
  ON match_decisions (confidence);
