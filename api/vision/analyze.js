export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url, base64 } = req.body || {};
  if (!url && !base64) {
    return res.status(400).json({ error: "Send either 'url' or 'base64'" });
  }

  // SOLO necesitamos la API KEY. No uses tus IDs propios ahora.
  const KEY = process.env.CLARIFAI_API_KEY || "";
  if (!KEY) return res.status(500).json({ error: "Missing CLARIFAI_API_KEY" });

  // Par público de Clarifai (modelos pre-entrenados accesibles)
  const USER_ID = "clarifai";
  const APP_ID = "main";

  // Primero intentamos con el modelo de comida; si no, caemos al general
  const PRIMARY = "food-item-recognition";
  const FALLBACK = "general-image-recognition";

  async function run(modelId) {
    const body = {
      user_app_id: { user_id: USER_ID, app_id: APP_ID },
      inputs: [{ data: { image: url ? { url } : { base64 } } }],
    };

    const r = await fetch(`https://api.clarifai.com/v2/models/${modelId}/outputs`, {
      method: "POST",
      headers: {
        Authorization: `Key ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    return { ok: r.ok, data };
  }

  try {
    // 1) Food
    let { ok, data } = await run(PRIMARY);

    // Si el modelo está temporalmente no disponible (o similar), probamos el general
    const statusCode = data?.status?.code;
    if (!ok && (statusCode === 21200 || statusCode === 21201 || statusCode === 21202)) {
      const alt = await run(FALLBACK);
      ok = alt.ok;
      data = alt.data;
    }

    if (!ok) {
      return res.status(500).json({ error: data });
    }

    const concepts =
      data?.outputs?.[0]?.data?.concepts?.map((c) => ({
        id: c.id,
        name: c.name || c.id,
        value: c.value,
      })) || [];

    return res.status(200).json({ concepts });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
