// api/admin-ping.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Debes enviar este header: x-admin-secret: <tu valor>
  const header = (req.headers['x-admin-secret'] || req.headers['X-Admin-Secret']) as string | undefined;
  if (!header || header !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  return res.status(200).json({
    ok: true,
    env: 'up',
    supabase: !!process.env.SUPABASE_URL,
  });
}
