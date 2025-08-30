// api/logmeal/recognize.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const LOGMEAL_COMPANY_TOKEN = process.env.LOGMEAL_COMPANY_TOKEN || '';
const LOGMEAL_API_USER_TOKEN = process.env.LOGMEAL_API_USER_TOKEN || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }

    const { base64, url } = req.body || {};
    if (!base64 && !url) {
      return res.status(400).json({ ok: false, error: 'Send base64 or url' });
    }

    let imageBuffer: Buffer;
    let filename = `image_${Date.now()}.jpg`;

    if (url) {
      const r = await fetch(url);
      const ab = await r.arrayBuffer();
      imageBuffer = Buffer.from(ab);
    } else {
      const clean = (base64 as string).includes('base64,')
        ? (base64 as string).split('base64,').pop()!
        : (base64 as string);
      imageBuffer = Buffer.from(clean, 'base64');
    }

    const form = new FormData();
    form.append('image', new Blob([imageBuffer]), filename);

    // Probar endpoint /image/recognition/dish en lugar de complete
    const endpoint = 'https://api.logmeal.com/image/recognition/dish';

    const rLm = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${LOGMEAL_COMPANY_TOKEN}`,
        user_token: LOGMEAL_API_USER_TOKEN,
      } as any,
      body: form as any,
    });

    const rawText = await rLm.text().catch(() => '');
    let raw: any = null;
    try { raw = rawText ? JSON.parse(rawText) : null; } catch { raw = rawText; }

    if (!rLm.ok) {
      return res.status(rLm.status).json({
        ok: false,
        error: 'LogMeal upstream error',
        status: rLm.status,
        rawText,   // 🔥 MOSTRAR TEXTO COMPLETO
      });
    }

    return res.status(200).json({ ok: true, raw });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: 'Internal proxy error',
      detail: err?.message || String(err),
    });
  }
}
