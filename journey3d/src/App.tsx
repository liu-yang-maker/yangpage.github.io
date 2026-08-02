import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './scene/Scene'
import LoadingScreen from './ui/LoadingScreen'
import NoiseOverlay from './ui/NoiseOverlay'

/**
 * Fixed full-viewport <Canvas> holding the 3D character.
 * The parent page (journey.html) drives it via postMessage:
 *   { type: 'theme', dark }            -> light/dark
 *   { type: 'avatar-outfit', hex }     -> recolor hoodie (null/'' = reset)
 *   { type: 'avatar-bg', preset }      -> background gradient (null/'' = default)
 *   { type: 'avatar-action', name }    -> play a VRMA gesture once
 *   { type: 'avatar-focus', category } -> move the camera to that category's shot
 * The initial theme also comes from the ?theme= query param.
 */
export default function App() {
  const [dark, setDark] = useState<boolean>(
    () => new URLSearchParams(window.location.search).get('theme') === 'dark',
  )
  const [outfitColor, setOutfitColor] = useState<string | null>(null)
  const [bgPreset, setBgPreset] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [action, setAction] = useState<{ name: string | null; nonce: number }>({
    name: null,
    nonce: 0,
  })

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data
      if (!d || typeof d !== 'object') return
      switch (d.type) {
        case 'theme':
          setDark(!!d.dark)
          break
        case 'avatar-outfit':
          setOutfitColor(d.hex || null)
          break
        case 'avatar-bg':
          setBgPreset(d.preset || null)
          break
        case 'avatar-action':
          setAction((a) => ({ name: d.name || null, nonce: a.nonce + 1 }))
          break
        case 'avatar-focus':
          setCategory(d.category || null)
          break
      }
    }
    window.addEventListener('message', onMessage)
    // Tell the parent we're mounted (so it can push the current theme).
    try {
      window.parent?.postMessage({ type: 'journey3d-ready' }, '*')
    } catch {
      /* ignore cross-origin */
    }
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ position: [0, 1.0, 3.6], fov: 34, near: 0.1, far: 100 }}
      >
        <Suspense fallback={null}>
          <Scene
            dark={dark}
            outfitColor={outfitColor}
            bgPreset={bgPreset}
            actionName={action.name}
            actionNonce={action.nonce}
            category={category}
          />
        </Suspense>
      </Canvas>
      <NoiseOverlay dark={dark} />
      <LoadingScreen dark={dark} />
    </>
  )
}
