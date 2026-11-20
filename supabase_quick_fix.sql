-- ==============================================================================
-- 🚀 APEX ESPORTS: IMMEDIATE DATABASE FIX FOR GUEST CHECKOUT & CONSTRAINTS
-- Run this in your Supabase Dashboard: SQL Editor -> New query -> Run
-- ==============================================================================

-- 1. Drop brittle phone check constraints so ANY valid number format is accepted
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_whatsapp_check;
ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_whatsapp_check;

-- 2. Allow guest checkout without mandatory Supabase login account
ALTER TABLE public.orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.registrations ALTER COLUMN user_id DROP NOT NULL;

-- 3. Drop user_id foreign key constraint to allow non-logged-in squad registration
ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_user_id_fkey;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;

-- 4. Add missing slot_list_image_url column to events
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS slot_list_image_url text;

-- 5. Ensure payments status column defaults and permissions
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS screenshot_url text;
ALTER TABLE public.payments ALTER COLUMN status SET DEFAULT 'pending_verification';

-- 6. Grant complete public access to all essential tables
GRANT ALL ON TABLE public.events TO anon, authenticated;
GRANT ALL ON TABLE public.orders TO anon, authenticated;
GRANT ALL ON TABLE public.registrations TO anon, authenticated;
GRANT ALL ON TABLE public.payments TO anon, authenticated;

-- 7. 1-Click Lobby Reset RPC (Removes all test registrations and resets filled slots to 0)
CREATE OR REPLACE FUNCTION admin_reset_lobby_slots(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  -- Mark all registrations for this event as cancelled
  UPDATE registrations
  SET status = 'cancelled'
  WHERE event_id = p_event_id AND status != 'cancelled';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Reset filled_slots counter
  UPDATE events
  SET filled_slots = 0,
      custom_slot_assignments = '{}'::jsonb
  WHERE id = p_event_id;

  RETURN jsonb_build_object('success', true, 'cleared_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reset_lobby_slots(uuid) TO anon, authenticated;

-- 8. Refresh schema cache
NOTIFY pgrst, 'reload schema';
