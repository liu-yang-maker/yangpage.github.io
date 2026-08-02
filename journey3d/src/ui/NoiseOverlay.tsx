import { useEffect, useMemo, useState } from 'react'

/**
 * 胶片颗粒 + 暗角叠层。
 *
 * sen-3d-resume 用「独立 R3F Canvas + frameloop=demand 约 1fps」画噪点，我们跑在
 * iframe 里，再开一个 WebGL 上下文不划算，所以改成：用 2D canvas 生成一张小噪点图，
 * 平铺成 CSS 背景，再低频抖动 background-position 得到相同的缓慢闪动质感，
 * 成本几乎为零。移动端 / 降低动效偏好下整体不渲染。
 */
const TILE = 128
const FPS = 3 // 颗粒抖动频率

function makeNoiseDataURL(): string {
  const c = document.createElement('canvas')
  c.width = TILE
  c.height = TILE
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(TILE, TILE)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + Math.random() * 135
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

export default function NoiseOverlay({ dark }: { dark: boolean }) {
  const enabled = useMemo(
    () =>
      typeof window !== 'undefined' &&
      !(window.matchMedia?.('(pointer: coarse)').matches === true || window.innerWidth <= 640) &&
      !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true),
    [],
  )
  const [url, setUrl] = useState('')
  const [pos, setPos] = useState('0px 0px')

  useEffect(() => {
    if (!enabled) return
    setUrl(makeNoiseDataURL())
  }, [enabled])

  useEffect(() => {
    if (!enabled || !url) return
    const id = setInterval(() => {
      const x = Math.floor(Math.random() * TILE)
      const y = Math.floor(Math.random() * TILE)
      setPos(`${x}px ${y}px`)
    }, 1000 / FPS)
    return () => clearInterval(id)
  }, [enabled, url])

  if (!enabled || !url) return null

  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      {/* 颗粒 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${url})`,
          backgroundRepeat: 'repeat',
          backgroundPosition: pos,
          mixBlendMode: dark ? 'screen' : 'multiply',
          opacity: dark ? 0.07 : 0.1,
        }}
      />
      {/* 暗角 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 45%, rgba(0,0,0,${dark ? 0.42 : 0.2}) 100%)`,
        }}
      />
    </div>
  )
}
