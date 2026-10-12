-- Tabla: generation_records
-- Registro de consumo facturable (real o estimado).
-- Permite distinguir cuota consumida de presupuesto potencialmente facturable.

CREATE TABLE IF NOT EXISTS generation_records (
  id BIGSERIAL PRIMARY KEY,
  visitor_id UUID NOT NULL,
  reservation_id UUID,
  success BOOLEAN NOT NULL,
  provider VARCHAR(50),
  model VARCHAR(100),
  tokens_input INTEGER CHECK (tokens_input IS NULL OR tokens_input >= 0),
  tokens_output INTEGER CHECK (tokens_output IS NULL OR tokens_output >= 0),
  estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  cost_estimated BOOLEAN NOT NULL DEFAULT false,
  error_code VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_reservation FOREIGN KEY (reservation_id)
    REFERENCES quota_reservations (reservation_id) ON DELETE SET NULL
);

CREATE INDEX idx_gen_visitor ON generation_records (visitor_id, created_at);
CREATE INDEX idx_gen_cost ON generation_records (created_at, estimated_cost_usd);
CREATE INDEX idx_gen_created_at ON generation_records (created_at);

COMMENT ON INDEX idx_gen_created_at IS 'Consultas mensuales: usar limites UTC con >= inicio y < fin de mes.';
CREATE INDEX idx_gen_success ON generation_records (success, created_at);

COMMENT ON TABLE generation_records IS 'Registro de consumo facturable de IA.';
COMMENT ON COLUMN generation_records.cost_estimated IS 'true cuando el costo es estimado (proveedor no reporto tokens).';
COMMENT ON COLUMN generation_records.reservation_id IS 'Reserva de cuota asociada (null si no hubo reserva).';
