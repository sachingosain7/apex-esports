-- ============================================================
-- supabase_step9_to_12.sql
-- Idempotent migration for Steps 9-12 of Apex Esports platform.
-- Paste ONCE into Supabase SQL Editor and run.
-- ============================================================

-- ============================================================
-- STEP 0: Helper Function has_role(text[])
-- Checks if currently authenticated user has any of the required roles.
-- ============================================================
CREATE OR REPLACE FUNCTION has_role(required_roles text[])
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
      AND role::text = ANY(required_roles)
  );
$$;

GRANT EXECUTE ON FUNCTION has_role(text[]) TO authenticated, anon;

-- ============================================================
-- STEP 9A: Add new columns to events table
-- ============================================================
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS idp_times           text,
  ADD COLUMN IF NOT EXISTS start_times         text,
  ADD COLUMN IF NOT EXISTS room_id             text,
  ADD COLUMN IF NOT EXISTS room_password       text,
  ADD COLUMN IF NOT EXISTS whatsapp_group_link text,
  ADD COLUMN IF NOT EXISTS is_published        boolean NOT NULL DEFAULT true;

-- ============================================================
-- STEP 9B: get_public_registrations()
-- Safe, masked team roster for public display.
-- Returns confirmed + non-expired pending registrations.
-- ============================================================
CREATE OR REPLACE FUNCTION get_public_registrations()
RETURNS TABLE (
  event_id         uuid,
  team_name        text,
  masked_whatsapp  text,
  status           text,
  created_at       timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.event_id,
    r.team_name,
    '+91 ' || left(r.whatsapp, 2) || '••••••' || right(r.whatsapp, 2) AS masked_whatsapp,
    r.status::text,
    r.created_at
  FROM registrations r
  JOIN orders o ON o.id = r.order_id
  WHERE
    r.status = 'confirmed'
    OR (r.status = 'pending_payment' AND o.expires_at > now())
  ORDER BY r.event_id, r.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_public_registrations() TO authenticated, anon;

-- ============================================================
-- STEP 10: submit_order_utr()
-- Validates 12-digit UTR, records payment, confirms all slots.
-- Instant slot lock; admin verifies later.
-- ============================================================
CREATE OR REPLACE FUNCTION submit_order_utr(p_order_id uuid, p_utr text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  -- Validate: exactly 12 numeric digits
  IF p_utr !~ '^[0-9]{12}$' THEN
    RAISE EXCEPTION 'invalid_utr: UTR must be exactly 12 digits';
  END IF;

  -- Ensure UTR has not been submitted before (prevents double-spend)
  IF EXISTS (SELECT 1 FROM payments WHERE utr = p_utr) THEN
    RAISE EXCEPTION 'duplicate_utr: This UTR reference number has already been used';
  END IF;

  -- Fetch and lock order row
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

  -- Insert payment record (pending_verification - admin confirms asynchronously)
  INSERT INTO payments (order_id, utr, amount_paise, status)
  VALUES (p_order_id, p_utr, v_order.total_paise, 'pending_verification');

  -- Instantly confirm all registrations in this order
  UPDATE registrations
  SET status = 'confirmed'
  WHERE order_id = p_order_id AND status = 'pending_payment';

  -- Increment filled_slots for each affected event
  UPDATE events e
  SET filled_slots = filled_slots + sub.cnt
  FROM (
    SELECT event_id, count(*)::int AS cnt
    FROM registrations
    WHERE order_id = p_order_id
    GROUP BY event_id
  ) sub
  WHERE e.id = sub.event_id;

  -- Mark order as paid
  UPDATE orders SET status = 'paid' WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'utr', p_utr);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_order_utr(uuid, text) TO authenticated;

-- ============================================================
-- STEP 11: lookup_my_tournaments()
-- Guest-friendly lookup by UTR OR WhatsApp number.
-- Returns confirmed registrations with full room details.
-- ============================================================
CREATE OR REPLACE FUNCTION lookup_my_tournaments(
  p_utr       text DEFAULT NULL,
  p_whatsapp  text DEFAULT NULL
)
RETURNS TABLE (
  registration_id      uuid,
  event_id             uuid,
  event_title          text,
  starts_at            timestamptz,
  idp_times            text,
  start_times          text,
  room_id              text,
  room_password        text,
  whatsapp_group_link  text,
  team_name            text,
  slot_number          int,
  status               text,
  amount_paise         int,
  registered_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_utr IS NULL AND p_whatsapp IS NULL THEN
    RAISE EXCEPTION 'provide_utr_or_whatsapp: Provide at least one search parameter';
  END IF;

  IF p_utr IS NOT NULL AND p_utr !~ '^[0-9]{12}$' THEN
    RAISE EXCEPTION 'invalid_utr: UTR must be exactly 12 digits';
  END IF;

  RETURN QUERY
  SELECT
    r.id                                                                           AS registration_id,
    r.event_id,
    e.title                                                                        AS event_title,
    e.starts_at,
    e.idp_times,
    e.start_times,
    e.room_id,
    e.room_password,
    e.whatsapp_group_link,
    r.team_name,
    ROW_NUMBER() OVER (PARTITION BY r.event_id ORDER BY r.created_at)::int         AS slot_number,
    r.status::text,
    r.amount_paise,
    r.created_at                                                                   AS registered_at
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  JOIN orders o ON o.id = r.order_id
  WHERE
    r.status = 'confirmed'
    AND (
      (p_utr IS NOT NULL AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.order_id = o.id AND p.utr = p_utr
      ))
      OR
      (p_whatsapp IS NOT NULL AND r.whatsapp = p_whatsapp)
    )
  ORDER BY e.starts_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION lookup_my_tournaments(text, text) TO authenticated, anon;

-- ============================================================
-- STEP 12A: admin_bulk_create_lobbies()
-- Create multiple lobbies in one call. Requires owner or moderator.
-- p_starts_at: array of start times (can be shorter than p_titles;
--              missing entries are auto-offset by 40 min each).
-- ============================================================
CREATE OR REPLACE FUNCTION admin_bulk_create_lobbies(
  p_kind                 text,
  p_titles               text[],
  p_mode                 text,
  p_maps                 text[],
  p_starts_at            timestamptz[],
  p_idp_times            text    DEFAULT NULL,
  p_start_times          text    DEFAULT NULL,
  p_entry_fee_paise      int     DEFAULT 0,
  p_early_bird_fee_paise int     DEFAULT NULL,
  p_early_bird_slots     int     DEFAULT NULL,
  p_prize_pool_paise     int     DEFAULT 0,
  p_max_slots            int     DEFAULT 100
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[] := '{}';
  v_id  uuid;
  i     int;
  v_at  timestamptz;
BEGIN
  IF NOT has_role(ARRAY['owner', 'moderator']) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  FOR i IN 1 .. array_length(p_titles, 1) LOOP
    v_at := CASE
      WHEN i <= array_length(p_starts_at, 1) THEN p_starts_at[i]
      ELSE p_starts_at[1] + ((i - 1) * interval '40 minutes')
    END;

    INSERT INTO events (
      kind, title, mode, maps, starts_at,
      idp_times, start_times,
      entry_fee_paise, early_bird_fee_paise, early_bird_slots,
      prize_pool_paise, max_slots, filled_slots, status
    ) VALUES (
      p_kind, p_titles[i], p_mode, p_maps, v_at,
      p_idp_times, p_start_times,
      p_entry_fee_paise, p_early_bird_fee_paise, p_early_bird_slots,
      p_prize_pool_paise, p_max_slots, 0, 'open'
    )
    RETURNING id INTO v_id;

    v_ids := v_ids || v_id;
  END LOOP;

  RETURN v_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_bulk_create_lobbies(text, text[], text, text[], timestamptz[], text, text, int, int, int, int, int) TO authenticated;

-- ============================================================
-- STEP 12B: admin_clone_todays_lobbies()
-- Clone a source date's lobbies to today with 0 filled slots.
-- ============================================================
CREATE OR REPLACE FUNCTION admin_clone_todays_lobbies(
  p_source_date date DEFAULT (CURRENT_DATE - 1)
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids   uuid[] := '{}';
  v_id    uuid;
  v_ev    events%ROWTYPE;
  v_days  interval;
BEGIN
  IF NOT has_role(ARRAY['owner', 'moderator']) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  v_days := CURRENT_DATE - p_source_date;

  FOR v_ev IN
    SELECT * FROM events
    WHERE starts_at::date = p_source_date
    ORDER BY starts_at
  LOOP
    INSERT INTO events (
      kind, title, mode, maps, starts_at,
      idp_times, start_times,
      entry_fee_paise, early_bird_fee_paise, early_bird_slots,
      prize_pool_paise, max_slots, filled_slots, status
    ) VALUES (
      v_ev.kind, v_ev.title, v_ev.mode, v_ev.maps,
      v_ev.starts_at + v_days,
      v_ev.idp_times, v_ev.start_times,
      v_ev.entry_fee_paise, v_ev.early_bird_fee_paise, v_ev.early_bird_slots,
      v_ev.prize_pool_paise, v_ev.max_slots, 0, 'open'
    )
    RETURNING id INTO v_id;

    v_ids := v_ids || v_id;
  END LOOP;

  RETURN v_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_clone_todays_lobbies(date) TO authenticated;

-- ============================================================
-- STEP 12C: admin_update_event()
-- Safely update event fields. Prevents lowering max_slots
-- below the confirmed registration count.
-- ============================================================
CREATE OR REPLACE FUNCTION admin_update_event(
  p_event_id             uuid,
  p_max_slots            int    DEFAULT NULL,
  p_entry_fee_paise      int    DEFAULT NULL,
  p_prize_pool_paise     int    DEFAULT NULL,
  p_status               text   DEFAULT NULL,
  p_room_id              text   DEFAULT NULL,
  p_room_password        text   DEFAULT NULL,
  p_whatsapp_group_link  text   DEFAULT NULL,
  p_idp_times            text   DEFAULT NULL,
  p_start_times          text   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirmed int;
BEGIN
  IF NOT has_role(ARRAY['owner', 'moderator']) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Guard: cannot lower max_slots below confirmed count
  IF p_max_slots IS NOT NULL THEN
    SELECT count(*) INTO v_confirmed
    FROM registrations
    WHERE event_id = p_event_id AND status = 'confirmed';

    IF p_max_slots < v_confirmed THEN
      RAISE EXCEPTION 'max_slots_below_confirmed: % confirmed registrations exist', v_confirmed;
    END IF;
  END IF;

  UPDATE events SET
    max_slots            = COALESCE(p_max_slots,           max_slots),
    entry_fee_paise      = COALESCE(p_entry_fee_paise,     entry_fee_paise),
    prize_pool_paise     = COALESCE(p_prize_pool_paise,    prize_pool_paise),
    status               = COALESCE(p_status,              status),
    room_id              = COALESCE(p_room_id,             room_id),
    room_password        = COALESCE(p_room_password,       room_password),
    whatsapp_group_link  = COALESCE(p_whatsapp_group_link, whatsapp_group_link),
    idp_times            = COALESCE(p_idp_times,           idp_times),
    start_times          = COALESCE(p_start_times,         start_times)
  WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_event(uuid, int, int, int, text, text, text, text, text, text) TO authenticated;

-- ============================================================
-- STEP 12D: admin_verify_payment()
-- Approve or reject a UTR. Reject reverts registrations and
-- decrements filled_slots.
-- ============================================================
CREATE OR REPLACE FUNCTION admin_verify_payment(p_utr text, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay payments%ROWTYPE;
BEGIN
  IF NOT has_role(ARRAY['owner', 'moderator', 'finance']) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_pay FROM payments WHERE utr = p_utr FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE payments SET status = 'approved' WHERE utr = p_utr;
    -- Registrations already confirmed from submit_order_utr; nothing else to do.

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
    UPDATE orders SET status = 'refunded'          WHERE id = v_pay.order_id;

  ELSE
    RAISE EXCEPTION 'invalid_action: must be approve or reject';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_verify_payment(text, text) TO authenticated;

-- ============================================================
-- STEP 12E: admin_list_payments()
-- Full payment queue with team and event details.
-- ============================================================
CREATE OR REPLACE FUNCTION admin_list_payments(p_status text DEFAULT NULL)
RETURNS TABLE (
  utr          text,
  amount_paise int,
  pay_status   text,
  created_at   timestamptz,
  order_id     uuid,
  whatsapp     text,
  team_names   text[],
  event_titles text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.utr,
    p.amount_paise,
    p.status::text            AS pay_status,
    p.created_at,
    o.id                      AS order_id,
    o.whatsapp,
    array_agg(DISTINCT r.team_name ORDER BY r.team_name) AS team_names,
    array_agg(DISTINCT e.title      ORDER BY e.title)    AS event_titles
  FROM payments p
  JOIN orders       o ON o.id  = p.order_id
  JOIN registrations r ON r.order_id = o.id
  JOIN events        e ON e.id = r.event_id
  WHERE
    has_role(ARRAY['owner', 'moderator', 'finance'])
    AND (p_status IS NULL OR p.status::text = p_status)
  GROUP BY p.utr, p.amount_paise, p.status, p.created_at, o.id, o.whatsapp
  ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION admin_list_payments(text) TO authenticated;

-- ============================================================
-- STEP 12F: admin_manage_role()
-- Grant or revoke moderator/finance roles. Owner only.
-- ============================================================
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
BEGIN
  IF NOT has_role(ARRAY['owner']) THEN
    RAISE EXCEPTION 'unauthorized: owner only';
  END IF;

  IF p_role NOT IN ('moderator', 'finance') THEN
    RAISE EXCEPTION 'invalid_role: can only manage moderator or finance (not owner)';
  END IF;

  SELECT id INTO v_target_id FROM auth.users WHERE email = p_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found: no account for %', p_email;
  END IF;

  IF p_action = 'grant' THEN
    INSERT INTO admin_roles (user_id, role)
    VALUES (v_target_id, p_role::admin_role_t)
    ON CONFLICT (user_id, role) DO NOTHING;

  ELSIF p_action = 'revoke' THEN
    DELETE FROM admin_roles WHERE user_id = v_target_id AND role = p_role::admin_role_t;

  ELSE
    RAISE EXCEPTION 'invalid_action: must be grant or revoke';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_manage_role(text, text, text) TO authenticated;

-- ============================================================
-- STEP 12G: admin_list_roles()
-- View current role assignments. Owner only.
-- ============================================================
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
  WHERE has_role(ARRAY['owner'])
  ORDER BY ar.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION admin_list_roles() TO authenticated;

-- ============================================================
-- STEP 12H: admin_roles constraints & RLS policy
-- Ensures unique constraint on (user_id, role) and allows
-- users to check their own admin roles.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_roles_user_id_role_key'
  ) THEN
    ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_user_id_role_key UNIQUE (user_id, role);
  END IF;
END $$;

ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 12I: Admin Team Roster & Bulk Approval RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION admin_get_event_registrations(p_event_id uuid)
RETURNS TABLE (
  registration_id uuid,
  team_name text,
  whatsapp text,
  amount_paise int,
  status text,
  created_at timestamptz,
  utr text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id AS registration_id,
    r.team_name,
    r.whatsapp,
    r.amount_paise,
    r.status::text,
    r.created_at,
    p.utr
  FROM registrations r
  LEFT JOIN payments p ON p.order_id = r.order_id
  WHERE r.event_id = p_event_id
    AND has_role(ARRAY['owner', 'moderator', 'finance'])
  ORDER BY r.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION admin_get_event_registrations(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION admin_bulk_approve_payments()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  r RECORD;
BEGIN
  IF NOT has_role(ARRAY['owner', 'moderator', 'finance']) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  FOR r IN SELECT utr FROM payments WHERE status = 'pending_verification' LOOP
    PERFORM admin_verify_payment(r.utr, 'approve');
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_bulk_approve_payments() TO authenticated;

-- ============================================================
-- STEP 12J: Publish / Unpublish Event Toggle RPC
-- ============================================================
CREATE OR REPLACE FUNCTION admin_toggle_event_publish(p_event_id uuid, p_is_published boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(ARRAY['owner', 'moderator']) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE events
  SET is_published = p_is_published
  WHERE id = p_event_id;

  RETURN p_is_published;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_event_publish(uuid, boolean) TO authenticated;

-- ============================================================
-- STEP 12K: Automatic Real-Time Synchronization for Team Counts
-- Automatically updates events.filled_slots to match real confirmed registrations.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_event_filled_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_event_id := OLD.event_id;
  ELSE
    v_event_id := NEW.event_id;
  END IF;

  IF v_event_id IS NOT NULL THEN
    UPDATE events
    SET filled_slots = (
      SELECT COUNT(*)::int
      FROM registrations
      WHERE event_id = v_event_id
        AND status = 'confirmed'
    )
    WHERE id = v_event_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_event_filled_slots ON registrations;
CREATE TRIGGER trg_sync_event_filled_slots
AFTER INSERT OR UPDATE OR DELETE ON registrations
FOR EACH ROW
EXECUTE FUNCTION sync_event_filled_slots();

-- One-time initial count recalculation
UPDATE events e
SET filled_slots = COALESCE((
  SELECT COUNT(*)::int
  FROM registrations r
  WHERE r.event_id = e.id
    AND r.status = 'confirmed'
), 0);



