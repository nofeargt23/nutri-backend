// api/_supabase.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRole =
  process.env.SUPABASE_SERVICE_ROLE || process.env.SB_SERVICE_ROLE_KEY;

if (!url) throw new Error('env_missing: SUPABASE_URL');
if (!serviceRole) throw new Error('env_missing: SUPABASE_SERVICE_ROLE');

export const supabaseAdmin = createClient(url, serviceRole, {
  auth: { persistSession: false }
});
