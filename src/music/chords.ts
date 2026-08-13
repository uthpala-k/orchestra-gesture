export const NOTE_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'] as const

export const KEY_OPTIONS = [
  {pc:0,label:'C'},
  {pc:1,label:'C# / Db'},
  {pc:2,label:'D'},
  {pc:3,label:'Eb'},
  {pc:4,label:'E'},
  {pc:5,label:'F'},
  {pc:6,label:'F# / Gb'},
  {pc:7,label:'G'},
  {pc:8,label:'Ab'},
  {pc:9,label:'A'},
  {pc:10,label:'Bb'},
  {pc:11,label:'B'},
] as const

export const SCALE_INTERVALS = {
  major: [0,2,4,5,7,9,11],
  minor: [0,2,3,5,7,8,10],
  dorian: [0,2,3,5,7,9,10],
  mixolydian: [0,2,4,5,7,9,10],
  lydian: [0,2,4,6,7,9,11],
  phrygian: [0,1,3,5,7,8,10],
  melodicMinor: [0,2,3,5,7,9,11],
  harmonicMinor: [0,2,3,5,7,8,11],
  // kept for compatibility with older saved settings
  naturalMinor: [0,2,3,5,7,8,10],
} as const

export type ScaleName = keyof typeof SCALE_INTERVALS
export type HarmonySide = 'palm'|'back'
export type ExtensionLevel = 0|1|2|3|4

export const ROMAN = ['I','II','III','IV','V','VI','VII'] as const
export const EXTENSION_LABELS = ['TRIAD','7TH','9TH','11TH','13TH'] as const

export type DegreeChord = {
  rootPc:number
  degree:number
  scale:ScaleName
  extension:ExtensionLevel
  midi:number[]
  pitchClasses:number[]
  label:string
  roman:string
  triadQuality:'major'|'minor'|'diminished'|'augmented'|'other'
}

const mod12 = (n:number) => ((n%12)+12)%12
const clampMidi = (n:number) => Math.max(0,Math.min(127,n))

export function midiToNote(midi:number) {
  const m=Math.round(midi)
  const oct=Math.floor(m/12)-1
  return `${NOTE_NAMES[mod12(m)]}${oct}`
}

export function scalePitchClasses(rootPc:number, scale:ScaleName) {
  return SCALE_INTERVALS[scale].map(i=>mod12(rootPc+i))
}

export function isMinorFamily(scale:ScaleName) {
  return SCALE_INTERVALS[scale][2] === 3
}

export function harmonyScaleForSide(selected:ScaleName, side:HarmonySide):ScaleName {
  if(side==='palm') return selected
  // Back of the hand flips to the parallel opposite major/minor family.
  return isMinorFamily(selected) ? 'major' : 'minor'
}

export function quantizeToScale(midi:number, rootPc:number, scale:ScaleName) {
  const pcs=scalePitchClasses(rootPc,scale)
  let best=Math.round(midi), bestDist=Infinity
  for(let m=Math.floor(midi)-8;m<=Math.ceil(midi)+8;m++){
    if(pcs.includes(mod12(m))){
      const d=Math.abs(m-midi)
      if(d<bestDist){best=m;bestDist=d}
    }
  }
  return clampMidi(best)
}

function triadQualityFromIntervals(third:number,fifth:number):DegreeChord['triadQuality'] {
  if(third===4 && fifth===7) return 'major'
  if(third===3 && fifth===7) return 'minor'
  if(third===3 && fifth===6) return 'diminished'
  if(third===4 && fifth===8) return 'augmented'
  return 'other'
}

function chordSuffix(quality:DegreeChord['triadQuality'], extension:ExtensionLevel, seventh?:number) {
  if(extension===0){
    if(quality==='major') return ''
    if(quality==='minor') return 'm'
    if(quality==='diminished') return 'dim'
    if(quality==='augmented') return 'aug'
    return ''
  }

  const ext=[0,7,9,11,13][extension]

  if(extension===1){
    if(quality==='major' && seventh===11) return 'maj7'
    if(quality==='major' && seventh===10) return '7'
    if(quality==='minor' && seventh===10) return 'm7'
    if(quality==='diminished' && seventh===10) return 'm7b5'
    if(quality==='diminished' && seventh===9) return 'dim7'
    return `${ext}`
  }

  if(quality==='major' && seventh===11) return `maj${ext}`
  if(quality==='major') return `${ext}`
  if(quality==='minor') return `m${ext}`
  if(quality==='diminished') return `m${ext}b5`
  if(quality==='augmented') return `aug${ext}`
  return `${ext}`
}

export function buildDegreeChord(
  tonicPc:number,
  scale:ScaleName,
  degree:number,
  extension:ExtensionLevel,
  tonicBaseMidi=48
):DegreeChord {
  const ints=[...SCALE_INTERVALS[scale]]
  const degreeIndex=Math.max(0,Math.min(6,degree-1))
  const count=3+extension

  const midi:number[]=[]
  for(let k=0;k<count;k++){
    const scaleIndex=degreeIndex + k*2
    const octave=Math.floor(scaleIndex/7)
    const idx=scaleIndex%7
    midi.push(clampMidi(tonicBaseMidi + tonicPc + ints[idx] + octave*12))
  }

  const root=midi[0]
  const third=midi[1]-root
  const fifth=midi[2]-root
  const seventh=midi[3]!==undefined ? midi[3]-root : undefined
  const quality=triadQualityFromIntervals(third,fifth)
  const rootName=NOTE_NAMES[mod12(root)]
  const suffix=chordSuffix(quality,extension,seventh)

  return {
    rootPc:mod12(root),
    degree,
    scale,
    extension,
    midi,
    pitchClasses:[...new Set(midi.map(mod12))],
    label:`${rootName}${suffix}`,
    roman:ROMAN[degreeIndex],
    triadQuality:quality,
  }
}

export function buildGestureChordMatrix(rootPc:number, scale:ScaleName) {
  return Array.from({length:7},(_,i)=>buildDegreeChord(rootPc,scale,i+1,0))
}

export function extensionLevelFromAmount(amount:number):ExtensionLevel {
  const a=Math.max(0,Math.min(0.999999,amount))
  return Math.min(4,Math.floor(a*5)) as ExtensionLevel
}


/**
 * Build a two-octave, 14-note scale lane like gesture.live's "wide" melody lane.
 * The notes are scale notes, not all 12 chromatic semitones, so each physical
 * hand movement gets considerably more space in SNAP mode.
 */
export function buildScaleMidiLanes(
  rootPc:number,
  scale:ScaleName,
  count=14,
  baseC=48
) {
  const intervals=[...SCALE_INTERVALS[scale]]
  const tonic=baseC+rootPc
  return Array.from({length:count},(_,i)=>{
    const octave=Math.floor(i/7)
    const degree=i%7
    return clampMidi(tonic+intervals[degree]+octave*12)
  })
}
