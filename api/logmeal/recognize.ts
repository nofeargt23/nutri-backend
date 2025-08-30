// api/logmeal/recognize.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const LOGMEAL_COMPANY_TOKEN = process.env.LOGMEAL_COMPANY_TOKEN || '';
const LOGMEAL_API_USER_TOKEN = process.env.LOGMEAL_API_USER_TOKEN || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }
    if (!LOGMEAL_COMPANY_TOKEN || !LOGMEAL_API_USER_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: 'Missing LogMeal env vars (LOGMEAL_COMPANY_TOKEN / LOGMEAL_API_USER_TOKEN)',
      });
    }

    const { base64, url } = req.body || {};
    if (!base64 && !url) {
      return res.status(400).json({ ok: false, error: 'Send base64 or url' });
    }

    // 1) Obtener Buffer de imagen (desde URL o base64)
    let imageBuffer: Buffer;
    let filename = `image_${Date.now()}.jpg`;

    if (url) {
      const r = await fetch(url);
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return res.status(400).json({
          ok: false,
          error: `Could not fetch image URL (${r.status})`,
          detail: txt,
        });
      }
      const ab = await r.arrayBuffer();
      imageBuffer = Buffer.from(ab);
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('png')) filename = filename.replace('.jpg', '.png');
    } else {
      const clean = (base64 as string).includes('base64,')
        ? (base64 as string).split('base64,').pop()!
        : (base64 as string);
      imageBuffer = Buffer.from(clean, 'base64');
    }

    // 2) Multipart/form-data
    const form = new FormData();
    form.append('image', new Blob([imageBuffer]), filename);

    // IMPORTANTE: en tu cuenta los endpoints son /image/recognition/complete
    const endpoint = 'https://api.logmeal.com/image/recognition/complete';

    // 3) Llamada a LogMeal con autenticación estándar
    const rLm = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${LOGMEAL_COMPANY_TOKEN}`,
        'X-USER-TOKEN': LOGMEAL_API_USER_TOKEN, // estándar actual
        // Si tu cuenta fuese legacy, descomenta la siguiente línea y prueba:
        // 'user_token': LOGMEAL_API_USER_TOKEN,
      } as any,
      body: form as any,
    });

    const rawText = await rLm.text().catch(() => '');
    let raw: any = null;
    try { raw = rawText ? JSON.parse(rawText) : null; } catch (_e) { raw = rawText; }

    if (!rLm.ok) {
      // Devuelve TODO para que lo veas en la app
      return res.status(rLm.status).json({
        ok: false,
        error: 'LogMeal upstream error',
        status: rLm.status,
        detail: raw ?? rawText,
      });
    }

    // Normalización simple para tu UI
    let all: Array<{ name: string; confidence: number }> = [];

    if (raw && Array.isArray(raw.recognition_results)) {
      all = raw.recognition_results.map((x: any) => ({
        name: x?.name || x?.foodName || 'unknown',
        confidence:
          typeof x?.confidence === 'number' ? x.confidence :
          typeof x?.score === 'number' ? x.score : 0,
      }));
    } else if (Array.isArray(raw?.items)) {
      all = raw.items.map((x: any) => ({
        name: x?.name || 'unknown',
        confidence: x?.score ?? 0,
      }));
    }

    return res.status(200).json({ ok: true, all, raw });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: 'Internal proxy error',
      detail: err?.message || String(err),
    });
  }
}
