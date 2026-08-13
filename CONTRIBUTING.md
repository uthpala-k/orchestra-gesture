# Contributing to Orchestra / Gesture

Thanks for contributing.

## Before making a change

For a small bug fix, you can open a pull request directly.

For a large behavior/UI/audio change, opening a GitHub issue first is useful so
the approach can be discussed before a lot of work is done.

## Development setup

```powershell
npm install
npm run import:samples
npm run install:solo-samples
npm run dev
```

The audio commands are optional if you are working on parts of the application
that do not require the full sample libraries.

## Branches

Create a descriptive branch:

```powershell
git checkout -b fix/camera-start
```

or:

```powershell
git checkout -b feature/new-gesture
```

## Before a pull request

Run:

```powershell
npm run build
```

The TypeScript build must pass.

Then commit your work with a useful message:

```powershell
git add .
git commit -m "Fix camera startup on deployed site"
```

## Pull requests

Please describe:

- what changed
- why it changed
- how you tested it
- browser/OS used for gesture or recording changes
- screenshots or short recordings when the UI changed

## Audio files

Do not commit downloaded/generated sample libraries.

The repository `.gitignore` excludes:

```text
public/samples/*
public/solo-samples/*
```

Use the importer/downloader scripts instead.

## Licensing

By submitting a contribution, you agree that your contribution may be
distributed under the repository's MIT License, unless a file clearly states a
different license.

Do not submit third-party code, audio, images or other assets unless their
license permits inclusion and the required attribution/license information is
also added.
