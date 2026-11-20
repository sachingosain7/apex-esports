-- ==============================================================================
-- 🚀 APEX ESPORTS: IMMEDIATE DATABASE FIX FOR GUEST CHECKOUT & POSTER COLUMN
-- Run this in your Supabase Dashboard: SQL Editor -> New query -> Run
-- ==============================================================================

-- 1. Allow guest checkout without mandatory Supabase login account
ALTER TABLE public.orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.registrations ALTER COLUMN user_id DROP NOT NULL;

-- 2. Drop user_id foreign key constraint to allow non-logged-in squad registration
ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_user_id_fkey;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;

-- 3. Add missing slot_list_image_url column to events
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS slot_list_image_url text;

-- 4. Ensure payments status column defaults and permissions
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS screenshot_url text;
ALTER TABLE public.payments ALTER COLUMN status SET DEFAULT 'pending_verification';

-- 5. Grant complete public access to all essential tables
GRANT ALL ON TABLE public.events TO anon, authenticated;
GRANT ALL ON TABLE public.orders TO anon, authenticated;
GRANT ALL ON TABLE public.registrations TO anon, authenticated;
GRANT ALL ON TABLE public.payments TO anon, authenticated;

-- 6. Refresh schema cache
NOTIFY pgrst, 'reload schema';
