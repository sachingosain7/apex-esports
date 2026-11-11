-- ============================================================================
-- APEX ESPORTS — COMPACT 1-CLICK FIX
-- Run this in Supabase Dashboard -> SQL Editor -> Run (Ctrl + Enter)
-- ============================================================================

-- 1. FIX has_role (PRESERVES EXISTING POLICIES)
DROP FUNCTION IF EXISTS has_role(text);
DROP FUNCTION IF EXISTS has_role(varchar);
DROP FUNCTION IF EXISTS has_role(text[]);
DROP FUNCTION IF EXISTS has_role(admin_role_t);
DROP FUNCTION IF EXISTS has_role(admin_role_t[]);

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
      AND role = ANY(roles)
  );
$$;

GRANT EXECUTE ON FUNCTION has_role(admin_role_t[]) TO authenticated, anon;

-- 2. ADD COLUMNS FOR PUBLISH & PRIZE POOL + MAKE EARLY BIRD OPTIONAL
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT true;
ALTER TABLE events ADD COLUMN IF NOT EXISTS prize_distribution jsonb DEFAULT '{"first": 350, "second": 150, "third": 70, "fourth": 30}'::jsonb;
ALTER TABLE events ALTER COLUMN early_bird_slots DROP NOT NULL;
ALTER TABLE events ALTER COLUMN early_bird_fee_paise DROP NOT NULL;
ALTER TABLE events ALTER COLUMN early_bird_slots SET DEFAULT 0;
ALTER TABLE events ALTER COLUMN early_bird_fee_paise SET DEFAULT 0;

-- 3. DROP OVERLOADED BULK GENERATOR VERSIONS
DROP FUNCTION IF EXISTS admin_bulk_create_lobbies(text, text[], text, text[], timestamptz[], text, text, int, int, int, int, int);
DROP FUNCTION IF EXISTS admin_bulk_create_lobbies(text, text[], text, text[], timestamptz[], text, text, int, int, int, int, int, boolean);
DROP FUNCTION IF EXISTS admin_bulk_create_lobbies(text, text[], text, text[], timestamptz[], text, text, int, int, int, int, int, boolean, jsonb);

