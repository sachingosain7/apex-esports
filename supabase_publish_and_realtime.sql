-- ============================================================================
-- APEX ESPORTS — PUBLISH / UNPUBLISH & REAL-TIME TEAM COUNT MIGRATION
-- Run this in Supabase Dashboard -> SQL Editor -> Run (Ctrl + Enter)
-- ============================================================================

-- 1. Helper function to check roles cleanly without enum casting errors
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

-- 2. Add is_published column to events table (default true for active lobbies)
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT true;

-- 3. Reset any dummy filled_slots data so it strictly reflects actual confirmed teams
UPDATE events e
SET filled_slots = COALESCE((
  SELECT COUNT(*)::int
  FROM registrations r
  WHERE r.event_id = e.id
    AND r.status = 'confirmed'
), 0);

-- 4. Automatic Real-Time Synchronization Trigger
-- Whenever teams register, cancel, or get approved, events.filled_slots is auto-updated
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

-- 5. Publish / Unpublish Event Toggle RPC
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

-- 6. Updated admin_bulk_create_lobbies supporting p_is_published
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
  p_is_published         boolean DEFAULT true
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
      prize_pool_paise, max_slots, filled_slots, status, is_published
    ) VALUES (
      p_kind, p_titles[i], p_mode, p_maps, v_at,
      p_idp_times, p_start_times,
      p_entry_fee_paise, p_early_bird_fee_paise, p_early_bird_slots,
      p_prize_pool_paise, p_max_slots, 0, 'open', p_is_published
    )
    RETURNING id INTO v_id;

    v_ids := v_ids || v_id;
  END LOOP;

  RETURN v_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_bulk_create_lobbies(text, text[], text, text[], timestamptz[], text, text, int, int, int, int, int, boolean) TO authenticated;

-- 7. Public registrations viewer for homepage live squad lists
CREATE OR REPLACE FUNCTION get_public_registrations()
RETURNS TABLE(
  event_id uuid,
  team_name text,
  masked_whatsapp text,
  status text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    r.event_id,
    r.team_name,
    CASE
      WHEN length(COALESCE(r.whatsapp, '')) >= 6 THEN
        substring(r.whatsapp, 1, 3) || '••••' || substring(r.whatsapp, length(r.whatsapp) - 2)
      ELSE '••••••'
    END AS masked_whatsapp,
    r.status,
    r.created_at
  FROM registrations r
  WHERE r.status IN ('confirmed', 'pending_payment')
  ORDER BY r.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_public_registrations() TO authenticated, anon;
