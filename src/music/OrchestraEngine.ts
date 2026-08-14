import * as Tone from 'tone'
import { midiToNote, type ScaleName } from './chords'

export type SoloName =
  | 'violin'|'viola'|'cello'|'piano'
  | 'flute'|'clarinet'|'oboe'|'horn'
  | 'saxophone'|'sopranoSax'|'altoSax'|'tenorSax'
  | 'whistle'|'panFlute'|'recorder'|'ocarina'
  | 'celticHarp'|'hammeredDulcimer'|'musette'
  | 'theremin'|'saw'|'square'|'glass'|'brass'|'acid'|'pulse'

export type MeterName='4/4'|'2/4'|'3/4'|'6/8'|'5/8'|'7/8'|'9/8'

type MeterSpec={
  label:string
  steps:number
  groups:number[]
}

export const METER_SPECS:Record<MeterName,MeterSpec>={
  '4/4':{label:'4/4 · Cinematic',steps:8,groups:[2,2,2,2]},
  '2/4':{label:'2/4 · Two-step',steps:4,groups:[2,2]},
  '3/4':{label:'3/4 · Waltz',steps:6,groups:[2,2,2]},
  '6/8':{label:'6/8 · Pastoral',steps:6,groups:[3,3]},
  '5/8':{label:'5/8 · 2+3',steps:5,groups:[2,3]},
  '7/8':{label:'7/8 · 2+2+3',steps:7,groups:[2,2,3]},
  '9/8':{label:'9/8 · 3+3+3',steps:9,groups:[3,3,3]},
}

type SampleManifest = Record<string,Record<string,string>>
type SoloInstrument = any

type ActiveSnap = { voice:SoloName; note:string; lastRefresh:number }
type ActiveGlide = { voice:SoloName }

const sampleBase=(import.meta.env.VITE_SAMPLE_BASE_URL||'/samples').replace(/\/$/,'')
const soloSampleBase=(import.meta.env.VITE_SOLO_SAMPLE_BASE_URL||'/solo-samples').replace(/\/$/,'')
const folkSampleBase=(import.meta.env.VITE_FOLK_SAMPLE_BASE_URL||'/folk-samples').replace(/\/$/,'')
const ACOUSTIC=new Set<SoloName>(['violin','viola','cello','piano','flute','clarinet','oboe','horn','saxophone','sopranoSax','altoSax','tenorSax'])
const SAMPLED_FOLK=new Set<SoloName>([
  'whistle','panFlute','recorder','ocarina',
  'celticHarp','hammeredDulcimer','musette'
])

const SUSTAINING_FOLK=new Set<SoloName>([
  'whistle','panFlute','recorder','ocarina','musette'
])
const FOLK_SUSTAIN_REFRESH_MS=1500

const SOLO_GAIN_DB:Partial<Record<SoloName,number>>={
  violin:9, viola:9, cello:7, piano:5,
  flute:8, clarinet:8, oboe:7, horn:6,
  saxophone:8, sopranoSax:8, altoSax:8, tenorSax:8,
  whistle:12, panFlute:13, recorder:12, ocarina:12,
  celticHarp:11, hammeredDulcimer:11, musette:11,
  theremin:-3, saw:-5, square:-6, glass:-4, brass:-4, acid:-6, pulse:-6,
}

const ORCHESTRA_GAIN_DB:Record<string,number>={
  violin:4.5,
  viola:4.5,
  cello:4,
  horn:3.5,
}

const PULSE_GAIN_DB:Record<string,number>={
  violin:8.5,
  viola:8.0,
  cello:7.5,
  horn:5.5,
  trombone:5.5,
  harp:3.5,
  timpani:3.0,
}

