export default async function handler(req, res) {
  res.json({ ok: true, model: process.env.ARK_MODEL || 'deepseek-v4-pro' })
}