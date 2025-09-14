// api/diary.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE!; // la service role real (no la anon)
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'my-admin-xyz';

const supa = createClient(url, key);

function todayUTC() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Seguridad simple (misma que /api/profile por ahora)
  const admin = req.headers['x-admin-secret'];
  if (admin !== ADMIN_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    if (req.method === 'POST') {
      const {
        user_id,
        entry_date,
        source,
        food_name,
        serving_qty,
        serving_unit,
        serving_grams,
        totals = {},
      } = req.body || {};

      if (!user_id) return res.status(400).json({ ok: false, error: 'missing user_id' });
      if (!food_name) return res.status(400).json({ ok: false, error: 'missing food_name' });

      const date = entry_date || todayUTC();

      // 1) asegurar entry del día
      const { data: existing, error: selErr } = await supa
        .from('diary_entries')
        .select('id')
        .eq('user_id', user_id)
        .eq('entry_date', date)
        .maybeSingle();

      if (selErr) throw selErr;

      let entry_id = existing?.id;
      if (!entry_id) {
        const { data: ins, error: insErr } = await supa
          .from('diary_entries')
          .insert([{ user_id, entry_date: date }])
          .select('id')
          .single();
        if (insErr) throw insErr;
        entry_id = ins.id;
      }

      // 2) crear item
      const payload: any = {
        entry_id,
        source: source || 'image',
        product_code: null,
        food_name,
        servings: serving_qty ?? 1,
        portion_g: serving_grams ?? null,
        calories_kcal: totals.calories ?? null,
        protein_g: totals.protein_g ?? null,
        carbs_g: totals.carbs_g ?? null,
        fat_g: totals.fat_g ?? null,
        sugars_g: totals.sugars_g ?? null,
        fiber_g: totals.fiber_g ?? null,
        sodium_mg: totals.sodium_mg ?? null,
      };

      const { data: item, error: itemErr } = await supa
        .from('diary_items')
        .insert([payload])
        .select('id')
        .single();

      if (itemErr) throw itemErr;

      return res.status(200).json({ ok: true, entry_id, item_id: item.id });
    }

    if (req.method === 'GET') {
      // /api/diary?user_id=...&date=YYYY-MM-DD
      const user_id = String(req.query.user_id || '');
      const date = String(req.query.date || todayUTC());
      if (!user_id) return res.status(400).json({ ok: false, error: 'missing user_id' });

      const { data: entry, error: eErr } = await supa
        .from('diary_entries')
        .select('id')
        .eq('user_id', user_id)
        .eq('entry_date', date)
        .maybeSingle();

      if (eErr) throw eErr;

      if (!entry) return res.status(200).json({ ok: true, items: [] });

      const { data: items, error: iErr } = await supa
        .from('diary_items')
        .select('*')
        .eq('entry_id', entry.id)
        .order('created_at', { ascending: false });

      if (iErr) throw iErr;

      return res.status(200).json({ ok: true, items });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
