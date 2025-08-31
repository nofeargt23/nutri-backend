// /api/logmeal/analyze.ts  (BACKEND en Vercel)
import type { VercelRequest, VercelResponse } from 'vercel';
import FormData from 'form-data';
import fetch from 'node-fetch';

const LOGMEAL_APP_ID = process.env.LOGMEAL_APP_ID!;
const LOGMEAL_API_KEY = process.env.LOGMEAL_API_KEY!;

function toBuffer(base64: string) {
  const cleaned = base64.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(cleaned, 'base64');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!LOGMEAL_APP_ID || !LOGMEAL_API_KEY) return res.status(500).json({ ok: false, error: 'Missing LogMeal credentials' });

  try {
    const { base64, url } = req.body || {};
    let lmRes: Response;

    if (url) {
      lmRes = await fetch('https://api.logmeal.com/image/recognition/complete/url', {
        method: 'POST',
        headers: {
          'X-APP-ID': LOGMEAL_APP_ID,
          'X-API-KEY': LOGMEAL_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });
    } else if (base64) {
      const form = new FormData();
      form.append('image', toBuffer(base64), { filename: 'photo.jpg', contentType: 'image/jpeg' });

      lmRes = await fetch('https://api.logmeal.com/image/recognition/complete', {
        method: 'POST',
        headers: { 'X-APP-ID': LOGMEAL_APP_ID, 'X-API-KEY': LOGMEAL_API_KEY, ...form.getHeaders() },
        body: form as any,
      });
    } else {
      return res.status(400).json({ ok: false, error: 'Provide url or base64' });
    }

    const text = await lmRes.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!lmRes.ok) {
      return res.status(lmRes.status).json({ ok: false, error: 'LogMeal upstream error', status: lmRes.status, data });
    }
    return res.status(200).json({ ok: true, data });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: 'Proxy error', detail: err?.message || String(err) });
  }
}
