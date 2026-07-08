import { useEffect, useState } from 'react'
import Aurora from './components/Aurora'
import StrandsContainer from './components/StrandsContainer'
import SplitText from './components/SplitText'
import BorderGlow from './components/BorderGlow'
import ShinyText from './components/ShinyText'
import { useAssistant } from './lib/useAssistant'
import './index.css'

const QUESTIONS = [
  '今天天气怎么样？',
  '帮我写一首关于秋天的诗',
  '给我讲个冷笑话',
  '如何高效学习一门新语言？',
  '推荐一部值得看的老电影',
]

export default function App() {
  const { state, answer, revealed, error, ask, stop } = useAssistant()
  const [input, setInput] = useState('')
  const [qIndex, setQIndex] = useState(0)

  // 空闲时轮询问题
  useEffect(() => {
    if (state !== 'idle') return
    const id = setInterval(() => setQIndex((i) => (i + 1) % QUESTIONS.length), 4200)
    return () => clearInterval(id)
  }, [state])

  const submit = () => {
    const q = input.trim()
    if (!q || state !== 'idle') return
    setInput('')
    ask(q)
  }

  const shown = Array.from(answer).slice(0, revealed).join('')
  const isActive = state === 'thinking' || state === 'answering'

  return (
    <>
      <Aurora
        colorStops={["#3B82F6", "#7C3AED", "#5227FF"]}
        blend={0.5}
        amplitude={1.0}
        speed={1}
      />
      <main className="app">
        <div className="stage">
          {/* 声波纹主视觉：不限高度 */}
          <div className="visual">
            <StrandsContainer state={state} />
          </div>

          {/* 文字区 */}
          <div className="text-area">
            {state === 'idle' && (
              <SplitText
                key={qIndex}
                text={QUESTIONS[qIndex]}
                className="poll-question"
                delay={80}
                duration={1.8}
                ease="power3.out"
                splitType="chars"
                from={{ opacity: 0, y: 40 }}
                to={{ opacity: 1, y: 0 }}
                threshold={0.1}
                rootMargin="-100px"
                textAlign="center"
              />
            )}
            {state === 'thinking' && (
              <ShinyText text="正在解析你的问题" className="status" speed={2} color="#6b7280" shineColor="#ffffff" />
            )}
            {state === 'answering' && (
              <>
                <ShinyText text="正在生成语音回复" className="status-label" speed={1.5} color="#6b7280" shineColor="#ffffff" />
                <div className="answer">{shown}</div>
              </>
            )}
          </div>

          {/* 输入区 */}
          <BorderGlow
            className="input-wrap"
            edgeSensitivity={6}
            glowColor="40 80 80"
            backgroundColor="#120F17"
            borderRadius={30}
            glowRadius={41}
            glowIntensity={1}
            coneSpread={25}
            colors={['#c084fc', '#f472b6', '#38bdf8']}
          >
            <div className="input-row">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="有什么我能帮你的吗？"
              />
              <button
                className={`ask-btn${isActive ? ' stop-btn' : ''}`}
                onClick={isActive ? stop : submit}
                disabled={!isActive && (state !== 'idle' || !input.trim())}
              >
                {isActive ? '■' : '↑'}
              </button>
            </div>
          </BorderGlow>

          {error && <div className="error-tip">{error}</div>}
        </div>
      </main>
    </>
  )
}
