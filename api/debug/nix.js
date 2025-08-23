export default function handler(req, res) {
  const id  = process.env.NUTRITIONIX_APP_ID || "";
  const key = process.env.NUTRITIONIX_API_KEY || "";
  res.status(200).json({
    hasId: Boolean(id),
    idLen: id.length,
    hasKey: Boolean(key),
    keyLen: key.length
  });
}
