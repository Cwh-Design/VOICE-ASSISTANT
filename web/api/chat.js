export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const question = (req.body?.question ?? '').toString().trim()
  if (!question) return res.status(400).json({ error: 'question 不能为空' })

  try {
    const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.ARK_MODEL || 'deepseek-v4-pro',
        messages: [
          { role: 'system', content: '你是一个简洁友好的中文语音助手，回答口语化、不要太长，一般两三句以内。' },
          { role: 'user', content: question },
        ],
      }),
    })

    const data = await r.json()
    if (!r.ok) return res.status(502).json({ error: '模型调用失败', detail: data })

    const answer = data?.choices?.[0]?.message?.content ?? ''
    res.json({ answer })
  } catch (e) {
    console.error('chat error:', e)
    res.status(500).json({ error: '模型调用异常', detail: String(e) })
  }
}
