// api/logmeal/analyze.ts
// POST { base64: string } -> sube como multipart a LogMeal y normaliza

export const config = {
  api: { bodyParser: { sizeLimit: "8mb" } },
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { base64 } = req.body || {};
    if (!base64) {
      res.status(400).json({ error: "Missing 'base64'" });
      return;
    }

    const token = process.env.LOGMEAL_COMPANY_TOKEN;
    if (!token) {
      res.status(500).json({ error: "Missing LOGMEAL_COMPANY_TOKEN" });
      return;
    }

    // Node 18+: Blob/FormData disponibles globalmente
    const bin = Buffer.from(base64, "base64");
    const blob = new Blob([bin], { type: "image/jpeg" });
    const form = new FormData();
    // LogMeal espera el campo "image"
    form.append("image", blob, "photo.jpg");

    // *** ENDPOINT CORRECTO ***
    const url = "https://api.logmeal.es/v2/image/recognition/dish";

    const lm = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }, // no pongas Content-Type aquí
      body: form, // FormData pone el boundary automáticamente
    });

    const raw = await lm.json().catch(() => ({}));

    if (!lm.ok) {
      res
        .status(lm.status)
        .json({ error: "LogMeal file error", detail: raw, status: lm.status });
      return;
    }

    const candidates =
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

    res.status(200).json({ all, raw });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Server error" });
  }
}
