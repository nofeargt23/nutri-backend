export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const list = Array.isArray(body.ingredients) ? body.ingredients : [];
    if (!list.length) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Send { ingredients: [ ... ] }" } });
    }

    const APP_ID = process.env.NUTRITIONIX_APP_ID;
    const API_KEY = process.env.NUTRITIONIX_API_KEY;
    if (!APP_ID || !API_KEY) {
      return res.status(501).json({ error: { code: "NO_KEY", message: "Missing Nutritionix keys" } });
    }

    const query = list.map(x => String(x).trim()).filter(Boolean).join(", ");

    const r = await fetch("https://trackapi.nutritionix.com/v2/natural/nutrients", {
      method: "POST",
      headers: {
        "x-app-id": APP_ID,
        "x-app-key": API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });

    const j = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: { code: "NIX_FAIL", message: JSON.stringify(j).slice(0, 800) } });
    }

    const items = (j.foods || []).map((f) => ({
      name: f.food_name,
      qty: f.serving_qty,
      unit: f.serving_unit,
      grams: f.serving_weight_grams,
      calories: f.nf_calories,
      protein: f.nf_protein,
      carbs: f.nf_total_carbohydrate,
      fat: f.nf_total_fat
    }));

    const totals = items.reduce((acc, it) => {
      acc.calories += it.calories || 0;
      acc.protein  += it.protein  || 0;
      acc.carbs    += it.carbs    || 0;
      acc.fat      += it.fat      || 0;
      return acc;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

    return res.status(200).json({ query, items, totals });
  } catch (e) {
    return res.status(502).json({ error: { code: "SERVER_ERROR", message: String(e).slice(0, 800) } });
  }
}
