-- ============================================================================
-- APEX ESPORTS — COMPREHENSIVE 1-CLICK PRODUCTION DATABASE SCRIPT
-- Paste and Run in: Supabase Dashboard -> SQL Editor -> Run (Ctrl + Enter)
-- ============================================================================

-- 0. GRANT SCHEMA ACCESS
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 1. CONVERT ENUMS TO TEXT (PERMANENTLY PREVENTS ENUM MISMATCH ERRORS)
DO $$
BEGIN
  -- Add values to enums first if they exist so any residual enum usages never throw 22P02
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_role_t') THEN
      ALTER TYPE admin_role_t ADD VALUE IF NOT EXISTS 'admin';
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reg_status_t') THEN
      ALTER TYPE reg_status_t ADD VALUE IF NOT EXISTS 'pending_payment';
      ALTER TYPE reg_status_t ADD VALUE IF NOT EXISTS 'pending_approval';
      ALTER TYPE reg_status_t ADD VALUE IF NOT EXISTS 'rejected';
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status_t') THEN
      ALTER TYPE order_status_t ADD VALUE IF NOT EXISTS 'submitted';
      ALTER TYPE order_status_t ADD VALUE IF NOT EXISTS 'refunded';
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_t') THEN
      ALTER TYPE payment_status_t ADD VALUE IF NOT EXISTS 'rejected';
      ALTER TYPE payment_status_t ADD VALUE IF NOT EXISTS 'approved';
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- admin_roles.role -> text
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'admin_roles' AND column_name = 'role') THEN
      ALTER TABLE admin_roles ALTER COLUMN role DROP DEFAULT;
      ALTER TABLE admin_roles ALTER COLUMN role TYPE text USING role::text;
      ALTER TABLE admin_roles ALTER COLUMN role SET DEFAULT 'admin';
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- registrations.status -> text
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'status') THEN
      ALTER TABLE registrations ALTER COLUMN status DROP DEFAULT;
      ALTER TABLE registrations ALTER COLUMN status TYPE text USING status::text;
      ALTER TABLE registrations ALTER COLUMN status SET DEFAULT 'pending_payment';
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- payments.status -> text
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'status') THEN
      ALTER TABLE payments ALTER COLUMN status DROP DEFAULT;
      ALTER TABLE payments ALTER COLUMN status TYPE text USING status::text;
      ALTER TABLE payments ALTER COLUMN status SET DEFAULT 'pending_verification';
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- orders.status -> text
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'status') THEN
      ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;
      ALTER TABLE orders ALTER COLUMN status TYPE text USING status::text;
      ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- events.status -> text
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'status') THEN
      ALTER TABLE events ALTER COLUMN status DROP DEFAULT;
      ALTER TABLE events ALTER COLUMN status TYPE text USING status::text;
      ALTER TABLE events ALTER COLUMN status SET DEFAULT 'upcoming';
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- 2. ENSURE ALL SUPPORTING COLUMNS EXIST
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT true;
ALTER TABLE events ADD COLUMN IF NOT EXISTS prize_distribution jsonb DEFAULT '{"first": 350, "second": 150, "third": 70, "fourth": 30}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS top_teams jsonb DEFAULT '{"first": "", "second": "", "third": "", "fourth": ""}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS final_points_table_url text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS slot_range_start int DEFAULT 5;
ALTER TABLE events ADD COLUMN IF NOT EXISTS slot_range_end int DEFAULT 25;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_slot_list_published boolean DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS custom_slot_assignments jsonb DEFAULT '{}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS room_id text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS room_password text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS whatsapp_group_link text;
ALTER TABLE events ALTER COLUMN early_bird_slots DROP NOT NULL;
ALTER TABLE events ALTER COLUMN early_bird_fee_paise DROP NOT NULL;
ALTER TABLE events ALTER COLUMN early_bird_slots SET DEFAULT 0;
ALTER TABLE events ALTER COLUMN early_bird_fee_paise SET DEFAULT 0;

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS amount_paise int;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS slot_number int;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS screenshot_url text;

