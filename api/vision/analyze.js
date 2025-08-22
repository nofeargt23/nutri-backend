export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } });
    }

    // 1) Body seguro
    const rawBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    let { url, base64 } = rawBody;

    // 2) Elegir fuente de imagen: URL preferente; si no, base64 limpio
    let imageData = {};
    if (url && typeof url === "string" && url.trim()) {
      imageData = { url: url.trim() };
    } else {
      let b64 = String(base64 || "").trim();
      b64 = b64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, ""); // quitar prefijo data:
      b64 = b64.replace(/\s+/g, ""); // quitar espacios/saltos
      const mod = b64.length % 4;     // padding si falta
      if (mod === 2) b64 += "==";
      else if (mod === 3) b64 += "=";
      if (!b64) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Provide url or base64" } });
      imageData = { base64: b64 };
    }

    // 3) API key
    const key = process.env.CLARIFAI_API_KEY;
    if (!key) return res.status(501).json({ error: { code: "NO_KEY", message: "Missing Clarifai key" } });

    // 4) Payload (más conceptos y min_value 0.0 para no filtrar en API)
    const payload = {
      user_app_id: { user_id: "clarifai", app_id: "main" },
      inputs: [{ data: { image: imageData } }],
      model: { output_info: { output_config: { max_concepts: 64, min_value: 0.0 } } }
    };

    // 5) Llamadas a Clarifai con fallback
    const endpoint = (modelId) => `https://api.clarifai.com/v2/models/${modelId}/outputs`;
    async function callClarifai(modelId) {
      const r = await fetch(endpoint(modelId), {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      return { ok: r.ok, json: j };
    }

    // Primero intentamos con food; si falla, general
    let resp = await callClarifai("food-item-recognition");
    if (!resp.ok) resp = await callClarifai("general-image-recognition");

    const j = resp.json;
    if (!resp.ok) {
      return res.status(502).json({ error: { code: "CLARIFAI_FAIL", message: JSON.stringify(j).slice(0, 800) } });
    }

    // 6) Normalización y filtrado más permisivo
    const es2en = {
      arroz:"rice", pollo:"chicken", res:"beef", carne:"beef", cerdo:"pork", pescado:"fish",
      huevo:"egg", huevos:"egg", papa:"potato", papas:"potato", queso:"cheese", pan:"bread",
      pasta:"pasta", ensalada:"salad", tomate:"tomato", lechuga:"lettuce", cebolla:"onion",
      maiz:"corn", arepa:"arepa", frijoles:"beans", caraotas:"beans", lentejas:"lentils",
      avena:"oats", yuca:"cassava", "plátano":"plantain", platano:"plantain",
      batata:"sweet potato", camote:"sweet potato", aguacate:"avocado"
    };
    const norm = s => {
      const x = (s || "").toLowerCase().trim();
      return es2en[x] || (x.endsWith("s") ? x.slice(0,-1) : x);
    };

    const all = (j?.outputs?.[0]?.data?.concepts || [])
      .sort((a,b)=> b.value - a.value)
      .slice(0, 12);

    let concepts = all
      .filter(c => c.value >= 0.50)      // más sensible
      .slice(0, 8)
      .map(c => ({ name: norm(c.name), confidence: Number(c.value.toFixed(3)) }));

    // si quedó vacío, regresamos top-5 sin filtro para no dejarte en blanco
    if (concepts.length === 0) {
      concepts = all.slice(0,5).map(c => ({
        name: norm(c.name),
        confidence: Number(c.value.toFixed(3))
      }));
    }

    return res.status(200).json({ concepts });
  } catch (e) {
    return res.status(502).json({ error: { code: "SERVER_ERROR", message: String(e).slice(0, 800) } });
  }
}
