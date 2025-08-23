export default function handler(req, res) {
  const id  = process.env.NUTRITIONIX_APP_ID || "";
  const key = process.env.NUTRITIONIX_API_KEY || "";
  const bKey = process.env.BACKEND_API_KEY || "";
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map(s=>s.trim()).filter(Boolean);

  res.status(200).json({
    hasId: Boolean(id), idLen: id.length,
    hasKey: Boolean(key), keyLen: key.length,
    hasBackendKey: Boolean(bKey), backendKeyLen: bKey.length,
    allowedOriginsCount: allowed.length,
    sampleOrigin: allowed[0] || null
  });
}
