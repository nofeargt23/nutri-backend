// api/analyze-then-parse.js
export default async function handler(req, res) {
  // ---- CORS básico ----
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin || "";
  const isAllowed = !allowed.length || allowed.includes(origin);
  if (isAllowed && origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ---- Método ----
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  // ---- Auth ----
  const expected = process.env.BACKEND_API_KEY || "";
  const provided = req.headers["x-api-key"];
  if (expected && provided !== expected) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  try {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "url required" });
    }

    // Base URL de este backend en Vercel (con https)
    const base = `https://${process.env.VERCEL_URL || req.headers.host}`;

    // Headers a propagar
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": provided || ""
    };

    // 1) Analizar imagen
    const vRes = await fetch(`${base}/api/vision/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url })
    });
    const vision = await vRes.json();

    // 2) Si hay conceptos -> parsear nutrición
    let nutrition = null;
    if (vision && Array.isArray(vision.concepts) && vision.concepts.length) {
      const ingredients = vision.concepts.map(c => c.name);
      const nRes = await fetch(`${base}/api/nutrition/parse`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ingredients })
      });
      nutrition = await nRes.json();
    }

    return res.status(200).json({ vision, nutrition });
  } catch (err) {
    return res.status(500).json({ error: "SERVER_ERROR", message: err?.message || String(err) });
  }
}
