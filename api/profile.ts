import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_supabase';

function unauthorized(res: VercelResponse) {
  return res.status(401).json({ ok: false, error: 'unauthorized' });
}
function bad(res: VercelResponse, error: string, details?: any, code = 400) {
  return res.status(code).json({ ok: false, error, details });
}
function ok(res: VercelResponse, data: any = {}) {
  return res.status(200).json({ ok: true, ...data });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Autorización simple por header
    const secret = req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET) {
      return unauthorized(res);
    }

    if (req.method === 'GET') {
      const user_id = String(req.query.user_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(user_id)) {
        return bad(res, 'invalid user_id');
      }

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('user_id', user_id)
        .maybeSingle(); // no revienta si no hay fila

      if (error) {
        return bad(res, 'db_select_failed', error.message, 500);
      }
      return ok(res, { profile: data ?? null });
    }

    if (req.method === 'POST') {
      const b = (req.body ?? {}) as any;
      if (!b.user_id) return bad(res, 'user_id required');

      const row = {
        user_id: b.user_id,
        full_name: b.full_name ?? null,
        sex: b.sex ?? null,
        height_cm: b.height_cm ?? null,
        weight_kg: b.weight_kg ?? null,
        units: b.units ?? 'metric',
        goals: b.goals ?? null,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .upsert(row, { onConflict: 'user_id' })
        .select()
        .single();

      if (error) {
        return bad(res, 'db_upsert_failed', error.message, 500);
      }
      return ok(res, { profile: data });
    }

    res.setHeader('Allow', 'GET, POST');
    return bad(res, 'method_not_allowed', null, 405);
  } catch (err: any) {
    console.error('profile handler crash', err);
    return res.status(500).json({
      ok: false,
      error: 'server_crash',
      details: String(err?.message || err),
    });
  }
}
