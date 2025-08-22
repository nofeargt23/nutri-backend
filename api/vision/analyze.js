export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } });
    }

    // Body seguro
    const rawBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    let { url, base64 } = rawBody;

    // Imagen por URL o base64
    let imageData = {};
    if (url && typeof url === "string" && url.trim()) {
      imageData = { url: url.trim() };
    } else {
      let b64 = String(base64 || "").trim()
        .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "")
        .replace(/\s+/g, "");
      const mod = b64.length % 4;
      if (mod === 2) b64 += "==";
      else if (mod === 3) b64 += "=";
      if (!b64) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Provide url or base64" } });
      imageData = { base64: b64 };
    }

    const key = process.env.CLARIFAI_API_KEY;
    if (!key) return res.status(501).json({ error: { code: "NO_KEY", message: "Missing Clarifai key" } });

    // Payload
    const payload = {
      user_app_id: { user_id: "clarifai", app_id: "main" },
      inputs: [{ data: { image: imageData } }],
      model: { output_info: { output_config: { max_concepts: 64, min_value: 0.0 } } }
    };

    const endpoint = (id) => `https://api.clarifai.com/v2/models/${id}/outputs`;
    async function call(id) {
      const r = await fetch(endpoint(id), {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      return { ok: r.ok, j };
    }

    // Intento con food y fallback a general
    let resp = await call("food-item-recognition");
    if (!resp.ok) resp = await call("general-image-recognition");

    const { ok, j } = resp;
    if (!ok) {
      return res.status(502).json({ error: { code: "CLARIFAI_FAIL", message: JSON.stringify(j).slice(0, 800) } });
    }

    // ========= EXTRAER CONCEPTOS DE TODAS LAS FORMAS POSIBLES =========
    const out = j?.outputs?.[0] || {};
    const data = out?.data || {};

    // 1) planos
    const flat = Array.isArray(data.concepts) ? data.concepts : [];

    // 2) regions[*].data.concepts
    let fromRegions = [];
    if (Array.isArray(data.regions)) {
      for (const r of data.regions) {
        const cc = r?.data?.concepts;
        if (Array.isArray(cc)) fromRegions.push(...cc);
      }
    }

    // 3) frames[*].data.concepts
    let fromFrames = [];
    if (Array.isArray(data.frames)) {
      for (const f of data.frames) {
        const cc = f?.data?.concepts;
        if (Array.isArray(cc)) fromFrames.push(...cc);
      }
    }

    // Unir todo
    const allConcepts = [...flat, ...fromRegions, ...fromFrames]
      .map(c => ({
        name: String(c?.name || "").toLowerCase(),
        value: Number(c?.value || 0)
      }))
      .filter(c => c.name);

    // Agrupar por nombre (promedio y pico)
    const byName = new Map();
    for (const c of allConcepts) {
      const prev = byName.get(c.name);
      if (!prev) byName.set(c.name, { name: c.name, sum: c.value, n: 1, max: c.value });
      else { prev.sum += c.value; prev.n += 1; prev.max = Math.max(prev.max, c.value); }
    }

    let combined = [...byName.values()].map(x => ({
      name: x.name,
      confidence: Number((x.sum / x.n).toFixed(3)), // promedio
      peak: Number(x.max.toFixed(3))                // mejor score
    }));

    // Ordenar por pico y promedio
    combined.sort((a, b) => (b.peak - a.peak) || (b.confidence - a.confidence));

    // Diccionario simple ES->EN
    const es2en = {
      arroz:"rice", pollo:"chicken", res:"beef", carne:"beef", cerdo:"pork", pescado:"fish",
      huevo:"egg", huevos:"egg", papa:"potato", papas:"potato", queso:"cheese", pan:"bread",
      pasta:"pasta", ensalada:"salad", tomate:"tomato", lechuga:"lettuce", cebolla:"onion",
      maiz:"corn", arepa:"arepa", frijoles:"beans", caraotas:"beans", lentejas:"lentils",
      avena:"oats", yuca:"cassava", "plátano":"plantain", platano:"plantain",
      batata:"sweet potato", camote:"sweet potato", aguacate:"avocado"
    };
    const norm = s => es2en[s] || (s.endsWith("s") ? s.slice(0,-1) : s);

    const concepts = combined.slice(0, 12).map(c => ({
      name: norm(c.name),
      confidence: c.confidence,
      peak: c.peak
    }));

    // Si sigue vacío, entregar debug con contadores claros
    if (!concepts.length) {
      return res.status(200).json({
        concepts: [],
        debug: {
          hasOutputs: !!j?.outputs?.length,
          flatConceptsCount: flat.length,
          regionsCount: Array.isArray(data.regions) ? data.regions.length : 0,
          framesCount: Array.isArray(data.frames) ? data.frames.length : 0
        }
      });
    }

    return res.status(200).json({ concepts });
  } catch (e) {
    return res.status(502).json({ error: { code: "SERVER_ERROR", message: String(e).slice(0, 800) } });
  }
}
