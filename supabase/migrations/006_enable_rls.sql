-- Row Level Security: los clientes anonimos NO tienen acceso directo
-- a tablas sensibles. Solo el servidor (service_role) puede operar.

ALTER TABLE visitor_daily_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE quota_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE ip_rate_limits ENABLE ROW LEVEL SECURITY;

-- Negar todo acceso desde clientes anonimos (sin politica = sin acceso)
-- El servicio de servidor usa service_role que bypass RLS por defecto.

-- Roles custom para futuro uso (opcional, no requerido para MVP)
-- CREATE ROLE vendefacil_reader;
-- CREATE ROLE vendefacil_writer;

-- Comentarios de seguridad
COMMENT ON TABLE visitor_daily_quota IS 'RLS activo: solo servicio servidor.';
COMMENT ON TABLE quota_reservations IS 'RLS activo: solo servicio servidor.';
COMMENT ON TABLE generation_records IS 'RLS activo: solo servicio servidor.';
COMMENT ON TABLE budget_tracking IS 'RLS activo: solo servicio servidor.';
COMMENT ON TABLE ip_rate_limits IS 'RLS activo: solo servicio servidor.';
