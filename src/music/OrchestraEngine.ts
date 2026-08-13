import * as Tone from 'tone'
import { midiToNote, type ScaleName } from './chords'

export type SoloName =
  | 'violin'|'viola'|'cello'|'piano'
  | 'flute'|'clarinet'|'oboe'|'horn'
  | 'saxophone'|'sopranoSax'|'altoSax'|'tenorSax'
  | 'theremin'|'saw'|'square'|'glass'|'brass'|'acid'|'pulse'

type SampleManifest = Record<string,Record<string,string>>
type SoloInstrument = any

type ActiveSnap = { voice:SoloName; note:string }
type ActiveGlide = { voice:SoloName }

const sampleBase=(import.meta.env.VITE_SAMPLE_BASE_URL||'/samples').replace(/\/$/,'')
const soloSampleBase=(import.meta.env.VITE_SOLO_SAMPLE_BASE_URL||'/solo-samples').replace(/\/$/,'')
const ACOUSTIC=new Set<SoloName>(['violin','viola','cello','piano','flute','clarinet','oboe','horn','saxophone','sopranoSax','altoSax','tenorSax'])

const SOLO_GAIN_DB:Partial<Record<SoloName,number>>={
  violin:9, viola:9, cello:7, piano:5,
  flute:8, clarinet:8, oboe:7, horn:6,
  saxophone:8, sopranoSax:8, altoSax:8, tenorSax:8,
  theremin:-3, saw:-5, square:-6, glass:-4, brass:-4, acid:-6, pulse:-6,
}

const ORCHESTRA_GAIN_DB:Record<string,number>={
  violin:4.5,
  viola:4.5,
  cello:4,
  horn:3.5,
}

function syntheticVoice(name:SoloName):SoloInstrument {
  if(name==='glass'){
    const s=new Tone.FMSynth({
      harmonicity:3.01,modulationIndex:8,
      envelope:{attack:.01,decay:1.1,sustain:.35,release:1.3}
    })
    return s
  }
  if(name==='acid'){
    return new Tone.MonoSynth({
      oscillator:{type:'sawtooth'},
      filter:{Q:5,type:'lowpass',rolloff:-24},
      envelope:{attack:.01,decay:.15,sustain:.65,release:.35}
    })
  }
  const oscillator =
    name==='square' ? 'square' :
    name==='saw' || name==='brass' ? 'sawtooth' :
    name==='pulse' ? 'pulse' :
    name==='theremin' || name==='flute' ? 'sine' : 'triangle'

  return new Tone.PolySynth(Tone.Synth,{
    oscillator:{type:oscillator as any},
    envelope:{attack:.025,decay:.10,sustain:.86,release:.45}
  })
}

function glideOscillator(name:SoloName){
  if(['flute','theremin'].includes(name))return 'sine'
  if(['clarinet','square'].includes(name))return 'square'
  if(['violin','viola','cello','brass','horn','saxophone','sopranoSax','altoSax','tenorSax','saw','acid'].includes(name))return 'sawtooth'
  return 'triangle'
}

export class OrchestraEngine {
  master=new Tone.Gain(.80)
  orchestraBus=new Tone.Gain(.98)
  orchestraDuck=new Tone.Gain(1)
  orchestraTrim=new Tone.Gain(1.45)
  soloBus=new Tone.Gain(.72)
  drumBus=new Tone.Gain(.55)
  reverb=new Tone.Reverb({decay:5.2,wet:.25})
  delay=new Tone.FeedbackDelay({delayTime:'8n',feedback:.08,wet:.025})
  compressor=new Tone.Compressor(-12,4)
  limiter=new Tone.Limiter(-1)

  // Recording gets its own conservative level. The live speaker mix can stay
  // powerful, while the encoder receives ~8.4 dB of extra headroom.
  recordGain=new Tone.Gain(.38)
  recordLimiter=new Tone.Limiter(-6)
  soloVibrato=new Tone.Vibrato({frequency:5.4,depth:0})
  soloCompressor=new Tone.Compressor(-20,3)
  soloBoost=new Tone.Gain(1)
  soloTrim=new Tone.Gain(.45)
  recordDest:MediaStreamAudioDestinationNode

  private manifest:SampleManifest={}
  private soloManifest:SampleManifest={}
  private realSamplesLoaded=false

  private orchestraSamplers:Record<string,Tone.Sampler>={}
  private orchestraHeld:Record<string,string[]>={}
  private currentChordVelocity=.75
  private lastChordRefresh=0

