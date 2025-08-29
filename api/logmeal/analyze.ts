// api/logmeal/analyze.ts
// POST { base64: string } -> sube como multipart a LogMeal y normaliza

export const config = {
  api: {
    bodyParser: { sizeLimit: "6mb" }, // por si envías fotos medianas
  },
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

    // ---- Preparar multipart/form-data ----
    // Node 18+ tiene Blob/FormData globales (undici)
    const bin = Buffer.from(base64, "base64");
    const blob = new Blob([bin], { type: "image/jpeg" });
    const form = new FormData();
    form.append("image", blob, "photo.jpg");

    // ---- Llamada a LogMeal (por archivo) ----
    const lm = await fetch("https://api.logmeal.es/v2/recognition/dish", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    const raw = await lm.json().catch(() => ({}));
    if (!lm.ok) {
      res.status(lm.status).json({ error: raw?.error || "LogMeal file error" });
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

