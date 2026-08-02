/**
 * 景别（镜头）数据 —— 本文件是「分类 -> 镜头」的唯一真源。
 *
 * 这是 sen-3d-resume 里 `data/focusPoints.ts` 的等价物：它用滚动位置驱动烘焙在
 * glb 里的相机动画，我们没有滚动叙事，改由 journey.html 右侧的分类来驱动镜头
 * （点 Philosophy 推特写、点 Community 拉全景），镜头参数直接写成数据。
 *
 * 相机以「目标点 (0, targetY, 0)」为球心做球坐标定位：
 *   radius  与目标点的距离（越小越近）
 *   phi     与 +Y 轴的夹角，PI/2 = 与目标同高，小于 PI/2 = 俯视（相机在上方）
 *   theta   方位角，0 = 正面(+Z)，正值向右绕
 *   targetY 目标点高度（人物身高 1.75，头部约在 1.55）
 *   fov     视场角，配合 radius 控制透视压缩
 *   bokeh   景深虚化强度（DepthOfField 的 bokehScale，最大模糊半径）
 *   range   清晰范围，**世界单位**（cocMaterial.focusRange：离焦点超过这个距离就完全
 *           虚化）。人物前后厚度不到 0.5，所以特写别小于 0.5，否则脸也会糊掉。
 *
 * 调整手感时直接改这里的常量即可，Scene / CameraRig 都从这里读。
 */
export type Shot = {
  radius: number
  phi: number
  theta: number
  targetY: number
  fov: number
  bokeh: number
  range: number
}

// 默认镜头：全身站姿，景深最深（基本全清晰）
export const HERO_SHOT: Shot = {
  radius: 3.6,
  phi: 1.52,
  theta: 0,
  targetY: 0.9,
  fov: 34,
  bokeh: 2.5,
  range: 2.0,
}

// 分类镜头：key 必须与 journey.html 里 .stage-chip 的 data-category 一致
export const SHOTS: Record<string, Shot> = {
  // 思考/内省 -> 面部特写，最浅景深（眼睛清晰、发梢与肩膀渐虚）
  philosophy: { radius: 1.55, phi: 1.5, theta: 0.18, targetY: 1.54, fov: 30, bokeh: 5, range: 0.55 },
  // 温柔的近中景
  love: { radius: 2.0, phi: 1.5, theta: -0.22, targetY: 1.4, fov: 32, bokeh: 4.5, range: 0.75 },
  // 中景，略侧身
  news: { radius: 2.4, phi: 1.48, theta: 0.3, targetY: 1.26, fov: 33, bokeh: 4, range: 1.0 },
  // 中景，另一侧、机位略低
  work: { radius: 2.6, phi: 1.46, theta: -0.35, targetY: 1.2, fov: 33, bokeh: 4, range: 1.1 },
  // 大半身，机位略高
  education: { radius: 3.2, phi: 1.42, theta: 0.12, targetY: 1.05, fov: 34, bokeh: 3, range: 1.6 },
  // 最宽的全景
  community: { radius: 3.9, phi: 1.5, theta: -0.15, targetY: 0.95, fov: 36, bokeh: 2.5, range: 2.2 },
}

export function getShot(category: string | null): Shot {
  return (category && SHOTS[category]) || HERO_SHOT
}

// 相机手感参数（沿用 sen 的阻尼写法 a = 1 - damping^dt）
export const CAM = {
  damping: 0.06, // 越小越跟手
  parallax: 4, // 鼠标视差最大角度（度）
  parallaxEase: 0.1,
  dragSpeed: 0.005, // 拖动灵敏度（弧度/px）
  dragDecay: 0.28, // 拖动偏移每秒衰减到的比例（越小回位越快）
  idleSway: 0.05, // 待机时方位角正弦微摆幅度（弧度）
  idleSwaySpeed: 0.16,
  zoomStep: 0.0012, // 滚轮灵敏度（每 deltaY 的缩放比例）
  zoomMin: 0.45, // 手动缩放下限（相对当前景别的倍率）
  zoomMax: 1.7,
  zoomEase: 0.02, // 缩放跟随的阻尼
  mobilePullback: 1.2, // 移动端整体拉远倍率
  minPhi: Math.PI * 0.34,
  maxPhi: Math.PI * 0.62,
}
