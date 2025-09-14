// api/vision-labels.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const KEY = process.env.GOOGLE_VISION_API_KEY;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }
    if (!KEY) {
      return res.status(500).json({ ok: false, error: 'env_missing: GOOGLE_VISION_API_KEY' });
    }

    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (!ct.includes('application/json')) {
      return res.status(400).json({ ok: false, error: 'expected application/json body' });
    }

    const { imageUrl, imageBase64 } = (req.body || {}) as {
      imageUrl?: string;
      imageBase64?: string; // sin el prefijo data:image/...;base64,
    };

    if (!imageUrl && !imageBase64) {
      return res.status(400).json({ ok: false, error: 'missing imageUrl or imageBase64' });
    }

    // Si viene base64 lo mandamos como "content"; si viene URL pública, como "imageUri"
    const image = imageBase64
      ? { content: imageBase64.replace(/^data:image\/\w+;base64,/, '') }
      : { source: { imageUri: imageUrl } };

    const body = {
      requests: [
        {
          image,
          features: [
            { type: 'LABEL_DETECTION', maxResults: 10 },
            { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
          ],
        },
      ],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const g = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(body),
      }
    ).finally(() => clearTimeout(timer));

    if (!g.ok) {
      const text = await g.text().catch(() => '');
      return res.status(502).json({ ok: false, error: 'vision_error', status: g.status, text });
    }

    const data = await g.json();

    const labels =
      (data?.responses?.[0]?.labelAnnotations || []).map((x: any) => ({
        name: x.description,
        score: x.score,
      }));

    const objects =
      (data?.responses?.[0]?.localizedObjectAnnotations || []).map((x: any) => ({
        name: x.name,
        score: x.score,
      }));

    return res.status(200).json({ ok: true, labels, objects });
  } catch (e: any) {
    if (e?.name === 'AbortError') return res.status(504).json({ ok: false, error: 'timeout' });
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