function syntheticVoice(name:SoloName):SoloInstrument {
  if(name==='glass'){
    return new Tone.FMSynth({
      harmonicity:3.01,modulationIndex:8,
      envelope:{attack:.01,decay:1.1,sustain:.35,release:1.3}
    })
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
    name==='theremin' ? 'sine' : 'triangle'

  return new Tone.PolySynth(Tone.Synth,{
    oscillator:{type:oscillator as any},
    envelope:{attack:.025,decay:.10,sustain:.86,release:.45}
  })
}

function glideOscillator(name:SoloName){
  // Continuous GLIDE uses a synth oscillator because a sampled note cannot be
  // continuously pitch-bent across the full range without artifacts.
  if(['flute','theremin','whistle','panFlute','recorder','ocarina'].includes(name))return 'sine'
  if(['clarinet','square'].includes(name))return 'square'
  if(['violin','viola','cello','brass','horn','saxophone','sopranoSax','altoSax','tenorSax','musette','saw','acid'].includes(name))return 'sawtooth'
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
  private folkManifest:SampleManifest={}
  private pulseManifest:SampleManifest={}
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
  private soloReverbs=new Map<SoloName,Tone.Reverb>()
  private soloReverbWet=new Map<SoloName,number>()
  private soloVoiceGains=new Map<SoloName,Tone.Gain>()
  private soloVoiceVolumes=new Map<SoloName,number>()

  private pulseMidis:number[]=[]
  private pulseVelocity=.78
  private pulseMeter:MeterName='4/4'
  private pulseStep=0
  private pulseScheduleId:number|null=null
  private pulseSamplers:Record<string,Tone.Sampler>={}
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

      try{
        const fr=await fetch(`${folkSampleBase}/folk-manifest.json`,{cache:'no-store'})
        if(fr.ok)this.folkManifest=await fr.json() as SampleManifest
      }catch{}

      try{
        const pr=await fetch(`${sampleBase}/pulse-manifest.json`,{cache:'no-store'})
        if(pr.ok)this.pulseManifest=await pr.json() as SampleManifest
      }catch{}

      for(const name of ['violin','viola','cello','horn','harp','piano','timpani']){
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

      for(const name of ['violin','viola','cello','horn','trombone','harp','timpani']){
        const shortMap=this.pulseManifest[name]
        const fallbackMap=this.manifest[name]

        const hasShort=!!shortMap&&Object.keys(shortMap).length>0
        const map=hasShort?shortMap:fallbackMap

        if(!map||!Object.keys(map).length)continue

        const sampler=new Tone.Sampler({
          urls:map,
          baseUrl:hasShort
            ? `${sampleBase}/pulse/${name}/`
            : `${sampleBase}/${name}/`,
          attack:0,
          release:hasShort?.18:.26
        })

        sampler.volume.value=PULSE_GAIN_DB[name] ?? 5
        sampler.connect(name==='timpani'?this.drumBus:this.orchestraBus)
        this.pulseSamplers[name]=sampler
      }

      await Tone.loaded()
      this.realSamplesLoaded=Object.keys(this.orchestraSamplers).length>=2
    }catch{
      this.realSamplesLoaded=false
    }
  }

  hasRealSamples(){return this.realSamplesLoaded}
  isModeledVoice(_name:SoloName){return false}
  isFolkSampled(name:SoloName){
    const m=this.folkManifest[name]
    return !!m&&Object.keys(m).length>0
  }

  private defaultVoiceReverb(name:SoloName){
    if(name==='whistle'||name==='panFlute'||name==='recorder'||name==='ocarina')return .32
    if(name==='celticHarp')return .25
    if(name==='hammeredDulcimer')return .17
    if(name==='musette')return .22
    return .18
  }

  private ensureSoloReverb(name:SoloName){
    const existing=this.soloReverbs.get(name)
    if(existing)return existing
    const wet=this.soloReverbWet.get(name)??this.defaultVoiceReverb(name)
    this.soloReverbWet.set(name,wet)
    const r=new Tone.Reverb({decay:3.1,wet})
    r.connect(this.soloBus)
    this.soloReverbs.set(name,r)
    return r
  }

  getVoiceReverb(name:SoloName){
    return this.soloReverbWet.get(name)??this.defaultVoiceReverb(name)
  }

  setVoiceReverb(name:SoloName,value:number){
    const wet=Math.max(0,Math.min(1,value))
    this.soloReverbWet.set(name,wet)
    const r=this.ensureSoloReverb(name)
    r.wet.rampTo(wet,.08)
  }

  private ensureSoloVoiceGain(name:SoloName){
    const existing=this.soloVoiceGains.get(name)
    if(existing)return existing

    const level=this.soloVoiceVolumes.get(name)??1
    this.soloVoiceVolumes.set(name,level)

    const gain=new Tone.Gain(level)
    gain.connect(this.ensureSoloReverb(name))
    this.soloVoiceGains.set(name,gain)
    return gain
  }

  getVoiceVolume(name:SoloName){
    return this.soloVoiceVolumes.get(name)??1
  }

  setVoiceVolume(name:SoloName,value:number){
    // 0-150% gives the performer room to compensate for naturally quiet
    // sampled instruments while still allowing a complete mute.
    const level=Math.max(0,Math.min(1.5,value))
    this.soloVoiceVolumes.set(name,level)
    const gain=this.ensureSoloVoiceGain(name)
    gain.gain.rampTo(level,.06)
  }

  private soloSourceKey(name:SoloName){
    if(['sopranoSax','altoSax','tenorSax'].includes(name))return 'saxophone'
    return name
  }

  private premiumMap(name:SoloName){
    return this.soloManifest[this.soloSourceKey(name)] || null
  }

  private folkMap(name:SoloName){
    return this.folkManifest[this.soloSourceKey(name)] || null
  }

  private vscoMap(name:SoloName){
    return this.manifest[this.soloSourceKey(name)] || null
  }

  isPremiumVoice(name:SoloName){
    const m=this.premiumMap(name)
    return !!m && Object.keys(m).length>0
  }

  isVoiceSampled(name:SoloName){
    if(SAMPLED_FOLK.has(name)){
      const f=this.folkMap(name)
      return !!f&&Object.keys(f).length>0
    }
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
      const folk=this.folkMap(name)
      const fallback=this.vscoMap(name)
      const sourceKey=this.soloSourceKey(name)

      const hasFolk=SAMPLED_FOLK.has(name)&&folk&&Object.keys(folk).length
      const hasPremium=premium&&Object.keys(premium).length
      const map=hasFolk?folk:(hasPremium?premium:fallback)
      const base=hasFolk
        ? `${folkSampleBase}/${sourceKey}/`
        : hasPremium
          ? `${soloSampleBase}/${sourceKey}/`
          : `${sampleBase}/${sourceKey}/`

      if((ACOUSTIC.has(name)||SAMPLED_FOLK.has(name))&&map&&Object.keys(map).length){
        instrument=new Tone.Sampler({
          urls:map,
          baseUrl:base,
          attack:0,
          release:.50
        })
        if(instrument.volume) instrument.volume.value=SOLO_GAIN_DB[name] ?? 5
        instrument.connect(this.ensureSoloVoiceGain(name))
        await Tone.loaded()
      }else{
        instrument=syntheticVoice(name)
        if(instrument.volume) instrument.volume.value=SOLO_GAIN_DB[name] ?? -3
        instrument.connect(this.ensureSoloVoiceGain(name))
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

    // These are final output faders for the two musical buses.
    // Hand dynamics still shape expression upstream, while these sliders
    // simply lower or raise the final orchestra / solo master levels.
    this.orchestraTrim.gain.rampTo(o,.080)
    this.soloTrim.gain.rampTo(s,.080)
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

  setTempo(bpm:number){
    const safe=Math.max(40,Math.min(220,bpm))
    Tone.getTransport().bpm.rampTo(safe,.08)
  }

  setPulseMeter(meter:MeterName){
    this.pulseMeter=meter
    this.pulseStep=0
  }

  private meterStarts(groups:number[]){
    const starts:number[]=[0]
    let cursor=0
    for(let i=0;i<groups.length-1;i++){
      cursor+=groups[i]
      starts.push(cursor)
    }
    return starts
  }

  private ensurePulseClock(){
    if(this.pulseScheduleId===null){
      this.pulseScheduleId=Tone.getTransport().scheduleRepeat(time=>this.pulseTick(time),'8n')
    }
    if(Tone.getTransport().state!=='started'){
      Tone.getTransport().start('+0.03')
    }
  }

  private pulseTrigger(
    section:string,
    notes:number[],
    duration:string,
    time:number,
    velocity:number
  ){
    const sampler=this.pulseSamplers[section]||this.orchestraSamplers[section]
    if(!sampler)return
    const names=notes.map(m=>midiToNote(m))
    try{sampler.triggerAttackRelease(names,duration,time,Math.max(.08,Math.min(1,velocity)))}catch{}
  }

  private pulseTick(time:number){
    if(!this.pulseMidis.length)return

    const spec=METER_SPECS[this.pulseMeter]
    const step=this.pulseStep%spec.steps
    const starts=this.meterStarts(spec.groups)
    const groupStart=starts.includes(step)
    const downbeat=step===0

    const chord=this.pulseMidis
    const root=chord[0]
    const third=chord[Math.min(1,chord.length-1)]
    const fifth=chord[Math.min(2,chord.length-1)]
    const color=chord[Math.min(3,chord.length-1)]
    const arp=[root,third,fifth,color,fifth,third,root,fifth]
    const v=this.pulseVelocity

    // V1.1 REAL ORCHESTRAL PULSE
    // Harp remains clear and prominent, but every meter now gets a much
    // stronger layered violin + viola + cello ensemble.  Velocity differences
    // create real musical accents instead of a flat beep-like pulse.

    if(this.pulseMeter==='3/4'){
      // Waltz:
      // strong string ensemble on beat 1, lighter ensemble responses on 2 and 3.
      if(step===0){
        this.pulseTrigger('cello',[root-12,fifth-12],'4n',time,v*.98)
        this.pulseTrigger('viola',[root,third,fifth],'8n',time,v*.82)
        this.pulseTrigger('violin',[third+12,fifth+12,color+12],'8n',time,v*.78)
        this.pulseTrigger('horn',[root,third,fifth],'4n',time,v*.58)
        this.pulseTrigger('timpani',[root-24],'8n',time,v*.58)
      }

      if(step===2||step===4){
        this.pulseTrigger('cello',[root-12],'8n',time,v*.62)
        this.pulseTrigger('viola',[third,fifth],'8n',time,v*.72)
        this.pulseTrigger('violin',[fifth+12,color+12],'8n',time,v*.68)
      }

      // Keep the harp audible and flowing.
      this.pulseTrigger(
        'harp',
        [arp[step%arp.length]+12],
        '16n',
        time,
        v*(step===0?.58:.36)
      )
    }

    else if(this.pulseMeter==='6/8'||this.pulseMeter==='9/8'){
      // Pastoral compound meter:
      // flowing harp + clearly audible orchestral string punches at each group.
      if(groupStart){
        this.pulseTrigger(
          'cello',
          [root-12,fifth-12],
          '8n',
          time,
          v*(downbeat?.98:.76)
        )

        this.pulseTrigger(
          'viola',
          [root,third,fifth],
          '8n',
          time,
          v*(downbeat?.84:.66)
        )

        this.pulseTrigger(
          'violin',
          [third+12,fifth+12,color+12],
          '8n',
          time,
          v*(downbeat?.80:.62)
        )
      }

      if(downbeat){
        this.pulseTrigger('horn',[root,third,fifth],'4n',time,v*.48)
      }

      // Harp remains prominent.
      this.pulseTrigger(
        'harp',
        [arp[step%arp.length]+12],
        '16n',
        time,
        v*(groupStart?.64:.42)
      )

      // Small upper-string answer at the end of each 3-note group.
      if(step%3===2){
        this.pulseTrigger('viola',[third,fifth],'16n',time,v*.48)
        this.pulseTrigger('violin',[fifth+12,color+12],'16n',time,v*.56)
      }
    }

    else if(this.pulseMeter==='5/8'||this.pulseMeter==='7/8'){
      // Irregular meters:
      // strong string punches define 2+3 or 2+2+3 while harp supplies movement.
      if(groupStart){
        this.pulseTrigger(
          'cello',
          [root-12,fifth-12],
          '8n',
          time,
          v*(downbeat?.98:.78)
        )

        this.pulseTrigger(
          'viola',
          [root,third,fifth],
          '8n',
          time,
          v*(downbeat?.84:.68)
        )

        this.pulseTrigger(
          'violin',
          [third+12,fifth+12,color+12],
          '8n',
          time,
          v*(downbeat?.82:.66)
        )

        this.pulseTrigger(
          'timpani',
          [root-24],
          '16n',
          time,
          v*(downbeat?.52:.32)
        )
      }else{
        this.pulseTrigger(
          'violin',
          [arp[step%arp.length]+12],
          '16n',
          time,
          v*.46
        )
      }

      this.pulseTrigger(
        'harp',
        [arp[(step*2)%arp.length]+12],
        '16n',
        time,
        v*.34
      )
    }

    else {
      // 4/4 and 2/4:
      // cinematic real-sample ostinato with a strong ensemble foundation.
      if(downbeat){
        this.pulseTrigger('cello',[root-12,fifth-12],'8n',time,v*.98)
        this.pulseTrigger('viola',[root,third,fifth],'8n',time,v*.84)
        this.pulseTrigger('violin',[third+12,fifth+12,color+12],'8n',time,v*.82)
        this.pulseTrigger('horn',[root,third,fifth],'4n',time,v*.58)
        this.pulseTrigger('timpani',[root-24],'8n',time,v*.56)
      }
      else if(groupStart){
        this.pulseTrigger('cello',[root-12],'16n',time,v*.72)
        this.pulseTrigger('viola',[third,fifth],'16n',time,v*.72)
        this.pulseTrigger('violin',[fifth+12,color+12],'16n',time,v*.74)
      }
      else{
        // Inner ostinato notes keep movement without masking the solo instrument.
        this.pulseTrigger(
          'viola',
          [arp[step%arp.length]],
          '16n',
          time,
          v*.50
        )
        this.pulseTrigger(
          'violin',
          [arp[(step+2)%arp.length]+12],
          '16n',
          time,
          v*.54
        )
      }

      // Keep the harp exactly in the supporting role that was already working.
      this.pulseTrigger(
        'harp',
        [arp[(step*2)%arp.length]+12],
        '16n',
        time,
        v*.30
      )
    }

    this.pulseStep=(step+1)%spec.steps
  }

  private stopPulseChord(){
    this.pulseMidis=[]
    this.pulseStep=0
    for(const sampler of Object.values(this.pulseSamplers)){
      try{sampler.releaseAll(Tone.now())}catch{}
    }
  }

  playPulseChord(midis:number[],velocity=.78){
    this.releaseSustainOnly()
    const wasActive=this.pulseMidis.length>0
    this.pulseMidis=midis.slice(0,Math.min(7,midis.length))
    this.pulseVelocity=velocity
    if(!wasActive)this.pulseStep=0
    this.ensurePulseClock()
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

  private releaseSustainOnly(){
    if(this.bedHeld.length){
      try{this.chordBed.triggerRelease(this.bedHeld,Tone.now())}catch{}
      this.bedHeld=[]
    }
    this.releaseSampleSections()
  }

  playChordMidi(midis:number[],velocity=.75){
    this.stopPulseChord()
    this.releaseSustainOnly()
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
    this.stopPulseChord()
    this.releaseSustainOnly()
  }

  playBass(rootPc:number,velocity=.8){
    this.bass.triggerAttackRelease(midiToNote(36+rootPc),'8n',Tone.now(),velocity)
  }

  drum(kind:'kick'|'hat',velocity=.8){
    if(kind==='kick')this.kick.triggerAttackRelease('C1','8n',Tone.now(),velocity)
    else this.hat.triggerAttackRelease('16n',Tone.now(),velocity*.45)
  }

  private soloSoundingMidi(_voice:SoloName,midi:number,octaveShift=0){
    return midi+Math.max(-2,Math.min(2,octaveShift))*12
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

  updateSoloSnap(finger:number,voice:SoloName,midi:number,velocity=.75,octaveShift=0){
    const instrument=this.soloVoices.get(voice) as any
    if(!instrument)return false

    const soundingMidi=this.soloSoundingMidi(voice,midi,octaveShift)
    const note=midiToNote(soundingMidi)
    const current=this.activeSnap[finger]
    const now=performance.now()

    if(current&&current.voice===voice&&current.note===note){
      // FluidR3_GM folk samples are finite recordings.  For instruments that
      // naturally sustain (winds / accordion), refresh the REAL sample while
      // the pinch remains held so the sound does not simply die after the WAV/MP3 ends.
      if(SUSTAINING_FOLK.has(voice)&&now-current.lastRefresh>=FOLK_SUSTAIN_REFRESH_MS){
        try{
          instrument.triggerAttack(note,Tone.now(),Math.max(.82,velocity)*.90)
          current.lastRefresh=now
        }catch{}
      }
      return true
    }

    this.releaseSnap(finger)
    this.stopSoloGlide(finger)

    try{
      instrument.triggerAttack(note,Tone.now(),Math.max(.82,velocity))
      this.activeSnap[finger]={voice,note,lastRefresh:now}
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
    synth.connect(this.ensureSoloVoiceGain(voice))
    this.glideVoices[finger]={voice,synth}
    return synth
  }

  updateSoloGlide(finger:number,voice:SoloName,midiFloat:number,velocity=.75,octaveShift=0){
    this.releaseSnap(finger)
    const synth=this.ensureGlideVoice(finger,voice)
    const soundingMidi=this.soloSoundingMidi(voice,midiFloat,octaveShift)
    const freq=Tone.Frequency(soundingMidi,'midi').toFrequency()
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
