// api/profile.ts  (o api/profile.js)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE as string
);

export default async function handler(req: any, res: any) {
  // auth simple con header
  const admin = req.headers['x-admin-secret'];
  if (admin !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const user_id = String(req.query.user_id || '').trim();
  if (!user_id) {
    return res.status(400).json({ ok: false, error: 'missing user_id' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user_id) // <- usar id, NO user_id
      .single();

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, profile: data });
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
      'avatar_url'
    ];

    // Construimos el payload SIN user_id (es generated always)
    const payload: any = { id: user_id }; // <- clave es id
    for (const k of allowed) {
      if (k in body) payload[k] = body[k];
    }

    // opcional: llevar updated_at
    payload.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'id' });

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, updated: 1 });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'method not allowed' });
}
