// api/logmeal.ts
import axios from "axios";
import FormData from "form-data";

const COMPANY = process.env.LOGMEAL_COMPANY_TOKEN!;
const USER    = process.env.LOGMEAL_USER_TOKEN!;
const BASE    = process.env.LOGMEAL_BASE_URL || "https://api.logmeal.com";

export default async function handler(req: any, res: any) {
  try {
    if (req.method === "GET") {
      if (!COMPANY || !USER) {
        res.status(500).json({ ok: false, error: "Missing LOGMEAL tokens" });
        return;
      }
      res.status(200).json({ ok: true, msg: "logmeal api alive" });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { mode, url, base64 } = req.body || {};

    if (mode === "url") {
      if (!url) return res.status(400).json({ error: "Missing url" });

      const r = await axios.post(
        `${BASE}/image/recognition/complete`,
        { image: url },
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${USER}`,
            "x-app-token": COMPANY
          },
          timeout: 20000
        }
      );
      res.status(200).json(r.data);
      return;
    }

    if (mode === "base64") {
      if (!base64) return res.status(400).json({ error: "Missing base64" });

      const cleaned = String(base64).replace(/^data:\w+\/\w+;base64,/, "");
      const buf = Buffer.from(cleaned, "base64");

      const form = new FormData();
      form.append("image", buf, { filename: "photo.jpg", contentType: "image/jpeg" });

      const r = await axios.post(
        `${BASE}/image/recognition/complete`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            "Authorization": `Bearer ${USER}`,
            "x-app-token": COMPANY
          },
          timeout: 20000,
          maxBodyLength: 10 * 1024 * 1024
        }
      );
      res.status(200).json(r.data);
      return;
    }

    res.status(400).json({ error: "Invalid mode. Use 'url' or 'base64'." });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    res.status(status).json({
      error: "logmeal-failed",
      detail: err?.response?.data || err?.message || String(err)
    });
  }
}
