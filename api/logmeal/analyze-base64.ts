export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const { base64 } = req.body || {};
  if (!base64) return res.status(400).json({ ok: false, error: 'Missing base64' });

  return res.status(200).json({ ok: true, echo: 'alive:base64' });
}
