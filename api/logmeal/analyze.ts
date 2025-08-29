// /api/logmeal/analyze.ts
// Proxy seguro a LogMeal: recibe {base64} o {url} y devuelve {concepts:[{name,confidence}], all: [...]}

import type { VercelRequest, VercelResponse } from '@vercel/node';

const REQUIRED_KEY = process.env.BACKEND_API_KEY || '';
const LOGMEAL_TOKEN = process.env.LOGMEAL_TOKEN || '';
const LOGMEAL_BASE = process.env.LOGMEAL_BASE || 'https://api.logmeal.es/v2';

async function callLogMeal(imageBase64?: string, url?: string) {
  // Preferimos base64; si llega URL, la descargamos nosotros (LogMeal permite file/base64; evitamos CORS raros)
  const body: any = {};
  if (imageBase64) {
    body.image = imageBase64; // LogMeal acepta { image: "<base64>" }
  } else if (url) {
    // Si quisieras reenviar URL directa, muchos planes lo aceptan en "url" o subiendo la imagen.
    // Para máxima compatibilidad, aquí podrías descargar y convertir a base64; de momento enviamos url.
    body.url = url;
  } else {
    throw new Error('No image data provided');
  }

  // Usamos el endpoint "recognition/complete" que devuelve múltiples ítems si existen
  const endpoint = `${LOGMEAL_BASE}/image/recognition/complete`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOGMEAL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LogMeal error ${res.status}: ${text}`);
  }

  const data = await res.json();

  // Normalizamos a un arreglo de { name, confidence }
  // LogMeal suele devolver predictions con labels y scores.
  const all: Array<{ name: string; confidence: number }> = [];

  // Intentamos mapear formatos comunes:
  // - data.recognition_results / data.foodName / data.image / etc.
  // Hacemos extracción flexible (no rompe si algún campo cambia).
  const tryPush = (label: any, score: any) => {
    const name = typeof label === 'string' ? label : (label?.name || label?.label || '');
    const confidence = typeof score === 'number' ? score : (score?.prob || score?.score || 0);
    if (name) all.push({ name: name.toLowerCase(), confidence: Number(confidence) || 0 });
  };

  // Casos comunes
  if (Array.isArray(data?.recognition_results)) {
    // algunos devuelven [{name,prob}, ...]
    for (const it of data.recognition_results) {
      tryPush(it?.name ?? it?.label, it?.prob ?? it?.score);
    }
  }

  if (Array.isArray(data?.food)) {
    // otros devuelven food: [{name,score}]
    for (const it of data.food) {
      tryPush(it?.name ?? it?.label, it?.score ?? it?.prob);
    }
  }

  if (Array.isArray(data?.predictions)) {
    // formato predictions: [{label,prob}]
    for (const it of data.predictions) {
      tryPush(it?.label ?? it?.name, it?.prob ?? it?.score);
    }
  }

  // Si vino vacío, intentamos un fallback minimal
  if (all.length === 0 && data?.classification) {
    tryPush(data.classification?.label, data.classification?.prob);
  }

  // Ordenamos por confianza desc y filtramos >0
  all.sort((a, b) => b.confidence - a.confidence);
  const concepts = all.filter(x => x.confidence > 0.2).slice(0, 5);

  return { concepts, all };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Seguridad básica con x-api-key (igual que el resto de tu backend)
    const key = req.headers['x-api-key'];
    if (!key || key !== REQUIRED_KEY) return res.status(401).json({ error: 'UNAUTHORIZED' });

    if (!LOGMEAL_TOKEN) return res.status(500).json({ error: 'LOGMEAL_TOKEN not configured' });

    const { base64, url } = req.body || {};
    const out = await callLogMeal(base64, url);

    return res.status(200).json({
      ok: true,
      provider: 'logmeal',
      ...out
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'Server error' });
  }
}
