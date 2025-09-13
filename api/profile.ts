// api/profile.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SERVICE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const ADMIN_SECRET = requireEnv('ADMIN_SECRET');

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Seguridad simple por header
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const user_id = String(req.query.user_id || '');
      if (!user_id) return res.status(400).json({ ok: false, error: 'missing user_id' });

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user_id)
        .maybeSingle();

      if (error) {
        console.error('SUPABASE_SELECT', error);
        return res.status(500).json({ ok: false, error: error.message });
      }
      if (!data) return res.status(404).json({ ok: false, error: 'not_found' });

      return res.status(200).json({ ok: true, profile: data });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const p = body?.profile;
      if (!p?.user_id) return res.status(400).json({ ok: false, error: 'missing profile.user_id' });

      // upsert por user_id
      const { data, error } = await supabase
        .from('profiles')
        .upsert(p, { onConflict: 'user_id' })
        .select()
        .maybeSingle();

      if (error) {
        console.error('SUPABASE_UPSERT', error);
        return res.status(500).json({ ok: false, error: error.message });
      }
      return res.status(200).json({ ok: true, profile: data });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err: any) {
    console.error('PROFILE_HANDLER', err);
    return res.status(500).json({ ok: false, error: err?.message || 'server_error' });
  }
}
