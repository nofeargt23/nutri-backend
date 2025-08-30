// api/logmeal/recognize.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const LOGMEAL_COMPANY_TOKEN = process.env.LOGMEAL_COMPANY_TOKEN || '';
const LOGMEAL_API_USER_TOKEN = process.env.LOGMEAL_API_USER_TOKEN || '';

/**
 * Proxy seguro hacia LogMeal API estándar (NO kiosk).
 * Acepta { base64?: string, url?: string } y devuelve la respuesta normalizada.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!LOGMEAL_COMPANY_TOKEN || !LOGMEAL_API_USER_TOKEN) {
      return res.status(500).json({ error: 'Missing LogMeal env vars' });
    }

    const { base64, url } = req.body || {};
    if (!base64 && !url) {
      return res.status(400).json({ error: 'Send base64 or url' });
    }

    // Descarga imagen si llega URL, o usa base64 directamente.
    let imageBuffer: Buffer;
    let filename = `image_${Date.now()}.jpg`;

    if (url) {
      const r = await fetch(url);
      if (!r.ok) {
        return res.status(400).json({ error: `Could not fetch image URL (${r.status})` });
      }
      const ab = await r.arrayBuffer();
      imageBuffer = Buffer.from(ab);
      // intenta inferir nombre/extension
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('png')) filename = filename.replace('.jpg', '.png');
    } else {
      // base64 puede venir con "data:image/jpeg;base64,...." o solo el payload
      const clean = (base64 as string).includes('base64,')
        ? (base64 as string).split('base64,').pop()!
        : (base64 as string);
      imageBuffer = Buffer.from(clean, 'base64');
    }

    // Construye multipart/form-data
    const form = new FormData();
    form.append('image', new Blob([imageBuffer]), filename);

    // API estándar de LogMeal (no kiosk)
    // Reconocimiento completo (ingredientes + plato)
    const endpoint = 'https://api.logmeal.com/v2/recognition/complete';

    const rLm = await fetch(endpoint, {
      method: 'POST',
      headers: {
        // Auth estándar: Company token + API User token
        Authorization: `Bearer ${LOGMEAL_COMPANY_TOKEN}`,
        'X-USER-TOKEN': LOGMEAL_API_USER_TOKEN,
      },
      body: form as any,
    });

    const raw = await rLm.json().catch(() => null);

    if (!rLm.ok) {
      return res.status(rLm.status).json({
        ok: false,
        error: 'LogMeal upstream error',
        detail: raw || (await rLm.text()),
      });
    }

    // Normalización mínima para tu app
    const all =
      raw?.recognition_results?.map((x: any) => ({
        name: x?.name || x?.foodName || 'unknown',
        confidence: typeof x?.confidence === 'number' ? x.confidence : x?.score ?? 0,
      })) ||
      raw?.items ||
      raw?.all ||
      [];

    return res.status(200).json({ ok: true, raw, all });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: 'Internal proxy error',
      detail: err?.message || String(err),
    });
  }
}