-- 4. BULK GENERATOR (WITH p_kind::event_kind_t CAST)
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
  IF NOT has_role(ARRAY['owner', 'moderator']::admin_role_t[]) THEN
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
      prize_pool_paise, max_slots, filled_slots, status,
      is_published, prize_distribution
    ) VALUES (
      p_kind::event_kind_t, p_titles[i], p_mode, p_maps, v_at,
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

GRANT EXECUTE ON FUNCTION admin_bulk_create_lobbies(text, text[], text, text[], timestamptz[], text, text, int, int, int, int, int, boolean, jsonb) TO authenticated;

-- 5. TOGGLE PUBLISH RPC
DROP FUNCTION IF EXISTS admin_toggle_event_publish(uuid, boolean);
CREATE OR REPLACE FUNCTION admin_toggle_event_publish(p_event_id uuid, p_is_published boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(ARRAY['owner', 'moderator']::admin_role_t[]) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE events
  SET is_published = p_is_published
  WHERE id = p_event_id;

  RETURN p_is_published;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_event_publish(uuid, boolean) TO authenticated;

-- 6. ENSURE gosainrijpal@gmail.com HAS OWNER ROLE
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'gosainrijpal@gmail.com';
  IF v_user_id IS NOT NULL THEN
    BEGIN
      INSERT INTO admin_roles (user_id, role)
      VALUES (v_user_id, 'owner'::admin_role_t)
      ON CONFLICT (user_id, role) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO admin_roles (user_id, role)
      VALUES (v_user_id, 'owner')
      ON CONFLICT DO NOTHING;
    END;
  END IF;
END;
$$;

-- 7. AUTO-TRANSITION LOBBY STATUSES (OPEN -> LIVE -> COMPLETED 20M AFTER MATCH 3 IDP)
DROP FUNCTION IF EXISTS public.auto_update_lobby_statuses();
CREATE OR REPLACE FUNCTION auto_update_lobby_statuses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Automatically transition open lobbies to 'live' once starts_at time has arrived
  UPDATE events
  SET status = 'live'
  WHERE status = 'open'
    AND starts_at <= now()
    AND is_published = true;

  -- Automatically mark matches completed 80 min after start (Match 3 IDP + 20 min)
  UPDATE events
  SET status = 'completed'
  WHERE status = 'live'
    AND starts_at <= (now() - interval '80 minutes');
END;
$$;

GRANT EXECUTE ON FUNCTION auto_update_lobby_statuses() TO authenticated, anon;

-- 8. PERMISSIONS & TABLE CREATION (Fixes permission denied for table orders)
GRANT USAGE ON SCHEMA public TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.points_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  match_number int NOT NULL DEFAULT 1,
  data jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_published boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(event_id, match_number)
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS top_teams jsonb DEFAULT '{"first": "", "second": "", "third": "", "fourth": ""}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS final_points_table_url text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS screenshot_url text;

GRANT ALL ON TABLE orders TO anon, authenticated;
GRANT ALL ON TABLE registrations TO anon, authenticated;
GRANT ALL ON TABLE payments TO anon, authenticated;
GRANT ALL ON TABLE events TO anon, authenticated;
GRANT ALL ON TABLE points_tables TO anon, authenticated;

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
DROP POLICY IF EXISTS "allow_public_all_payments" ON payments;
CREATE POLICY "allow_public_all_payments" ON payments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE points_tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_public_all_points_tables" ON points_tables;
CREATE POLICY "allow_public_all_points_tables" ON points_tables FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 9. PAYMENT PIPELINE (Resilient LEFT JOIN, accessible by owner & all admins)
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
    RAISE EXCEPTION 'invalid_action';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_verify_payment(text, text) TO authenticated, anon;

-- 10. PUBLIC REGISTRATIONS (LIVE SQUAD ROSTER FOR HOMEPAGE)
DROP FUNCTION IF EXISTS public.get_public_registrations();

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
    CASE
      WHEN length(COALESCE(r.whatsapp, o.whatsapp, '')) >= 6 THEN
        left(COALESCE(r.whatsapp, o.whatsapp), 3) || '••••' || right(COALESCE(r.whatsapp, o.whatsapp), 3)
      ELSE '••••••'
    END AS masked_whatsapp,
    r.status::text,
    r.created_at
  FROM registrations r
  LEFT JOIN orders o ON o.id = r.order_id
  WHERE r.status::text != 'cancelled'
  ORDER BY r.event_id, r.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_public_registrations() TO authenticated, anon;

-- 11. CREDENTIALS & IDP LOOKUP (MY TOURNAMENTS PORTAL)
DROP FUNCTION IF EXISTS public.lookup_my_tournaments(text, text);

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
  registered_at        timestamptz,
  whatsapp             text
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
    ROW_NUMBER() OVER (PARTITION BY r.event_id ORDER BY r.created_at)::int         AS slot_number,
    CASE WHEN p.status = 'approved' OR r.status = 'confirmed' THEN 'confirmed' ELSE 'pending_verification' END AS status,
    COALESCE(r.amount_paise, p.amount_paise, 3000)                                 AS amount_paise,
    r.created_at                                                                   AS registered_at,
    COALESCE(r.whatsapp, o.whatsapp, '')                                           AS whatsapp
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

-- 12. ENSURE ALL SUPPORTING COLUMNS EXIST
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS amount_paise int;
ALTER TABLE events ADD COLUMN IF NOT EXISTS room_id text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS room_password text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS whatsapp_group_link text;

-- 13. REAL-TIME FILLED SLOTS AUTO-SYNC TRIGGER
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



