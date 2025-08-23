// api/analyze-then-parse.js
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    }

    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "url required" });
    }

    const key = req.headers["x-api-key"];
    if (!key || key !== process.env.BACKEND_API_KEY) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    // Paso 1: analizar imagen con visión
    const vision = await fetch(`${process.env.VERCEL_URL}/api/vision/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ url })
    }).then(r => r.json());

    // Paso 2: si hay conceptos válidos -> parsear nutrición
    let nutrition = null;
    if (vision && vision.concepts && vision.concepts.length > 0) {
      const ingredients = vision.concepts.map(c => c.name);
      nutrition = await fetch(`${process.env.VERCEL_URL}/api/nutrition/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        body: JSON.stringify({ ingredients })
      }).then(r => r.json());
    }

    return res.status(200).json({ vision, nutrition });

  } catch (err) {
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
}
