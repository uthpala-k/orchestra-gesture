import { useEffect, useMemo, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision'
import { OrchestraEngine, METER_SPECS, type SoloName, type MeterName } from './music/OrchestraEngine'
import {
  KEY_OPTIONS, ROMAN, EXTENSION_LABELS,
  buildDegreeChord, buildGestureChordMatrix,
  extensionLevelFromAmount, harmonyScaleForSide,
  midiToNote, quantizeToScale, scalePitchClasses, buildScaleMidiLanes,
  type ScaleName, type HarmonySide, type ExtensionLevel, type DegreeChord
} from './music/chords'
import {
  handCenter, pinchStrength, wristRoll, chordGestureDegree,
  isFist, verticalPerformanceAmount, lateralDynamics, palmSurface, EMA,
  type HandData, type Landmark
} from './gestures/gestureMath'
import { Mp4Recorder, downloadBlob, trimMp4 } from './recording/mp4Recorder'

const FINGERS=[8,12,16,20] as const
const FINGER_LABELS=['I','M','R','P'] as const
const SOLO_OPTIONS:{value:SoloName,label:string}[]=[
  {value:'violin',label:'Violin / fiddle'},
  {value:'viola',label:'Viola'},
  {value:'cello',label:'Cello'},
  {value:'piano',label:'Piano'},
  {value:'flute',label:'Flute'},
  {value:'clarinet',label:'Clarinet'},
  {value:'oboe',label:'Oboe'},
  {value:'horn',label:'French horn'},
  {value:'saxophone',label:'Saxophone'},
  {value:'sopranoSax',label:'Soprano sax*'},
  {value:'altoSax',label:'Alto sax*'},
  {value:'tenorSax',label:'Tenor sax*'},
  {value:'whistle',label:'Whistle · REAL SAMPLE'},
  {value:'panFlute',label:'Pan flute · REAL SAMPLE'},
  {value:'recorder',label:'Recorder · REAL SAMPLE'},
  {value:'ocarina',label:'Ocarina · REAL SAMPLE'},
  {value:'celticHarp',label:'Celtic / folk harp · REAL SAMPLE'},
  {value:'hammeredDulcimer',label:'Hammered dulcimer · REAL SAMPLE'},
  {value:'musette',label:'Musette / folk accordion · REAL SAMPLE'},
  {value:'theremin',label:'Theremin'},
  {value:'saw',label:'Saw'},
  {value:'square',label:'Square'},
  {value:'glass',label:'Glass'},
  {value:'brass',label:'Brass synth'},
  {value:'acid',label:'Acid'},
  {value:'pulse',label:'Pulse'},
]
const SCALE_OPTIONS:{value:ScaleName,label:string}[]=[
  {value:'major',label:'Major'},
  {value:'minor',label:'Minor'},
  {value:'dorian',label:'Dorian'},
  {value:'mixolydian',label:'Mixolydian'},
  {value:'lydian',label:'Lydian'},
  {value:'phrygian',label:'Phrygian'},
  {value:'melodicMinor',label:'Melodic minor'},
  {value:'harmonicMinor',label:'Harmonic minor'},
]

type Tab='chords'|'melody'|'rhythm'|'sound'|'camera'|'recording'|'about'
type PerformanceMode='sustain'|'pulse'
type SoloMode='snap'|'glide'
type CameraPreset='wide'|'hd'|'auto'
type PalmBackPolicy='automatic'|'same'

type DisplayLayout={dx:number,dy:number,dw:number,dh:number,W:number,H:number}

function clamp01(v:number){return Math.max(0,Math.min(1,v))}

function computeContainLayout(video:HTMLVideoElement,W:number,H:number):DisplayLayout{
  const vw=video.videoWidth||1280
  const vh=video.videoHeight||720
  const scale=Math.min(W/vw,H/vh)
  const dw=vw*scale, dh=vh*scale
  return {dx:(W-dw)/2,dy:(H-dh)/2,dw,dh,W,H}
}

function mapLandmarkForMirror(p:Landmark,l:DisplayLayout):Landmark{
  const x=l.dx+p.x*l.dw
  const y=l.dy+p.y*l.dh
  return {x:(l.W-x)/l.W,y:y/l.H,z:p.z,visibility:p.visibility ?? 1}
}

function mapHandForMirror(hand:HandData,l:DisplayLayout):HandData{
  return {...hand,landmarks:hand.landmarks.map(p=>mapLandmarkForMirror(p,l))}
}

function scaleLabel(v:ScaleName){
  return String(v).replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase())
}

function drawDial(
  ctx:CanvasRenderingContext2D,
  x:number,y:number,r:number,value:number,min:number,max:number,label:string,unit='°'
){
  const t=clamp01((value-min)/(max-min))
  const start=Math.PI*.75,end=Math.PI*2.25
  ctx.save()
  ctx.lineWidth=5
  ctx.strokeStyle='rgba(255,255,255,.13)'
  ctx.beginPath();ctx.arc(x,y,r,start,end);ctx.stroke()
  ctx.strokeStyle='#e6c66f'
  ctx.beginPath();ctx.arc(x,y,r,start,start+(end-start)*t);ctx.stroke()
  const a=start+(end-start)*t
  ctx.strokeStyle='#fff3cb';ctx.lineWidth=2
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*(r-7),y+Math.sin(a)*(r-7));ctx.stroke()
  ctx.textAlign='center';ctx.fillStyle='rgba(255,255,255,.55)'
  ctx.font='9px ui-monospace,Consolas,monospace';ctx.fillText(label,x,y+r+17)
  ctx.fillStyle='#fff7df';ctx.font='700 11px ui-monospace,Consolas,monospace'
  ctx.fillText(`${Math.round(value)}${unit}`,x,y+4)
  ctx.restore()
}

function drawVerticalMeter(
  ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,amount:number,label:string
){
  const a=clamp01(amount)
  ctx.save()
  ctx.fillStyle='rgba(255,255,255,.08)';ctx.fillRect(x,y,w,h)
  ctx.fillStyle='rgba(226,194,110,.70)';ctx.fillRect(x,y+h*(1-a),w,h*a)
  ctx.strokeStyle='rgba(255,255,255,.20)';ctx.strokeRect(x,y,w,h)
  ctx.translate(x+w+10,y+h/2);ctx.rotate(-Math.PI/2)
  ctx.textAlign='center';ctx.font='9px ui-monospace,Consolas,monospace'
  ctx.fillStyle='rgba(255,255,255,.52)';ctx.fillText(label,0,0)
  ctx.restore()
}

