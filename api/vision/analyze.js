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

    // Extraer SIEMPRE top conceptos (sin filtro)
    const rawConcepts = j?.outputs?.[0]?.data?.concepts || [];
    const top = rawConcepts
      .slice()                           // copia
      .sort((a,b) => (b.value||0) - (a.value||0))
      .slice(0, 12)
      .map(c => ({ name: String(c.name||"").toLowerCase(), confidence: Number((c.value||0).toFixed(3)) }));

    // Si vino vacío, devolvemos también debug con lo que llegó
    if (!top.length) {
      return res.status(200).json({
        concepts: [],
        debug: {
          status: j?.status || null,
          hasOutputs: !!j?.outputs?.length,
          rawFirstOutputKeys: j?.outputs?.[0] ? Object.keys(j.outputs[0]) : null,
          rawDataKeys: j?.outputs?.[0]?.data ? Object.keys(j.outputs[0].data) : null
        }
      });
    }

    return res.status(200).json({ concepts: top });
  } catch (e) {
    return res.status(502).json({ error: { code: "SERVER_ERROR", message: String(e).slice(0, 800) } });
  }
}
