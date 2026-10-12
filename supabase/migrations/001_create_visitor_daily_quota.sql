-- Tabla: visitor_daily_quota
-- Cuota diaria de generaciones por visitante anonimo.
-- La fecha de cuota se calcula en America/Mexico_City (UTC-6, sin DST).

CREATE TABLE IF NOT EXISTS visitor_daily_quota (
  id BIGSERIAL PRIMARY KEY,
  visitor_id UUID NOT NULL,
  quota_date DATE NOT NULL,
  generations_used INTEGER NOT NULL DEFAULT 0 CHECK (generations_used >= 0),
  max_generations INTEGER NOT NULL DEFAULT 5 CHECK (max_generations > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_visitor_daily UNIQUE (visitor_id, quota_date)
);

CREATE INDEX idx_quota_lookup ON visitor_daily_quota (visitor_id, quota_date);

COMMENT ON TABLE visitor_daily_quota IS 'Cuota diaria de generaciones por visitante.';
COMMENT ON COLUMN visitor_daily_quota.quota_date IS 'Fecha de cuota calculada en America/Mexico_City (UTC-6).';
