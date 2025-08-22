export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } });
    }

    // 1) Asegurar que el body sea objeto (Vercel a veces entrega string)
    const rawBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    let b64 = String(rawBody.base64 || "");

    // 2) Quitar prefijos y espacios/nuevas líneas
    b64 = b64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, ""); // data:image/...;base64,
    b64 = b64.replace(/\s+/g, ""); // quitar \n, \r, espacios

    // 3) Relleno de padding (=) si falta
    const mod = b64.length % 4;
    if (mod === 2) b64 += "==";
    else if (mod === 3) b64 += "=";

    if (!b64) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "base64 required" } });
    }

    const key = process.env.CLARIFAI_API_KEY;
    if (!key) {
      return res.status(501).json({ error: { code: "NO_KEY", message: "Missing Clarifai key" } });
    }

    // 4) Payload limpio
    const payload = {
      inputs: [{ data: { image: { base64: b64 } } }],
      model: { output_info: { output_config: { max_concepts: 32, min_value: 0.5 } } }
    };

    const r = await fetch("https://api.clarifai.com/v2/models/food-item-recognition/outputs", {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const j = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: { code: "CLARIFAI_FAIL", message: JSON.stringify(j).slice(0, 800) } });
    }

    const es2en = {
      arroz: "rice", pollo: "chicken", res: "beef", carne: "beef", cerdo: "pork", pescado: "fish",
      huevo: "egg", huevos: "egg", papa: "potato", papas: "potato", queso: "cheese", pan: "bread",
      pasta: "pasta", ensalada: "salad", tomate: "tomato", lechuga: "lettuce", cebolla: "onion",
      maiz: "corn", arepa: "arepa", frijoles: "beans", caraotas: "beans", lentejas: "lentils",
      avena: "oats", yuca: "cassava", "plátano": "plantain", platano: "plantain",
      batata: "sweet potato", camote: "sweet potato", aguacate: "avocado"
    };
    const norm = s => {
      const x = (s || "").toLowerCase().trim();
      return es2en[x] || (x.endsWith("s") ? x.slice(0, -1) : x);
    };

    const concepts = (j?.outputs?.[0]?.data?.concepts || [])
      .filter(c => c.value >= 0.85)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
      .map(c => ({ name: norm(c.name), confidence: Number(c.value.toFixed(3)) }));

    return res.status(200).json({ concepts });
  } catch (e) {
    return res.status(502).json({ error: { code: "SERVER_ERROR", message: String(e).slice(0, 800) } });
  }
}
