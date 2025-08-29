import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await new Promise(r => setTimeout(r, 800)); // simulación de latencia

  return res.status(200).json({
    ok: true,
    all: [
      { name: "arepa", confidence: 0.92 },
      { name: "queso", confidence: 0.85 },
      { name: "jamón", confidence: 0.80 },
      { name: "carne", confidence: 0.78 },
    ],
    raw: { mock: true }
  });
}

