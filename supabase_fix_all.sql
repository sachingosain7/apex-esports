-- ============================================================================
-- APEX ESPORTS — COMPACT 1-CLICK FIX
-- Run this in Supabase Dashboard -> SQL Editor -> Run (Ctrl + Enter)
-- ============================================================================

-- 1. FIX has_role (PRESERVES EXISTING POLICIES)
DROP FUNCTION IF EXISTS has_role(text);
DROP FUNCTION IF EXISTS has_role(varchar);
DROP FUNCTION IF EXISTS has_role(text[]);
DROP FUNCTION IF EXISTS has_role(admin_role_t);

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

-- 7. AUTO-TRANSITION LOBBY STATUSES BASED ON TIME (OPEN -> LIVE -> COMPLETED)
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

  -- Automatically mark matches completed 3 hours after start
  UPDATE events
  SET status = 'completed'
  WHERE status = 'live'
    AND starts_at <= (now() - interval '3 hours');
END;
$$;

GRANT EXECUTE ON FUNCTION auto_update_lobby_statuses() TO authenticated, anon;