-- 3. ENSURE TABLES EXIST
CREATE TABLE IF NOT EXISTS public.points_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  match_number int NOT NULL DEFAULT 1,
  data jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_published boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(event_id, match_number)
);

CREATE TABLE IF NOT EXISTS public.admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'admin',
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role)
);

-- 4. TABLE PERMISSIONS & RLS POLICIES
GRANT ALL ON TABLE orders TO anon, authenticated;
GRANT ALL ON TABLE registrations TO anon, authenticated;
GRANT ALL ON TABLE payments TO anon, authenticated;
GRANT ALL ON TABLE events TO anon, authenticated;
GRANT ALL ON TABLE points_tables TO anon, authenticated;
GRANT ALL ON TABLE admin_roles TO anon, authenticated;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_public_all_orders" ON orders;
CREATE POLICY "allow_public_all_orders" ON orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_public_all_registrations" ON registrations;
CREATE POLICY "allow_public_all_registrations" ON registrations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_public_all_payments" ON payments;
CREATE POLICY "allow_public_all_payments" ON payments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_public_all_events" ON events;
CREATE POLICY "allow_public_all_events" ON events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE points_tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_public_all_points_tables" ON points_tables;
CREATE POLICY "allow_public_all_points_tables" ON points_tables FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_public_all_admin_roles" ON admin_roles;
CREATE POLICY "allow_public_all_admin_roles" ON admin_roles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 5. has_role OVERLOADS (TEXT & ENUM SAFE)
DROP FUNCTION IF EXISTS has_role(text);
DROP FUNCTION IF EXISTS has_role(varchar);
DROP FUNCTION IF EXISTS has_role(text[]);
DROP FUNCTION IF EXISTS has_role(admin_role_t);
DROP FUNCTION IF EXISTS has_role(admin_role_t[]);

CREATE OR REPLACE FUNCTION has_role(roles text[])
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
        role::text = ANY(roles)
        OR (role::text = 'admin' AND ('moderator' = ANY(roles) OR 'finance' = ANY(roles)))
        OR role::text = 'owner'
      )
  );
$$;

GRANT EXECUTE ON FUNCTION has_role(text[]) TO authenticated, anon;

-- Overload for backwards compatibility if callers pass admin_role_t[]
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_role_t') THEN
    EXECUTE '
      CREATE OR REPLACE FUNCTION has_role(roles admin_role_t[])
      RETURNS boolean
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      STABLE
      AS $fn$
        SELECT has_role(roles::text[]);
      $fn$;
      GRANT EXECUTE ON FUNCTION has_role(admin_role_t[]) TO authenticated, anon;
    ';
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 6. ENSURE PLATFORM OWNER gosainrijpal@gmail.com
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'gosainrijpal@gmail.com';
  IF v_user_id IS NOT NULL THEN
    INSERT INTO admin_roles (user_id, role)
    VALUES (v_user_id, 'owner')
    ON CONFLICT (user_id, role) DO UPDATE SET role = 'owner';
  END IF;
END;
$$;

