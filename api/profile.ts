// api/profile.ts  (si usas JS, quita los tipos :any y los "as string")
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url) throw new Error('env_missing: SUPABASE_URL');
  if (!key) throw new Error('env_missing: SUPABASE_SERVICE_ROLE');
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req: any, res: any) {
  try {
    // Auth muy simple por header
    const admin = req.headers['x-admin-secret'];
    if (admin !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const user_id = String(req.query.user_id || '').trim();
    if (!user_id) {
      return res.status(400).json({ ok: false, error: 'missing user_id' });
    }

    const supabase = getSupabase();

    if (req.method === 'GET') {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user_id) // usar id, NO user_id
          .single();

        if (error) {
          return res.status(500).json({ ok: false, step: 'select', error: error.message });
        }
        return res.status(200).json({ ok: true, profile: data });
      } catch (e: any) {
        return res.status(500).json({ ok: false, step: 'get_try', error: String(e?.message || e) });
      }
    }

    if (req.method === 'POST') {
      let body: any = {};
      try {
        body =
          typeof req.body === 'object' && req.body !== null
            ? req.body
            : JSON.parse(req.body || '{}');
      } catch {
        return res.status(400).json({ ok: false, error: 'invalid json' });
      }

      // Campos permitidos para actualizar
      const allowed = [
        'full_name',
        'gender',
        'birthdate',
        'height_cm',
        'weight_kg',
        'goal_kcal',
        'goal_protein_g',
        'goal_carbs_g',
        'goal_fat_g',
        'avatar_url',
      ];

      const payload: any = { id: user_id }; // clave es id
      for (const k of allowed) {
        if (k in body) payload[k] = body[k];
      }
      // Si tienes la columna updated_at, la rellenamos; si no, no pasa nada
      payload.updated_at = new Date().toISOString();

      try {
        const { error } = await supabase
          .from('profiles')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          return res.status(500).json({ ok: false, step: 'upsert', error: error.message });
        }
        return res.status(200).json({ ok: true, updated: 1 });
      } catch (e: any) {
        return res.status(500).json({ ok: false, step: 'post_try', error: String(e?.message || e) });
      }
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (e: any) {
    // Errores en inicialización (p.ej., env faltantes) o cualquier throw no capturado
    return res.status(500).json({ ok: false, step: 'init', error: String(e?.message || e) });
  }
}
