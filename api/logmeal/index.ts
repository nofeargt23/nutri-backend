// /api/logmeal/index.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Buffer } from 'node:buffer';

// Permite payloads base64 grandes sin cortar
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

type Mode = 'url' | 'base64';

function json(res: VercelResponse, code: number, payload: any) {
  res.status(code).json(payload);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method Not Allowed' });
  }

  const API_BASE = process.env.LOGMEAL_API_BASE || 'https://api.logmeal.com';
  const USER_TOKEN =
    process.env.LOGMEAL_API_USER_TOKEN ||
    process.env.LOGMEAL_TOKEN; // por si lo guardaste con este nombre

  if (!USER_TOKEN) {
    return json(res, 500, {
      error: 'Missing LOGMEAL_API_USER_TOKEN environment variable',
    });
  }

  const { mode, imageUrl, base64 } = (req.body || {}) as {
    mode?: Mode;
    imageUrl?: string;
    base64?: string;
  };

  if (mode !== 'url' && mode !== 'base64') {
    return json(res, 400, { error: "Invalid mode. Use 'url' or 'base64'" });
  }

  const endpoint = `${API_BASE}/v2/recognition/complete`;

  try {
    let upstream: Response;

    if (mode === 'url') {
      if (!imageUrl) {
        return json(res, 400, { error: 'imageUrl is required for mode=url' });
      }

      upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${USER_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image_url: imageUrl }),
      });
    } else {
      // mode === 'base64'
      if (!base64) {
        return json(res, 400, { error: 'base64 is required for mode=base64' });
      }

      const buf = Buffer.from(base64, 'base64');
      // En Node 18+ (Vercel) Blob/FormData existen vía undici
      const blob = new Blob([buf], { type: 'image/jpeg' });
      const form = new FormData();
      form.append('image', blob, 'image.jpg');

      upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${USER_TOKEN}`,
          // NO pongas Content-Type aquí; fetch lo setea para multipart
        },
        body: form as any,
      });
    }

    // Intenta parsear JSON (si el upstream falla, igual intentamos leer JSON del error)
    const data = await upstream
      .json()
      .catch(async () => ({ raw: await upstream.text() }));

    if (!upstream.ok) {
      return json(res, upstream.status, {
        error: 'LogMeal upstream error',
        detail: data,
      });
    }

    // Devuelve tal cual la respuesta de LogMeal
    return json(res, 200, data);
  } catch (err: any) {
    return json(res, 500, {
      error: 'Upstream fetch failed',
      message: err?.message ?? String(err),
    });
  }
}
