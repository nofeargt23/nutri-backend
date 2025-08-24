export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url, base64 } = req.body || {};
  if (!url && !base64) {
    return res.status(400).json({ error: "Send either 'url' or 'base64'" });
  }

  const KEY = process.env.CLARIFAI_API_KEY || "";
  const USER_ID = process.env.CLARIFAI_USER_ID || "nofeargt23";
  const APP_ID = process.env.CLARIFAI_APP_ID || "nofeargt23";

  if (!KEY) return res.status(500).json({ error: "Missing CLARIFAI_API_KEY" });

  const PRIMARY = process.env.CLARIFAI_MODEL_ID || "food-item-recognition";
  const FALLBACK = "general-image-recognition";

  async function run(modelId) {
    const body = {
      user_app_id: { user_id: USER_ID, app_id: APP_ID },
      inputs: [{ data: { image: url ? { url } : { base64 } } }],
    };

    const r = await fetch(
      `https://api.clarifai.com/v2/models/${modelId}/outputs`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const data = await r.json();
    return { ok: r.ok, data };
  }

  try {
    // 1) Intento con Food
    let { ok, data } = await run(PRIMARY);

    // Si el modelo no existe en tu app (code 21200), pruebo el general
    const statusCode = data?.status?.code;
    if (!ok && statusCode === 21200) {
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
