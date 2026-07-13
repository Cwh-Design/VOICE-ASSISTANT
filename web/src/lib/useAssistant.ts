import { useCallback, useRef, useState } from 'react'
import { synthesize } from './ttsClient'

export type AssistantState = 'idle' | 'thinking' | 'answering'

// MediaError code 对照表
const MEDIA_ERR: Record<number, string> = {
  1: '用户中止',
  2: '网络错误',
  3: '解码错误',
  4: '格式不支持',
}

/**
 * 状态机：idle -> thinking -> answering -> idle
 * - thinking：调 DeepSeek 拿回答
 * - answering：合成 TTS 并播放，打字机按音频时长整体同步出字
 */
export function useAssistant() {
  const [state, setState] = useState<AssistantState>('idle')
  const [answer, setAnswer] = useState('')
  const [revealed, setRevealed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number>(0)
  const abortRef = useRef<AbortController | null>(null)
  // 记录用户是否已经交互过（用于解锁音频播放）
  const unlockedRef = useRef(false)

  const cleanup = () => {
    cancelAnimationFrame(rafRef.current)
    abortRef.current?.abort()
    abortRef.current = null
    const a = audioRef.current
    if (a) {
      a.pause()
      if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src)
    }
    audioRef.current = null
  }

  const stop = () => {
    cleanup()
    setState('idle')
    setAnswer('')
    setRevealed(0)
  }

  // 解锁音频：iOS 必须在用户手势中创建一个真实 <audio> 元素并调用 play()，
  // 才能解除后续所有 audio 元素的自动播放限制。Web Audio API 解锁对 HTML5 Audio 无效。
  const unlock = useCallback(() => {
    if (unlockedRef.current) return
    // 1x1 采样点的静音 WAV（base64 编码），44 字节
    const SILENT_WAV =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
    const a = new Audio(SILENT_WAV)
    a.setAttribute('playsinline', 'true')
    a.setAttribute('webkit-playsinline', 'true')
    a.volume = 0
    const p = a.play()
    if (p && typeof p.then === 'function') {
      p.then(() => {
        a.pause()
        unlockedRef.current = true
      }).catch(() => {
        // 播放失败也标记为已尝试过，避免重复触发
        unlockedRef.current = true
      })
    }
  }, [])

  const ask = async (question: string) => {
    if (state !== 'idle') return
    unlock() // 在用户点击的同步调用链里解锁音频
    setError(null)
    setAnswer('')
    setRevealed(0)
    setState('thinking')

    try {
      // 1. DeepSeek 对话
      abortRef.current = new AbortController()
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: abortRef.current.signal,
      })
      const data = await res.json()
      const text: string = data?.answer ?? ''
      if (!text) {
        if (data?.error) setError(typeof data.error === 'string' ? data.error : '模型调用失败')
        setState('idle')
        return
      }
      setAnswer(text)

      // 2. 进 answering，合成语音
      setState('answering')
      const tts = await synthesize(text)
      const chars = Array.from(text)
      const total = chars.length
      // 兜底时长：取不到就用估算（spd=15 约 12 字/秒）
      const fallbackDur = tts.duration > 0 ? tts.duration : total / 12

      const audio = new Audio()
      audio.setAttribute('playsinline', 'true')
      audio.setAttribute('webkit-playsinline', 'true')
      audio.preload = 'auto'
      audio.src = tts.audioUrl
      audioRef.current = audio

      const lastRevealed = { v: 0 }
      const tick = () => {
        const a = audioRef.current
        if (!a) return
        const dur = a.duration && isFinite(a.duration) ? a.duration : fallbackDur
        const ratio = dur > 0 ? Math.min(1, a.currentTime / dur) : 0
        const r = Math.min(total, Math.floor(ratio * total))
        if (r !== lastRevealed.v) {
          lastRevealed.v = r
          setRevealed(r)
        }
        if (!a.ended) rafRef.current = requestAnimationFrame(tick)
      }

      audio.onplay = () => { requestAnimationFrame(tick) }
      audio.onended = () => {
        setRevealed(total)
        setTimeout(() => {
          cleanup()
          setState('idle')
          setAnswer('')
          setRevealed(0)
        }, 5000)
      }
      audio.onerror = () => {
        // 输出 MediaError 详细信息（code 1=中止 2=网络 3=解码 4=不支持）
        const err = audio.error
        const detail = err ? ` (code ${err.code}: ${err.message || MEDIA_ERR[err.code] || '未知'})` : ''
        console.error('audio error code:', err?.code, 'src:', tts.audioUrl.slice(0, 60))
        setError('音频播放失败' + detail)
        cleanup()
        setState('idle')
      }

      await audio.play().catch((e) => {
        setError('播放被拦截：' + (e?.name || String(e)))
        cleanup()
        setState('idle')
      })
    } catch (e) {
      console.error(e)
      setError(typeof e === 'string' ? e : (e as Error)?.message || '出错了')
      cleanup()
      setState('idle')
    }
  }

  return { state, answer, revealed, error, ask, stop }
}
