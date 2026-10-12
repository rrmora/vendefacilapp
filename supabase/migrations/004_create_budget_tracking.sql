-- Tabla: budget_tracking
-- Presupuesto mensual para proveedores de pago.
-- spent_usd: consumo confirmado. reserved_usd: reservas pendientes de conciliacion.

CREATE TABLE IF NOT EXISTS budget_tracking (
  id BIGSERIAL PRIMARY KEY,
  month VARCHAR(7) NOT NULL,
  total_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 5.00 CHECK (total_budget_usd > 0),
  spent_usd NUMERIC(10, 6) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  reserved_usd NUMERIC(10, 6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_budget_month UNIQUE (month),
  CONSTRAINT chk_month_format CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT chk_spent_not_negative CHECK (spent_usd >= 0)
);

CREATE INDEX idx_budget_month ON budget_tracking (month);

COMMENT ON TABLE budget_tracking IS 'Presupuesto mensual para proveedores de pago.';
COMMENT ON COLUMN budget_tracking.spent_usd IS 'Consumo confirmado (real o estimado conciliado).';
COMMENT ON COLUMN budget_tracking.reserved_usd IS 'Reservas pendientes de conciliacion post-generacion.';
