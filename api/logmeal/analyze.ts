// api/logmeal/analyze.ts
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
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { base64, url } = req.body || {};

    if (!LOGMEAL_APP_ID || !LOGMEAL_API_KEY) {
      return res.status(500).json({ ok: false, error: 'Missing LogMeal credentials' });
    }

    let lmRes: Response;

    // 1) Por URL pública
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

    // 2) Por base64 → multipart
    } else if (base64) {
      const form = new FormData();
      form.append('image', toBuffer(base64), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

      lmRes = await fetch('https://api.logmeal.com/image/recognition/complete', {
        method: 'POST',
        headers: {
          'X-APP-ID': LOGMEAL_APP_ID,
          'X-API-KEY': LOGMEAL_API_KEY,
          // ¡NO pongas Content-Type! FormData lo maneja con boundary
          ...form.getHeaders(),
        },
        body: form as any,
      });

    } else {
      return res.status(400).json({ ok: false, error: 'Provide url or base64' });
    }

    // Intenta parsear JSON; si viene HTML (upstream), captura el texto para depurar
    const text = await lmRes.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!lmRes.ok) {
      // Reexpone el código y el cuerpo que devolvió LogMeal para ver el motivo real
      return res.status(lmRes.status).json({
        ok: false,
        error: 'LogMeal upstream error',
        status: lmRes.status,
        data,
      });
    }

    return res.status(200).json({ ok: true, data });

  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: 'Proxy error',
      detail: err?.message || String(err),
    });
  }
}
