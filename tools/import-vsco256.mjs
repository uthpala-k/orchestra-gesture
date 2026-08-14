import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const inputArg = process.argv[2]
const source = inputArg
  ? path.resolve(inputArg)
  : path.join(os.homedir(), 'Downloads', '256OrchestralSamples')

const projectRoot = path.resolve(import.meta.dirname, '..')
const outputRoot = path.join(projectRoot, 'public', 'samples')

if (!fs.existsSync(source)) {
  console.error('\nERROR: I cannot find the VSCO folder here:')
  console.error(source)
  console.error('\nRun this command again and put your folder path in quotes, for example:')
  console.error('node tools/import-vsco256.mjs "C:\\Users\\YOURNAME\\Downloads\\256OrchestralSamples"\n')
  process.exit(1)
}

function walk(dir) {
  const out=[]
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=path.join(dir,ent.name)
    if(ent.isDirectory()) out.push(...walk(p))
    else if(ent.isFile() && ent.name.toLowerCase().endsWith('.wav')) out.push(p)
  }
  return out
}

const files=walk(source)
console.log(`Found ${files.length} WAV files.`)

const instrumentRules = {
  violin: [
    /llvln/i, /vlnens/i, /violin/i, /(?:^|[_ -])vln(?:[_ -]|$)/i
  ],
  viola: [
    /violaens/i, /viola/i, /(?:^|[_ -])vla(?:[_ -]|$)/i
  ],
  cello: [
    /celloens/i, /cello/i, /(?:^|[_ -])vc(?:[_ -]|$)/i, /(?:^|[_ -])vcl(?:[_ -]|$)/i
  ],
  piano: [
    /piano/i, /upright/i, /(?:^|[_ -])pno(?:[_ -]|$)/i
  ],
  flute: [
    /flute/i, /(?:^|[_ -])fl(?:[_ -]|$)/i
  ],
  clarinet: [
    /clarinet/i, /clar/i, /(?:^|[_ -])cl(?:[_ -]|$)/i
  ],
  oboe: [
    /oboe/i, /(?:^|[_ -])ob(?:[_ -]|$)/i
  ],
  horn: [
    /fhorn/i, /f horn/i, /horn/i, /(?:^|[_ -])fhn(?:[_ -]|$)/i
  ],
  bassoon: [
    /bassoon/i, /(?:^|[_ -])bsn(?:[_ -]|$)/i
  ],
  trumpet: [
    /trumpet/i, /(?:^|[_ -])tpt(?:[_ -]|$)/i
  ],
  trombone: [
    /trombone/i, /tbnens/i, /(?:^|[_ -])tbn(?:[_ -]|$)/i
  ],
  tuba: [
    /tuba/i
  ],
  harp: [
    /harp/i
  ],
  timpani: [
    /timpani/i, /(?:^|[_ -])tmp(?:[_ -]|$)/i, /(?:^|[_ -])timp(?:[_ -]|$)/i
  ]
}

function classify(name) {
  for(const [instrument,rules] of Object.entries(instrumentRules)) {
    if(rules.some(r=>r.test(name))) return instrument
  }
  return null
}

