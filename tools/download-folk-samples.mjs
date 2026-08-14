import fs from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..')
const outRoot = path.join(projectRoot, 'public', 'folk-samples')
const base = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM'

// These are REAL sampled General MIDI instruments from FluidR3_GM,
// redistributed by gleitz/midi-js-soundfonts under CC BY 3.0.
const instruments = {
  whistle: {
    remote: 'whistle',
    notes: ['C4','E4','G4','C5','E5','G5','C6']
  },
  panFlute: {
    remote: 'pan_flute',
    notes: ['C3','G3','C4','G4','C5','G5','C6']
  },
  recorder: {
    remote: 'recorder',
    notes: ['C4','E4','G4','C5','E5','G5','C6']
  },
  ocarina: {
    remote: 'ocarina',
    notes: ['C4','E4','G4','C5','E5','G5','C6']
  },
  celticHarp: {
    remote: 'orchestral_harp',
    notes: ['C2','G2','C3','G3','C4','G4','C5','G5','C6']
  },
  hammeredDulcimer: {
    remote: 'dulcimer',
    notes: ['C3','G3','C4','G4','C5','G5','C6']
  },
  musette: {
    remote: 'accordion',
    notes: ['C3','G3','C4','G4','C5','G5']
  }
}

async function download(url, dest) {
  const r = await fetch(url, {
    headers: {'User-Agent':'orchestra-gesture-studio'}
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`)
  const ab = await r.arrayBuffer()
  fs.mkdirSync(path.dirname(dest), {recursive:true})
  fs.writeFileSync(dest, Buffer.from(ab))
}

fs.rmSync(outRoot, {recursive:true, force:true})
fs.mkdirSync(outRoot, {recursive:true})

const manifest = {}

console.log('\nInstalling REAL sampled folk/pastoral instruments...')
console.log('Source: FluidR3_GM via gleitz/midi-js-soundfonts')
console.log('Sample license: CC BY 3.0\n')

for (const [voice, spec] of Object.entries(instruments)) {
  manifest[voice] = {}
  console.log(`${voice}:`)
  for (const note of spec.notes) {
    const filename = `${note}.mp3`
    const url = `${base}/${spec.remote}-mp3/${filename}`
    const dest = path.join(outRoot, voice, filename)

    process.stdout.write(`  ${note} ... `)
    await download(url, dest)
    manifest[voice][note] = filename
    process.stdout.write('ok\n')
  }
}

fs.writeFileSync(
  path.join(outRoot, 'folk-manifest.json'),
  JSON.stringify(manifest, null, 2)
)

fs.writeFileSync(
  path.join(outRoot, 'ATTRIBUTION.txt'),
`Orchestra / Gesture - sampled folk/pastoral voice attribution

Source:
gleitz/midi-js-soundfonts
https://github.com/gleitz/midi-js-soundfonts

FluidR3_GM sample set:
Creative Commons Attribution 3.0 (CC BY 3.0)

The midi-js-soundfonts project contains pre-rendered MP3 versions of
FluidR3_GM for browser playback.

Used by Orchestra / Gesture V1.1:
- Whistle
- Pan Flute
- Recorder
- Ocarina
- Orchestral Harp (presented in the UI as Celtic / Folk Harp)
- Dulcimer
- Accordion (presented as Musette / Folk Accordion)

This project downloads only a sparse pitch subset and Tone.Sampler repitches
between the sampled notes.

Repository:
https://github.com/uthpala-k/orchestra-gesture

Keep this attribution file with deployments that include these samples.
`
)

console.log('\nFinished.')
console.log(`Manifest: ${path.join(outRoot,'folk-manifest.json')}`)
console.log(`Attribution: ${path.join(outRoot,'ATTRIBUTION.txt')}`)
console.log('\nNow run: npm run dev\n')
