import WebSocket from 'ws'

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
    // 改用 WAV 格式（aue=6），所有手机浏览器都支持；MP3 部分机型 code 4 报错
    const aue = process.env.TTS_AUE || '6'
    const baiduUrl = `wss://aip.baidubce.com/ws/2.0/speech/publiccloudspeech/v1/tts?access_token=${token}&per=${per}`

    const baiduWs = new WebSocket(baiduUrl)
    const chunks = []

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        baiduWs.close()
        reject(new Error('百度 TTS 超时'))
      }, 15000)

      baiduWs.on('open', () => {
        baiduWs.send(JSON.stringify({
          type: 'system.start',
          payload: { spd: Number(spd), vol: 5, aue: Number(aue) },
        }))
        baiduWs.send(JSON.stringify({ type: 'text', payload: { text } }))
        baiduWs.send(JSON.stringify({ type: 'system.finish' }))
      })

      baiduWs.on('message', (data, isBinary) => {
        if (isBinary) {
          chunks.push(data)
        } else {
          try {
            const msg = JSON.parse(data.toString())
            if (msg.type === 'system.error') {
              clearTimeout(timeout)
              reject(new Error(msg.message || '百度 TTS 错误'))
            }
          } catch {}
        }
      })

      baiduWs.on('close', () => {
        clearTimeout(timeout)
        resolve()
      })

      baiduWs.on('error', (e) => {
        clearTimeout(timeout)
        reject(new Error(String(e)))
      })
    })

    if (chunks.length === 0) {
      return res.status(502).json({ error: '百度 TTS 未返回音频数据' })
    }

    const audioBuf = Buffer.concat(chunks)
    res.setHeader('Content-Type', 'audio/wav')
    res.setHeader('Content-Length', audioBuf.length)
    res.setHeader('Cache-Control', 'no-cache')
    res.send(audioBuf)
  } catch (e) {
    console.error('tts error:', e)
    res.status(500).json({ error: 'TTS 合成失败', detail: String(e) })
  }
}
