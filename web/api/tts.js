// Vercel Serverless Function: 百度 TTS 合成代理（REST API，无需 WebSocket）

let cachedToken = null
let tokenExpireAt = 0

async function getBaiduToken() {
  const now = Date.now()
  if (cachedToken && now < tokenExpireAt - 60_000) return cachedToken

  const BAIDU_API_KEY = process.env.BAIDU_API_KEY
  const BAIDU_SECRET_KEY = process.env.BAIDU_SECRET_KEY

  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${BAIDU_API_KEY}&client_secret=${BAIDU_SECRET_KEY}`
  const r = await fetch(url)
  const data = await r.json()
  if (!data.access_token) throw new Error('获取百度 access_token 失败: ' + JSON.stringify(data))

  cachedToken = data.access_token
  tokenExpireAt = now + (data.expires_in ?? 2592000) * 1000
  return cachedToken
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const text = (req.body?.text ?? '').toString().trim()
  if (!text) return res.status(400).json({ error: 'text 不能为空' })

  const TTS_SPD = process.env.TTS_SPD || '15'
  const TTS_PER = process.env.TTS_PER || '4106'
  const TTS_AUE = process.env.TTS_AUE || '3'

  try {
    const token = await getBaiduToken()
    const params = new URLSearchParams({
      tex: text,
      tok: token,
      cuid: 'voice-assistant-demo',
      ctp: '1',
      lan: 'zh',
      spd: TTS_SPD,
      per: TTS_PER,
      aue: TTS_AUE,
    })

    const r = await fetch('https://tsn.baidu.com/text2audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    const contentType = r.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const err = await r.json()
      return res.status(502).json({ error: '百度 TTS 合成失败', detail: err })
    }

    // 成功：返回音频
    const audioBuffer = await r.arrayBuffer()
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', audioBuffer.byteLength)
    res.send(Buffer.from(audioBuffer))
  } catch (e) {
    console.error('tts error:', e)
    res.status(500).json({ error: 'TTS 合成异常', detail: String(e) })
  }
}