-- 7. ROLE MANAGEMENT RPCS (OWNER ONLY)
DROP FUNCTION IF EXISTS public.admin_manage_role(text, text, text);
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
  v_clean_role text := lower(trim(p_role));
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1 FROM admin_roles
      WHERE user_id = auth.uid() AND role::text = 'owner'
    )
  ) THEN
    RAISE EXCEPTION 'unauthorized: platform owner only';
  END IF;

  IF v_clean_role NOT IN ('admin', 'moderator', 'finance') THEN
    v_clean_role := 'admin';
  END IF;

  SELECT id INTO v_target_id FROM auth.users WHERE lower(email) = lower(trim(p_email));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found: no registered account found for %', p_email;
  END IF;

  IF p_action = 'grant' THEN
    DELETE FROM admin_roles WHERE user_id = v_target_id;
    BEGIN
      INSERT INTO admin_roles (user_id, role)
      VALUES (v_target_id, v_clean_role);
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        EXECUTE 'INSERT INTO admin_roles (user_id, role) VALUES ($1, $2::admin_role_t)'
        USING v_target_id, v_clean_role;
      EXCEPTION WHEN OTHERS THEN
        EXECUTE 'INSERT INTO admin_roles (user_id, role) VALUES ($1, ''moderator''::admin_role_t)'
        USING v_target_id;
      END;
    END;

  ELSIF p_action = 'revoke' THEN
    DELETE FROM admin_roles WHERE user_id = v_target_id;

  ELSE
    RAISE EXCEPTION 'invalid_action: must be grant or revoke';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_manage_role(text, text, text) TO authenticated, anon;

DROP FUNCTION IF EXISTS public.admin_transfer_ownership(text);
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
  IF NOT (
    EXISTS (
      SELECT 1 FROM admin_roles
      WHERE user_id = v_current_user_id AND role::text = 'owner'
    )
  ) THEN
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
  DELETE FROM admin_roles WHERE user_id = v_current_user_id;
  BEGIN
    INSERT INTO admin_roles (user_id, role) VALUES (v_current_user_id, 'admin');
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      EXECUTE 'INSERT INTO admin_roles (user_id, role) VALUES ($1, ''admin''::admin_role_t)' USING v_current_user_id;
    EXCEPTION WHEN OTHERS THEN
      EXECUTE 'INSERT INTO admin_roles (user_id, role) VALUES ($1, ''moderator''::admin_role_t)' USING v_current_user_id;
    END;
  END;

  -- Grant owner to new owner
  DELETE FROM admin_roles WHERE user_id = v_new_owner_id;
  BEGIN
    INSERT INTO admin_roles (user_id, role) VALUES (v_new_owner_id, 'owner');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'INSERT INTO admin_roles (user_id, role) VALUES ($1, ''owner''::admin_role_t)' USING v_new_owner_id;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_transfer_ownership(text) TO authenticated, anon;

DROP FUNCTION IF EXISTS public.admin_list_roles();
CREATE OR REPLACE FUNCTION admin_list_roles()
RETURNS TABLE (email text, role text, granted_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(u.email::text, ar.user_id::text) AS email,
    ar.role::text AS role,
    COALESCE(ar.created_at, now()) AS granted_at
  FROM admin_roles ar
  LEFT JOIN auth.users u ON u.id = ar.user_id
  ORDER BY ar.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION admin_list_roles() TO authenticated, anon;

-- 8. ORDER CREATION RPCS
DROP FUNCTION IF EXISTS public.create_registration_order(uuid[], text, text);
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

    IF v_event.early_bird_fee_paise IS NOT NULL AND v_event.early_bird_slots IS NOT NULL AND v_event.filled_slots < v_event.early_bird_slots THEN
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
    IF v_event.early_bird_fee_paise IS NOT NULL AND v_event.early_bird_slots IS NOT NULL AND v_event.filled_slots < v_event.early_bird_slots THEN
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

DROP FUNCTION IF EXISTS public.create_order(text, uuid[], text[]);
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

-- 9. SUBMIT ORDER UTR (AVAILABLE TO ANON USERS)
DROP FUNCTION IF EXISTS public.submit_order_utr(uuid, text);
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

  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  -- Upsert payment row
  INSERT INTO payments (order_id, utr, amount_paise, status)
  VALUES (p_order_id, p_utr, COALESCE(v_order.total_paise, 3000), 'pending_verification')
  ON CONFLICT (utr) DO UPDATE SET
    order_id = EXCLUDED.order_id,
    status = 'pending_verification';

  -- Move registrations to pending_payment (safe for both enum and text)
  UPDATE registrations
  SET status = 'pending_payment'
  WHERE order_id = p_order_id;

  -- Mark order pending (safe for both enum and text)
  IF FOUND THEN
    UPDATE orders SET status = 'pending' WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'utr', p_utr);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_order_utr(uuid, text) TO authenticated, anon;

