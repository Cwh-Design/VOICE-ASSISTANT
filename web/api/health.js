export default async function handler(req, res) {
  res.json({ ok: true, model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' })
}