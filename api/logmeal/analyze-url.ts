export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: 'Missing url' });

  return res.status(200).json({ ok: true, echo: 'alive:url' });
}
