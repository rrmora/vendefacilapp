CREATE TABLE IF NOT EXISTS budget_reservations (
  id BIGSERIAL PRIMARY KEY,
  reservation_id UUID NOT NULL UNIQUE,
  budget_month VARCHAR(7) NOT NULL,
  reserved_cost_usd NUMERIC(10, 6) NOT NULL CHECK (reserved_cost_usd >= 0),
  actual_cost_usd NUMERIC(10, 6) CHECK (actual_cost_usd IS NULL OR actual_cost_usd >= 0),
  cost_estimated BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'confirmed', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT fk_budget_month FOREIGN KEY (budget_month)
    REFERENCES budget_tracking (month) ON DELETE CASCADE
);

CREATE INDEX idx_budget_reservations_month ON budget_reservations (budget_month);
CREATE INDEX idx_budget_reservations_status ON budget_reservations (status);

COMMENT ON TABLE budget_reservations IS 'Reservas idempotentes de presupuesto IA.';

CREATE OR REPLACE FUNCTION reserve_budget(
  p_reservation_id UUID,
  p_month VARCHAR(7),
  p_max_cost_usd NUMERIC,
  p_total_budget_usd NUMERIC DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_total_budget NUMERIC;
  v_spent NUMERIC;
  v_reserved NUMERIC;
  v_existing_status VARCHAR(20);
  v_existing_reserved NUMERIC;
BEGIN
  v_total_budget := COALESCE(p_total_budget_usd, 5.00);
  IF v_total_budget <= 0 THEN
    v_total_budget := 5.00;
  END IF;

  INSERT INTO budget_tracking (month, total_budget_usd, spent_usd, reserved_usd)
  VALUES (p_month, v_total_budget, 0, 0)
  ON CONFLICT (month) DO NOTHING;

  SELECT total_budget_usd, spent_usd, reserved_usd
  INTO v_total_budget, v_spent, v_reserved
  FROM budget_tracking
  WHERE month = p_month
  FOR UPDATE;

  IF v_total_budget IS NULL THEN
    v_total_budget := COALESCE(p_total_budget_usd, 5.00);
  END IF;

  SELECT status, reserved_cost_usd
  INTO v_existing_status, v_existing_reserved
  FROM budget_reservations
  WHERE reservation_id = p_reservation_id
  FOR UPDATE;

  IF v_existing_status IS NOT NULL THEN
    RETURN json_build_object(
      'status', 'already_reserved',
      'reservation_id', p_reservation_id,
      'month', p_month,
      'reserved_cost_usd', v_existing_reserved,
      'spent_usd', v_spent,
      'reserved_usd', v_reserved,
      'total_budget_usd', v_total_budget
    );
  END IF;

  IF p_max_cost_usd < 0 OR p_max_cost_usd IS NULL THEN
    RETURN json_build_object('status', 'invalid_cost');
  END IF;

  IF v_spent + v_reserved + p_max_cost_usd >= v_total_budget * 0.95 THEN
    RETURN json_build_object(
      'status', 'budget_exceeded',
      'month', p_month,
      'spent_usd', v_spent,
      'reserved_usd', v_reserved,
      'total_budget_usd', v_total_budget,
      'available_usd', GREATEST(v_total_budget * 0.95 - v_spent - v_reserved, 0)
    );
  END IF;

  INSERT INTO budget_reservations (
    reservation_id,
    budget_month,
    reserved_cost_usd,
    status
  )
  VALUES (
    p_reservation_id,
    p_month,
    p_max_cost_usd,
    'reserved'
  );

  UPDATE budget_tracking
  SET
    reserved_usd = reserved_usd + p_max_cost_usd,
    updated_at = NOW()
  WHERE month = p_month;

  RETURN json_build_object(
    'status', 'reserved',
    'reservation_id', p_reservation_id,
    'month', p_month,
    'reserved_cost_usd', p_max_cost_usd,
    'spent_usd', v_spent,
    'reserved_usd', v_reserved + p_max_cost_usd,
    'total_budget_usd', v_total_budget
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION confirm_budget(
  p_reservation_id UUID,
  p_actual_cost_usd NUMERIC,
  p_cost_estimated BOOLEAN DEFAULT FALSE
) RETURNS JSON AS $$
DECLARE
  v_budget_month VARCHAR(7);
  v_reserved_cost NUMERIC;
  v_status VARCHAR(20);
  v_total_budget NUMERIC;
  v_spent NUMERIC;
  v_reserved NUMERIC;
BEGIN
  SELECT budget_month, reserved_cost_usd, status
  INTO v_budget_month, v_reserved_cost, v_status
  FROM budget_reservations
  WHERE reservation_id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN json_build_object('status', 'not_found');
  END IF;

  IF v_status <> 'reserved' THEN
    RETURN json_build_object(
      'status', 'already_processed',
      'previous_status', v_status
    );
  END IF;

  IF p_actual_cost_usd IS NULL OR p_actual_cost_usd < 0 THEN
    p_actual_cost_usd := 0;
  END IF;

  SELECT total_budget_usd, spent_usd, reserved_usd
  INTO v_total_budget, v_spent, v_reserved
  FROM budget_tracking
  WHERE month = v_budget_month
  FOR UPDATE;

  UPDATE budget_tracking
  SET
    spent_usd = spent_usd + p_actual_cost_usd,
    reserved_usd = GREATEST(reserved_usd - v_reserved_cost, 0),
    updated_at = NOW()
  WHERE month = v_budget_month;

  UPDATE budget_reservations
  SET
    status = 'confirmed',
    actual_cost_usd = p_actual_cost_usd,
    cost_estimated = p_cost_estimated,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE reservation_id = p_reservation_id;

  RETURN json_build_object(
    'status', 'confirmed',
    'month', v_budget_month,
    'reserved_cost_usd', v_reserved_cost,
    'actual_cost_usd', p_actual_cost_usd,
    'cost_estimated', p_cost_estimated
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_budget(
  p_reservation_id UUID
) RETURNS JSON AS $$
DECLARE
  v_budget_month VARCHAR(7);
  v_reserved_cost NUMERIC;
  v_status VARCHAR(20);
BEGIN
  SELECT budget_month, reserved_cost_usd, status
  INTO v_budget_month, v_reserved_cost, v_status
  FROM budget_reservations
  WHERE reservation_id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN json_build_object('status', 'not_found');
  END IF;

  IF v_status <> 'reserved' THEN
    RETURN json_build_object(
      'status', 'already_processed',
      'previous_status', v_status
    );
  END IF;

  UPDATE budget_tracking
  SET
    reserved_usd = GREATEST(reserved_usd - v_reserved_cost, 0),
    updated_at = NOW()
  WHERE month = v_budget_month;

  UPDATE budget_reservations
  SET
    status = 'released',
    completed_at = NOW(),
    updated_at = NOW()
  WHERE reservation_id = p_reservation_id;

  RETURN json_build_object(
    'status', 'released',
    'month', v_budget_month,
    'released_cost_usd', v_reserved_cost
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_budget_status(
  p_month VARCHAR(7),
  p_total_budget_usd NUMERIC DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_total_budget NUMERIC;
  v_spent NUMERIC;
  v_reserved NUMERIC;
BEGIN
  v_total_budget := COALESCE(p_total_budget_usd, 5.00);
  IF v_total_budget <= 0 THEN
    v_total_budget := 5.00;
  END IF;

  INSERT INTO budget_tracking (month, total_budget_usd, spent_usd, reserved_usd)
  VALUES (p_month, v_total_budget, 0, 0)
  ON CONFLICT (month) DO NOTHING;

  SELECT total_budget_usd, spent_usd, reserved_usd
  INTO v_total_budget, v_spent, v_reserved
  FROM budget_tracking
  WHERE month = p_month;

  IF v_spent IS NULL THEN
    v_spent := 0;
  END IF;
  IF v_reserved IS NULL THEN
    v_reserved := 0;
  END IF;

  RETURN json_build_object(
    'month', p_month,
    'total_budget_usd', v_total_budget,
    'spent_usd', v_spent,
    'reserved_usd', v_reserved,
    'available_usd', GREATEST(v_total_budget - v_spent - v_reserved, 0),
    'threshold_usd', v_total_budget * 0.95
  );
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION reserve_budget(UUID, VARCHAR, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION confirm_budget(UUID, NUMERIC, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION release_budget(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_budget_status(VARCHAR, NUMERIC) FROM PUBLIC;