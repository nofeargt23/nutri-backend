export default function handler(req, res) {
  const spoon = process.env.SPOONACULAR_API_KEY || "";
  res.status(200).json({
    hasSpoon: Boolean(spoon),
    spoonLen: spoon.length
  });
}