-- 9B. COMPLETE 1-CLICK ATOMIC REGISTRATION RPC (BYPASSES ALL POSTGREST RLS RESTRICTIONS)
DROP FUNCTION IF EXISTS public.submit_tournament_registration(uuid, uuid, text, text, text, int, text);
CREATE OR REPLACE FUNCTION submit_tournament_registration(
  p_order_id       uuid,
  p_event_id       uuid,
  p_team_name      text,
  p_whatsapp       text,
  p_utr            text,
  p_amount_paise   int     DEFAULT 3000,
  p_screenshot_url text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_phone text := regexp_replace(COALESCE(p_whatsapp, ''), '[^0-9+]', '', 'g');
  v_target_order_id uuid := COALESCE(p_order_id, gen_random_uuid());
BEGIN
  -- 1. Ensure order exists
  IF EXISTS (SELECT 1 FROM orders WHERE id = v_target_order_id) THEN
    UPDATE orders
    SET whatsapp = v_clean_phone,
        total_paise = p_amount_paise,
        status = 'pending'
    WHERE id = v_target_order_id;
  ELSE
    INSERT INTO orders (id, whatsapp, total_paise, status, expires_at)
    VALUES (v_target_order_id, v_clean_phone, p_amount_paise, 'pending', now() + interval '1 day');
  END IF;

  -- 2. Insert or update registration (resilient to missing unique constraint)
  IF EXISTS (SELECT 1 FROM registrations WHERE order_id = v_target_order_id AND event_id = p_event_id) THEN
    UPDATE registrations
    SET whatsapp = v_clean_phone,
        team_name = p_team_name,
        amount_paise = p_amount_paise,
        status = 'pending_payment'
    WHERE order_id = v_target_order_id AND event_id = p_event_id;
  ELSE
    INSERT INTO registrations (order_id, event_id, whatsapp, team_name, status, amount_paise)
    VALUES (v_target_order_id, p_event_id, v_clean_phone, p_team_name, 'pending_payment', p_amount_paise);
  END IF;

  -- 3. Insert or update payment (resilient to duplicate UTRs)
  IF p_utr IS NOT NULL AND length(trim(p_utr)) > 0 THEN
    IF EXISTS (SELECT 1 FROM payments WHERE utr = trim(p_utr)) THEN
      UPDATE payments
      SET order_id = v_target_order_id,
          amount_paise = p_amount_paise,
          status = 'pending_verification',
          screenshot_url = COALESCE(p_screenshot_url, payments.screenshot_url)
      WHERE utr = trim(p_utr);
    ELSE
      INSERT INTO payments (order_id, utr, amount_paise, status, screenshot_url)
      VALUES (v_target_order_id, trim(p_utr), p_amount_paise, 'pending_verification', p_screenshot_url);
    END IF;
  END IF;

  -- 4. Update event filled slots
  UPDATE events
  SET filled_slots = (
    SELECT COUNT(*)::int
    FROM registrations
    WHERE event_id = p_event_id
      AND status::text != 'cancelled'
  )
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_target_order_id,
    'event_id', p_event_id,
    'utr', p_utr
  );
END;
$$;

GRANT EXECUTE ON FUNCTION submit_tournament_registration(uuid, uuid, text, text, text, int, text) TO authenticated, anon;

