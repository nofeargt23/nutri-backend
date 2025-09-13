// Vercel Serverless Function: /api/profile
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || '';
// acepta ambos nombres de variable para el service role
const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SB_SERVICE_ROLE_KEY || '';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'my-admin-xyz';

// util: validar uuid v4 simple
const isUUID = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export default async function handler(req: any, res: any) {
  // auth de admin para pruebas
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const user_id = String(req.query.user_id || '');
  if (!isUUID(user_id)) {
    return res.status(400).json({ ok: false, error: 'invalid user_id' });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return res
      .status(500)
      .json({ ok: false, step: 'init', error: 'env_missing: SUPABASE_SERVICE_ROLE' });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (req.method === 'GET') {
    // leer por **id** (no user_id)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user_id)
      .single();

    if (error && (error as any).code !== 'PGRST116') {
      return res.status(500).json({ ok: false, step: 'select', error: error.message });
    }
    return res.status(200).json({ ok: true, profile: data || null });
  }

  if (req.method === 'POST') {
    // parsear body y permitir solo columnas existentes
    let body: any = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ ok: false, error: 'invalid JSON body' });
    }

    const allow = [
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

    const payload: any = { id: user_id }; // upsert por **id**
    for (const k of allow) if (body[k] !== undefined) payload[k] = body[k];

    const { data, error } = await supabase
      .from('profiles')
      .upsert(payload)         // sin onConflict raro ni updated_at
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, step: 'upsert', error: error.message });
    }
    return res.status(200).json({ ok: true, profile: data });
  }

  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
}
