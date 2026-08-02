import { useProgress } from '@react-three/drei'
import { useEffect, useState } from 'react'

/** Simple loading mask over the canvas until assets finish loading. */
export default function LoadingScreen({ dark }: { dark: boolean }) {
  const { active, progress } = useProgress()
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!active && progress >= 100) {
      const t = setTimeout(() => setHidden(true), 350)
      return () => clearTimeout(t)
    }
    setHidden(false)
  }, [active, progress])

  if (hidden) return null

  const bg = dark ? '#1a202c' : '#e9e4d4'
  const fg = dark ? '#cbd5e0' : '#4a5568'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        background: bg,
        color: fg,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        transition: 'opacity 0.35s ease',
        opacity: !active && progress >= 100 ? 0 : 1,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: `3px solid ${dark ? '#2d3748' : '#cfc8b4'}`,
          borderTopColor: dark ? '#63b3ed' : '#2b6cb0',
          animation: 'j3dspin 0.9s linear infinite',
        }}
      />
      <div style={{ fontSize: 12, letterSpacing: 1 }}>{Math.round(progress)}%</div>
      <style>{`@keyframes j3dspin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
