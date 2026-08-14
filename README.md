# Orchestra Gesture Studio V1.1

V1.1 adds four major product-level improvements:

## 1. Stronger orchestra

The orchestra now has:
- higher orchestral bus headroom
- individual makeup gain on violin / viola / cello / horn sections
- a louder continuous chord bed
- stronger finite-sample re-layering
- a larger Orchestra Mix trim range
- only very gentle orchestra ducking when a solo is active
- master limiting to control clipping

Default global trims:
- Orchestra 92%
- Solo 52%

You can still change both in:
Settings -> Sound

## 2. Header overlap fixed

The performance canvas no longer draws a second "ORCHESTRA / GESTURE" title
behind the HTML top-left title.

## 3. About + full documentation

Settings -> About contains:
- Creator: Uthpala Kaushalya
- independent freelance / fun project description
- gesture.live inspiration statement
- ChatGPT / OpenAI development-assistance credit
- MediaPipe, Tone.js, VSCO 2 CE, tonejs-instruments, Mediabunny, React and Vite credits
- license notes
- link to the full user guide

The full versioned guide is:

public/docs.html

The app opens it in a separate browser tab.

## 4. Recording editor

Record workflow:

RECORD
-> countdown 3
-> 2
-> 1
-> recording begins
-> STOP RECORDING
-> preview editor opens
-> select IN / OUT
-> preview selection
-> DOWNLOAD FULL or EXPORT TRIMMED MP4

Trim conversion happens locally in the browser using Mediabunny's Conversion API.

## Run

```powershell
npm install
npm run import:samples
npm run install:solo-samples
npm run dev
```

If you already have populated `public/samples` and `public/solo-samples` folders
from V0.8, you may copy those into V1.1 instead of re-downloading samples.


## Public deployment

See `DEPLOY_FREE.md` for the zero-cost Cloudflare Pages deployment procedure.


## V1.1 — Pastoral voices and Orchestral Pulse

V1.1 adds REAL sampled pastoral/folk voices:

- Whistle
- Pan flute
- Recorder
- Ocarina
- Celtic / folk harp
- Hammered dulcimer
- Musette / folk accordion

These voices are downloaded from the FluidR3_GM browser sample distribution
in gleitz/midi-js-soundfonts and are licensed CC BY 3.0. Run:

```powershell
npm run install:folk-samples
```

Settings -> Melody includes per-finger **Octave −/+** controls plus per-voice
**Volume** and **Reverb** controls. Octave can be shifted from −2 to +2 for
each of the four pinch channels.

The BPM control now drives **Orchestral Pulse**, a real-sample accompaniment engine. The patterns are original, but the sound comes from imported VSCO short articulations rather than oscillator beeps. Supported meters are:

- 4/4
- 2/4
- 3/4 waltz
- 6/8
- 5/8 (2+3)
- 7/8 (2+2+3)
- 9/8 (3+3+3)

The generated rhythmic patterns follow the current left-hand chord and stop
when the chord hand disappears or makes a fist.

No Lord of the Rings soundtrack audio, melody, MIDI, or transcription is
included in the repository. The pastoral palette is only a high-level
inspiration reference.


## V1.1 refinement — sustained samples, per-voice volume and final mix

The final V1.1 behavior also includes:

- sampled Whistle, Pan Flute, Recorder, Ocarina and Musette sustain for as long
  as a SNAP pinch is held by periodically refreshing the finite real recording;
- naturally plucked/struck voices such as Harp and Dulcimer still decay;
- a per-finger **Octave −/+** control from −2 to +2 in Settings -> Melody;
- Whistle, Pan Flute, Recorder and Ocarina default to **+1 octave**, while the
  performer can freely move each of the four assigned finger voices up/down;
- instrument dropdowns show clean instrument names only, without processing
  or sample-source suffixes;
- a per-voice **Volume** control (0–150%) beside per-voice Reverb in
  Settings -> Melody;
- Settings -> Sound defaults to **Orchestra 15%** and **Solo 70%**;
- Orchestra/Solo mix controls are literal final bus output faders;
- the strengthened real-sample Orchestral Pulse arrangement remains in V1.1.

The folk sample bank is FluidR3_GM via `gleitz/midi-js-soundfonts`
(CC BY 3.0). Keep the generated `public/folk-samples/ATTRIBUTION.txt`
with deployed builds.
