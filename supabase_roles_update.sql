-- ============================================================================
-- APEX ESPORTS — ROLES & PAYMENT VERIFICATION UPDATE
-- Run this in Supabase Dashboard -> SQL Editor -> Run (Ctrl + Enter)
-- ============================================================================

-- 1. ADD 'admin' TO admin_role_t ENUM (IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_role_t' AND e.enumlabel = 'admin'
  ) THEN
    ALTER TYPE admin_role_t ADD VALUE 'admin';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. UPDATE has_role TO SUPPORT 'owner' AND 'admin' (PLUS LEGACY 'moderator' & 'finance')
CREATE OR REPLACE FUNCTION has_role(roles admin_role_t[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin_roles
    WHERE user_id = auth.uid()
      AND (
        role = ANY(roles)
        -- An 'admin' has full moderator and finance powers
        OR (role = 'admin'::admin_role_t AND ('moderator'::admin_role_t = ANY(roles) OR 'finance'::admin_role_t = ANY(roles)))
        -- Owner has all powers
        OR role = 'owner'::admin_role_t
      )
  );
$$;

GRANT EXECUTE ON FUNCTION has_role(admin_role_t[]) TO authenticated, anon;

-- 3. ADMIN MANAGE ROLE (Owner can promote anyone to 'admin' or revoke)
CREATE OR REPLACE FUNCTION admin_manage_role(
  p_email  text,
  p_role   text,
  p_action text   -- 'grant' or 'revoke'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_id uuid;
  v_role_enum admin_role_t;
BEGIN
  IF NOT has_role(ARRAY['owner']::admin_role_t[]) THEN
    RAISE EXCEPTION 'unauthorized: platform owner only';
  END IF;

  -- Normalize role: treat admin, moderator, finance properly
  IF lower(p_role) = 'admin' THEN
    v_role_enum := 'admin'::admin_role_t;
  ELSIF lower(p_role) = 'moderator' THEN
    v_role_enum := 'moderator'::admin_role_t;
  ELSIF lower(p_role) = 'finance' THEN
    v_role_enum := 'finance'::admin_role_t;
  ELSE
    RAISE EXCEPTION 'invalid_role: can only manage admin role (not owner)';
  END IF;

  SELECT id INTO v_target_id FROM auth.users WHERE lower(email) = lower(trim(p_email));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found: no registered account found for %', p_email;
  END IF;

  IF p_action = 'grant' THEN
    INSERT INTO admin_roles (user_id, role)
    VALUES (v_target_id, v_role_enum)
    ON CONFLICT (user_id, role) DO NOTHING;

  ELSIF p_action = 'revoke' THEN
    DELETE FROM admin_roles WHERE user_id = v_target_id AND role = v_role_enum;

  ELSE
    RAISE EXCEPTION 'invalid_action: must be grant or revoke';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_manage_role(text, text, text) TO authenticated;

-- 4. TRANSFER PLATFORM OWNERSHIP (Owner can transfer platform ownership to any user)
CREATE OR REPLACE FUNCTION admin_transfer_ownership(p_new_owner_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_owner_id uuid;
  v_current_user_id uuid := auth.uid();
BEGIN
  IF NOT has_role(ARRAY['owner']::admin_role_t[]) THEN
    RAISE EXCEPTION 'unauthorized: only current platform owner can transfer ownership';
  END IF;

  SELECT id INTO v_new_owner_id FROM auth.users WHERE lower(email) = lower(trim(p_new_owner_email));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found: no registered user found with email %', p_new_owner_email;
  END IF;

  IF v_new_owner_id = v_current_user_id THEN
    RAISE EXCEPTION 'already_owner: You already own this platform';
  END IF;

  -- Step down current owner to admin
  DELETE FROM admin_roles WHERE user_id = v_current_user_id AND role = 'owner'::admin_role_t;
  INSERT INTO admin_roles (user_id, role)
  VALUES (v_current_user_id, 'admin'::admin_role_t)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Remove any existing non-owner role for the new owner
  DELETE FROM admin_roles WHERE user_id = v_new_owner_id;

  -- Grant owner to new owner
  INSERT INTO admin_roles (user_id, role)
  VALUES (v_new_owner_id, 'owner'::admin_role_t);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_transfer_ownership(text) TO authenticated;

-- 5. LIST ROLES (Owner can view all roles)
CREATE OR REPLACE FUNCTION admin_list_roles()
RETURNS TABLE (email text, role text, granted_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.email::text,
    ar.role::text,
    ar.created_at AS granted_at
  FROM admin_roles ar
  JOIN auth.users u ON u.id = ar.user_id
  WHERE has_role(ARRAY['owner']::admin_role_t[])
  ORDER BY
    CASE WHEN ar.role = 'owner'::admin_role_t THEN 1 ELSE 2 END,
    ar.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION admin_list_roles() TO authenticated;

-- 6. CHECK PAYMENT STATUS (Public / Guest RPC to poll approval state)
CREATE OR REPLACE FUNCTION check_payment_status(p_utr text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay payments%ROWTYPE;
BEGIN
  SELECT * INTO v_pay FROM payments WHERE utr = trim(p_utr);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'status', v_pay.status,
    'utr', v_pay.utr,
    'amount_paise', v_pay.amount_paise,
    'order_id', v_pay.order_id,
    'created_at', v_pay.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_payment_status(text) TO authenticated, anon;

-- 7. SUBMIT ORDER UTR (Hold slot with pending_verification state)
CREATE OR REPLACE FUNCTION submit_order_utr(p_order_id uuid, p_utr text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  IF p_utr !~ '^[0-9]{12}$' THEN
    RAISE EXCEPTION 'invalid_utr: UTR must be exactly 12 digits';
  END IF;

  IF EXISTS (SELECT 1 FROM payments WHERE utr = p_utr) THEN
    RAISE EXCEPTION 'duplicate_utr: This UTR reference number has already been used';
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'order_not_pending: Order status is %', v_order.status;
  END IF;

  IF v_order.expires_at < now() THEN
    RAISE EXCEPTION 'order_expired: Slot hold has expired. Please re-register.';
  END IF;

  -- Record payment as pending_verification
  INSERT INTO payments (order_id, utr, amount_paise, status)
  VALUES (p_order_id, p_utr, v_order.total_paise, 'pending_verification');

  -- Hold registrations under pending_approval (NOT revealed until admin approval)
  UPDATE registrations
  SET status = 'pending_approval'
  WHERE order_id = p_order_id AND status = 'pending_payment';

  -- Reserve the slots
  UPDATE events e
  SET filled_slots = filled_slots + sub.cnt
  FROM (
    SELECT event_id, count(*)::int AS cnt
    FROM registrations
    WHERE order_id = p_order_id
    GROUP BY event_id
  ) sub
  WHERE e.id = sub.event_id;

  UPDATE orders SET status = 'submitted' WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'utr', p_utr);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_order_utr(uuid, text) TO authenticated;

-- 8. VERIFY PAYMENT (Owner and Admins can approve or reject)
CREATE OR REPLACE FUNCTION admin_verify_payment(p_utr text, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay payments%ROWTYPE;
BEGIN
  IF NOT has_role(ARRAY['owner', 'admin', 'moderator', 'finance']::admin_role_t[]) THEN
    RAISE EXCEPTION 'unauthorized: owner or admin only';
  END IF;

  SELECT * INTO v_pay FROM payments WHERE utr = p_utr FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE payments SET status = 'approved' WHERE utr = p_utr;
    -- Unlock registration and credentials:
    UPDATE registrations SET status = 'confirmed' WHERE order_id = v_pay.order_id;
    UPDATE orders SET status = 'paid' WHERE id = v_pay.order_id;

  ELSIF p_action = 'reject' THEN
    UPDATE payments SET status = 'rejected' WHERE utr = p_utr;

    -- Revert registrations and decrement filled_slots
    UPDATE events e
    SET filled_slots = GREATEST(0, filled_slots - sub.cnt)
    FROM (
      SELECT event_id, count(*)::int AS cnt
      FROM registrations
      WHERE order_id = v_pay.order_id
      GROUP BY event_id
    ) sub
    WHERE e.id = sub.event_id;

    UPDATE registrations SET status = 'cancelled' WHERE order_id = v_pay.order_id;
    UPDATE orders SET status = 'refunded' WHERE id = v_pay.order_id;

  ELSE
    RAISE EXCEPTION 'invalid_action: must be approve or reject';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_verify_payment(text, text) TO authenticated;

-- ============================================================================
-- 9. POINTS TABLE & MATCH RESULTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS points_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  match_number int NOT NULL DEFAULT 1,
  data jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_published boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(event_id, match_number)
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS screenshot_url text;

CREATE OR REPLACE FUNCTION admin_save_points_table(
  p_event_id uuid,
  p_match_number int,
  p_data jsonb,
  p_is_published boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(ARRAY['owner', 'admin', 'moderator', 'finance']::admin_role_t[]) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO points_tables (event_id, match_number, data, is_published, updated_at)
  VALUES (p_event_id, p_match_number, p_data, p_is_published, now())
  ON CONFLICT (event_id, match_number)
  DO UPDATE SET
    data = EXCLUDED.data,
    is_published = EXCLUDED.is_published,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION admin_save_points_table(uuid, int, jsonb, boolean) TO authenticated;

-- ============================================================================
-- 10. GET PUBLIC POINTS TABLE
-- ============================================================================
CREATE OR REPLACE FUNCTION get_points_table(p_event_id uuid)
RETURNS TABLE (
  match_number int,
  data jsonb,
  is_published boolean,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT match_number, data, is_published, updated_at
  FROM points_tables
  WHERE event_id = p_event_id AND is_published = true
  ORDER BY match_number ASC;
$$;

GRANT EXECUTE ON FUNCTION get_points_table(uuid) TO authenticated, anon;

-- ============================================================================
-- 11. CANONICAL create_registration_order & create_order
-- ============================================================================
CREATE OR REPLACE FUNCTION create_registration_order(
  p_event_ids uuid[],
  p_whatsapp text,
  p_team_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid := gen_random_uuid();
  v_expires_at timestamptz := now() + interval '10 minutes';
  v_total_paise int := 0;
  v_event events%ROWTYPE;
  v_eid uuid;
  v_fee int;
BEGIN
  -- Compute total fee
  FOREACH v_eid IN ARRAY p_event_ids LOOP
    SELECT * INTO v_event FROM events WHERE id = v_eid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'event_not_found: %', v_eid;
    END IF;

    IF v_event.early_bird_fee_paise IS NOT NULL AND v_event.filled_slots < v_event.early_bird_slots THEN
      v_fee := v_event.early_bird_fee_paise;
    ELSE
      v_fee := v_event.entry_fee_paise;
    END IF;
    v_total_paise := v_total_paise + v_fee;
  END LOOP;

  -- Insert order
  INSERT INTO orders (id, whatsapp, total_paise, status, expires_at)
  VALUES (v_order_id, p_whatsapp, v_total_paise, 'pending', v_expires_at);

  -- Insert registrations
  FOREACH v_eid IN ARRAY p_event_ids LOOP
    SELECT * INTO v_event FROM events WHERE id = v_eid;
    IF v_event.early_bird_fee_paise IS NOT NULL AND v_event.filled_slots < v_event.early_bird_slots THEN
      v_fee := v_event.early_bird_fee_paise;
    ELSE
      v_fee := v_event.entry_fee_paise;
    END IF;

    INSERT INTO registrations (order_id, event_id, whatsapp, team_name, status, amount_paise)
    VALUES (v_order_id, v_eid, p_whatsapp, p_team_name, 'pending_payment', v_fee);
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'expires_at', v_expires_at,
    'total_paise', v_total_paise
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_registration_order(uuid[], text, text) TO authenticated, anon;

-- Wrapper for legacy create_order
CREATE OR REPLACE FUNCTION create_order(
  p_whatsapp text,
  p_events uuid[],
  p_teams text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN create_registration_order(
    p_events,
    p_whatsapp,
    CASE WHEN array_length(p_teams, 1) > 0 THEN p_teams[1] ELSE 'Unknown Squad' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_order(text, uuid[], text[]) TO authenticated, anon;

-- ============================================================================
-- 12. PERMISSIONS & ROW LEVEL SECURITY FIX (Eliminates permission denied errors)
-- ============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE orders TO anon, authenticated;
GRANT ALL ON TABLE registrations TO anon, authenticated;
GRANT ALL ON TABLE payments TO anon, authenticated;
GRANT ALL ON TABLE events TO anon, authenticated;
GRANT ALL ON TABLE points_tables TO anon, authenticated;

-- Ensure RLS allows guest & user registration without permission errors
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_public_insert_orders" ON orders;
CREATE POLICY "allow_public_insert_orders" ON orders FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "allow_public_select_orders" ON orders;
CREATE POLICY "allow_public_select_orders" ON orders FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "allow_public_update_orders" ON orders;
CREATE POLICY "allow_public_update_orders" ON orders FOR UPDATE TO anon, authenticated USING (true);

ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_public_insert_registrations" ON registrations;
CREATE POLICY "allow_public_insert_registrations" ON registrations FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "allow_public_select_registrations" ON registrations;
CREATE POLICY "allow_public_select_registrations" ON registrations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "allow_public_update_registrations" ON registrations;
CREATE POLICY "allow_public_update_registrations" ON registrations FOR UPDATE TO anon, authenticated USING (true);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_public_insert_payments" ON payments;
CREATE POLICY "allow_public_insert_payments" ON payments FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "allow_public_select_payments" ON payments;
CREATE POLICY "allow_public_select_payments" ON payments FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "allow_public_update_payments" ON payments;
CREATE POLICY "allow_public_update_payments" ON payments FOR UPDATE TO anon, authenticated USING (true);

-- ============================================================================
-- 13. TOP 4 TEAMS & FINAL POINTS TABLE IMAGE COLUMNS
-- ============================================================================
ALTER TABLE events ADD COLUMN IF NOT EXISTS top_teams jsonb DEFAULT '{"first": "", "second": "", "third": "", "fourth": ""}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS final_points_table_url text;

-- ============================================================================
-- 14. AUTO TRANSITION LOBBY STATUS: LIVE -> COMPLETED 20M AFTER MATCH 3 IDP
-- ============================================================================
CREATE OR REPLACE FUNCTION auto_update_lobby_statuses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Open lobbies whose start time has arrived transition to 'live'
  UPDATE events
  SET status = 'live'
  WHERE status = 'open'
    AND starts_at <= now()
    AND is_published = true;

  -- 2. Once Match 3 has completed (80 minutes from lobby start, which is Match 3 IDP at +60m + 20 minutes)
  UPDATE events
  SET status = 'completed'
  WHERE status = 'live'
    AND starts_at <= (now() - interval '80 minutes');
END;
$$;

GRANT EXECUTE ON FUNCTION auto_update_lobby_statuses() TO authenticated, anon;


