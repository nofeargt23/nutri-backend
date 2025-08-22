export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const url = (body.url || "").trim();
    if (!url) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Send { url: \"https://...jpg\" }" } });
    }

    const KEY = process.env.SPOONACULAR_API_KEY;
    if (!KEY) {
      return res.status(501).json({ error: { code: "NO_KEY", message: "Missing SPOONACULAR_API_KEY" } });
    }

    // Spoonacular Image Analysis by URL
    const endpoint = new URL("https://api.spoonacular.com/food/images/analyze");
    endpoint.searchParams.set("apiKey", KEY);
    endpoint.searchParams.set("imageUrl", url);

    const r = await fetch(endpoint.toString(), { method: "GET" });
    const j = await r.json();

    if (!r.ok) {
      return res.status(502).json({ error: { code: "SPOON_FAIL", message: JSON.stringify(j).slice(0, 800) } });
    }

    // Normalizar a { concepts: [{name, confidence}] }
    // Spoonacular devuelve varias cosas; priorizamos "category" y "nutrition/recipes" si existen.
    // También mapeamos "annotations" si vienen.
    let concepts = [];

    if (j?.category?.name) {
      concepts.push({ name: String(j.category.name).toLowerCase(), confidence: Number((j.category.probability || 0).toFixed(3)) });
    }

    if (Array.isArray(j?.annotations)) {
      for (const a of j.annotations) {
        if (a?.label) {
          concepts.push({ name: String(a.label).toLowerCase(), confidence: Number((a?.confidence || 0).toFixed(3)) });
        }
      }
    }

    // Quitar duplicados, ordenar por confianza
    const seen = new Map();
    for (const c of concepts) {
      if (!seen.has(c.name) || seen.get(c.name).confidence < c.confidence) {
        seen.set(c.name, c);
      }
    }
    concepts = [...seen.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 12);

    return res.status(200).json({ concepts, raw: { category: j?.category || null, annotations: j?.annotations || null } });
  } catch (e) {
    return res.status(502).json({ error: { code: "SERVER_ERROR", message: String(e).slice(0, 800) } });
  }
}