function parsePitch(name) {
  // Finds pitches such as A3, C#4, Bb2.
  // Prefer pitch-like tokens separated by punctuation/spaces.
  const matches=[...name.matchAll(/(?:^|[^A-Za-z])([A-Ga-g])([#b]?)(-?\d)(?=[^0-9]|$)/g)]
  if(!matches.length) return null
  const m=matches[matches.length-1]
  return `${m[1].toUpperCase()}${m[2] || ''}${m[3]}`
}

function score(name,instrument) {
  const n=name.toLowerCase()
  let s=0

  // Sustains are best for this app.
  if(/sus|sustain|arcovib|arco|susvib/.test(n)) s+=80
  if(/vib/.test(n)) s+=20

  // Prefer solo violin for the solo voice.
  if(instrument==='violin' && /llvln/.test(n)) s+=40

  // Medium/strong dynamic gives a useful source sample for browser gain control.
  if(/(?:^|[_ -])(mf|f)(?:[_ .-]|$)/.test(n)) s+=12
  if(/_v2|_v3/.test(n)) s+=6

  // Avoid short articulations for the main sampler.
  if(/stac|stacc|spic|pizz|trem|trill|fx|gliss/.test(n)) s-=100

  return s
}

const grouped={}
const unclassified=[]

for(const f of files) {
  const name=path.basename(f)
  const instrument=classify(name)
  const pitch=parsePitch(name)
  if(!instrument || !pitch) {
    unclassified.push(name)
    continue
  }
  grouped[instrument] ??= {}
  grouped[instrument][pitch] ??= []
  grouped[instrument][pitch].push({path:f,name,score:score(name,instrument)})
}


function scorePulse(name,instrument) {
  const n=name.toLowerCase()
  let s=0

  // Short orchestral articulations are preferred for rhythmic accompaniment.
  if(/spic|spicc/.test(n)) s+=150
  if(/stac|stacc/.test(n)) s+=140
  if(/pizz/.test(n)) s+=125

  // Harp and timpani are naturally suitable even when filenames don't say staccato.
  if(instrument==='harp') s+=115
  if(instrument==='timpani') s+=120

  // Useful dynamics / round-robin choices.
  if(/(?:^|[_ -])(mf|f)(?:[_ .-]|$)/.test(n)) s+=18
  if(/_v2|_v3/.test(n)) s+=8

  // Long/special articulations are poor rhythmic sources.
  if(/sus|sustain|trem|trill|gliss|fx/.test(n)) s-=90

  return s
}

const pulseGrouped={}
for(const f of files) {
  const name=path.basename(f)
  const instrument=classify(name)
  const pitch=parsePitch(name)
  if(!instrument || !pitch) continue

  const ps=scorePulse(name,instrument)
  if(ps < 60) continue

  pulseGrouped[instrument] ??= {}
  pulseGrouped[instrument][pitch] ??= []
  pulseGrouped[instrument][pitch].push({path:f,name,score:ps})
}

fs.rmSync(outputRoot,{recursive:true,force:true})
fs.mkdirSync(outputRoot,{recursive:true})

const manifest={}
const report=[]

for(const instrument of Object.keys(instrumentRules)) {
  const pitchGroups=grouped[instrument] || {}
  const pitches=Object.keys(pitchGroups)

  manifest[instrument]={}
  const dest=path.join(outputRoot,instrument)
  fs.mkdirSync(dest,{recursive:true})

  for(const pitch of pitches) {
    const candidates=pitchGroups[pitch].sort((a,b)=>b.score-a.score)
    const best=candidates[0]
    const safePitch=pitch.replace('#','s').replace('b','b')
    const targetName=`${instrument}_${safePitch}.wav`
    fs.copyFileSync(best.path,path.join(dest,targetName))
    manifest[instrument][pitch]=targetName
  }

  report.push(`${instrument.padEnd(10)} ${String(pitches.length).padStart(3)} mapped pitches`)
}

fs.writeFileSync(
  path.join(outputRoot,'sample-manifest.json'),
  JSON.stringify(manifest,null,2)
)

const pulseManifest={}
const pulseRoot=path.join(outputRoot,'pulse')
fs.mkdirSync(pulseRoot,{recursive:true})

for(const instrument of ['violin','viola','cello','horn','trombone','harp','timpani']) {
  const groups=pulseGrouped[instrument] || {}
  const pitches=Object.keys(groups)
  pulseManifest[instrument]={}

  const dest=path.join(pulseRoot,instrument)
  fs.mkdirSync(dest,{recursive:true})

  for(const pitch of pitches) {
    const candidates=groups[pitch].sort((a,b)=>b.score-a.score)
    const best=candidates[0]
    const safePitch=pitch.replace('#','s')
    const targetName=`${instrument}_pulse_${safePitch}.wav`
    fs.copyFileSync(best.path,path.join(dest,targetName))
    pulseManifest[instrument][pitch]=targetName
  }
}

fs.writeFileSync(
  path.join(outputRoot,'pulse-manifest.json'),
  JSON.stringify(pulseManifest,null,2)
)


fs.writeFileSync(
  path.join(outputRoot,'IMPORT_REPORT.txt'),
  [
    'VSCO 256 IMPORT REPORT',
    '======================',
    `Source: ${source}`,
    `Total WAV files found: ${files.length}`,
    '',
    ...report,
    '',
    'REAL ORCHESTRAL PULSE ARTICULATIONS',
    ...Object.entries(pulseManifest).map(([name,map])=>
      `${name.padEnd(10)} ${String(Object.keys(map).length).padStart(3)} short-articulation pitches`
    ),
    '',
    `Unclassified/unpitched files: ${unclassified.length}`,
    '',
    'A few unclassified names:',
    ...unclassified.slice(0,80)
  ].join('\n')
)

console.log('\nImport finished.')
console.log('-----------------------------------')
for(const line of report) console.log(line)
console.log('-----------------------------------')
console.log(`\nManifest written to:\n${path.join(outputRoot,'sample-manifest.json')}`)
console.log(`\nReport written to:\n${path.join(outputRoot,'IMPORT_REPORT.txt')}`)
console.log('\nNow run: npm run dev\n')
