export type Landmark = { x:number; y:number; z:number; visibility:number }
export type HandData = {
  handedness:'Left'|'Right'
  landmarks:Landmark[]
}

const clamp01=(v:number)=>Math.max(0,Math.min(1,v))
const d=(a:Landmark,b:Landmark)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)

export function palmSize(lm:Landmark[]) {
  return Math.max(0.0001,d(lm[5],lm[17]))
}

export function handCenter(lm:Landmark[]) {
  const ids=[0,5,9,13,17]
  const pts=ids.map(i=>lm[i])
  return {
    x:pts.reduce((a,p)=>a+p.x,0)/pts.length,
    y:pts.reduce((a,p)=>a+p.y,0)/pts.length,
    z:pts.reduce((a,p)=>a+p.z,0)/pts.length,
  }
}

export function wristRoll(lm:Landmark[]) {
  const a=lm[5], b=lm[17]
  let angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI

  // A palm's knuckle line has a 180° ambiguity. Folding it into [-90,+90]
  // prevents an ordinary upright hand from being clamped permanently at
  // -90 or +90.
  angle=((angle+90)%180+180)%180-90
  return angle
}

/**
 * Dynamics without moving toward the camera.
 * The preview is mirrored, so convert raw camera X to the displayed X.
 * Each hand gets louder as it moves outward toward its own screen edge.
 */
export function lateralDynamics(
  lm:Landmark[],
  handedness:'Left'|'Right'
) {
  const displayX=1-handCenter(lm).x
  if(handedness==='Left'){
    return clamp01((0.50-displayX)/0.34)
  }
  return clamp01((displayX-0.50)/0.34)
}

export function pinchStrength(lm:Landmark[], tip:8|12|16|20) {
  const dist=d(lm[4],lm[tip])/palmSize(lm)
  return clamp01(1-(dist-0.18)/0.55)
}

export function isPinched(lm:Landmark[],tip:8|12|16|20,threshold=.72) {
  return pinchStrength(lm,tip)>=threshold
}

export function pinchY(lm:Landmark[],tip:8|12|16|20) {
  return (lm[4].y+lm[tip].y)/2
}

export function openness(lm:Landmark[]) {
  const s=palmSize(lm)
  const vals=[8,12,16,20].map(i=>d(lm[0],lm[i])/s)
  return clamp01((vals.reduce((a,b)=>a+b,0)/vals.length-1.3)/1.8)
}

function angleDeg(a:Landmark,b:Landmark,c:Landmark) {
  const ab=[a.x-b.x,a.y-b.y,a.z-b.z]
  const cb=[c.x-b.x,c.y-b.y,c.z-b.z]
  const dot=ab[0]*cb[0]+ab[1]*cb[1]+ab[2]*cb[2]
  const ma=Math.hypot(...ab), mb=Math.hypot(...cb)
  if(ma<1e-6||mb<1e-6)return 0
  return Math.acos(Math.max(-1,Math.min(1,dot/(ma*mb))))*180/Math.PI
}

function nonThumbExtended(lm:Landmark[],mcp:number,pip:number,tip:number) {
  return angleDeg(lm[mcp],lm[pip],lm[tip])>145 &&
    d(lm[tip],lm[0])>d(lm[pip],lm[0])*1.08
}

function thumbExtended(lm:Landmark[]) {
  return angleDeg(lm[2],lm[3],lm[4])>135 &&
    d(lm[4],lm[9])>d(lm[3],lm[9])*1.12
}

export type FingerState={
  thumb:boolean,index:boolean,middle:boolean,ring:boolean,pinky:boolean
}

export function fingerState(lm:Landmark[]):FingerState {
  return {
    thumb:thumbExtended(lm),
    index:nonThumbExtended(lm,5,6,8),
    middle:nonThumbExtended(lm,9,10,12),
    ring:nonThumbExtended(lm,13,14,16),
    pinky:nonThumbExtended(lm,17,18,20),
  }
}

export function chordGestureDegree(lm:Landmark[]):0|1|2|3|4|5|6|7 {
  const f=fingerState(lm)

  if(f.index && !f.middle && !f.ring && f.pinky){
    return f.thumb?7:6
  }
  if(f.index && !f.middle && !f.ring && !f.pinky)return 1
  if(f.index && f.middle && !f.ring && !f.pinky)return 2
  if(f.index && f.middle && f.ring && !f.pinky)return 3
  if(f.index && f.middle && f.ring && f.pinky)return f.thumb?5:4
  return 0
}

export function isFist(lm:Landmark[]) {
  const f=fingerState(lm)
  return !f.thumb&&!f.index&&!f.middle&&!f.ring&&!f.pinky
}

/**
 * Bottom of frame = 0, top of frame = 1.
 * The useful hand-tracking region is compressed slightly so users do not
 * need to touch the exact camera edge to reach 13ths.
 */
export function verticalPerformanceAmount(lm:Landmark[]) {
  const y=handCenter(lm).y
  return clamp01((0.84-y)/0.68)
}

/**
 * Palm size is used as a simple depth gesture.
 * Farther away = softer; closer to camera = louder.
 */
export function depthDynamics(lm:Landmark[]) {
  const size=palmSize(lm)
  return clamp01((size-0.075)/0.145)
}

/**
 * Determine whether the palm surface or back of the hand faces the camera.
 * We use the signed 2D orientation of wrist/index-MCP/pinky-MCP and correct
 * for chirality. Very sideways hands return "edge".
 */
export function palmSurface(
  lm:Landmark[],
  handedness:'Left'|'Right'
):{side:'palm'|'back'|'edge',confidence:number} {
  const w=lm[0], i=lm[5], p=lm[17]
  const cross=(i.x-w.x)*(p.y-w.y)-(i.y-w.y)*(p.x-w.x)
  const signed=handedness==='Right'?-cross:cross
  const norm=signed/(palmSize(lm)**2)
  const confidence=clamp01(Math.abs(norm)*2.2)
  if(Math.abs(norm)<0.10)return {side:'edge',confidence}
  return {side:signed>0?'palm':'back',confidence}
}

export class EMA {
  private value:number|undefined
  constructor(private alpha=.25){}
  next(v:number){
    this.value=this.value===undefined?v:this.value+this.alpha*(v-this.value)
    return this.value
  }
}
