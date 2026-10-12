-- Tabla: ip_rate_limits
-- Rate limiting por IP (sliding window).
-- Almacena solo ventanas activas; limpieza de 24 horas.

CREATE TABLE IF NOT EXISTS ip_rate_limits (
  id BIGSERIAL PRIMARY KEY,
  ip_address INET NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  CONSTRAINT uq_ip_window UNIQUE (ip_address, window_start)
);

CREATE INDEX idx_ip_lookup ON ip_rate_limits (ip_address, window_start);
CREATE INDEX idx_ip_window_start ON ip_rate_limits (window_start);

COMMENT ON TABLE ip_rate_limits IS 'Rate limiting por IP (sliding window).';
COMMENT ON COLUMN ip_rate_limits.window_start IS 'Inicio de la ventana de conteo.';
