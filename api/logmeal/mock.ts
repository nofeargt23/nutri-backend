// /api/logmeal/mock.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simular un delay como si llamara a la API real
  await new Promise((r) => setTimeout(r, 1000));

  return res.status(200).json({
    ok: true,
    all: [
      { name: "arepa", confidence: 0.92 },
      { name: "queso", confidence: 0.85 },
      { name: "jamón", confidence: 0.80 },
      { name: "carne", confidence: 0.78 }
    ],
    raw: {
      recognition_results: [
        { name: "arepa", probability: 0.92 },
        { name: "queso", probability: 0.85 },
        { name: "jamón", probability: 0.80 },
        { name: "carne", probability: 0.78 }
      ]
    }
  });
}
