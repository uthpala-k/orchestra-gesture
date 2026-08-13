import fs from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..')
const outRoot = path.join(projectRoot, 'public', 'solo-samples')
const apiBase = 'https://api.github.com/repos/nbrosowsky/tonejs-instruments/contents/samples'
const rawBase = 'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples'

const instruments = ['violin','cello','piano','flute','clarinet','saxophone']

function pitchToMidi(name) {
  const m = name.match(/^([A-G])([sb]?)(-?\d+)$/i)
  if (!m) return null
  const pcs = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}
  let pc = pcs[m[1].toUpperCase()]
  if (m[2] === 's') pc += 1
  if (m[2] === 'b') pc -= 1
  const oct = Number(m[3])
  return (oct + 1) * 12 + pc
}

function toTonePitch(stem) {
  return stem.replace(/^([A-G])s(-?\d+)$/i, '$1#$2')
}

function keep(instrument, stem) {
  const midi = pitchToMidi(stem)
  if (midi === null) return false

  // Browser-performance ranges. Keep enough neighboring notes so Tone.Sampler
  // does very little repitching around the actual gesture range.
  if (instrument === 'piano') return midi >= 36 && midi <= 84   // C2-C6
  if (instrument === 'cello') return midi >= 36 && midi <= 72   // C2-C5
  if (instrument === 'violin') return midi >= 55 && midi <= 96  // G3-C7
  if (instrument === 'flute') return midi >= 60 && midi <= 96   // C4-C7
  if (instrument === 'clarinet') return midi >= 50 && midi <= 88
  if (instrument === 'saxophone') return midi >= 46 && midi <= 86
  return true
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'orchestra-gesture-studio',
      'Accept': 'application/vnd.github+json'
    }
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`)
  return r.json()
}

async function download(url, dest) {
  const r = await fetch(url, {headers:{'User-Agent':'orchestra-gesture-studio'}})
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`)
  const ab = await r.arrayBuffer()
  fs.mkdirSync(path.dirname(dest), {recursive:true})
  fs.writeFileSync(dest, Buffer.from(ab))
}

fs.rmSync(outRoot, {recursive:true,force:true})
fs.mkdirSync(outRoot, {recursive:true})

const manifest = {}

console.log('\nDownloading normalized browser solo samples...')
console.log('Source: nbrosowsky/tonejs-instruments (CC BY 3.0)\n')

for (const instrument of instruments) {
  const listing = await fetchJson(`${apiBase}/${instrument}`)
  const mp3s = listing
    .filter(x => x.type === 'file' && x.name.toLowerCase().endsWith('.mp3'))
    .filter(x => keep(instrument, path.basename(x.name,'.mp3')))

  manifest[instrument] = {}
  console.log(`${instrument}: ${mp3s.length} notes`)

  for (let i=0;i<mp3s.length;i++) {
    const item = mp3s[i]
    const stem = path.basename(item.name,'.mp3')
    const tonePitch = toTonePitch(stem)
    const dest = path.join(outRoot,instrument,item.name)
    process.stdout.write(`  ${String(i+1).padStart(2,'0')}/${mp3s.length} ${item.name}\r`)
    await download(`${rawBase}/${instrument}/${encodeURIComponent(item.name)}`, dest)
    manifest[instrument][tonePitch] = item.name
  }
  process.stdout.write(' '.repeat(70)+'\r')
}

fs.writeFileSync(
  path.join(outRoot,'solo-manifest.json'),
  JSON.stringify(manifest,null,2)
)

fs.writeFileSync(
  path.join(outRoot,'ATTRIBUTION.txt'),
`Orchestra Gesture Studio - solo sample attribution

Processed instrument sample collection:
nbrosowsky/tonejs-instruments
https://github.com/nbrosowsky/tonejs-instruments

Repository code: MIT
Samples: Creative Commons Attribution 3.0 (CC BY 3.0)

The repository states that its samples were edited for consistency including
silence trimming, on/off ramps, volume matching, normalization, noise removal,
and pitch correction where necessary.

Original sample sources vary by instrument. See:
https://github.com/nbrosowsky/tonejs-instruments/blob/master/sample-source-info.txt

Changes in this project:
A pitch-range subset of the MP3 files is copied into the application's
public/solo-samples directory for low-latency browser playback.
`
)

console.log('\nSolo sample installation finished.')
console.log(`Manifest: ${path.join(outRoot,'solo-manifest.json')}`)
console.log(`Attribution: ${path.join(outRoot,'ATTRIBUTION.txt')}`)
console.log('\nNow run: npm run dev\n')
