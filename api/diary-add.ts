// api/diary-add.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return res.status(500).json({ ok: false, error: "env_missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE" });
    }
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return res.status(400).json({ ok: false, error: "expected application/json body" });
    }

    const body = (req.body || {}) as any;

    // user_id: del payload o de envs para modo demo
    const user_id =
      body.user_id ||
      process.env.EXPO_PUBLIC_TEST_USER_ID ||
      process.env.TEST_USER_ID ||
      "";

    if (!user_id) {
      return res.status(400).json({ ok: false, error: "missing user_id (configure EXPO_PUBLIC_TEST_USER_ID)" });
    }

    const {
      source = "image",
      food_name,
      serving_qty = 1,
      serving_unit = "g",
      serving_grams = 100,
      totals = {},
    } = body;

    if (!food_name) {
      return res.status(400).json({ ok: false, error: "missing food_name" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // crea entrada de diario para hoy
    const today = new Date().toISOString().slice(0, 10);
    const { data: entry, error: e1 } = await supabase
      .from("diary_entries")
      .insert({ user_id, entry_date: today })
      .select()
      .single();

    if (e1) return res.status(500).json({ ok: false, step: "insert_entry", error: e1.message });

    // inserta el item
    const item = {
      entry_id: entry.id,
      source,
      food_name,
      servings: serving_qty,
      portion_g: serving_grams,
      calories_kcal: totals.calories ?? null,
      protein_g: totals.protein_g ?? null,
      carbs_g: totals.carbs_g ?? null,
      fat_g: totals.fat_g ?? null,
      sugars_g: totals.sugars_g ?? null,
      fiber_g: totals.fiber_g ?? null,
      sodium_mg: totals.sodium_mg ?? null,
    };

    const { data: itemIns, error: e2 } = await supabase
      .from("diary_items")
      .insert(item)
      .select()
      .single();

    if (e2) return res.status(500).json({ ok: false, step: "insert_item", error: e2.message });

    return res.status(200).json({ ok: true, entry, item: itemIns });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
}
