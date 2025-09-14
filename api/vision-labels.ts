// api/vision-labels.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const KEY = process.env.GOOGLE_VISION_API_KEY as string;

function send(res: VercelResponse, code: number, body: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(code).send(JSON.stringify(body));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  // Ping de salud: https://<tu-backend>/api/vision-labels?ping=1
  if (req.method === 'GET' && req.query?.ping === '1') {
    return send(res, 200, { ok: true, ping: true, hasKey: Boolean(KEY), ts: Date.now() });
  }

  if (!KEY) {
    return send(res, 500, { ok: false, error: 'env_missing: GOOGLE_VISION_API_KEY' });
  }

  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('application/json')) {
    return send(res, 400, { ok: false, error: 'expected application/json' });
  }

  // Acepta URL o base64
  const { imageUrl, imageBase64 } = (req.body || {}) as {
    imageUrl?: string;
    imageBase64?: string; // solo el base64, sin "data:image/jpeg;base64,"
  };

  if ((!imageUrl || typeof imageUrl !== 'string') && (!imageBase64 || typeof imageBase64 !== 'string')) {
    return send(res, 400, { ok: false, error: 'missing imageUrl or imageBase64' });
  }

  const image: any = imageUrl
    ? { source: { imageUri: imageUrl } }
    : { content: imageBase64 };

  // Timeout 8s
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        requests: [
          {
            image,
            features: [{ type: 'LABEL_DETECTION', maxResults: 10 }],
          },
        ],
      }),
    }).finally(() => clearTimeout(timer));

    const text = await resp.text();

    if (!resp.ok) {
      return send(res, 502, {
        ok: false,
        error: 'vision_error',
        status: resp.status,
        text: text.slice(0, 600),
      });
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return send(res, 502, { ok: false, error: 'invalid_json_from_vision', text: text.slice(0, 600) });
    }

    const labels =
      data?.responses?.[0]?.labelAnnotations?.map((x: any) => ({
        name: x.description,
        score: x.score,
        topicality: x.topicality,
      })) ?? [];

    return send(res, 200, { ok: true, labels, raw: data?.responses?.[0] ?? null });
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err);
    return send(res, 500, { ok: false, error: msg });
  }
}
