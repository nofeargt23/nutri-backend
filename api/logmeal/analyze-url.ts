// api/logmeal/analyze-url.ts
// POST { url: string } -> llama a LogMeal con URL y normaliza la salida

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { url } = req.body || {};
    if (!url) {
      res.status(400).json({ error: "Missing 'url'" });
      return;
    }

    const token = process.env.LOGMEAL_COMPANY_TOKEN;
    if (!token) {
      res.status(500).json({ error: "Missing LOGMEAL_COMPANY_TOKEN" });
      return;
    }

    // ---- Llamada a LogMeal (por URL) ----
    const lm = await fetch("https://api.logmeal.es/v2/recognition/dish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ image_url: url }),
    });

    const raw = await lm.json().catch(() => ({}));
    if (!lm.ok) {
      res.status(lm.status).json({ error: raw?.error || "LogMeal URL error" });
      return;
    }

    // ---- Normalización a { all: [{name, confidence}] } ----
    const candidates: Array<{ name?: string; probability?: number; score?: number }> =
      raw?.recognition_results ||
      raw?.detection_results ||
      raw?.items ||
      [];

    const all = candidates
      .map((c) => ({
        name: c.name || "item",
        confidence: Number(c.probability ?? c.score ?? 0),
      }))
      .filter((c) => !!c.name);

    res.status(200).json({ all });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Server error" });
  }
}
