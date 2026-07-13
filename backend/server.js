import 'dotenv/config'
import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'

const {
  BAIDU_API_KEY,
  BAIDU_SECRET_KEY,
  DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL = 'deepseek-chat',
  TTS_SPD = '15',
  TTS_PER = '4117',
  TTS_AUE = '3',
  PORT = '8787',
} = process.env

const app = express()
app.use(express.json({ limit: '2mb' }))

// 开发期允许跨域（前端跑在 5173）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/api/health', (_req, res) => res.json({ ok: true, model: DEEPSEEK_MODEL, spd: TTS_SPD, per: TTS_PER }))

// ============ DeepSeek 对话（非流式，v1 先拿整段回答）============
app.post('/api/chat', async (req, res) => {
  const question = (req.body?.question ?? '').toString().trim()
  if (!question) return res.status(400).json({ error: 'question 不能为空' })
  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
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
})

// ============ 百度 access_token（带缓存）============
let baiduToken = null
let baiduTokenExpire = 0
async function getBaiduToken() {
  const now = Date.now()
  if (baiduToken && now < baiduTokenExpire - 60_000) return baiduToken
  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${BAIDU_API_KEY}&client_secret=${BAIDU_SECRET_KEY}`
  const r = await fetch(url)
  const data = await r.json()
  if (!data.access_token) throw new Error('获取百度 access_token 失败: ' + JSON.stringify(data))
  baiduToken = data.access_token
  baiduTokenExpire = now + (data.expires_in ?? 2592000) * 1000
  return baiduToken
}

// ============ 百度 TTS HTTP POST（手机兼容）============
app.post('/api/tts', async (req, res) => {
  const text = (req.body?.text ?? '').toString().trim()
  if (!text) return res.status(400).json({ error: 'text 不能为空' })

  try {
    const token = await getBaiduToken()
    const per = req.query?.per || TTS_PER
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
          payload: { spd: Number(TTS_SPD), vol: 5, aue: Number(TTS_AUE) },
        }))
        // 发送文本
        baiduWs.send(JSON.stringify({ type: 'text', payload: { text } }))
        // 发送结束标记
        baiduWs.send(JSON.stringify({ type: 'system.finish' }))
      })

      baiduWs.on('message', (data, isBinary) => {
        if (isBinary) {
          chunks.push(data)
        } else {
          // JSON 帧，检查是否有错误
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
    res.set({
      'Content-Type': 'audio/mp3',
      'Content-Length': audioBuf.length,
      'Cache-Control': 'no-cache',
    })
    res.send(audioBuf)
  } catch (e) {
    console.error('tts error:', e)
    res.status(500).json({ error: 'TTS 合成失败', detail: String(e) })
  }
})

// ============ 百度流式 TTS WebSocket 透传 ============
const server = app.listen(Number(PORT), () => {
  console.log(`backend on http://localhost:${PORT}`)
})

const wss = new WebSocketServer({ server, path: '/api/tts' })

wss.on('connection', async (clientWs, req) => {
  let baiduWs = null
  const sendToClient = (data, isBinary = false) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: isBinary })
  }
  try {
    const token = await getBaiduToken()
    // 支持用 ?per=xxx 临时覆盖发音人（方便调试），默认用环境变量
    const u = new URL(req.url, 'http://localhost')
    const per = u.searchParams.get('per') || TTS_PER
    const baiduUrl = `wss://aip.baidubce.com/ws/2.0/speech/publiccloudspeech/v1/tts?access_token=${token}&per=${per}`
    baiduWs = new WebSocket(baiduUrl)

    baiduWs.on('open', () => {
      // 后端固定下发开始帧：spd=15(最快)、aue=3(mp3)
      baiduWs.send(JSON.stringify({
        type: 'system.start',
        payload: { spd: Number(TTS_SPD), vol: 5, aue: Number(TTS_AUE) },
      }))
      sendToClient(JSON.stringify({ type: 'system.started', code: 0, message: 'success' }))
    })

    baiduWs.on('message', (data, isBinary) => {
      // 百度的音频二进制 & JSON 文本帧原样转发给前端
      sendToClient(data, isBinary)
    })

    baiduWs.on('close', () => sendToClient(JSON.stringify({ type: 'system.finished', code: 0 })))
    baiduWs.on('error', (e) => sendToClient(JSON.stringify({ type: 'system.error', message: String(e) })))
  } catch (e) {
    sendToClient(JSON.stringify({ type: 'system.error', message: String(e) }))
  }

  // 前端 -> 百度：只透传 text / system.finish
  clientWs.on('message', (data) => {
    let msg
    try { msg = JSON.parse(data.toString()) } catch { return }
    if ((msg.type === 'text' || msg.type === 'system.finish') && baiduWs?.readyState === WebSocket.OPEN) {
      baiduWs.send(data.toString())
    }
  })

  clientWs.on('close', () => { try { baiduWs?.close() } catch {} })
})