  // A quiet continuous string-like bed guarantees that a held chord never
  // disappears merely because a finite source WAV reaches its end.
  private bedGain=new Tone.Gain(.38)
  private chordBed=new Tone.PolySynth(Tone.Synth,{
    oscillator:{type:'fattriangle',count:3,spread:12} as any,
    envelope:{attack:.28,decay:.18,sustain:1,release:1.0}
  })
  private bedHeld:string[]=[]

  private bass=new Tone.MonoSynth({
    oscillator:{type:'triangle'},
    envelope:{attack:.04,decay:.22,sustain:.7,release:.5}
  })
  private kick=new Tone.MembraneSynth()
  private hat=new Tone.MetalSynth({
    envelope:{attack:.001,decay:.08,release:.02},
    harmonicity:5.1,modulationIndex:32,resonance:3000,octaves:1.5
  })

  private soloVoices=new Map<SoloName,SoloInstrument>()
  private soloLoading=new Map<SoloName,Promise<void>>()
  private activeSnap:Record<number,ActiveSnap|undefined>={}
  private glideVoices:Record<number,{voice:SoloName,synth:Tone.Synth}|undefined>={}
  private activeGlide:Record<number,ActiveGlide|undefined>={}

  constructor(){
    this.orchestraBus.connect(this.orchestraDuck)
    this.orchestraDuck.connect(this.orchestraTrim)
    this.orchestraTrim.connect(this.master)

    this.soloBus.connect(this.soloVibrato)
    this.soloVibrato.connect(this.soloCompressor)
    this.soloCompressor.connect(this.soloBoost)
    this.soloBoost.connect(this.soloTrim)
    this.soloTrim.connect(this.master)
    this.drumBus.connect(this.master)
    this.master.chain(this.reverb,this.delay,this.compressor,this.limiter,Tone.getDestination())

    this.chordBed.connect(this.bedGain)
    this.bedGain.connect(this.orchestraBus)
    this.bass.connect(this.orchestraBus)
    this.kick.connect(this.drumBus)
    this.hat.connect(this.drumBus)

    const raw=Tone.getContext().rawContext as AudioContext
    this.recordDest=raw.createMediaStreamDestination()

    // Do NOT feed the already-hot public performance mix straight into the
    // media encoder. Give the recording branch extra headroom first.
    this.limiter.connect(this.recordGain)
    this.recordGain.connect(this.recordLimiter)
    this.recordLimiter.connect(this.recordDest)
  }

  async start(){
    await Tone.start()
    await this.loadManifest()
  }

  private async loadManifest(){
    try{
      const r=await fetch(`${sampleBase}/sample-manifest.json`,{cache:'no-store'})
      if(!r.ok)throw new Error('No sample manifest')
      this.manifest=await r.json() as SampleManifest

      try{
        const sr=await fetch(`${soloSampleBase}/solo-manifest.json`,{cache:'no-store'})
        if(sr.ok)this.soloManifest=await sr.json() as SampleManifest
      }catch{}

      for(const name of ['violin','viola','cello','horn']){
        const map=this.manifest[name]
        if(!map||!Object.keys(map).length)continue
        const sampler=new Tone.Sampler({
          urls:map,
          baseUrl:`${sampleBase}/${name}/`,
          attack:0,
          release:1.0
        })
        sampler.volume.value=ORCHESTRA_GAIN_DB[name] ?? 3
        sampler.connect(this.orchestraBus)
        this.orchestraSamplers[name]=sampler
      }
      await Tone.loaded()
      this.realSamplesLoaded=Object.keys(this.orchestraSamplers).length>=2
    }catch{
      this.realSamplesLoaded=false
    }
  }

  hasRealSamples(){return this.realSamplesLoaded}

  private soloSourceKey(name:SoloName){
    if(['sopranoSax','altoSax','tenorSax'].includes(name))return 'saxophone'
    return name
  }

  private premiumMap(name:SoloName){
    return this.soloManifest[this.soloSourceKey(name)] || null
  }

  private vscoMap(name:SoloName){
    return this.manifest[this.soloSourceKey(name)] || null
  }

  isPremiumVoice(name:SoloName){
    const m=this.premiumMap(name)
    return !!m && Object.keys(m).length>0
  }