-- 10. CHECK PAYMENT STATUS RPC
DROP FUNCTION IF EXISTS public.check_payment_status(text);
CREATE OR REPLACE FUNCTION check_payment_status(p_utr text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay payments%ROWTYPE;
BEGIN
  SELECT * INTO v_pay FROM payments WHERE utr = p_utr;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object('found', true, 'status', v_pay.status::text);
END;
$$;

GRANT EXECUTE ON FUNCTION check_payment_status(text) TO authenticated, anon;

-- 11. PAYMENT VERIFICATION (APPROVE / REJECT)
DROP FUNCTION IF EXISTS public.admin_list_payments(text);
DROP FUNCTION IF EXISTS public.admin_list_payments();
CREATE OR REPLACE FUNCTION admin_list_payments(p_status text DEFAULT NULL)
RETURNS TABLE (
  utr          text,
  amount_paise int,
  pay_status   text,
  created_at   timestamptz,
  order_id     uuid,
  whatsapp     text,
  team_names   text[],
  event_titles text[],
  screenshot_url text
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
    p.order_id,
    COALESCE(o.whatsapp, '')  AS whatsapp,
    COALESCE(array_agg(DISTINCT r.team_name) FILTER (WHERE r.team_name IS NOT NULL), ARRAY[]::text[]) AS team_names,
    COALESCE(array_agg(DISTINCT e.title)     FILTER (WHERE e.title IS NOT NULL),     ARRAY[]::text[]) AS event_titles,
    p.screenshot_url
  FROM payments p
  LEFT JOIN orders        o ON o.id = p.order_id
  LEFT JOIN registrations r ON r.order_id = p.order_id
  LEFT JOIN events        e ON e.id = r.event_id
  WHERE (p_status IS NULL OR p.status::text = p_status)
  GROUP BY p.utr, p.amount_paise, p.status, p.created_at, p.order_id, o.whatsapp, p.screenshot_url
  ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION admin_list_payments(text) TO authenticated, anon;

DROP FUNCTION IF EXISTS public.admin_verify_payment(text, text);
CREATE OR REPLACE FUNCTION admin_verify_payment(p_utr text, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay payments%ROWTYPE;
BEGIN
  SELECT * INTO v_pay FROM payments WHERE utr = p_utr FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE payments SET status = 'approved' WHERE utr = p_utr;
    UPDATE registrations SET status = 'confirmed' WHERE order_id = v_pay.order_id;
    UPDATE orders SET status = 'paid' WHERE id = v_pay.order_id;
  ELSIF p_action = 'reject' THEN
    UPDATE payments SET status = 'rejected' WHERE utr = p_utr;
    UPDATE registrations SET status = 'cancelled' WHERE order_id = v_pay.order_id;
    UPDATE orders SET status = 'refunded' WHERE id = v_pay.order_id;
  ELSE
    RAISE EXCEPTION 'invalid_action: must be approve or reject';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_verify_payment(text, text) TO authenticated, anon;

-- 12. PUBLIC ROSTER ACCORDION (SAVAGE ESPORTS STYLE)
DROP FUNCTION IF EXISTS public.get_public_registrations();
CREATE OR REPLACE FUNCTION get_public_registrations()
RETURNS TABLE (
  event_id               uuid,
  team_name              text,
  masked_whatsapp        text,
  status                 text,
  created_at             timestamptz,
  slot_number            int,
  is_slot_list_published boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.event_id,
    r.team_name,
    CASE
      WHEN length(COALESCE(r.whatsapp, o.whatsapp, '')) >= 6 THEN
        left(COALESCE(r.whatsapp, o.whatsapp), 6) || 'XXXX'
      ELSE '••••••'
    END AS masked_whatsapp,
    r.status::text,
    r.created_at,
    COALESCE(
      (e.custom_slot_assignments->>r.id::text)::int,
      (e.custom_slot_assignments->>r.team_name)::int,
      (ROW_NUMBER() OVER (PARTITION BY r.event_id ORDER BY r.created_at) + COALESCE(e.slot_range_start, 5) - 1)::int
    ) AS slot_number,
    COALESCE(e.is_slot_list_published, false) AS is_slot_list_published
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  LEFT JOIN orders o ON o.id = r.order_id
  WHERE r.status::text != 'cancelled'
  ORDER BY r.event_id, r.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_public_registrations() TO authenticated, anon;

-- 13. IDP & CREDENTIALS LOOKUP (/my-tournaments PORTAL)
DROP FUNCTION IF EXISTS public.lookup_my_tournaments(text, text);
CREATE OR REPLACE FUNCTION lookup_my_tournaments(
  p_utr       text DEFAULT NULL,
  p_whatsapp  text DEFAULT NULL
)
RETURNS TABLE (
  registration_id        uuid,
  event_id               uuid,
  event_title            text,
  starts_at              timestamptz,
  idp_times              text,
  start_times            text,
  room_id                text,
  room_password          text,
  whatsapp_group_link    text,
  team_name              text,
  slot_number            int,
  status                 text,
  amount_paise           int,
  registered_at          timestamptz,
  whatsapp               text,
  is_slot_list_published boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_phone text;
BEGIN
  IF p_utr IS NULL AND p_whatsapp IS NULL THEN
    RAISE EXCEPTION 'provide_utr_or_whatsapp: Provide at least one search parameter';
  END IF;

  IF p_whatsapp IS NOT NULL THEN
    v_clean_phone := right(regexp_replace(p_whatsapp, '[^0-9]', '', 'g'), 10);
  END IF;

  RETURN QUERY
  SELECT
    r.id                                                                           AS registration_id,
    r.event_id,
    e.title                                                                        AS event_title,
    e.starts_at,
    e.idp_times,
    e.start_times,
    CASE WHEN p.status = 'approved' OR r.status = 'confirmed' THEN e.room_id ELSE NULL END AS room_id,
    CASE WHEN p.status = 'approved' OR r.status = 'confirmed' THEN e.room_password ELSE NULL END AS room_password,
    CASE WHEN p.status = 'approved' OR r.status = 'confirmed' THEN e.whatsapp_group_link ELSE NULL END AS whatsapp_group_link,
    r.team_name,
    COALESCE(
      (e.custom_slot_assignments->>r.id::text)::int,
      (e.custom_slot_assignments->>r.team_name)::int,
      (ROW_NUMBER() OVER (PARTITION BY r.event_id ORDER BY r.created_at) + COALESCE(e.slot_range_start, 5) - 1)::int
    ) AS slot_number,
    CASE WHEN p.status = 'approved' OR r.status = 'confirmed' THEN 'confirmed' ELSE 'pending_verification' END AS status,
    COALESCE(r.amount_paise, p.amount_paise, 3000)                                 AS amount_paise,
    r.created_at                                                                   AS registered_at,
    COALESCE(r.whatsapp, o.whatsapp, '')                                           AS whatsapp,
    COALESCE(e.is_slot_list_published, false)                                      AS is_slot_list_published
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  LEFT JOIN orders o ON o.id = r.order_id
  LEFT JOIN payments p ON p.order_id = r.order_id
  WHERE
    r.status::text != 'cancelled'
    AND (
      (p_utr IS NOT NULL AND (p.utr = p_utr OR EXISTS (SELECT 1 FROM payments p2 WHERE p2.order_id = r.order_id AND p2.utr = p_utr)))
      OR
      (v_clean_phone IS NOT NULL AND (
        right(regexp_replace(COALESCE(r.whatsapp, ''), '[^0-9]', '', 'g'), 10) = v_clean_phone
        OR right(regexp_replace(COALESCE(o.whatsapp, ''), '[^0-9]', '', 'g'), 10) = v_clean_phone
      ))
    )
  ORDER BY e.starts_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION lookup_my_tournaments(text, text) TO authenticated, anon;

-- 14. ADMIN EVENT SQUAD ROSTER RPC
DROP FUNCTION IF EXISTS public.admin_get_event_registrations(uuid);
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
    COALESCE(r.whatsapp, o.whatsapp, '') AS whatsapp,
    COALESCE(r.amount_paise, 3000) AS amount_paise,
    r.status::text AS status,
    r.created_at,
    p.utr
  FROM registrations r
  LEFT JOIN orders o ON o.id = r.order_id
  LEFT JOIN payments p ON p.order_id = r.order_id
  WHERE r.event_id = p_event_id
    AND r.status::text != 'cancelled'
  ORDER BY r.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION admin_get_event_registrations(uuid) TO authenticated, anon;

-- 15. BULK GENERATOR RPC
DROP FUNCTION IF EXISTS admin_bulk_create_lobbies(text, text[], text, text[], timestamptz[], text, text, int, int, int, int, int, boolean, jsonb);
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
  p_max_slots            int     DEFAULT 100,
  p_is_published         boolean DEFAULT true,
  p_prize_distribution  jsonb   DEFAULT '{"first": 350, "second": 150, "third": 70, "fourth": 30}'::jsonb
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
  FOR i IN 1 .. array_length(p_titles, 1) LOOP
    v_at := CASE
      WHEN i <= array_length(p_starts_at, 1) THEN p_starts_at[i]
      ELSE p_starts_at[1] + ((i - 1) * interval '40 minutes')
    END;

    INSERT INTO events (
      kind, title, mode, maps, starts_at,
      idp_times, start_times,
      entry_fee_paise, early_bird_fee_paise, early_bird_slots,
      prize_pool_paise, max_slots, filled_slots, status,
      is_published, prize_distribution
    ) VALUES (
      p_kind, p_titles[i], p_mode, p_maps, v_at,
      p_idp_times, p_start_times,
      p_entry_fee_paise, COALESCE(p_early_bird_fee_paise, 0), COALESCE(p_early_bird_slots, 0),
      p_prize_pool_paise, p_max_slots, 0, 'open',
      p_is_published, p_prize_distribution
    )
    RETURNING id INTO v_id;

    v_ids := v_ids || v_id;
  END LOOP;

  RETURN v_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_bulk_create_lobbies(text, text[], text, text[], timestamptz[], text, text, int, int, int, int, int, boolean, jsonb) TO authenticated, anon;

-- 16. TOGGLE PUBLISH RPC
DROP FUNCTION IF EXISTS admin_toggle_event_publish(uuid, boolean);
CREATE OR REPLACE FUNCTION admin_toggle_event_publish(p_event_id uuid, p_is_published boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE events
  SET is_published = p_is_published
  WHERE id = p_event_id;

  RETURN p_is_published;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_event_publish(uuid, boolean) TO authenticated, anon;

-- 17. AUTO UPDATE LOBBY STATUSES
DROP FUNCTION IF EXISTS public.auto_update_lobby_statuses();
CREATE OR REPLACE FUNCTION auto_update_lobby_statuses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE events
  SET status = 'live'
  WHERE status = 'open'
    AND starts_at <= now()
    AND is_published = true;

  UPDATE events
  SET status = 'completed'
  WHERE status = 'live'
    AND starts_at <= (now() - interval '80 minutes');
END;
$$;

GRANT EXECUTE ON FUNCTION auto_update_lobby_statuses() TO authenticated, anon;

-- 18. REAL-TIME FILLED SLOTS SYNC TRIGGER
CREATE OR REPLACE FUNCTION sync_event_filled_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eid uuid;
BEGIN
  v_eid := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  IF v_eid IS NOT NULL THEN
    UPDATE events
    SET filled_slots = (
      SELECT COUNT(*)::int
      FROM registrations
      WHERE event_id = v_eid
        AND status::text != 'cancelled'
    )
    WHERE id = v_eid;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_event_filled_slots ON registrations;
CREATE TRIGGER trg_sync_event_filled_slots
AFTER INSERT OR UPDATE OR DELETE ON registrations
FOR EACH ROW
EXECUTE FUNCTION sync_event_filled_slots();

-- ============================================================================
-- SCRIPT COMPLETE! ALL RPCS & POLICIES ARE TYPE-SAFE AND GRANTED.
-- ============================================================================
