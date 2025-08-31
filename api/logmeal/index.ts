export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const { base64, url } = req.body || {};
    const API_BASE = process.env.LOGMEAL_API_BASE || 'https://api.logmeal.com';
    const USER_TOKEN = process.env.LOGMEAL_API_USER_TOKEN!;
    const COMPANY_TOKEN = process.env.LOGMEAL_COMPANY_TOKEN!;

    let resp;
    if (base64) {
      const bin = Buffer.from(base64, 'base64');
      const blob = new Blob([bin], { type: 'image/jpeg' });
      const form = new FormData();
      form.append('image', blob, 'photo.jpg');

      resp = await fetch(`${API_BASE}/image/recognition/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${USER_TOKEN}`,
          'X-Company-Token': COMPANY_TOKEN,
        },
        body: form,
      });
    } else if (url) {
      resp = await fetch(`${API_BASE}/image/confirm/type`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${USER_TOKEN}`,
          'X-Company-Token': COMPANY_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: url }),
      });
    } else {
      return res.status(400).json({ ok: false, error: 'Missing base64 or url' });
    }

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      return res.status(resp.status).json({ ok: false, error: 'LogMeal error', detail: data });
    }

    return res.status(200).json({ ok: true, result: data });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