  isVoiceSampled(name:SoloName){
    if(!ACOUSTIC.has(name))return false
    const p=this.premiumMap(name)
    if(p&&Object.keys(p).length)return true
    const v=this.vscoMap(name)
    return !!v&&Object.keys(v).length>0
  }

  async prepareSoloVoice(name:SoloName){
    if(this.soloVoices.has(name))return
    const pending=this.soloLoading.get(name)
    if(pending)return pending

    const job=(async()=>{
      let instrument:SoloInstrument
      const premium=this.premiumMap(name)
      const fallback=this.vscoMap(name)
      const map=(premium&&Object.keys(premium).length)?premium:fallback
      const sourceKey=this.soloSourceKey(name)
      const base=(premium&&Object.keys(premium).length)
        ? `${soloSampleBase}/${sourceKey}/`
        : `${sampleBase}/${sourceKey}/`

      if(ACOUSTIC.has(name)&&map&&Object.keys(map).length){
        instrument=new Tone.Sampler({
          urls:map,
          baseUrl:base,
          attack:0,
          release:.50
        })
        if(instrument.volume) instrument.volume.value=SOLO_GAIN_DB[name] ?? 5
        instrument.connect(this.soloBus)
        await Tone.loaded()
      }else{
        instrument=syntheticVoice(name)
        if(instrument.volume) instrument.volume.value=SOLO_GAIN_DB[name] ?? -3
        instrument.connect(this.soloBus)
      }
      this.soloVoices.set(name,instrument)
    })()

    this.soloLoading.set(name,job)
    try{await job}finally{this.soloLoading.delete(name)}
  }

  async prepareSoloVoices(names:SoloName[]){
    await Promise.all([...new Set(names)].map(n=>this.prepareSoloVoice(n)))
  }

  setChordDynamics(v:number){
    const x=Math.max(0,Math.min(1,v))
    this.orchestraBus.gain.rampTo(.24+x*1.18,.060)
  }

  setSoloDynamics(v:number){
    const x=Math.max(0,Math.min(1,v))
    this.soloBus.gain.rampTo(.20+x*.70,.040)
  }

  setSoloPresence(active:boolean){
    // V0.8 uses only a gentle cinematic duck. The processed solo samples
    // are already strong, so the orchestra should remain present.
    this.orchestraDuck.gain.rampTo(active?.94:1,.060)
    this.soloBoost.gain.rampTo(active?1.02:.96,.060)
  }

  setMixLevels(orchestraPercent:number,soloPercent:number){
    const o=Math.max(0,Math.min(100,orchestraPercent))/100
    const s=Math.max(0,Math.min(100,soloPercent))/100

    // Separate trims make the two systems easy to balance without changing
    // the expressive hand-dynamics mapping.
    this.orchestraTrim.gain.rampTo(2.05*o,.080)
    this.soloTrim.gain.rampTo(.68*s,.080)
  }

  setSoloVibrato(v:number){
    const x=Math.max(0,Math.min(1,v))
    const depth=x*.20
    const d:any=this.soloVibrato.depth
    if(d.rampTo)d.rampTo(depth,.05); else d.value=depth
  }

  setReverb(v:number){
    this.reverb.wet.rampTo(Math.max(0,Math.min(1,v))*.68,.08)
  }

  private releaseSampleSections(){
    for(const [section,notes] of Object.entries(this.orchestraHeld)){
      try{this.orchestraSamplers[section]?.triggerRelease(notes,Tone.now())}catch{}
    }
    this.orchestraHeld={}
  }

  private sectionVoicings(base:number[]){
    const n=(i:number,oct=0)=>{
      const source=base[Math.min(i,base.length-1)]
      return midiToNote(source+oct*12)
    }
    return {
      cello:[n(0,-1),n(2,-1)],
      viola:[n(1,0),base.length>=4?n(3,0):n(2,0)],
      violin:[n(2,1),base.length>=5?n(4,1):n(1,1),base.length>=7?n(6,1):n(0,1)],
      horn:[n(0,0),n(2,0)]
    } as Record<string,string[]>
  }

  private retriggerSections(velocity:number){
    for(const [section,notes] of Object.entries(this.orchestraHeld)){
      const sampler=this.orchestraSamplers[section]
      if(!sampler)continue
      try{sampler.triggerAttack(notes,Tone.now(),velocity)}catch{}
    }
  }

