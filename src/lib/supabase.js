import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dsofwbmtlckylmotpokv.supabase.co';
const supabasePublishableKey = 'sb_publishable_otNM7MJ-0aaZq6mI1ZJW5g_UWAdsbJw';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
