-- Tabla: quota_reservations
-- Reservas atomicas de cuota con ciclo de vida: pending -> completed | released | expired.
-- Permite manejo de concurrencia mediante FOR UPDATE y liberacion automatica.

CREATE TABLE IF NOT EXISTS quota_reservations (
  id BIGSERIAL PRIMARY KEY,
  visitor_id UUID NOT NULL,
  reservation_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'released', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_reservation_id UNIQUE (reservation_id),
  CONSTRAINT chk_expires_after_created CHECK (expires_at > created_at),
  CONSTRAINT chk_completed_after_created CHECK (completed_at IS NULL OR completed_at >= created_at)
);

CREATE INDEX idx_reservations_pending ON quota_reservations (visitor_id, status)
  WHERE status = 'pending';
CREATE INDEX idx_reservations_expiry ON quota_reservations (expires_at)
  WHERE status = 'pending';
CREATE INDEX idx_reservations_visitor ON quota_reservations (visitor_id, created_at);

COMMENT ON TABLE quota_reservations IS 'Reservas atomicas de cuota con expiracion y liberacion.';
COMMENT ON COLUMN quota_reservations.status IS 'pending: activa, completed: exitosa, released: fallida sin consumo, expired: tiempo agotado.';
