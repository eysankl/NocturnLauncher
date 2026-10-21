
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://irlvvskxpiyxkbeyyxeh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ODBIRseect90PvCgQzsPPg_7WMHKeRb';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);
