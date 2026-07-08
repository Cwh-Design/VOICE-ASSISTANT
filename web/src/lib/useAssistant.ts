import { useRef, useState } from 'react'
import { synthesize } from './ttsClient'

export type AssistantState = 'idle' | 'thinking' | 'answering'

/**
 * 状态机：idle -> thinking -> answering -> idle
 * - thinking：调火山方舟拿回答
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

  const ask = async (question: string) => {
    if (state !== 'idle') return
    setError(null)
    setAnswer('')
    setRevealed(0)
    setState('thinking')

    try {
      // 1. 火山方舟对话
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

      const audio = new Audio(tts.audioUrl)
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
        setError('音频播放失败')
        cleanup()
        setState('idle')
      }

      await audio.play().catch((e) => {
        setError('播放被拦截：' + String(e))
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
