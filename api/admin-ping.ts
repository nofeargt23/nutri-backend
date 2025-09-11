import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, role')
      .limit(5);

    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true, sample: data });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