export default function App(){
  const videoRef=useRef<HTMLVideoElement>(null)
  const canvasRef=useRef<HTMLCanvasElement>(null)
  const landmarkerRef=useRef<HandLandmarker|null>(null)
  const rafRef=useRef<number>(0)
  const cameraStreamRef=useRef<MediaStream|null>(null)
  const engine=useMemo(()=>new OrchestraEngine(),[])
  const recorder=useMemo(()=>new Mp4Recorder(),[])

  const chordCandidate=useRef<{signature:string;since:number}>({signature:'',since:0})
  const activeChordSignature=useRef('')
  const lastHarmonySide=useRef<HarmonySide>('palm')
  const pinchActiveRef=useRef([false,false,false,false])
  const lastSoloUiUpdate=useRef(0)
  const leftMissingSinceRef=useRef<number|null>(null)
  const leftVisibleRef=useRef(false)
  const lastInferenceRef=useRef(0)
  const latestRawHandsRef=useRef<HandData[]>([])
  const lastGestureUiPublishRef=useRef(0)
  const snapLaneIndexRef=useRef<number|null>(null)
  const leftRollSmoothRef=useRef(new EMA(.22))
  const rightRollSmoothRef=useRef(new EMA(.20))
  const [trackingFps,setTrackingFps]=useState(24)

  const [started,setStarted]=useState(false)
  const [cameraError,setCameraError]=useState('')
  const [cameraPreset,setCameraPreset]=useState<CameraPreset>('wide')
  const [cameraInfo,setCameraInfo]=useState('')
  const [hands,setHands]=useState<HandData[]>([])

  const [gestureDegree,setGestureDegree]=useState(0)
  const [currentChord,setCurrentChord]=useState<DegreeChord|null>(null)
  const [chordHeight,setChordHeight]=useState(0)
  const [extensionLevel,setExtensionLevel]=useState<ExtensionLevel>(0)
  const [chordDynamics,setChordDynamics]=useState(.65)
  const [leftRoll,setLeftRoll]=useState(0)
  const [harmonySide,setHarmonySide]=useState<HarmonySide>('palm')
  const [surfaceLabel,setSurfaceLabel]=useState<'PALM'|'BACK'|'EDGE'>('PALM')
  const [invertPalmBack,setInvertPalmBack]=useState(false)
  const [palmBackPolicy,setPalmBackPolicy]=useState<PalmBackPolicy>('automatic')

  const [fingerVoices,setFingerVoices]=useState<SoloName[]>(['violin','cello','piano','flute'])
  const [soloMode,setSoloMode]=useState<SoloMode>('snap')
  const [soloDynamics,setSoloDynamics]=useState(.65)
  const [soloVibrato,setSoloVibrato]=useState(0)
  const [rightRoll,setRightRoll]=useState(0)
  const [soloMidis,setSoloMidis]=useState<Array<number|null>>([null,null,null,null])
  const [soloRawMidi,setSoloRawMidi]=useState(60)
  const [soloLanePosition,setSoloLanePosition]=useState(0)
  const [soloLoading,setSoloLoading]=useState(false)
  const [orchestraMix,setOrchestraMix]=useState(15)
  const [soloMix,setSoloMix]=useState(70)

  const [rootPc,setRootPc]=useState(0)
  const [scale,setScale]=useState<ScaleName>('major')
  const [bpm,setBpm]=useState(92)
  const [performanceMode,setPerformanceMode]=useState<PerformanceMode>('sustain')
  const [meter,setMeter]=useState<MeterName>('4/4')
  const [voiceReverbs,setVoiceReverbs]=useState<Record<string,number>>({})
  const [voiceVolumes,setVoiceVolumes]=useState<Record<string,number>>({})
  const [tab,setTab]=useState<Tab>('chords')
  const [settingsOpen,setSettingsOpen]=useState(false)
  const [lightPlate,setLightPlate]=useState(false)
  const [recording,setRecording]=useState(false)
  const [recordSeconds,setRecordSeconds]=useState(0)
  const [recordCountdown,setRecordCountdown]=useState<number|null>(null)
  const [recordedBlob,setRecordedBlob]=useState<Blob|null>(null)
  const [recordedUrl,setRecordedUrl]=useState('')
  const recordedUrlRef=useRef('')
  const [recordReviewOpen,setRecordReviewOpen]=useState(false)
  const [recordedDuration,setRecordedDuration]=useState(0)
  const [trimStart,setTrimStart]=useState(0)
  const [trimEnd,setTrimEnd]=useState(0)
  const [trimBusy,setTrimBusy]=useState(false)
  const [trimProgress,setTrimProgress]=useState(0)
  const previewVideoRef=useRef<HTMLVideoElement>(null)
  const previewTimerRef=useRef<number|undefined>(undefined)
  const [status,setStatus]=useState('Press START to enable camera + audio')
  const [sampleMode,setSampleMode]=useState<'checking'|'real'|'fallback'>('checking')
  const [publicStats,setPublicStats]=useState<{visits:number;users:number}|null>(null)
  const recordTimer=useRef<number|undefined>(undefined)

  const stateRef=useRef({
    recording,recordSeconds,rootPc,scale,bpm,performanceMode,meter,lightPlate,sampleMode,gestureDegree,
    currentChord,chordHeight,extensionLevel,chordDynamics,leftRoll,
    harmonySide,surfaceLabel,invertPalmBack,palmBackPolicy,
    fingerVoices,soloMode,soloDynamics,soloVibrato,rightRoll,soloMidis,soloRawMidi,soloLanePosition,trackingFps
  })

  useEffect(()=>{
    stateRef.current={
      recording,recordSeconds,rootPc,scale,bpm,performanceMode,meter,lightPlate,sampleMode,gestureDegree,
      currentChord,chordHeight,extensionLevel,chordDynamics,leftRoll,
      harmonySide,surfaceLabel,invertPalmBack,palmBackPolicy,
      fingerVoices,soloMode,soloDynamics,soloVibrato,rightRoll,soloMidis,soloRawMidi,soloLanePosition,trackingFps
    }
  },[
    recording,recordSeconds,rootPc,scale,bpm,performanceMode,meter,lightPlate,sampleMode,gestureDegree,
    currentChord,chordHeight,extensionLevel,chordDynamics,leftRoll,
    harmonySide,surfaceLabel,invertPalmBack,palmBackPolicy,
    fingerVoices,soloMode,soloDynamics,soloVibrato,rightRoll,soloMidis,soloRawMidi,soloLanePosition,trackingFps
  ])

  useEffect(()=>{
    engine.setMixLevels(orchestraMix,soloMix)
  },[engine,orchestraMix,soloMix])

  useEffect(()=>{
    engine.setTempo(bpm)
  },[engine,bpm])

  useEffect(()=>{
    engine.setPulseMeter(meter)
  },[engine,meter])

  useEffect(()=>()=>{
    cancelAnimationFrame(rafRef.current)
    cameraStreamRef.current?.getTracks().forEach(t=>t.stop())
    engine.allOff()
    if(recordedUrlRef.current)URL.revokeObjectURL(recordedUrlRef.current)
    if(previewTimerRef.current)window.clearInterval(previewTimerRef.current)
  },[engine])

  function cameraConstraints(preset:CameraPreset):MediaTrackConstraints{
    if(preset==='wide')return {
      width:{ideal:1280},height:{ideal:720},aspectRatio:{ideal:16/9},facingMode:'user'
    }
    if(preset==='hd')return {
      width:{ideal:1920},height:{ideal:1080},aspectRatio:{ideal:16/9},facingMode:'user'
    }
    return {facingMode:'user'}
  }

  async function openCamera(preset:CameraPreset){
    cameraStreamRef.current?.getTracks().forEach(t=>t.stop())
    const stream=await navigator.mediaDevices.getUserMedia({video:cameraConstraints(preset),audio:false})
    const track=stream.getVideoTracks()[0]

    // If this webcam/browser exposes optical/digital zoom, use its minimum value
    // to maximize the physical field of view.
    try{
      const caps:any=track.getCapabilities?.()
      if(caps?.zoom&&typeof caps.zoom.min==='number'){
        await track.applyConstraints({advanced:[{zoom:caps.zoom.min} as any]})
      }
    }catch{}

    const video=videoRef.current!
    video.srcObject=stream
    await video.play()
    cameraStreamRef.current=stream
    const st:any=track.getSettings?.()||{}
    setCameraInfo(`${st.width||video.videoWidth}×${st.height||video.videoHeight}${st.zoom!==undefined?` · zoom ${st.zoom}`:''}`)
  }

  async function loadPublicStats(){
    try{
      const response=await fetch('/api/stats',{cache:'no-store'})
      if(!response.ok)return
      const data=await response.json()
      if(typeof data.visits==='number'&&typeof data.users==='number'){
        setPublicStats({visits:data.visits,users:data.users})
      }
    }catch{}
  }

  async function countPublicStat(type:'visit'|'use'){
    const storageKey=type==='visit'
      ?'orchestra-gesture-visitor-v1'
      :'orchestra-gesture-user-v1'
    try{
      if(localStorage.getItem(storageKey)==='1'){
        await loadPublicStats()
        return
      }
      const response=await fetch('/api/stats',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({type})
      })
      if(!response.ok)return
      const data=await response.json()
      if(typeof data.visits==='number'&&typeof data.users==='number'){
        setPublicStats({visits:data.visits,users:data.users})
        localStorage.setItem(storageKey,'1')
      }
    }catch{}
  }

  useEffect(()=>{
    void countPublicStat('visit')
  },[])

  async function startApp(){
    try{
      setCameraError('')
      setStatus('Loading audio and orchestra samples…')
      await engine.start()
      setSampleMode(engine.hasRealSamples()?'real':'fallback')

      setStatus('Preloading solo instruments…')
      setSoloLoading(true)
      await engine.prepareSoloVoices(fingerVoices)
      setSoloLoading(false)

      setStatus('Opening wide camera mode…')
      await openCamera(cameraPreset)

      setStatus('Loading hand tracker…')
      const vision=await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      )
      landmarkerRef.current=await HandLandmarker.createFromOptions(vision,{
        baseOptions:{
          modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate:'GPU'
        },
        runningMode:'VIDEO',numHands:2,
        minHandDetectionConfidence:.55,
        minHandPresenceConfidence:.55,
        minTrackingConfidence:.55,
      })

      setStarted(true)
      setStatus('Ready — interactive controls are now clickable')
      void countPublicStat('use')
      renderLoop()
    }catch(e:any){
      setSoloLoading(false)
      setCameraError(e?.message||'Camera/audio could not start.')
      setStatus('Camera blocked or unavailable')
    }
  }

  async function changeCameraPreset(next:CameraPreset){
    setCameraPreset(next)
    if(!started)return
    try{
      setStatus('Changing camera mode…')
      await openCamera(next)
      setStatus('Ready')
    }catch(e:any){
      setStatus(`Camera change failed: ${e?.message||'unknown error'}`)
    }
  }

  async function changeVoice(index:number,name:SoloName){
    const next=[...fingerVoices]
    next[index]=name
    setFingerVoices(next)
    engine.stopSoloFinger(index)
    try{
      setSoloLoading(true)
      await engine.prepareSoloVoice(name)
      const wet=voiceReverbs[name]??engine.getVoiceReverb(name)
      engine.setVoiceReverb(name,wet)

      const level=voiceVolumes[name]??engine.getVoiceVolume(name)
      engine.setVoiceVolume(name,level)
    }finally{
      setSoloLoading(false)
    }
  }

  function changeVoiceReverb(name:SoloName,value:number){
    const wet=clamp01(value)
    setVoiceReverbs(prev=>({...prev,[name]:wet}))
    engine.setVoiceReverb(name,wet)
  }

  function changeVoiceVolume(name:SoloName,value:number){
    const level=Math.max(0,Math.min(1.5,value))
    setVoiceVolumes(prev=>({...prev,[name]:level}))
    engine.setVoiceVolume(name,level)
  }

  function switchPerformanceMode(){
    const next:PerformanceMode=performanceMode==='sustain'?'pulse':'sustain'
    setPerformanceMode(next)
    stateRef.current.performanceMode=next
    if(currentChord&&leftVisibleRef.current){
      if(next==='pulse')engine.playPulseChord(currentChord.midi,.82)
      else engine.playChordMidi(currentChord.midi,.82)
    }
  }

  function resetHarmony(){
    activeChordSignature.current=''
    chordCandidate.current={signature:'',since:0}
    snapLaneIndexRef.current=null
  }

  function renderLoop(){
    const video=videoRef.current
    const canvas=canvasRef.current
    const landmarker=landmarkerRef.current
    if(!video||!canvas||!landmarker)return

    // Native 16:9 canvas. Lower internal resolution substantially reduces
    // MediaPipe + canvas work while looking sharp at normal browser sizes.
    const W=1280,H=720
    canvas.width=W;canvas.height=H
    const ctx=canvas.getContext('2d',{alpha:false})!

    let lastPaint=0
    const draw=(now:number)=>{
      // Cap visual rendering at ~30 fps. The webcam itself can still supply
      // frames independently; this reduces CPU/GPU load and UI jank.
      if(now-lastPaint>=32){
        lastPaint=now

        if(video.readyState>=2){
          const layout=computeContainLayout(video,W,H)

          // Run MediaPipe only at the selected tracking rate (default 24 fps),
          // rather than synchronously on every requestAnimationFrame.
          const inferenceInterval=1000/Math.max(12,stateRef.current.trackingFps)
          if(now-lastInferenceRef.current>=inferenceInterval){
            const result=landmarker.detectForVideo(video,now)
            latestRawHandsRef.current=result.landmarks.map((lm,i)=>({
              handedness:(result.handednesses[i]?.[0]?.categoryName||'Left') as 'Left'|'Right',
              landmarks:lm
            }))
            lastInferenceRef.current=now
            processHands(latestRawHandsRef.current,now)
          }

          const rawHands=latestRawHandsRef.current
          const displayHands=rawHands.map(h=>mapHandForMirror(h,layout))

          ctx.fillStyle='#020305';ctx.fillRect(0,0,W,H)
          ctx.save()
          ctx.translate(W,0);ctx.scale(-1,1)
          ctx.drawImage(video,W-(layout.dx+layout.dw),layout.dy,layout.dw,layout.dh)
          ctx.restore()

          if(!stateRef.current.lightPlate){
            ctx.fillStyle='rgba(3,6,11,.24)';ctx.fillRect(0,0,W,H)
          }

          const du=new DrawingUtils(ctx)
          displayHands.forEach(hand=>{
            const left=hand.handedness==='Left'
            du.drawConnectors(hand.landmarks,HandLandmarker.HAND_CONNECTIONS,{
              color:left?'#72b8ee':'#e2b856',lineWidth:2
            })
            du.drawLandmarks(hand.landmarks,{
              color:'#fff',fillColor:left?'#18364e':'#493819',radius:2.5
            })
          })

          // Maintain real sample layers only while the chord hand is visible.
          if(leftVisibleRef.current)engine.maintainChord()
          drawHUD(ctx,W,H,displayHands)
        }
      }

      rafRef.current=requestAnimationFrame(draw)
    }
    cancelAnimationFrame(rafRef.current)
    rafRef.current=requestAnimationFrame(draw)
  }

  function processHands(parsed:HandData[],now=performance.now()){
    const s=stateRef.current
    const left=parsed.find(h=>h.handedness==='Left')
    const right=parsed.find(h=>h.handedness==='Right')

    // ------------------------------------------------------------
    // LEFT: orchestra. If hand leaves frame, release after a short
    // tracking grace period. This avoids stuck chords while tolerating
    // one or two missed MediaPipe frames.
    // ------------------------------------------------------------
    if(left){
      leftVisibleRef.current=true
      leftMissingSinceRef.current=null

      const lm=left.landmarks
      const degree=chordGestureDegree(lm)
      const height=verticalPerformanceAmount(lm)
      const ext=extensionLevelFromAmount(height)
      const dyn=lateralDynamics(lm,'Left')
      const roll=leftRollSmoothRef.current.next(wristRoll(lm))
      const detected=palmSurface(lm,'Left')

      let detectedSide:HarmonySide=lastHarmonySide.current
      if(detected.side==='palm'||detected.side==='back'){
        detectedSide=detected.side
        if(s.invertPalmBack)detectedSide=detectedSide==='palm'?'back':'palm'
        if(detected.confidence>.18)lastHarmonySide.current=detectedSide
      }
      const side=s.palmBackPolicy==='same'?'palm':detectedSide
      const effectiveScale=s.palmBackPolicy==='same'
        ? s.scale
        : harmonyScaleForSide(s.scale,side)

      // Update the fast canvas-facing ref immediately.
      stateRef.current.gestureDegree=degree
      stateRef.current.chordHeight=height
      stateRef.current.extensionLevel=ext
      stateRef.current.chordDynamics=dyn
      stateRef.current.leftRoll=roll
      stateRef.current.harmonySide=side
      stateRef.current.surfaceLabel=detected.side==='edge'?'EDGE':side==='palm'?'PALM':'BACK'

      engine.setChordDynamics(dyn)
      engine.setReverb((roll+90)/180)

      const signature=degree>=1?`${degree}|${ext}|${effectiveScale}`:isFist(lm)?'FIST':'NONE'
      if(chordCandidate.current.signature!==signature){
        chordCandidate.current={signature,since:now}
      }

      if(now-chordCandidate.current.since>165){
        if(degree>=1&&degree<=7&&activeChordSignature.current!==signature){
          const chord=buildDegreeChord(s.rootPc,effectiveScale,degree,ext)
          if(s.performanceMode==='pulse')engine.playPulseChord(chord.midi,.82)
          else engine.playChordMidi(chord.midi,.82)
          stateRef.current.currentChord=chord
          setCurrentChord(chord)
          activeChordSignature.current=signature
        }else if(signature==='FIST'&&activeChordSignature.current){
          engine.releaseChord()
          stateRef.current.currentChord=null
          setCurrentChord(null)
          activeChordSignature.current=''
        }
      }

      // React DOM updates only ~10 fps; the canvas gets values directly from stateRef.
      if(now-lastGestureUiPublishRef.current>95){
        setGestureDegree(degree)
        setChordHeight(height)
        setExtensionLevel(ext)
        setChordDynamics(dyn)
        setLeftRoll(roll)
        setHarmonySide(side)
        setSurfaceLabel(stateRef.current.surfaceLabel)
      }
    }else{
      if(leftMissingSinceRef.current===null)leftMissingSinceRef.current=now
      if(now-leftMissingSinceRef.current>160){
        leftVisibleRef.current=false
        stateRef.current.gestureDegree=0
        if(activeChordSignature.current){
          engine.releaseChord()
          activeChordSignature.current=''
          chordCandidate.current={signature:'',since:now}
          stateRef.current.currentChord=null
          setCurrentChord(null)
        }
        if(now-lastGestureUiPublishRef.current>95)setGestureDegree(0)
      }
    }

    // ------------------------------------------------------------
    // RIGHT: 14 wide SCALE-note lanes in snap mode.
    // A lane-change hysteresis prevents tiny hand movements changing note.
    // ------------------------------------------------------------
    if(right){
      const lm=right.landmarks
      const center=handCenter(lm)
      const dyn=lateralDynamics(lm,'Right')
      const roll=rightRollSmoothRef.current.next(wristRoll(lm))
      const vibrato=clamp01(Math.abs(roll)/88)
      const activeScale=stateRef.current.currentChord?.scale||s.scale
      const lanes=buildScaleMidiLanes(s.rootPc,activeScale,14)

      const normalized=clamp01((.85-center.y)/.70)
      const laneFloat=normalized*(lanes.length-1)

      // Wide-lane hysteresis: cross roughly 65% into the neighboring lane
      // before SNAP changes pitch.
      let laneIndex=snapLaneIndexRef.current
      if(laneIndex===null){
        laneIndex=Math.round(laneFloat)
      }else{
        while(laneFloat>laneIndex+.65&&laneIndex<lanes.length-1)laneIndex++
        while(laneFloat<laneIndex-.65&&laneIndex>0)laneIndex--
      }
      laneIndex=Math.max(0,Math.min(lanes.length-1,laneIndex))
      snapLaneIndexRef.current=laneIndex

      const low=lanes[0]
      const high=lanes[lanes.length-1]
      const rawMidi=low+normalized*(high-low)
      const snapped=lanes[laneIndex]

      stateRef.current.soloRawMidi=rawMidi
      stateRef.current.soloLanePosition=s.soloMode==='snap'?laneIndex:laneFloat
      stateRef.current.soloDynamics=dyn
      stateRef.current.soloVibrato=vibrato
      stateRef.current.rightRoll=roll

      engine.setSoloDynamics(dyn)
      engine.setSoloVibrato(vibrato)

      const nextMidis:Array<number|null>=[null,null,null,null]
      for(let fi=0;fi<FINGERS.length;fi++){
        const strength=pinchStrength(lm,FINGERS[fi])
        const was=pinchActiveRef.current[fi]

        // Easier, faster pinch engagement than V1.1, with strong hysteresis
        // to prevent fluttering and stuck/retriggered notes.
        const active=was?strength>.33:strength>.58
        pinchActiveRef.current[fi]=active

        if(active){
          if(s.soloMode==='snap'){
            const ok=engine.updateSoloSnap(fi,s.fingerVoices[fi],snapped,Math.max(.82,dyn))
            nextMidis[fi]=ok?snapped:null
          }else{
            engine.updateSoloGlide(fi,s.fingerVoices[fi],rawMidi,Math.max(.75,dyn))
            nextMidis[fi]=rawMidi
          }
        }else{
          engine.stopSoloFinger(fi)
        }
      }

      stateRef.current.soloMidis=nextMidis
      engine.setSoloPresence(nextMidis.some(m=>m!==null))

      if(now-lastSoloUiUpdate.current>90){
        setRightRoll(roll)
        setSoloDynamics(dyn)
        setSoloVibrato(vibrato)
        setSoloRawMidi(rawMidi)
        setSoloLanePosition(stateRef.current.soloLanePosition)
        setSoloMidis(nextMidis)
        lastSoloUiUpdate.current=now
      }
    }else{
      pinchActiveRef.current=[false,false,false,false]
      snapLaneIndexRef.current=null
      engine.stopAllSolo()
      engine.setSoloPresence(false)
      stateRef.current.soloMidis=[null,null,null,null]
      if(now-lastSoloUiUpdate.current>120){
        setSoloMidis([null,null,null,null])
        lastSoloUiUpdate.current=now
      }
    }

    if(now-lastGestureUiPublishRef.current>95){
      setHands(parsed)
      lastGestureUiPublishRef.current=now
    }
  }

  function drawPitchKeyboard(
    ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,
    chord:DegreeChord|null,root:number,scaleName:ScaleName,
    active:Array<number|null>,lanePosition:number,mode:SoloMode
  ){
    const activeScale=chord?.scale||scaleName
    const lanes=buildScaleMidiLanes(root,activeScale,14)
    const rows=lanes.length
    const rowH=h/rows
    const chordPcs=new Set(chord?.pitchClasses||[])

    ctx.save()
    ctx.font='800 9px ui-monospace,Consolas,monospace'

    // Highest note at the top.
    lanes.slice().reverse().forEach((midi,visualIndex)=>{
      const pc=((midi%12)+12)%12
      const yy=y+visualIndex*rowH
      const chordTone=chordPcs.has(pc)

      ctx.fillStyle=chordTone
        ?'rgba(229,188,91,.43)'
        :visualIndex%2===0?'rgba(91,151,202,.21)':'rgba(255,255,255,.075)'
      ctx.fillRect(x,yy,w,rowH-2)

      ctx.fillStyle=chordTone?'#f7db92':'rgba(255,255,255,.60)'
      ctx.textAlign='left'
      ctx.fillText(midiToNote(midi),x+7,yy+rowH/2+3)
    })

    ctx.strokeStyle='rgba(255,255,255,.27)'
    ctx.strokeRect(x,y,w,h)

    const pos=Math.max(0,Math.min(rows-1,lanePosition))
    const markerY=y+(rows-1-pos)*rowH+rowH/2
    ctx.strokeStyle='#fff2bd';ctx.lineWidth=2
    ctx.beginPath();ctx.moveTo(x-12,markerY);ctx.lineTo(x+w+12,markerY);ctx.stroke()

    active.forEach((m,fi)=>{
      if(m===null)return
      // Find nearest lane for the active marker.
      let best=0,bestD=Infinity
      lanes.forEach((lm,i)=>{
        const d=Math.abs(lm-m)
        if(d<bestD){best=i;bestD=d}
      })
      const yy=y+(rows-1-best)*rowH+rowH/2
      ctx.fillStyle='#fff3c4';ctx.beginPath();ctx.arc(x+w-14,yy,7,0,Math.PI*2);ctx.fill()
      ctx.fillStyle='#0a0d12';ctx.textAlign='center';ctx.font='800 8px ui-monospace,Consolas,monospace'
      ctx.fillText(FINGER_LABELS[fi],x+w-14,yy+3)
    })

    ctx.textAlign='center'
    ctx.fillStyle='rgba(255,255,255,.65)'
    ctx.font='800 10px ui-monospace,Consolas,monospace'
    ctx.fillText(mode==='snap'?'14 NOTES · WIDE SNAP':'14 NOTES · CONTINUOUS GLIDE',x+w/2,y-11)
    ctx.restore()
  }

  function drawExtensionIndicator(
    ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,
    amount:number,level:ExtensionLevel
  ){
    const zones=5,zh=h/zones
    ctx.save()
    for(let i=0;i<zones;i++){
      const idx=zones-1-i,yy=y+i*zh,on=idx===level
      ctx.fillStyle=on?'rgba(112,176,225,.30)':'rgba(255,255,255,.055)'
      ctx.fillRect(x,yy,w,zh-2)
      ctx.strokeStyle=on?'rgba(133,194,239,.9)':'rgba(255,255,255,.12)';ctx.strokeRect(x,yy,w,zh-2)
      ctx.fillStyle=on?'#d7efff':'rgba(255,255,255,.45)'
      ctx.font='800 9px ui-monospace,Consolas,monospace';ctx.textAlign='center'
      ctx.fillText(EXTENSION_LABELS[idx],x+w/2,yy+zh/2+3)
    }
    const markerY=y+h*(1-clamp01(amount))
    ctx.strokeStyle='#fff5d0';ctx.lineWidth=2
    ctx.beginPath();ctx.moveTo(x-7,markerY);ctx.lineTo(x+w+7,markerY);ctx.stroke()
    ctx.translate(x-13,y+h/2);ctx.rotate(-Math.PI/2)
    ctx.fillStyle='rgba(255,255,255,.55)';ctx.font='9px ui-monospace,Consolas,monospace'
    ctx.textAlign='center';ctx.fillText('HAND HEIGHT / HARMONY',0,0)
    ctx.restore()
  }

  function drawHUD(ctx:CanvasRenderingContext2D,W:number,H:number,displayHands:HandData[]){
    const s=stateRef.current
    const current=s.currentChord
    const effectiveScale=current?.scale||harmonyScaleForSide(s.scale,s.harmonySide)
    const matrix=buildGestureChordMatrix(s.rootPc,effectiveScale)
    const left=displayHands.find(h=>h.handedness==='Left')
    const right=displayHands.find(h=>h.handedness==='Right')

    ctx.save()
    ctx.globalAlpha=.06;ctx.strokeStyle='#f0d9a0'
    for(let yy=0;yy<H;yy+=5){ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(W,yy);ctx.stroke()}
    ctx.globalAlpha=1

    ctx.fillStyle='rgba(2,5,10,.58)';ctx.fillRect(0,0,W,67)
    ctx.strokeStyle='rgba(232,207,145,.28)';ctx.beginPath();ctx.moveTo(20,66);ctx.lineTo(W-20,66);ctx.stroke()
    ctx.textAlign='left';ctx.fillStyle='rgba(255,255,255,.67)';ctx.font='10px ui-monospace,Consolas,monospace'
    ctx.fillText(`KEY ${KEY_OPTIONS.find(k=>k.pc===s.rootPc)?.label}`,350,27)
    ctx.fillText(`SCALE ${scaleLabel(s.scale).toUpperCase()}`,505,27)
    ctx.fillText(`SOLO ${s.soloMode.toUpperCase()}`,760,27)
    ctx.fillText(`AUDIO ${s.sampleMode==='real'?'ORCHESTRA WAV':'FALLBACK'}`,915,27)

    const lp={x:25,y:92,w:305,h:570}
    ctx.fillStyle='rgba(2,6,11,.45)';ctx.fillRect(lp.x,lp.y,lp.w,lp.h)
    ctx.strokeStyle='rgba(111,177,226,.42)';ctx.strokeRect(lp.x,lp.y,lp.w,lp.h)
    ctx.fillStyle='#a8d7f7';ctx.font='800 13px ui-monospace,Consolas,monospace';ctx.fillText('L / ORCHESTRA',lp.x+13,lp.y+22)

    matrix.forEach((c,i)=>{
      const yy=lp.y+59+i*38,on=i+1===s.gestureDegree
      if(on){ctx.fillStyle='rgba(99,167,218,.20)';ctx.fillRect(lp.x+10,yy-17,170,27)}
      ctx.fillStyle=on?'#dff2ff':'rgba(255,255,255,.64)';ctx.font='800 10px ui-monospace,Consolas,monospace'
      ctx.fillText(ROMAN[i],lp.x+18,yy);ctx.fillText(c.label,lp.x+62,yy)
      ctx.fillStyle='rgba(255,255,255,.36)';ctx.fillText(['INDEX','2 FINGERS','3 FINGERS','4 FINGERS','ALL 5','I+PINKY','THUMB+I+P'][i],lp.x+123,yy)
    })

    ctx.fillStyle=s.surfaceLabel==='PALM'?'#d8ecff':s.surfaceLabel==='BACK'?'#f3d18b':'#aaa'
    ctx.font='800 11px ui-monospace,Consolas,monospace'
    ctx.fillText(`${s.surfaceLabel} → ${scaleLabel(effectiveScale).toUpperCase()}`,lp.x+13,lp.y+348)
    ctx.fillStyle='rgba(255,255,255,.43)';ctx.font='9px ui-monospace,Consolas,monospace'
    ctx.fillText('FIST = RELEASE',lp.x+13,lp.y+370)
    ctx.fillText('OUTWARD = LOUDER',lp.x+13,lp.y+388)
    ctx.fillText('WRIST ROLL = SPACE',lp.x+13,lp.y+406)
    drawVerticalMeter(ctx,lp.x+18,lp.y+446,12,65,s.chordDynamics,'CHORD VOL')
    drawDial(ctx,lp.x+105,lp.y+479,29,s.leftRoll,-90,90,'ROLL / SPACE')

    drawExtensionIndicator(ctx,lp.x+lp.w+26,145,77,430,s.chordHeight,s.extensionLevel)

    const cx=W/2
    ctx.fillStyle='rgba(1,4,8,.38)';ctx.fillRect(cx-185,92,370,118)
    ctx.strokeStyle='rgba(235,208,139,.24)';ctx.strokeRect(cx-185,92,370,118)
    ctx.textAlign='center';ctx.fillStyle='#fff7df';ctx.font='800 44px ui-monospace,Consolas,monospace'
    ctx.fillText(current?.label||'—',cx,144)
    ctx.fillStyle='rgba(255,255,255,.70)';ctx.font='10px ui-monospace,Consolas,monospace'
    ctx.fillText(current?current.midi.map(midiToNote).join('   '):'MAKE A LEFT-HAND CHORD GESTURE',cx,172)
    ctx.fillStyle='rgba(232,203,129,.68)'
    ctx.fillText(`${current?.roman||'—'} · ${EXTENSION_LABELS[s.extensionLevel]} · ${s.surfaceLabel}`,cx,194)

    const rp={x:W-325,y:92,w:300,h:570}
    ctx.fillStyle='rgba(2,6,11,.45)';ctx.fillRect(rp.x,rp.y,rp.w,rp.h)
    ctx.strokeStyle='rgba(229,184,92,.42)';ctx.strokeRect(rp.x,rp.y,rp.w,rp.h)
    ctx.textAlign='left';ctx.fillStyle='#efd18b';ctx.font='800 13px ui-monospace,Consolas,monospace';ctx.fillText('R / SOLOIST',rp.x+13,rp.y+22)
    ctx.fillStyle='rgba(255,255,255,.52)';ctx.font='9px ui-monospace,Consolas,monospace'
    ctx.fillText('PINCH = VOICE · HAND HEIGHT = PITCH',rp.x+13,rp.y+42)

    s.fingerVoices.forEach((voice,i)=>{
      const yy=rp.y+74+i*43,m=s.soloMidis[i]
      ctx.fillStyle=m!==null?'#fff0bd':'rgba(255,255,255,.58)';ctx.font='800 10px ui-monospace,Consolas,monospace'
      ctx.fillText(`${FINGER_LABELS[i]} / ${voice.toUpperCase()}`,rp.x+13,yy)
      ctx.textAlign='right';ctx.fillText(m!==null?(s.soloMode==='snap'?midiToNote(m):m.toFixed(1)):'—',rp.x+278,yy);ctx.textAlign='left'
    })
    ctx.fillStyle=s.soloMode==='snap'?'#b8dbf4':'#f1cf84';ctx.font='800 12px ui-monospace,Consolas,monospace'
    ctx.fillText(`${s.soloMode.toUpperCase()} MODE`,rp.x+13,rp.y+265)
    ctx.fillStyle='rgba(255,255,255,.43)';ctx.font='9px ui-monospace,Consolas,monospace'
    ctx.fillText('OUTWARD = LOUDER',rp.x+13,rp.y+290)
    ctx.fillText('WRIST ROLL = VIBRATO',rp.x+13,rp.y+308)
    ctx.fillText('GOLD LANES = CURRENT CHORD TONES',rp.x+13,rp.y+326)
    drawVerticalMeter(ctx,rp.x+18,rp.y+366,12,75,s.soloDynamics,'SOLO VOL')
    drawDial(ctx,rp.x+110,rp.y+405,31,s.rightRoll,-90,90,'ROLL')
    drawVerticalMeter(ctx,rp.x+205,rp.y+366,12,75,s.soloVibrato,'VIBRATO')

    drawPitchKeyboard(ctx,rp.x-176,128,146,500,current,s.rootPc,s.scale,s.soloMidis,s.soloLanePosition,s.soloMode)

    if(left){
      const p=left.landmarks[0];ctx.textAlign='left';ctx.fillStyle='#a9dbff';ctx.font='800 10px ui-monospace,Consolas,monospace'
      ctx.fillText('L / ORCHESTRA',Math.max(15,p.x*W-48),Math.max(80,p.y*H+20))
    }
    if(right){
      const p=right.landmarks[0];ctx.textAlign='left';ctx.fillStyle='#f1d287';ctx.font='800 10px ui-monospace,Consolas,monospace'
      ctx.fillText('R / SOLO',Math.max(15,p.x*W-34),Math.max(80,p.y*H+20))
    }

    ctx.fillStyle='rgba(2,5,10,.64)';ctx.fillRect(0,H-72,W,72)
    ctx.fillStyle='rgba(255,255,255,.45)';ctx.font='9px ui-monospace,Consolas,monospace';ctx.textAlign='left'
    ctx.fillText('L: SHAPE=DEGREE · HEIGHT=EXTENSION · PALM/BACK=HARMONY · X=VOLUME · ROLL=SPACE',24,H-44)
    ctx.fillText('R: PINCH=VOICE · HAND HEIGHT=PITCH · X=VOLUME · ROLL=VIBRATO',820,H-44)

    if(s.sampleMode==='fallback'){
      ctx.fillStyle='rgba(158,77,44,.88)';ctx.fillRect(cx-160,222,320,24)
      ctx.textAlign='center';ctx.fillStyle='#fff3e7';ctx.font='800 9px ui-monospace,Consolas,monospace'
      ctx.fillText('SYNTH FALLBACK — RUN npm run import:samples',cx,238)
    }
    if(s.recording){
      ctx.fillStyle='#ff5968';ctx.beginPath();ctx.arc(W-75,34,7,0,Math.PI*2);ctx.fill()
      ctx.textAlign='left';ctx.fillStyle='#fff';ctx.font='800 11px ui-monospace,Consolas,monospace';ctx.fillText(`REC ${s.recordSeconds}s`,W-59,38)
    }
    ctx.restore()
  }

  function setRecordedPreview(blob:Blob){
    if(recordedUrlRef.current)URL.revokeObjectURL(recordedUrlRef.current)
    const url=URL.createObjectURL(blob)
    recordedUrlRef.current=url
    setRecordedBlob(blob)
    setRecordedUrl(url)
    setRecordedDuration(0)
    setTrimStart(0)
    setTrimEnd(0)
    setTrimProgress(0)
    setRecordReviewOpen(true)
  }

  async function beginRecordingAfterCountdown(){
    if(recording||recordCountdown!==null)return
    const canvas=canvasRef.current
    if(!canvas)return

    setSettingsOpen(false)
    try{
      for(const n of [3,2,1]){
        setRecordCountdown(n)
        await new Promise(resolve=>window.setTimeout(resolve,1000))
      }
      setRecordCountdown(null)

      await recorder.start(canvas,engine.getRecordingAudioTrack(),30)
      setRecording(true)
      setRecordSeconds(0)
      const began=Date.now()
      recordTimer.current=window.setInterval(
        ()=>setRecordSeconds(Math.floor((Date.now()-began)/1000)),
        250
      )
    }catch(e:any){
      setRecordCountdown(null)
      alert(e?.message||'Could not start MP4 recording.')
    }
  }

  async function stopRecording(){
    if(!recording)return
    try{
      if(recordTimer.current)clearInterval(recordTimer.current)
      const blob=await recorder.stop()
      setRecordedPreview(blob)
    }catch(e:any){
      alert(e?.message||'Could not finish MP4.')
    }finally{
      setRecording(false)
    }
  }

  async function toggleRecording(){
    if(recording)await stopRecording()
    else await beginRecordingAfterCountdown()
  }

  function onPreviewMetadata(){
    const video=previewVideoRef.current
    if(!video)return
    const duration=Number.isFinite(video.duration)?video.duration:0
    setRecordedDuration(duration)
    setTrimStart(0)
    setTrimEnd(duration)
  }

  function previewSelection(){
    const video=previewVideoRef.current
    if(!video||trimEnd<=trimStart)return
    if(previewTimerRef.current)window.clearInterval(previewTimerRef.current)

    video.currentTime=trimStart
    void video.play()
    previewTimerRef.current=window.setInterval(()=>{
      if(video.currentTime>=trimEnd||video.ended){
        video.pause()
        if(previewTimerRef.current)window.clearInterval(previewTimerRef.current)
        previewTimerRef.current=undefined
      }
    },50)
  }

  function markTrimStart(){
    const t=previewVideoRef.current?.currentTime ?? 0
    setTrimStart(Math.max(0,Math.min(t,Math.max(0,trimEnd-.1))))
  }

  function markTrimEnd(){
    const t=previewVideoRef.current?.currentTime ?? recordedDuration
    setTrimEnd(Math.min(recordedDuration,Math.max(t,trimStart+.1)))
  }

  function resetTrim(){
    setTrimStart(0)
    setTrimEnd(recordedDuration)
  }

  async function exportTrimmed(){
    if(!recordedBlob||trimEnd<=trimStart)return
    try{
      setTrimBusy(true)
      setTrimProgress(0)
      const trimmed=await trimMp4(
        recordedBlob,
        trimStart,
        trimEnd,
        p=>setTrimProgress(Math.round(p*100))
      )
      downloadBlob(
        trimmed,
        `orchestra-performance-trimmed-${new Date().toISOString().replace(/[:.]/g,'-')}.mp4`
      )
      setTrimProgress(100)
    }catch(e:any){
      alert(e?.message||'Could not export the trimmed MP4.')
    }finally{
      setTrimBusy(false)
    }
  }

  function closeRecordReview(){
    previewVideoRef.current?.pause()
    setRecordReviewOpen(false)
  }

  function fmtTime(seconds:number){
    if(!Number.isFinite(seconds))return '0:00.0'
    const m=Math.floor(seconds/60)
    const s=seconds-m*60
    return `${m}:${s.toFixed(1).padStart(4,'0')}`
  }

  return <div className={`app ${lightPlate?'light-plate':''}`}>
    <div className="topbar">
      <div>
        <div className="brand">ORCHESTRA / GESTURE <span className="version">V1.1</span></div>
        <div className="status">{sampleMode==='real'?'ORCHESTRA WAV':'SYNTH FALLBACK'} · SOLO {soloLoading?'LOADING':'READY'} {cameraInfo&&`· ${cameraInfo}`}</div>
      </div>
      <div className="top-actions">
        <button
          className={recording?'record active':'record'}
          onClick={()=>void toggleRecording()}
          disabled={!started||recordCountdown!==null||trimBusy}
        >
          {recording?'■ STOP RECORDING':recordCountdown!==null?`${recordCountdown}…`:'● RECORD'}
        </button>
        <a className="top-link" href="/docs.html" target="_blank" rel="noreferrer">USER GUIDE ↗</a>
        <button onClick={()=>setSettingsOpen(v=>!v)}>⚙ SETTINGS</button>
      </div>
    </div>

    <main className="stage-wrap">
      <video ref={videoRef} className="hidden-video" playsInline muted/>
      <canvas ref={canvasRef} className="stage"/>

      {recordCountdown!==null&&<div className="countdown-overlay" aria-live="assertive">
        <div className="countdown-number">{recordCountdown}</div>
        <div className="countdown-label">GET READY</div>
      </div>}

      {!started&&<div className="start-overlay">
        <h1>Conduct the orchestra. Perform the solo.</h1>
        <p>Full-window 16:9 performance view · cinematic orchestra + solo.</p>
        <button className="start" onClick={startApp}>START CAMERA + AUDIO</button>
        {cameraError&&<div className="error">{cameraError}</div>}
      </div>}

      {publicStats&&<div
        className="public-stats"
        title="Approximate unique browsers. Clearing browser data or using another device can count again."
      >
        <span>VISITORS <b>{publicStats.visits.toLocaleString()}</b></span>
        <i>·</i>
        <span>USED <b>{publicStats.users.toLocaleString()}</b></span>
      </div>}
    </main>

    <section className="control-deck">
      <label>Key
        <select value={rootPc} onChange={e=>{setRootPc(+e.target.value);resetHarmony()}}>
          {KEY_OPTIONS.map(k=><option value={k.pc} key={k.pc}>{k.label}</option>)}
        </select>
      </label>
      <label>Scale
        <select value={scale} onChange={e=>{setScale(e.target.value as ScaleName);resetHarmony()}}>
          {SCALE_OPTIONS.map(s=><option value={s.value} key={s.value}>{s.label}</option>)}
        </select>
      </label>
      <label>BPM<input type="number" min="40" max="220" value={bpm} onChange={e=>setBpm(+e.target.value)}/></label>
      <label>Meter
        <select value={meter} onChange={e=>setMeter(e.target.value as MeterName)} disabled={performanceMode==='sustain'}>
          {(Object.keys(METER_SPECS) as MeterName[]).map(m=><option value={m} key={m}>{METER_SPECS[m].label}</option>)}
        </select>
      </label>
      <button className={`pulse-switch ${performanceMode}`} onClick={switchPerformanceMode}>
        {performanceMode==='pulse'?'⚡ ORCHESTRAL PULSE ON':'○ SUSTAIN MODE'}
      </button>
      <button className={`mode-switch ${soloMode}`} onClick={()=>{
        engine.stopAllSolo();pinchActiveRef.current=[false,false,false,false];snapLaneIndexRef.current=null
        setSoloMode(m=>m==='snap'?'glide':'snap')
      }}>{soloMode==='snap'?'♬ SNAP TO NOTES':'〰 GLIDE / THEREMIN'}</button>
      <button onClick={()=>setLightPlate(v=>!v)}>{lightPlate?'DARK SCRIM':'LIGHT PLATE'}</button>
    </section>

    <section className="performance-guide">
      <div><b>LEFT</b><span>Shape: chord</span><span>Height: triad→13th</span><span>Horizontal: volume</span><span>Roll: space</span></div>
      <div><b>RIGHT</b><span>Pinch: voice</span><span>Hand height: pitch</span><span>Horizontal: volume</span><span>Roll: vibrato</span></div>
      <div><b>SOLO</b><span>14 scale notes · wide lanes</span><span>Gold: chord tones</span><span>Blue: scale tones</span><span>{soloLoading?'Loading samples…':'Samples ready'}</span></div>
    </section>

    {settingsOpen&&<aside className="settings">
      <div className="tabs">
        {(['chords','melody','rhythm','sound','camera','recording','about'] as Tab[]).map(t=><button className={tab===t?'selected':''} key={t} onClick={()=>setTab(t)}>{t}</button>)}
      </div>

      {tab==='chords'&&<div className="panel">
        <h2>Chord controls</h2>
        <div className="settings-grid">
          <label>Key
            <select value={rootPc} onChange={e=>{setRootPc(+e.target.value);resetHarmony()}}>
              {KEY_OPTIONS.map(k=><option value={k.pc} key={k.pc}>{k.label}</option>)}
            </select>
          </label>
          <label>Scale
            <select value={scale} onChange={e=>{setScale(e.target.value as ScaleName);resetHarmony()}}>
              {SCALE_OPTIONS.map(s=><option value={s.value} key={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label>Palm/back behavior
            <select value={palmBackPolicy} onChange={e=>{setPalmBackPolicy(e.target.value as PalmBackPolicy);resetHarmony()}}>
              <option value="automatic">Palm selected / back opposite</option>
              <option value="same">Both use selected scale</option>
            </select>
          </label>
          <label className="check-row"><input type="checkbox" checked={invertPalmBack} onChange={e=>{setInvertPalmBack(e.target.checked);resetHarmony()}}/> Swap palm/back detector</label>
        </div>
        <p>Use “Swap palm/back detector” if your camera reports the surfaces opposite to what you physically show.</p>
        <div className="matrix">
          {buildGestureChordMatrix(rootPc,harmonyScaleForSide(scale,harmonySide)).map((c,i)=><div className="matrix-cell" key={i}><b>{ROMAN[i]}</b><span>{c.label}</span></div>)}
        </div>
      </div>}

      {tab==='melody'&&<div className="panel">
        <h2>Solo controls</h2>
        <p>The right-hand CENTER height controls pitch. Pinching selects which voice sounds. This is intentionally different from V0.4, where each fingertip position made the pitch lane cramped.</p>
        {['Index','Middle','Ring','Pinky'].map((label,i)=><div className="row" key={label}>
          <span>{label}</span>
          <select value={fingerVoices[i]} onChange={e=>void changeVoice(i,e.target.value as SoloName)}>
            {SOLO_OPTIONS.map(v=><option key={v.value} value={v.value}>{v.label}{engine.isPremiumVoice(v.value)?' · PROCESSED':engine.isFolkSampled(v.value)?' · SAMPLED':engine.isVoiceSampled(v.value)?' · WAV':''}</option>)}
          </select>
          <label className="voice-volume">Volume <b>{Math.round((voiceVolumes[fingerVoices[i]]??engine.getVoiceVolume(fingerVoices[i]))*100)}%</b>
            <input type="range" min="0" max="150"
              value={Math.round((voiceVolumes[fingerVoices[i]]??engine.getVoiceVolume(fingerVoices[i]))*100)}
              onChange={e=>changeVoiceVolume(fingerVoices[i],+e.target.value/100)}/>
          </label>
          <label className="voice-reverb">Reverb <b>{Math.round((voiceReverbs[fingerVoices[i]]??engine.getVoiceReverb(fingerVoices[i]))*100)}%</b>
            <input type="range" min="0" max="100"
              value={Math.round((voiceReverbs[fingerVoices[i]]??engine.getVoiceReverb(fingerVoices[i]))*100)}
              onChange={e=>changeVoiceReverb(fingerVoices[i],+e.target.value/100)}/>
          </label>
          <span>{soloMidis[i]===null?'—':soloMode==='snap'?midiToNote(soloMidis[i]!):soloMidis[i]!.toFixed(1)}</span>
        </div>)}
        <button className="wide-button" onClick={()=>{
          engine.stopAllSolo();pinchActiveRef.current=[false,false,false,false];snapLaneIndexRef.current=null
          setSoloMode(m=>m==='snap'?'glide':'snap')
        }}>{soloMode==='snap'?'Switch to continuous glide':'Switch to snapped notes'}</button>
      </div>}

      {tab==='rhythm'&&<div className="panel">
        <h2>Orchestral Pulse</h2>
        <p><strong>Sustain</strong> keeps the current long-held chord behavior. <strong>Orchestral Pulse</strong> turns the current hand chord into a tempo-synchronised accompaniment played with REAL sampled orchestral articulations.</p>
        <div className="settings-grid">
          <label>Performance mode
            <select value={performanceMode} onChange={e=>{
              const next=e.target.value as PerformanceMode
              if(next!==performanceMode)switchPerformanceMode()
            }}>
              <option value="sustain">Sustain</option>
              <option value="pulse">Orchestral Pulse</option>
            </select>
          </label>
          <label>Time signature
            <select value={meter} onChange={e=>setMeter(e.target.value as MeterName)}>
              {(Object.keys(METER_SPECS) as MeterName[]).map(m=><option value={m} key={m}>{METER_SPECS[m].label}</option>)}
            </select>
          </label>
          <label>BPM
            <input type="number" min="40" max="220" value={bpm} onChange={e=>setBpm(+e.target.value)}/>
          </label>
        </div>
        <p>The pulse follows the chord currently selected by the left hand and stops immediately on a fist or when the left hand leaves the camera. Odd meters use explicit groupings such as 5/8 = 2+3 and 7/8 = 2+2+3.</p>
        <p>No copyrighted soundtrack audio is included. The accompaniment uses real VSCO sample articulations and original chord-following orchestration patterns.</p>
      </div>}

      {tab==='sound'&&<div className="panel">
        <h2>Mix & expression</h2>
        <div className="mix-controls">
          <label>Orchestra mix <b>{orchestraMix}%</b>
            <input type="range" min="0" max="100" value={orchestraMix}
              onChange={e=>setOrchestraMix(+e.target.value)}/>
          </label>
          <label>Solo mix <b>{soloMix}%</b>
            <input type="range" min="0" max="100" value={soloMix}
              onChange={e=>setSoloMix(+e.target.value)}/>
          </label>
        </div>
        <p>Orchestra mix and Solo mix are final output faders. V1.1 starts at Orchestra 15% and Solo 70%; move either slider down or up to change that bus's final master level without changing the hand-expression mapping.</p>
        <p>Left horizontal position = chord volume; left roll = hall space. Right horizontal position = solo volume; right roll = vibrato.</p>
        <p>Solo WAV instruments are preloaded before performance, so a pinch does not wait for a new sample download.</p>
        <p>The processed solo library is CC BY 3.0. Keep public/solo-samples/ATTRIBUTION.txt with any deployed build that includes those samples.</p>
      </div>}

      {tab==='camera'&&<div className="panel">
        <h2>Camera / field of view</h2>
        <p>V1.1 no longer crops a 16:9 webcam into 20:9. It shows the entire camera frame. “Wide” requests 1280×720 because some webcams expose a wider sensor crop at 720p than at 1080p.</p>
        <label>Camera mode
          <select value={cameraPreset} onChange={e=>void changeCameraPreset(e.target.value as CameraPreset)}>
            <option value="wide">Wide 1280×720</option>
            <option value="hd">Full HD 1920×1080</option>
            <option value="auto">Browser auto</option>
          </select>
        </label>
        <p>Current stream: {cameraInfo||'not started'}</p>
        <label>Hand tracking rate
          <select value={trackingFps} onChange={e=>setTrackingFps(+e.target.value)}>
            <option value={18}>18 fps · coolest</option>
            <option value={24}>24 fps · recommended</option>
            <option value={30}>30 fps · smoother</option>
          </select>
        </label>
        <p>24 fps is the recommended default. The camera display runs separately, while MediaPipe inference is throttled to reduce lag.</p>
      </div>}

      {tab==='recording'&&<div className="panel">
        <h2>Recording & trim</h2>
        <p>Press Record to see a 3–2–1 countdown. Recording starts only after the countdown finishes.</p>
        <p>Stopping a recording opens the review editor instead of downloading immediately. You can preview the clip, set IN/OUT points, preview the selected range, and export a new trimmed MP4.</p>
        <button
          className={recording?'record active':'record'}
          disabled={!started||recordCountdown!==null||trimBusy}
          onClick={()=>void toggleRecording()}
        >
          {recording?'STOP RECORDING':recordCountdown!==null?`${recordCountdown}…`:'START RECORDING'}
        </button>
        {recordedBlob&&<button className="wide-button" onClick={()=>setRecordReviewOpen(true)}>OPEN LAST RECORDING</button>}
      </div>}
      {tab==='about'&&<div className="panel about-panel">
        <h2>About Orchestra / Gesture</h2>
        <p><strong>Creator:</strong> Uthpala Kaushalya</p>
        <p>This is an independent freelance / fun project created by Uthpala Kaushalya: a browser-based gesture instrument for conducting orchestral harmony with the left hand and performing solo instruments with the right hand.</p>
        <p>The interaction concept is <strong>influenced by gesture.live</strong>. This application is an independent implementation and is not affiliated with, endorsed by, or part of gesture.live.</p>
        <p><strong>Development assistance:</strong> ChatGPT by OpenAI assisted with software architecture, coding, debugging, iteration and documentation.</p>

        <h3>Connect with the creator</h3>
        <div className="social-links">
          <a href="https://www.facebook.com/UthpalaKaushalya/" target="_blank" rel="noreferrer"><b>Facebook</b><span>Uthpala Kaushalya</span></a>
          <a href="https://www.instagram.com/uthpala_kaushalya/" target="_blank" rel="noreferrer"><b>Instagram</b><span>@uthpala_kaushalya</span></a>
          <a href="https://www.linkedin.com/in/uthpalakaushalya/" target="_blank" rel="noreferrer"><b>LinkedIn</b><span>Uthpala Kaushalya</span></a>
        </div>

        <h3>Technology & resource credits</h3>
        <div className="credit-list">
          <a href="https://www.gesture.live/" target="_blank" rel="noreferrer"><b>gesture.live</b><span>Interaction inspiration</span></a>
          <a href="https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js" target="_blank" rel="noreferrer"><b>Google MediaPipe Hand Landmarker</b><span>Real-time hand landmarks</span></a>
          <a href="https://tonejs.github.io/" target="_blank" rel="noreferrer"><b>Tone.js</b><span>Web Audio instrument/effects engine · MIT</span></a>
          <a href="https://versilian-studios.com/vsco-community/" target="_blank" rel="noreferrer"><b>Versilian Studios · VSCO 2 CE</b><span>Orchestral samples · CC0</span></a>
          <a href="https://github.com/nbrosowsky/tonejs-instruments" target="_blank" rel="noreferrer"><b>tonejs-instruments</b><span>Processed solo samples · CC BY 3.0</span></a>
          <a href="https://github.com/gleitz/midi-js-soundfonts" target="_blank" rel="noreferrer"><b>FluidR3_GM via midi-js-soundfonts</b><span>Sampled folk / pastoral voices · CC BY 3.0</span></a>
          <a href="https://mediabunny.dev/" target="_blank" rel="noreferrer"><b>Mediabunny</b><span>MP4 recording, conversion and trimming · MPL 2.0</span></a>
          <a href="https://react.dev/" target="_blank" rel="noreferrer"><b>React</b><span>Application UI</span></a>
          <a href="https://vite.dev/" target="_blank" rel="noreferrer"><b>Vite</b><span>Development/build tooling</span></a>
          <a href="https://openai.com/chatgpt/" target="_blank" rel="noreferrer"><b>ChatGPT · OpenAI</b><span>Development and documentation assistance</span></a>
        </div>

        <div className="about-actions">
          <a className="primary-link" href="/docs.html" target="_blank" rel="noreferrer">OPEN FULL USER GUIDE ↗</a>
        </div>
        <p className="fine-print"><strong>V1.1:</strong> real sampled pastoral/folk voices; sustained SNAP playback for naturally sustaining sampled winds/reeds while the pinch is held; per-voice Volume and Reverb controls; real-sample Orchestral Pulse; functional BPM/meter controls; and final Orchestra/Solo mix faders (defaults 15% / 70%).</p>
        <p className="fine-print">The pastoral/fantasy palette is a high-level musical influence only. Orchestra / Gesture does not bundle or reproduce music, melodies, MIDI, loops, or recordings from <em>The Lord of the Rings</em> or any other film score.</p>
        <p className="fine-print">© 2026 Uthpala Kaushalya. Project code is released under the MIT License. Third-party resources remain subject to their own licenses and attribution requirements. Keep both <code>public/solo-samples/ATTRIBUTION.txt</code> and <code>public/folk-samples/ATTRIBUTION.txt</code> with deployments that include those sample libraries.</p>
      </div>}

    </aside>}

    {recordReviewOpen&&recordedBlob&&<div className="record-review-backdrop" role="dialog" aria-modal="true">
      <div className="record-review">
        <div className="review-head">
          <div>
            <h2>Recording review</h2>
            <p>Preview, trim, then download your MP4.</p>
          </div>
          <button onClick={closeRecordReview}>✕</button>
        </div>

        <video
          ref={previewVideoRef}
          className="review-video"
          src={recordedUrl}
          controls
          onLoadedMetadata={onPreviewMetadata}
        />

        <div className="trim-readout">
          <span>IN <b>{fmtTime(trimStart)}</b></span>
          <span>SELECTED <b>{fmtTime(Math.max(0,trimEnd-trimStart))}</b></span>
          <span>OUT <b>{fmtTime(trimEnd)}</b></span>
        </div>

        <div className="trim-track">
          <label>Start
            <input
              type="range"
              min="0"
              max={Math.max(.1,recordedDuration)}
              step=".1"
              value={Math.min(trimStart,recordedDuration)}
              onChange={e=>setTrimStart(Math.min(+e.target.value,Math.max(0,trimEnd-.1)))}
            />
          </label>
          <label>End
            <input
              type="range"
              min="0"
              max={Math.max(.1,recordedDuration)}
              step=".1"
              value={Math.min(trimEnd,recordedDuration)}
              onChange={e=>setTrimEnd(Math.max(+e.target.value,Math.min(recordedDuration,trimStart+.1)))}
            />
          </label>
        </div>

        <div className="trim-buttons">
          <button onClick={markTrimStart}>SET IN TO PLAYHEAD</button>
          <button onClick={markTrimEnd}>SET OUT TO PLAYHEAD</button>
          <button onClick={previewSelection}>▶ PREVIEW SELECTION</button>
          <button onClick={resetTrim}>RESET</button>
        </div>

        {trimBusy&&<div className="trim-progress">
          <div><span style={{width:`${trimProgress}%`}}/></div>
          <b>Exporting trimmed MP4… {trimProgress}%</b>
        </div>}

        <div className="review-actions">
          <button
            disabled={trimBusy}
            onClick={()=>downloadBlob(recordedBlob,`orchestra-performance-${new Date().toISOString().replace(/[:.]/g,'-')}.mp4`)}
          >
            DOWNLOAD FULL
          </button>
          <button
            className="primary-action"
            disabled={trimBusy||trimEnd<=trimStart}
            onClick={()=>void exportTrimmed()}
          >
            {trimBusy?'EXPORTING…':'EXPORT TRIMMED MP4'}
          </button>
        </div>
        <p className="review-note">Trim export happens locally in your browser. Longer recordings can take a while because the selected section is re-encoded for accurate IN/OUT timing.</p>
      </div>
    </div>}

    <footer>
      <span>L roll {leftRoll.toFixed(0)}° · chord vol {Math.round(chordDynamics*100)}%</span>
      <span>Hands {hands.length} · {cameraInfo}</span>
      <span>R roll {rightRoll.toFixed(0)}° · solo vol {Math.round(soloDynamics*100)}%</span>
    </footer>
  </div>
}
