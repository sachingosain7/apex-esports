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
