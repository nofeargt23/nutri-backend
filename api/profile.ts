// api/profile.ts (o api/profile/index.ts)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../_supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const user_id = (req.query.user_id as string) || '';
    if (!user_id) {
      return res.status(400).json({ ok: false, error: 'missing user_id' });
    }

    if (req.method === 'GET') {
      // lee desde la vista o tabla que estés usando
      const { data, error } = await supabaseAdmin
        .from('profiles_ext') // si usas la vista con alias user_id
        // .from('profiles')   // si prefieres la tabla base (usa id en vez de user_id)
        .select('*')
        .eq('user_id', user_id) // si es profiles_ext
        // .eq('id', user_id)    // si es profiles
        .maybeSingle();

      if (error) return res.status(500).json({ ok: false, error: error.message });
      return res.json({ ok: true, profile: data });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const updates = {
        id: user_id, // clave primaria en 'profiles'
        full_name: body.full_name ?? null,
        height_cm: body.height_cm ?? null,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .upsert(updates, { onConflict: 'id' })
        .select()
        .single();

      if (error) return res.status(500).json({ ok: false, error: error.message });
      return res.json({ ok: true, profile: data });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
