export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const url = (body.url || "").trim();
    const base64 = (body.base64 || "").trim();
    if (!url && !base64) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Send { url } or { base64 }" } });
    }

    // ===== Helpers =====
    const es2en = {
      arroz:"rice", pollo:"chicken", res:"beef", carne:"beef", cerdo:"pork", pescado:"fish",
      huevo:"egg", huevos:"egg", papa:"potato", papas:"potato", queso:"cheese", pan:"bread",
      pasta:"pasta", ensalada:"salad", tomate:"tomato", lechuga:"lettuce", cebolla:"onion",
      maiz:"corn", arepa:"arepa", frijoles:"beans", caraotas:"beans", lentejas:"lentils",
      avena:"oats", yuca:"cassava", "plátano":"plantain", platano:"plantain",
      batata:"sweet potato", camote:"sweet potato", aguacate:"avocado"
    };
    const norm = s => {
      const x = String(s || "").toLowerCase().trim();
      return es2en[x] || (x.endsWith("s") ? x.slice(0, -1) : x);
    };
    const uniqTop = (arr, topN=12) => {
      const seen = new Map();
      for (const c of arr) {
        if (!c?.name) continue;
        const name = norm(c.name);
        const conf = Number((c.confidence ?? c.value ?? 0).toFixed(3));
        const prev = seen.get(name);
        if (!prev || conf > prev.confidence) seen.set(name, { name, confidence: conf });
      }
      return [...seen.values()].sort((a,b)=>b.confidence-a.confidence).slice(0, topN);
    };

    // ===== Try Spoonacular (URL) =====
    const KEY = process.env.SPOONACULAR_API_KEY || "";
    let concepts = [];
    if (KEY && url) {
      const mkUrl = (path, params={}) => {
        const u = new URL(`https://api.spoonacular.com${path}`);
        u.searchParams.set("apiKey", KEY);
        for (const [k,v] of Object.entries(params)) u.searchParams.set(k, v);
        return u.toString();
      };
      async function call(path, params) {
        const r = await fetch(mkUrl(path, params), { method: "GET" });
        const j = await r.json();
        return { ok: r.ok && j?.status !== "failure", j };
      }

      // analyze → classify fallback
      let resp = await call("/food/images/analyze", { imageUrl: url });
      if (!resp.ok) resp = await call("/food/images/classify", { imageUrl: url });
      if (resp.ok) {
        const j = resp.j;
        let spoonConcepts = [];
        if (j?.category?.name) {
          spoonConcepts.push({ name: j.category.name, confidence: j.category.probability || 0 });
        }
        if (Array.isArray(j?.annotations)) {
          for (const a of j.annotations) {
            if (a?.label) spoonConcepts.push({ name: a.label, confidence: a.confidence || 0 });
          }
        }
        if (Array.isArray(j) && j[0]?.category) {
          const c = j[0].category;
          spoonConcepts.push({ name: c.name || c.label || "", confidence: c.probability || c.prob || 0 });
        }
        concepts = uniqTop(spoonConcepts);
      }
    }

    // ===== Clarifai fallback si Spoonacular no dio nada =====
    if (concepts.length === 0) {
      const key = process.env.CLARIFAI_API_KEY || "";
      if (key) {
        let imageData = {};
        if (url) {
          imageData = { url };
        } else {
          let b64 = base64
            .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "")
            .replace(/\s+/g, "");
          const mod = b64.length % 4;
          if (mod === 2) b64 += "==";
          else if (mod === 3) b64 += "=";
          imageData = { base64: b64 };
        }

        const payload = {
          user_app_id: { user_id: "clarifai", app_id: "main" },
          inputs: [{ data: { image: imageData } }],
          model: { output_info: { output_config: { max_concepts: 64, min_value: 0.0 } } }
        };

        const endpoint = id => `https://api.clarifai.com/v2/models/${id}/outputs`;
        async function callClarifai(id) {
          const r = await fetch(endpoint(id), {
            method: "POST",
            headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const j = await r.json();
          return { ok: r.ok, j };
        }

        // modelo general (más estable)
        let resp = await callClarifai("general-image-recognition");
        if (resp.ok) {
          const j = resp.j;
          const out = j?.outputs?.[0] || {};
          const data = out?.data || {};
          const flat = Array.isArray(data.concepts) ? data.concepts : [];
          let fromRegions = [];
          if (Array.isArray(data.regions)) {
            for (const r of data.regions) {
              const cc = r?.data?.concepts;
              if (Array.isArray(cc)) fromRegions.push(...cc);
            }
          }
          let fromFrames = [];
          if (Array.isArray(data.frames)) {
            for (const f of data.frames) {
              const cc = f?.data?.concepts;
              if (Array.isArray(cc)) fromFrames.push(...cc);
            }
          }
          concepts = uniqTop([...flat, ...fromRegions, ...fromFrames]);
        }
      }
    }

    // ===== Filtro de vocabulario (ingredientes válidos) =====
    const vocab = new Set([
      "chicken","rice","beef","pork","fish","egg","cheese","bread","pasta","salad",
      "tomato","lettuce","onion","corn","beans","lentils","potato","plantain","avocado",
      "arepa","cassava","oats","sweet potato","yuca","pepper","carrot","broccoli"
    ]);

    let filtered = concepts.filter(c => vocab.has(c.name));

    // si no hay match, devolvemos vacío + nota (en vez de basura tipo "ice_cream")
    if (filtered.length === 0) {
      return res.status(200).json({
        concepts: [],
        note: "Ningún ingrediente válido detectado. Intenta otra foto o confirma manualmente."
      });
    }

    concepts = filtered;

    return res.status(200).json({ concepts });
  } catch (e) {
    return res.status(502).json({ error: { code: "SERVER_ERROR", message: String(e).slice(0, 800) } });
  }
}
