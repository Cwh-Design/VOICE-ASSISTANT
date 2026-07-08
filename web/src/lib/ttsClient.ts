// 百度 TTS 客户端：经后端 REST API 合成，返回 blob + 时长

export interface TtsResult {
  audioUrl: string
  duration: number
}

/** 把文本合成成语音，返回可播放的音频 URL 和时长（秒） */
export async function synthesize(text: string): Promise<TtsResult> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'TTS 请求失败' }))
    throw new Error(err.error || 'TTS 合成错误')
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)

  // 估算时长：WAV 格式 16kHz/16bit 单声道 ≈ 32KB/s
  const estimatedBySize = blob.size / 32000
  const estimatedByText = text.length / 12
  const duration = estimatedBySize > 0 ? estimatedBySize : estimatedByText

  return { audioUrl: url, duration }
}