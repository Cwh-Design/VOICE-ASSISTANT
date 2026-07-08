import { useEffect, useRef, useState } from 'react'
import Strands, { type StrandsProps } from './Strands'

export type AssistantState = 'idle' | 'thinking' | 'answering'

// 各状态对应的 Strands 参数
const BASE: StrandsProps = {
  colors: ['#F97316', '#7C3AED', '#06B6D4'],
  count: 3,
  speed: 1,
  amplitude: 1.2,
  waviness: 1.4,
  thickness: 1.4,
  glow: 2.75,
  taper: 1.2,
  spread: 1,
  intensity: 0.4,
  saturation: 2,
  opacity: 1,
  scale: 1.6,
  glass: false,
  refraction: 1,
  dispersion: 1,
  glassSize: 1,
  hueShift: 0,
}

const PARAMS: Record<AssistantState, StrandsProps> = {
  idle: { ...BASE, saturation: 1 },
  thinking: { ...BASE, glass: true, glassSize: 0.7 },
  answering: { ...BASE, saturation: 3, speed: 3 },
}

/**
 * StrandsContainer：用透明度交叉溶解（crossfade）在状态间过渡。
 * 新图层先渐入（旧图层保持可见），等新图层到位后旧图层再渐出，避免中间"变暗"。
 */
export default function StrandsContainer({ state }: { state: AssistantState }) {
  const [layers, setLayers] = useState<{ variant: AssistantState; opacity: number; key: number }[]>([
    { variant: state, opacity: 1, key: 0 },
  ])
  const prev = useRef<AssistantState>(state)
  const keyRef = useRef(1)

  useEffect(() => {
    if (state === prev.current) return

    const newKey = keyRef.current++
    prev.current = state

    // 1) 添加新图层（opacity:0），旧图层保持不变
    setLayers((ls) => [...ls, { variant: state, opacity: 0, key: newKey }])

    // 2) 等 WebGL 初始化后，新图层渐入
    const fadeInId = setTimeout(() => {
      setLayers((ls) => ls.map((l) => (l.key === newKey ? { ...l, opacity: 1 } : l)))
    }, 120)

    // 3) 新图层到位后，旧图层渐出
    const fadeOutId = setTimeout(() => {
      setLayers((ls) => ls.map((l) => (l.key === newKey ? l : { ...l, opacity: 0 })))
    }, 500)

    // 4) 清理已完全透明的旧图层
    const cleanupId = setTimeout(() => {
      setLayers((ls) => ls.filter((l) => l.opacity > 0))
    }, 1200)

    return () => {
      clearTimeout(fadeInId)
      clearTimeout(fadeOutId)
      clearTimeout(cleanupId)
    }
  }, [state])

  return (
    <div className="strands-stage">
      {layers.map((l) => (
        <div
          key={l.key}
          className="strands-layer"
          style={{ opacity: l.opacity, transition: 'opacity 0.15s ease-out' }}
        >
          <Strands {...PARAMS[l.variant]} />
        </div>
      ))}
    </div>
  )
}