  playChordMidi(midis:number[],velocity=.75){
    this.releaseChord()
    const base=midis.slice(0,Math.min(midis.length,7))
    this.currentChordVelocity=velocity

    this.bedHeld=base.map(midiToNote)
    this.chordBed.triggerAttack(this.bedHeld,Tone.now(),Math.min(.42,velocity*.58))

    if(this.realSamplesLoaded){
      const voicings=this.sectionVoicings(base)
      for(const [section,notes] of Object.entries(voicings)){
        const sampler=this.orchestraSamplers[section]
        if(!sampler)continue
        sampler.triggerAttack(notes,Tone.now(),velocity)
        this.orchestraHeld[section]=notes
      }
      this.lastChordRefresh=performance.now()
    }
  }

  /** Call once per animation frame while a chord is held. */
  maintainChord(){
    if(!Object.keys(this.orchestraHeld).length)return
    const now=performance.now()
    // Re-layer the real sustained samples before typical short CE WAVs fully vanish.
    if(now-this.lastChordRefresh>2600){
      this.retriggerSections(Math.max(.32,this.currentChordVelocity*.58))
      this.lastChordRefresh=now
    }
  }

  releaseChord(){
    if(this.bedHeld.length){
      try{this.chordBed.triggerRelease(this.bedHeld,Tone.now())}catch{}
      this.bedHeld=[]
    }
    this.releaseSampleSections()
  }

  playBass(rootPc:number,velocity=.8){
    this.bass.triggerAttackRelease(midiToNote(36+rootPc),'8n',Tone.now(),velocity)
  }

  drum(kind:'kick'|'hat',velocity=.8){
    if(kind==='kick')this.kick.triggerAttackRelease('C1','8n',Tone.now(),velocity)
    else this.hat.triggerAttackRelease('16n',Tone.now(),velocity*.45)
  }

  private releaseSnap(finger:number){
    const active=this.activeSnap[finger]
    if(!active)return
    const instrument=this.soloVoices.get(active.voice) as any
    try{instrument?.triggerRelease(active.note,Tone.now())}catch{
      try{instrument?.triggerRelease?.()}catch{}
    }
    delete this.activeSnap[finger]
  }

  updateSoloSnap(finger:number,voice:SoloName,midi:number,velocity=.75){
    const instrument=this.soloVoices.get(voice) as any
    if(!instrument)return false

    const note=midiToNote(midi)
    const current=this.activeSnap[finger]
    if(current&&current.voice===voice&&current.note===note)return true

    this.releaseSnap(finger)
    this.stopSoloGlide(finger)
    try{
      instrument.triggerAttack(note,Tone.now(),Math.max(.82,velocity))
      this.activeSnap[finger]={voice,note}
      return true
    }catch{
      return false
    }
  }

  private ensureGlideVoice(finger:number,voice:SoloName){
    const current=this.glideVoices[finger]
    if(current&&current.voice===voice)return current.synth
    if(current){try{current.synth.dispose()}catch{}}

    const synth=new Tone.Synth({
      oscillator:{type:glideOscillator(voice) as any},
      portamento:.045,
      envelope:{attack:.018,decay:.03,sustain:1,release:.12}
    })
    synth.connect(this.soloBus)
    this.glideVoices[finger]={voice,synth}
    return synth
  }

  updateSoloGlide(finger:number,voice:SoloName,midiFloat:number,velocity=.75){
    this.releaseSnap(finger)
    const synth=this.ensureGlideVoice(finger,voice)
    const freq=Tone.Frequency(midiFloat,'midi').toFrequency()
    const active=this.activeGlide[finger]
    if(!active||active.voice!==voice){
      this.stopSoloGlide(finger)
      const s=this.ensureGlideVoice(finger,voice)
      s.triggerAttack(freq,Tone.now(),velocity)
      this.activeGlide[finger]={voice}
    }else{
      const f:any=synth.frequency
      if(f.rampTo)f.rampTo(freq,.025); else f.value=freq
    }
  }

  private stopSoloGlide(finger:number){
    if(!this.activeGlide[finger])return
    try{this.glideVoices[finger]?.synth.triggerRelease()}catch{}
    delete this.activeGlide[finger]
  }

  stopSoloFinger(finger:number){
    this.releaseSnap(finger)
    this.stopSoloGlide(finger)
  }

  stopAllSolo(){
    for(let i=0;i<4;i++)this.stopSoloFinger(i)
  }

  allOff(){
    this.releaseChord()
    this.stopAllSolo()
  }

  getRecordingAudioTrack(){
    return this.recordDest.stream.getAudioTracks()[0]
  }
}
