// 端到端测试：调对话拿回答 -> 喂给百度流式 TTS -> 看是否产出音频
import WebSocket from 'ws'

const per = process.argv[2] || '4106'
const question = '讲个简短的笑话'

// 1. DeepSeek 对话
const r = await fetch('http://localhost:8787/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question }),
})
const data = await r.json()
const text = data?.answer
if (!text) {
  console.log('[fail] 对话无回答:', JSON.stringify(data))
  process.exit(1)
}
console.log('[answer]', text)

// 2. 百度流式 TTS
const ws = new WebSocket(`ws://localhost:8787/api/tts?per=${per}`)
let audioBytes = 0

ws.on('message', (d, isBinary) => {
  if (isBinary) { audioBytes += d.length; return }
  let msg
  try { msg = JSON.parse(d.toString()) } catch { return }
  if (msg.type === 'system.started') {
    if (msg.code !== 0) { console.log('[fail] 通道错误:', msg.message); process.exit(1) }
    ws.send(JSON.stringify({ type: 'text', payload: { text } }))
    ws.send(JSON.stringify({ type: 'system.finish' }))
  } else if (msg.type === 'system.finished') {
    console.log('[ok] 端到端通过，音频字节数:', audioBytes)
    ws.close()
    process.exit(0)
  } else if (msg.type === 'system.error') {
    console.log('[fail] TTS 错误:', msg.message)
    process.exit(1)
  }
})
ws.on('error', (e) => { console.log('[ws error]', e.message); process.exit(1) })
setTimeout(() => { console.log('[timeout] 30s 无结果'); process.exit(1) }, 30000)
