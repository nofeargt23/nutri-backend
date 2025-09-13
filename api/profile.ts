// /api/profile.ts
// Handler mínimo sin tipos, robusto para Node runtime en Vercel
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SB_SERVICE_ROLE_KEY = process.env.SB_SERVICE_ROLE_KEY!; // usa aquí el nombre exacto de tu env en Vercel
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'my-admin-xyz';

const supabase = createClient(SUPABASE_URL, SB_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// util: parsea body seguro (a veces Vercel te lo da como string)
function getJsonBody(req: any) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

export default async function handler(req: any, res: any) {
  try {
    // auth simple de admin
    const secret = req.headers['x-admin-secret'];
    if (secret !== ADMIN_SECRET) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    const user_id = (req.query?.user_id || '').toString();
    if (!user_id) {
      res.status(400).json({ ok: false, error: 'missing user_id' });
      return;
    }

    if (req.method === 'GET') {
      // lee perfil
      const { data, error } = await supabase
        .from('profiles')                 // <<< cambia si tu tabla se llama distinto
        .select('*')
        .eq('user_id', user_id)
        .maybeSingle();
      if (error) throw error;
      res.status(200).json({ ok: true, profile: data });
      return;
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      // upsert del perfil
      const body = getJsonBody(req);
      const payload = {
        user_id,
        ...body,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('profiles')                 // <<< cambia si tu tabla se llama distinto
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .maybeSingle();
      if (error) throw error;

      res.status(200).json({ ok: true, profile: data });
      return;
    }

    res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (err: any) {
    console.error('api/profile error', err);
    res.status(500).json({ ok: false, error: err?.message || 'internal error' });
  }
}
