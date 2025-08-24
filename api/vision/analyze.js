// /api/vision/analyze.js
export default async function handler(req, res) {
  // CORS mínimo (si ya tienes seguridad/CORS global, puedes quitarlo)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } });
  }

  const key = process.env.CLARIFAI_API_KEY || "";
  if (!key) {
    return res.status(501).json({
      ok: false,
      error: { code: "NO_KEY", message: "Missing CLARIFAI_API_KEY" }
    });
  }

  const { url, base64, minScore = 0.5, maxConcepts = 32 } = req.body || {};
  if (!url && !base64) {
    return res.status(400).json({
      ok: false,
      error: { code: "BAD_REQUEST", message: "Send 'url' or 'base64'." }
    });
  }

  // Construimos payload correcto para Clarifai
  const imageObj = url ? { url } : { base64 };
  const payload = {
    user_app_id: { user_id: "clarifai", app_id: "main" },
    inputs: [{ data: { image: imageObj } }],
    model: {
      output_info: { output_config: { max_concepts: maxConcepts, min_value: minScore } }
    }
  };

  try {
    const resp = await fetch(
      "https://api.clarifai.com/v2/models/food-item-recognition/outputs",
      {
        method: "POST",
        headers: {
          Authorization: `Key ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) {
      return res.status(502).json({
        ok: false,
        error: { code: "CLARIFAI_HTTP", status: resp.status, body: data }
      });
    }

    // Éxito de Clarifai es status.code === 10000
    const st = data?.status?.code;
    if (st !== 10000) {
      return res.status(502).json({
        ok: false,
        error: { code: "CLARIFAI_FAIL", clarifaiStatus: data?.status }
      });
    }

    // Tomamos conceptos
    const concepts =
      data?.outputs?.[0]?.data?.concepts?.map((c) => ({
        name: c.name,
        confidence: c.value
      })) || [];

    return res.status(200).json({
      ok: true,
      concepts,
      meta: {
        count: concepts.length,
        minScore,
        maxConcepts
      }
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "SERVER_ERROR", message: String(e) }
    });
  }
}
