// api/profile.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sbAdmin, getUserFromReq } from './_lib/supabase';

// Campos que permitimos escribir
const ALLOWED = new Set([
  'full_name', 'avatar_url',
  'sex', 'height_cm', 'weight_kg',
  'goal_calories', 'goal_protein_g', 'goal_carbs_g', 'goal_fat_g',
  'language', 'units',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Validar sesión de usuario (Bearer <token>)
  const { user, error } = await getUserFromReq(req);
  if (error || !user) return res.status(401).json({ error: 'unauthorized' });

  try {
    if (req.method === 'GET') {
      // Asumimos profiles.id = auth.uid()
      const { data, error } = await sbAdmin
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ profile: data || null });
    }

    if (req.method === 'PUT') {
      const body = (req.body || {}) as Record<string, any>;
      const filtered: Record<string, any> = {};
      for (const k of Object.keys(body)) if (ALLOWED.has(k)) filtered[k] = body[k];

      const row = {
        id: user.id,
        ...filtered,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await sbAdmin
        .from('profiles')
        .upsert(row, { onConflict: 'id' })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ profile: data });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
