import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { Environment, Lightformer, ContactShadows } from '@react-three/drei'
import { EffectComposer, Bloom, DepthOfField, SMAA } from '@react-three/postprocessing'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation'
import CameraRig from './CameraRig'

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */
// A VRoid/VRM avatar (CC0). Swap this file to change the character.
const MODEL_URL = `${import.meta.env.BASE_URL}models/avatar.vrm`

// VRMA gesture clips (MIT, from tk256ailab/vrm-viewer). Order == UI order.
export const GESTURES = [
  'Goodbye',
  'Clapping',
  'Jump',
  'Thinking',
  'Relax',
  'Surprised',
  'LookAround',
] as const
const VRMA_URLS = GESTURES.map((n) => `${import.meta.env.BASE_URL}models/vrma/${n}.vrma`)

// 手势播放时叠加的表情（VRM 预设名）
const GESTURE_EXPRESSION: Record<string, string> = {
  Goodbye: 'happy',
  Clapping: 'happy',
  Jump: 'happy',
  Relax: 'relaxed',
  Surprised: 'surprised',
}

/* ------------------------------------------------------------------ */
/* Theme + background palettes                                         */
/* ------------------------------------------------------------------ */
const THEME = {
  light: { top: '#7c9a83', bottom: '#e4dcc4', key: '#ffd9c6', fill: '#9fc6ff', rim: '#fff4e6' },
  dark: { top: '#26324a', bottom: '#121826', key: '#ffcbb0', fill: '#5b7fb8', rim: '#bcd6ff' },
}

// User-selectable background gradients (id must match journey.html swatches).
export const BG_PRESETS: Record<string, { light: { top: string; bottom: string }; dark: { top: string; bottom: string } }> = {
  mint: { light: { top: '#a7d7c5', bottom: '#f0ede0' }, dark: { top: '#1f3b32', bottom: '#0e1512' } },
  sunset: { light: { top: '#f6b4a0', bottom: '#f7e9d8' }, dark: { top: '#3a2230', bottom: '#161018' } },
  ocean: { light: { top: '#8fb8e8', bottom: '#e6eef5' }, dark: { top: '#16273f', bottom: '#0b111c' } },
  lilac: { light: { top: '#c3b3e6', bottom: '#efeaf6' }, dark: { top: '#2c2540', bottom: '#14101f' } },
  mono: { light: { top: '#c9cdd2', bottom: '#eef0f2' }, dark: { top: '#2a2f37', bottom: '#12151a' } },
}

