// /api/logmeal/analyze.ts
import type { NextApiRequest, NextApiResponse } from 'next';

const REQUIRED_KEY = process.env.BACKEND_API_KEY!;
const LOGMEAL_BASE = process.env.LOGMEAL_API_BASE || 'https://api.logmeal.es/v2';
const COMPANY_TOKEN = process.env.LOGMEAL_COMPANY_TOKEN!;
const RECOGNITION_URL = `${LOGMEAL_BASE}/image/recognition/complete`;

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' }, // permite imágenes grandes
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Seguridad: validar tu x-api-key
    const clientKey = req.headers['x-api-key'];
    if (!clientKey || clientKey !== REQUIRED_KEY) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    if (!COMPANY_TOKEN) {
      return res.status(500).json({ error: 'Missing LOGMEAL_COMPANY_TOKEN' });
    }

    const { base64, url } = (req.body || {}) as { base64?: string; url?: string };
    if (!base64 && !url) {
      return res.status(400).json({ error: 'Provide base64 or url' });
    }

    const form = new FormData();

    if (base64) {
      const bytes = Buffer.from(base64, 'base64');
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      form.append('image', blob, 'photo.jpg');
    }

    if (url) {
      form.append('image_url', url);
    }

    const lmRes = await fetch(RECOGNITION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${COMPANY_TOKEN}`,
      },
      body: form,
    });

    const raw = await lmRes.json().catch(() => null);

    if (!lmRes.ok) {
      return res.status(502).json({ error: 'LOGMEAL_ERROR', status: lmRes.status, raw });
    }

    // Normalizar a { all: Concept[] }
    const concepts = extractConcepts(raw);

    return res.status(200).json({
      ok: true,
      all: concepts,
      raw,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
}

function extractConcepts(raw: any): Array<{ name: string; confidence: number }> {
  const out: Array<{ name: string; confidence: number }> = [];
  const candidates: any[] = [];

  if (Array.isArray(raw?.recognition_results)) candidates.push(...raw.recognition_results);
  if (Array.isArray(raw?.dishes)) candidates.push(...raw.dishes);
  if (Array.isArray(raw?.items)) candidates.push(...raw.items);

  const pushItem = (label: string, prob: number) => {
    if (!label) return;
    out.push({ name: label.toLowerCase(), confidence: Number.isFinite(prob) ? prob : 0 });
  };

  for (const c of candidates) {
    if (c?.name && (c?.probability ?? c?.score ?? c?.confidence) != null) {
      pushItem(c.name, c.probability ?? c.score ?? c.confidence);
    }
    if (c?.label && (c?.prob ?? c?.score ?? c?.confidence) != null) {
      pushItem(c.label, c.prob ?? c.score ?? c?.confidence);
    }
  }

  if (out.length === 0 && raw?.label) pushItem(raw.label, raw?.probability ?? 0.5);

  return out.slice(0, 10);
}
