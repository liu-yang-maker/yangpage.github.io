import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CAM, getShot, type Shot } from './shots'

/**
 * 程序化电影运镜（取代 OrbitControls），做法参考 sen-3d-resume：
 * - 相机由数据驱动：每帧把球坐标 radius/phi/theta、目标高度、fov 按阻尼逼近当前景别
 * - 绕焦点的鼠标视差：主体在画面里钉住不动，只有四周产生位移（sen 的四元数做法）
 * - 拖动仍然可用，但作为「会衰减的手动偏移」，松手后自动回到构图
 * - 待机时方位角极慢正弦微摆，替代生硬的自动旋转
 * - 移动端整体拉远、关闭视差
 *
 * 同时把当前焦点（人物头部世界坐标）写进 focusRef，供景深自动对焦使用。
 */
export default function CameraRig({
  category,
  reduced,
  headRef,
  focusRef,
  dofRef,
}: {
  category: string | null
  reduced: boolean
  headRef: MutableRefObject<THREE.Object3D | null>
  focusRef: MutableRefObject<THREE.Vector3>
  dofRef: MutableRefObject<{ bokeh: number; range: number }>
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  const isCoarse = useMemo(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches === true || window.innerWidth <= 640),
    [],
  )

  // 当前（被阻尼追赶的）镜头状态，初始即为目标景别，避免入场时甩镜
  const shot = getShot(category)
  const cur = useRef<Shot>({ ...shot })
  const inited = useRef(false)

  // 拖动产生的手动偏移（会随时间衰减回 0）
  const drag = useRef({ theta: 0, phi: 0, active: false })
  // 手动缩放：相对当前景别的倍率，切换景别时归位
  const zoom = useRef({ goal: 1, cur: 1 })
  // 鼠标视差（缓动后的值）
  const smouse = useRef({ x: 0, y: 0 })

  // 复用对象，避免每帧分配
  const tmp = useMemo(
    () => ({
      target: new THREE.Vector3(),
      basePos: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      mat: new THREE.Matrix4(),
      paraEuler: new THREE.Euler(0, 0, 0, 'YXZ'),
      paraQuat: new THREE.Quaternion(),
      camQuat: new THREE.Quaternion(),
    }),
    [],
  )

  // 拖动：在 canvas 上累加偏移；松手后由每帧衰减带回构图
  useEffect(() => {
    const el = gl.domElement
    let last: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      drag.current.active = true
      last = { x: e.clientX, y: e.clientY }
      el.setPointerCapture?.(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!drag.current.active || !last) return
      drag.current.theta -= (e.clientX - last.x) * CAM.dragSpeed
      drag.current.phi -= (e.clientY - last.y) * CAM.dragSpeed
      drag.current.phi = THREE.MathUtils.clamp(drag.current.phi, -0.5, 0.5)
      last = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e: PointerEvent) => {
      drag.current.active = false
      last = null
      el.releasePointerCapture?.(e.pointerId)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerleave', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerleave', onUp)
    }
  }, [gl])

  // 缩放：滚轮 + 双指捏合。到达上下限时不再拦截滚轮，让父页正常滚动。
  useEffect(() => {
    const el = gl.domElement
    const setZoom = (v: number) => {
      zoom.current.goal = THREE.MathUtils.clamp(v, CAM.zoomMin, CAM.zoomMax)
    }
    const onWheel = (e: WheelEvent) => {
      const next = zoom.current.goal * (1 + e.deltaY * CAM.zoomStep)
      const atLimit =
        (zoom.current.goal >= CAM.zoomMax && next > zoom.current.goal) ||
        (zoom.current.goal <= CAM.zoomMin && next < zoom.current.goal)
      if (atLimit) return // 让滚动事件冒泡给页面
      e.preventDefault()
      setZoom(next)
    }
    let pinch0 = 0
    let zoom0 = 1
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch0 = dist(e.touches)
        zoom0 = zoom.current.goal
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch0) return
      e.preventDefault()
      setZoom(zoom0 * (pinch0 / dist(e.touches)))
    }
    const onTouchEnd = () => {
      pinch0 = 0
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [gl])

  // 换景别时手动缩放归位，回到设计好的构图
  useEffect(() => {
    zoom.current.goal = 1
  }, [category])

  useFrame((state, dt) => {
    const goal = getShot(category)
    const c = cur.current

    // 1) 阻尼逼近目标景别（sen 的写法：帧率无关）
    const a = inited.current ? 1 - Math.pow(CAM.damping, dt) : 1
    inited.current = true
    c.radius += (goal.radius - c.radius) * a
    c.phi += (goal.phi - c.phi) * a
    c.theta += (goal.theta - c.theta) * a
    c.targetY += (goal.targetY - c.targetY) * a
    c.fov += (goal.fov - c.fov) * a
    c.bokeh += (goal.bokeh - c.bokeh) * a
    c.range += (goal.range - c.range) * a

    // 2) 拖动偏移衰减 + 待机微摆
    const d = drag.current
    if (!d.active) {
      const k = Math.pow(CAM.dragDecay, dt)
      d.theta *= k
      d.phi *= k
    }
    const sway = reduced || d.active ? 0 : Math.sin(state.clock.elapsedTime * CAM.idleSwaySpeed) * CAM.idleSway

    // 3) 焦点：跟随人物头部（景深对焦 + 视差支点都用它）
    if (headRef.current) headRef.current.getWorldPosition(focusRef.current)
    else focusRef.current.set(0, c.targetY, 0)

    // 4) 球坐标 -> 相机位置。手动拉近时把瞄准点抬向头部，
    //    否则纯推轨会把画面顶在胸口、把脸挤出画外。
    const theta = c.theta + d.theta + sway
    const phi = THREE.MathUtils.clamp(c.phi + d.phi, CAM.minPhi, CAM.maxPhi)
    const z = zoom.current
    z.cur += (z.goal - z.cur) * (1 - Math.pow(CAM.zoomEase, dt))
    let radius = c.radius * z.cur
    if (isCoarse) radius *= CAM.mobilePullback

    const lift = THREE.MathUtils.clamp((1 - z.cur) / (1 - CAM.zoomMin), 0, 1)
    const targetY = c.targetY + (focusRef.current.y - c.targetY) * lift * 0.85

    tmp.target.set(0, targetY, 0)
    tmp.basePos.set(
      radius * Math.sin(phi) * Math.sin(theta),
      targetY + radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta),
    )

    // 相机朝向目标点（用 Matrix4.lookAt：它是「-Z 朝前」的相机约定，
    // Object3D.lookAt 对非相机对象会反过来，会把镜头转到背面）
    tmp.mat.lookAt(tmp.basePos, tmp.target, tmp.up)
    tmp.camQuat.setFromRotationMatrix(tmp.mat)

    // 5) 绕焦点做鼠标视差：主体位置不变，只有四周产生位移（sen 的做法）
    if (!isCoarse && !reduced) {
      const me = 1 - Math.pow(CAM.parallaxEase, dt)
      smouse.current.x += (state.pointer.x - smouse.current.x) * me
      smouse.current.y += (state.pointer.y - smouse.current.y) * me
      const ax = THREE.MathUtils.degToRad(CAM.parallax)
      tmp.paraEuler.set(-smouse.current.y * ax, -smouse.current.x * ax, 0)
      tmp.paraQuat.setFromEuler(tmp.paraEuler)
      tmp.offset.copy(tmp.basePos).sub(focusRef.current).applyQuaternion(tmp.paraQuat).add(focusRef.current)
      camera.position.copy(tmp.offset)
      camera.quaternion.multiplyQuaternions(tmp.paraQuat, tmp.camQuat)
    } else {
      camera.position.copy(tmp.basePos)
      camera.quaternion.copy(tmp.camQuat)
    }

    // 6) fov
    const persp = camera as THREE.PerspectiveCamera
    if (persp.isPerspectiveCamera && Math.abs(persp.fov - c.fov) > 0.01) {
      persp.fov = c.fov
      persp.updateProjectionMatrix()
    }

    // 7) 把景深参数交给后处理
    dofRef.current.bokeh = c.bokeh
    dofRef.current.range = c.range
  })

  return null
}
