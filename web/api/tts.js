// 百度 access_token 缓存（serverless 实例复用）
let baiduToken = null
let baiduTokenExpire = 0

async function getBaiduToken() {
  const now = Date.now()
  if (baiduToken && now < baiduTokenExpire - 60_000) return baiduToken

  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${process.env.BAIDU_API_KEY}&client_secret=${process.env.BAIDU_SECRET_KEY}`
  const r = await fetch(url)
  const data = await r.json()
  if (!data.access_token) throw new Error('获取百度 access_token 失败: ' + JSON.stringify(data))

  baiduToken = data.access_token
  baiduTokenExpire = now + (data.expires_in ?? 2592000) * 1000
  return baiduToken
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const text = (req.body?.text ?? '').toString().trim()
  if (!text) return res.status(400).json({ error: 'text 不能为空' })

  try {
    const token = await getBaiduToken()
    const spd = process.env.TTS_SPD || '15'
    const per = process.env.TTS_PER || '4117'
    // 改用百度 HTTP TTS API（tsn.baidu.com/text2audio），直接返回音频二进制
    // aue=3: mp3, aue=4: pcm-16k, aue=5: pcm-8k, aue=6: wav
    const aue = process.env.TTS_AUE || '3'
    const params = new URLSearchParams({
      tex: text,
      tok: token,
      cuid: 'voice-assistant',
      ctp: '1',
      lan: 'zh',
      spd,
      pit: '5',
      vol: '5',
      per,
      aue,
    })

    const r = await fetch(`https://tsn.baidu.com/text2audio?${params}`)

    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      return res.status(502).json({ error: '百度 TTS 调用失败', detail: errText.slice(0, 200) })
    }

    // 百度失败时会返回 JSON 格式错误信息，要先判断 Content-Type
    const contentType = r.headers.get('content-type') || ''
    if (!contentType.startsWith('audio/')) {
      const errBody = await r.text()
      return res.status(502).json({ error: '百度 TTS 返回非音频数据', detail: errBody.slice(0, 200) })
    }

    const audioBuf = Buffer.from(await r.arrayBuffer())
    if (audioBuf.length < 100) {
      return res.status(502).json({ error: '百度 TTS 返回空音频' })
    }

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', audioBuf.length)
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Accept-Ranges', 'bytes')
    res.send(audioBuf)
  } catch (e) {
    console.error('tts error:', e)
    res.status(500).json({ error: 'TTS 合成失败', detail: String(e) })
  }
}
