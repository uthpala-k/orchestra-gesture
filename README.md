# Orchestra / Gesture

**Version 1.0**

A browser-based two-hand gesture instrument for conducting orchestral harmony
with the left hand and performing solo instruments with the right hand.

**Creator:** Uthpala Kaushalya  
**Project type:** Independent freelance / fun project  
**Live site:** https://orchestra-gesture.pages.dev

The interaction concept is influenced by [gesture.live](https://www.gesture.live/).
This project is an independent implementation and is not affiliated with,
endorsed by, or part of gesture.live.

Development assistance was provided by ChatGPT by OpenAI.

## Features

- Real-time two-hand tracking with MediaPipe Hand Landmarker
- Left-hand scale-degree chord gestures
- Hand-height chord extensions: triad, 7th, 9th, 11th, 13th
- Palm/back harmonic polarity switching
- Horizontal hand movement for dynamics
- Wrist roll for hall space and solo vibrato
- Right-hand four-finger pinch solo system
- 14-note wide SNAP lane and continuous GLIDE mode
- Multiple keys and scales/modes
- Orchestral and solo sample playback
- Adjustable orchestra/solo mixer
- In-browser MP4 recording
- 3-2-1 recording countdown
- Recording preview, trim and MP4 export
- Full user guide in `public/docs.html`

## Tech stack

- React
- TypeScript
- Vite
- Google MediaPipe Hand Landmarker
- Tone.js / Web Audio
- Mediabunny

## Quick start

Requirements:

- Node.js LTS
- npm
- A modern Chromium-based browser such as Chrome or Edge
- Webcam
- Optional local orchestral sample pack described below

Install dependencies:

```powershell
npm install
```

### Orchestra samples

The project does **not** commit large audio sample folders to Git.

For the VSCO 2 Community Edition 256-sample pack, place the downloaded sample
folder in your normal Downloads directory, then run:

```powershell
npm run import:samples
```

You can also provide the source folder explicitly:

```powershell
node tools/import-vsco256.mjs "C:\path\to\256OrchestralSamples"
```

### Processed solo samples

Run:

```powershell
npm run install:solo-samples
```

This downloads the selected browser-oriented sample subset used by the solo
engine and writes the required attribution file locally.

### Run locally

```powershell
npm run dev
```

Then open the localhost URL printed by Vite.

### Production build

```powershell
npm run build
```

The production site is generated in:

```text
dist/
```

## Gesture overview

### Left hand — orchestra

| Gesture | Scale degree |
|---|---|
| Index | I |
| Index + middle | II |
| Index + middle + ring | III |
| Four non-thumb fingers | IV |
| All five fingers | V |
| Index + pinky | VI |
| Thumb + index + pinky | VII |
| Fist | Release |

Left-hand height increases harmonic richness:

```text
Triad -> 7th -> 9th -> 11th -> 13th
```

### Right hand — solo

Thumb pinches select four independently assignable voices:

- Thumb + index
- Thumb + middle
- Thumb + ring
- Thumb + pinky

Vertical position controls pitch. Horizontal position controls solo dynamics.
Wrist roll controls vibrato.

See the full guide at `public/docs.html`.

## Repository policy for audio

Large/generated audio files are deliberately excluded from Git.

Do not commit:

```text
public/samples/*
public/solo-samples/*
dist/
node_modules/
```

The setup scripts recreate the required sample folders locally.

This keeps clones small and separates the project code from third-party audio
licensing requirements.

## Open-source license

The original Orchestra / Gesture source code in this repository is released
under the **MIT License**. See [LICENSE](LICENSE).

That means people may use, copy, modify, distribute and build on the project,
including commercially, as long as the MIT copyright and permission notice are
preserved.

Third-party libraries and audio resources are **not relicensed** under this
repository's MIT License. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

Typical workflow:

```powershell
git checkout -b feature/my-change
npm install
npm run dev
npm run build
git add .
git commit -m "Describe the change"
git push
```

Then open a pull request on GitHub.

## Credits

- **Uthpala Kaushalya** — creator
- **gesture.live** — interaction inspiration; no affiliation
- **ChatGPT by OpenAI** — development, debugging and documentation assistance
- **Google MediaPipe** — hand tracking
- **Tone.js** — Web Audio framework
- **Mediabunny** — browser media recording/conversion
- **Versilian Studios / VSCO 2 Community Edition** — optional orchestral samples
- **nbrosowsky/tonejs-instruments** — optional processed solo samples
- **React / Vite** — application framework and build tooling

## Public deployment

The current public build uses Cloudflare Pages.

See:

```text
DEPLOY_FREE.md
```

for the deployment workflow.
