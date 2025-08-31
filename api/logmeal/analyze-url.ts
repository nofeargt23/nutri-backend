import type { VercelRequest, VercelResponse } from "vercel";
import axios from "axios";

const COMPANY = process.env.LOGMEAL_COMPANY_TOKEN!;
const USER = process.env.LOGMEAL_USER_TOKEN!;
const BASE = process.env.LOGMEAL_BASE_URL || "https://api.logmeal.com";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });

    const r = await axios.post(
      `${BASE}/image/recognition/complete`,
      { image: url },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${USER}`,
          "x-app-token": COMPANY,
        },
        timeout: 20000,
      }
    );

    res.status(200).json(r.data);
  } catch (err: any) {
    const status = err?.response?.status || 500;
    res.status(status).json({
      error: "logmeal-url-failed",
      detail: err?.response?.data || err?.message || String(err),
    });
  }
}