/* ------------------------------------------------------------------ */
/* Top/bottom gradient background sphere (wraps the camera)            */
/* ------------------------------------------------------------------ */
function GradientBackground({ dark, bgPreset }: { dark: boolean; bgPreset: string | null }) {
  const preset = bgPreset ? BG_PRESETS[bgPreset] : null
  const pal = preset ? (dark ? preset.dark : preset.light) : dark ? THEME.dark : THEME.light
  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uSteep: { value: 1.25 },
    }),
    [],
  )
  uniforms.uTop.value.set(pal.top)
  uniforms.uBottom.value.set(pal.bottom)

  return (
    <mesh scale={60}>
      <sphereGeometry args={[1, 32, 32]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uBottom;
          uniform float uSteep;
          varying vec3 vDir;
          void main() {
            float t = clamp(vDir.y * uSteep * 0.5 + 0.5, 0.0, 1.0);
            gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0);
          }
        `}
      />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/* Lights: procedural IBL (Lightformers) + hemisphere + key/fill/rim   */
/* ------------------------------------------------------------------ */
function Lights({ dark }: { dark: boolean }) {
  const pal = dark ? THEME.dark : THEME.light
  return (
    <>
      <hemisphereLight intensity={dark ? 0.7 : 1.1} groundColor={dark ? '#0b1220' : '#4a4a3a'} />
      <directionalLight
        position={[4, 6, 5]}
        intensity={dark ? 1.9 : 2.0}
        color={pal.key}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      >
        <orthographicCamera attach="shadow-camera" args={[-3, 3, 3, -3, 0.1, 20]} />
      </directionalLight>
      <directionalLight position={[-5, 3, -3]} intensity={dark ? 1.4 : 1.6} color={pal.fill} />
      {/* 轮廓补光：从后上方勾边，把人物从背景里剥离出来 */}
      <directionalLight position={[-1.5, 4.5, -5]} intensity={dark ? 2.6 : 1.1} color={pal.rim} />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={dark ? 1.4 : 1.9} position={[0, 3, 3]} scale={[6, 4, 1]} />
        <Lightformer form="rect" intensity={dark ? 0.8 : 1.2} position={[-4, 1, -2]} scale={[5, 4, 1]} color={pal.fill} />
        <Lightformer form="circle" intensity={dark ? 0.6 : 1.0} position={[3, 2, -3]} scale={3} color={pal.key} />
      </Environment>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* The VRM character                                                   */
/* - avatar.vrm + VRMA gesture clips loaded together (parallel)        */
/* - auto-fit: recentered, scaled to TARGET_HEIGHT, feet on the floor  */
/* - eye/head look-at follows the cursor (VRM built-in lookAt)         */
/* - gestures: one-shot AnimationMixer clips, smooth slerp back to rest*/
/* - micro-motions: blink / breathing / weight shift / head follow     */
/* - outfit recolor: tint the MToon "Tops" (hoodie) material           */
/* ------------------------------------------------------------------ */
const TARGET_HEIGHT = 1.75

/**
 * 体格微调：VRoid 角色头大、肩窄，整体偏少年感。
 * 这里只用「均匀缩放 + 位移」，不做非均匀缩放——非均匀缩放会在骨骼旋转时产生剪切，
 * 手势一动就穿帮。改这几个数就能在「少年」和「成年男性」之间调。
 * 全部设成 1 / 0 即为模型原始体型。
 */
const BUILD = {
  head: 0.94, // 头小一点，身体比例立刻显得成熟
  neck: 1.06, // 脖子略粗
  shoulderSpread: 0.035, // 肩膀向外挪（模型单位，约 3.5cm），加宽肩线
  upperArm: 1.06, // 手臂略壮
}

// 微动手感
const MICRO = {
  breatheSpeed: 1.1,
  headGainX: 0.5, // 光标 -> 头部偏航（弧度）
  headGainY: 0.26, // 光标 -> 头部俯仰
  headEase: 0.08,
  blinkMin: 2.2,
  blinkMax: 6.0,
  blinkDur: 0.16,
  idleGaze: 8, // 光标静止多久后自己四处看（秒）
  idleGesture: 26, // 静置多久后自发做一次环顾（秒）
}

// MToon materials expose .color (litFactor) + .shadeColorFactor.
type ColorableMaterial = THREE.Material & {
  color?: THREE.Color
  shadeColorFactor?: THREE.Color
}

type MicroBone = { node: THREE.Object3D; rest: THREE.Quaternion }

function Character({
  reduced,
  outfitColor,
  actionName,
  actionNonce,
  headRef,
}: {
  reduced: boolean
  outfitColor: string | null
  actionName: string | null
  actionNonce: number
  headRef: MutableRefObject<THREE.Object3D | null>
}) {
  const gltfs = useLoader(GLTFLoader, [MODEL_URL, ...VRMA_URLS], (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
  })
  const vrm = gltfs[0].userData.vrm as VRM
  const vrmAnimations = gltfs.slice(1).map((g) => (g.userData.vrmAnimations as VRMAnimation[])?.[0])

  const group = useRef<THREE.Group>(null)
  const lookTarget = useRef(new THREE.Object3D())
  const mixer = useRef<THREE.AnimationMixer | null>(null)
  const clips = useRef<Record<string, THREE.AnimationClip>>({})
  const current = useRef<THREE.AnimationAction | null>(null)
  const playing = useRef(false)
  const restPose = useRef<{ node: THREE.Object3D; quat: THREE.Quaternion }[]>([])
  const toneMats = useRef<{ mat: ColorableMaterial; color0: THREE.Color; shade0: THREE.Color | null }[]>([])

  // 微动状态
  const micro = useRef<Record<string, MicroBone | null>>({})
  const blink = useRef({ next: 3, phase: 0 })
  const expr = useRef({ name: '', w: 0 })
  const head = useRef({ yaw: 0, pitch: 0 })
  const idle = useRef({ t: 0, x: 0, y: 0 })
  const tmpEuler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), [])
  const tmpQuat = useMemo(() => new THREE.Quaternion(), [])

  useMemo(() => {
    // performance clean-ups
    VRMUtils.removeUnnecessaryVertices(vrm.scene)
    VRMUtils.combineSkeletons(vrm.scene)
    // VRM0 faces -Z; rotate so the avatar looks toward the camera (+Z)
    VRMUtils.rotateVRM0(vrm)

    // relax the default T-pose into a natural A-pose (arms down, slight elbow bend)
    const h = vrm.humanoid
    const lUp = h?.getNormalizedBoneNode('leftUpperArm')
    const rUp = h?.getNormalizedBoneNode('rightUpperArm')
    const lLo = h?.getNormalizedBoneNode('leftLowerArm')
    const rLo = h?.getNormalizedBoneNode('rightLowerArm')
    if (lUp) lUp.rotation.set(0.06, 0, 1.33)
    if (rUp) rUp.rotation.set(0.06, 0, -1.33)
    if (lLo) lLo.rotation.set(0.05, 0, 0.16)
    if (rLo) rLo.rotation.set(0.05, 0, -0.16)

    // 体格微调。必须作用在 raw 骨骼上：humanoid.update() 只会把 normalized 的
    // 旋转（和 hips 位移）拷回 raw，缩放不会传递。
    const rawHead = h?.getRawBoneNode('head')
    const rawNeck = h?.getRawBoneNode('neck')
    if (rawHead) rawHead.scale.setScalar(BUILD.head)
    if (rawNeck) rawNeck.scale.setScalar(BUILD.neck)
    ;(['leftShoulder', 'rightShoulder'] as const).forEach((n) => {
      const b = h?.getRawBoneNode(n)
      if (b) b.position.x += Math.sign(b.position.x || 1) * BUILD.shoulderSpread
    })
    ;(['leftUpperArm', 'rightUpperArm'] as const).forEach((n) => {
      const b = h?.getRawBoneNode(n)
      if (b) b.scale.setScalar(BUILD.upperArm)
    })

    // 手指默认是完全张开的，看着很僵；给一点自然的微握
    const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const
    const SEGMENTS = [
      ['Proximal', 0.22],
      ['Intermediate', 0.34],
      ['Distal', 0.2],
    ] as const
    ;(['left', 'right'] as const).forEach((side) => {
      const sign = side === 'left' ? -1 : 1
      FINGERS.forEach((finger) => {
        SEGMENTS.forEach(([segment, amount]) => {
          const node = h?.getNormalizedBoneNode(`${side}${finger}${segment}` as never)
          if (node) node.rotation.z = sign * (finger === 'Thumb' ? amount * 0.45 : amount)
        })
      })
    })

    // collect recolorable clothing material(s) + cache originals
    toneMats.current = []
    vrm.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.frustumCulled = false
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach((m) => {
          const mat = m as ColorableMaterial
          if (mat?.name?.includes('Tops') && mat.color) {
            toneMats.current.push({
              mat,
              color0: mat.color.clone(),
              shade0: mat.shadeColorFactor ? mat.shadeColorFactor.clone() : null,
            })
          }
        })
      }
    })

    // auto-fit: recenter x/z, drop feet to y=0, scale to TARGET_HEIGHT
    vrm.scene.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(vrm.scene)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)
    const s = TARGET_HEIGHT / (size.y || 1)
    vrm.scene.scale.setScalar(s)
    vrm.scene.position.set(-center.x * s, -box.min.y * s, -center.z * s)

    // gaze: make the avatar's eyes/head track a movable target
    if (vrm.lookAt) vrm.lookAt.target = lookTarget.current

    // capture the A-pose as the rest pose (per normalized humanoid bone)
    restPose.current = []
    const humanBones = vrm.humanoid?.humanBones ?? {}
    Object.keys(humanBones).forEach((name) => {
      const node = vrm.humanoid?.getNormalizedBoneNode(name as never)
      if (node) restPose.current.push({ node, quat: node.quaternion.clone() })
    })

    // 微动骨骼：每帧从 rest 重算（copy(rest).multiply(micro)），避免与回位 slerp 互相累积
    micro.current = {}
    ;(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'] as const).forEach((n) => {
      const node = vrm.humanoid?.getNormalizedBoneNode(n)
      micro.current[n] = node ? { node, rest: node.quaternion.clone() } : null
    })

    // 景深对焦用：人物头部（原始骨骼，vrm.update 之后世界变换才是最终值）
    headRef.current = vrm.humanoid?.getRawBoneNode('head') ?? null

    // build the animation mixer + one clip per gesture
    // NOTE: no VRMLookAtQuaternionProxy is added, so the VRMA lookAt tracks are
    // skipped and our cursor-driven gaze keeps working during every gesture.
    mixer.current = new THREE.AnimationMixer(vrm.scene)
    clips.current = {}
    GESTURES.forEach((name, i) => {
      const anim = vrmAnimations[i]
      if (anim) clips.current[name] = createVRMAnimationClip(anim, vrm)
    })
    mixer.current.addEventListener('finished', (e) => {
      if (e.action === current.current) {
        current.current.stop()
        current.current = null
        playing.current = false
      }
    })
  }, [vrm])

  const play = (name: string | null) => {
    if (!name || !mixer.current) return
    const clip = clips.current[name]
    if (!clip) return
    if (current.current) current.current.stop()
    const action = mixer.current.clipAction(clip)
    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.fadeIn(0.25)
    action.play()
    current.current = action
    playing.current = true
    // 切表情前先把上一个归零，避免叠加
    const next = GESTURE_EXPRESSION[name] ?? ''
    if (expr.current.name && expr.current.name !== next) {
      vrm.expressionManager?.setValue(expr.current.name, 0)
      expr.current.w = 0
    }
    expr.current.name = next
  }

  // outfit recolor (Tops / hoodie). null => restore original.
  useEffect(() => {
    toneMats.current.forEach(({ mat, color0, shade0 }) => {
      if (outfitColor) {
        mat.color?.set(outfitColor)
        if (mat.shadeColorFactor) mat.shadeColorFactor.set(outfitColor).multiplyScalar(0.62)
      } else {
        mat.color?.copy(color0)
        if (mat.shadeColorFactor && shade0) mat.shadeColorFactor.copy(shade0)
      }
    })
  }, [outfitColor])

  // gesture trigger (nonce increments even when re-picking the same action)
  useEffect(() => {
    if (actionNonce > 0) play(actionName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionNonce])

  // greet once on mount
  useEffect(() => {
    if (reduced) return
    const t = setTimeout(() => play('Goodbye'), 650)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 把 euler 微旋转叠加到 rest 姿态上（每帧重算，无累积）
  const applyMicro = (key: string, x: number, y: number, z = 0) => {
    const m = micro.current[key]
    if (!m) return
    tmpEuler.set(x, y, z)
    tmpQuat.setFromEuler(tmpEuler)
    m.node.quaternion.copy(m.rest).multiply(tmpQuat)
  }

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const p = state.pointer

    // 光标是否在动 -> 决定是否进入「自己四处看」的待机状态
    if (Math.abs(p.x - idle.current.x) > 0.01 || Math.abs(p.y - idle.current.y) > 0.01) {
      idle.current.t = 0
      idle.current.x = p.x
      idle.current.y = p.y
    } else {
      idle.current.t += delta
    }
    const gazeIdle = !reduced && idle.current.t > MICRO.idleGaze

    // 视线目标：跟光标；久无操作则自己缓慢游移
    if (gazeIdle) {
      lookTarget.current.position.set(
        Math.sin(t * 0.21) * 1.3,
        TARGET_HEIGHT * 0.92 + Math.sin(t * 0.13) * 0.32,
        3.0,
      )
    } else {
      lookTarget.current.position.set(p.x * 1.6, TARGET_HEIGHT * 0.92 + p.y * 0.7, 3.0)
    }

    // 静置太久，自发做一次环顾
    if (!reduced && !playing.current && idle.current.t > MICRO.idleGesture) {
      idle.current.t = 0
      play('LookAround')
    }

    mixer.current?.update(delta)

    // smoothly relax back to the A-pose whenever no gesture is playing
    if (!playing.current && restPose.current.length) {
      const a = 1 - Math.pow(0.001, delta) // frame-rate independent damping
      for (const { node, quat } of restPose.current) node.quaternion.slerp(quat, a)
    }

    // 微动：呼吸 / 重心微摆 / 头部跟随（手势播放时让位给 clip）
    if (!reduced && !playing.current) {
      const breathe = Math.sin(t * MICRO.breatheSpeed)
      applyMicro('spine', breathe * 0.012, Math.sin(t * 0.31) * 0.01)
      applyMicro('chest', breathe * 0.01, 0)
      applyMicro('hips', 0, Math.sin(t * 0.37) * 0.03, Math.sin(t * 0.23) * 0.012)

      // 头部朝光标（待机时朝自己的游移目标），带上限与缓动
      const tx = gazeIdle ? Math.sin(t * 0.21) * 0.8 : p.x
      const ty = gazeIdle ? Math.sin(t * 0.13) * 0.5 : p.y
      const e = 1 - Math.pow(MICRO.headEase, delta)
      head.current.yaw += (THREE.MathUtils.clamp(tx, -1, 1) * MICRO.headGainX - head.current.yaw) * e
      head.current.pitch += (-THREE.MathUtils.clamp(ty, -1, 1) * MICRO.headGainY - head.current.pitch) * e
      applyMicro('neck', head.current.pitch * 0.35, head.current.yaw * 0.35)
      applyMicro('head', head.current.pitch * 0.65 + breathe * 0.006, head.current.yaw * 0.65)
    }

    // 自动眨眼
    if (!reduced && vrm.expressionManager) {
      blink.current.next -= delta
      if (blink.current.next <= 0 && blink.current.phase === 0) {
        blink.current.phase = 1e-4
        blink.current.next = MICRO.blinkMin + Math.random() * (MICRO.blinkMax - MICRO.blinkMin)
      }
      if (blink.current.phase > 0) {
        blink.current.phase += delta / MICRO.blinkDur
        if (blink.current.phase >= 1) {
          blink.current.phase = 0
          vrm.expressionManager.setValue('blink', 0)
        } else {
          vrm.expressionManager.setValue('blink', Math.sin(blink.current.phase * Math.PI))
        }
      }
    }

    // 手势期表情淡入淡出
    if (expr.current.name && vrm.expressionManager) {
      const goal = playing.current ? 1 : 0
      expr.current.w += (goal - expr.current.w) * (1 - Math.pow(0.02, delta))
      vrm.expressionManager.setValue(expr.current.name, expr.current.w)
    }

    // subtle idle bob (skipped while gesturing so it doesn't fight the clip)
    if (group.current && !reduced && !playing.current) {
      group.current.position.y = Math.sin(t * MICRO.breatheSpeed) * 0.015
    }

    vrm.update(delta)
  })

  return (
    <group ref={group}>
      <primitive object={vrm.scene} />
      <primitive object={lookTarget.current} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Post: DepthOfField -> Bloom -> SMAA (顺序影响合成，参考 sen)         */
/* DoF 焦点每帧跟随 focusRef（人物头部），虚化档位来自当前景别           */
/* ------------------------------------------------------------------ */
function Post({
  dark,
  dof,
  focusRef,
  dofRef,
}: {
  dark: boolean
  dof: boolean
  focusRef: MutableRefObject<THREE.Vector3>
  dofRef: MutableRefObject<{ bokeh: number; range: number }>
}) {
  const ref = useRef<any>(null)
  useFrame(() => {
    const e = ref.current
    if (!e) return
    if (e.target) e.target.copy(focusRef.current)
    e.bokehScale = dofRef.current.bokeh
    if (e.cocMaterial) e.cocMaterial.focusRange = Math.max(1e-4, dofRef.current.range)
  })

  return (
    <EffectComposer multisampling={0}>
      {(dof ? <DepthOfField ref={ref} target={[0, 1.4, 0]} worldFocusRange={1.2} bokehScale={3} height={720} /> : null) as any}
      <Bloom intensity={dark ? 0.7 : 0.35} luminanceThreshold={0.9} luminanceSmoothing={0.2} mipmapBlur />
      <SMAA />
    </EffectComposer>
  )
}

/* ------------------------------------------------------------------ */
/* prefers-reduced-motion                                              */
/* ------------------------------------------------------------------ */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

/* ------------------------------------------------------------------ */
/* Scene root                                                          */
/* ------------------------------------------------------------------ */
export default function Scene({
  dark,
  outfitColor,
  bgPreset,
  actionName,
  actionNonce,
  category,
}: {
  dark: boolean
  outfitColor: string | null
  bgPreset: string | null
  actionName: string | null
  actionNonce: number
  category: string | null
}) {
  const reduced = usePrefersReducedMotion()
  const headRef = useRef<THREE.Object3D | null>(null)
  const focusRef = useRef(new THREE.Vector3(0, 1.4, 0))
  const dofRef = useRef({ bokeh: 3.5, range: 1.2 })

  // 移动端 / 降低动效偏好下不挂景深，保帧率
  const heavy = useMemo(
    () =>
      typeof window !== 'undefined' &&
      !(window.matchMedia?.('(pointer: coarse)').matches === true || window.innerWidth <= 640),
    [],
  )

  return (
    <>
      <GradientBackground dark={dark} bgPreset={bgPreset} />
      <Lights dark={dark} />

      <Character
        reduced={reduced}
        outfitColor={outfitColor}
        actionName={actionName}
        actionNonce={actionNonce}
        headRef={headRef}
      />

      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={dark ? 0.5 : 0.4}
        scale={6}
        blur={2.6}
        far={3}
        resolution={512}
        color={dark ? '#000000' : '#3a3a2e'}
      />

      <CameraRig
        category={category}
        reduced={reduced}
        headRef={headRef}
        focusRef={focusRef}
        dofRef={dofRef}
      />

      <Post dark={dark} dof={heavy && !reduced} focusRef={focusRef} dofRef={dofRef} />
    </>
  )
}
