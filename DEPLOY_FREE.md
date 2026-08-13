# Orchestra / Gesture V1.0 — FREE PUBLIC DEPLOYMENT

Recommended hosting: Cloudflare Pages Direct Upload.

Why this method:
- no paid domain required
- your public address will be PROJECT-NAME.pages.dev
- HTTPS is provided by the platform
- no GitHub repository is required
- updates can be deployed again from the same PC
- the application remains a static client-side app

IMPORTANT:
Before deployment, your V1.0 project must contain your actual sample folders:

public/
  samples/
    sample-manifest.json
    ...
  solo-samples/
    solo-manifest.json
    ATTRIBUTION.txt
    ...

If these folders are already working in V0.9, copy both folders from the
working V0.9 project's public folder into V1.0/public.

------------------------------------------------------------
STEP 1 — TEST V1.0 LOCALLY
------------------------------------------------------------

Open the V1.0 project in VS Code.

Terminal:

npm install

If you copied the sample folders from V0.9, run:

npm run dev

Open the localhost address and verify:
- camera works
- chords work
- solo samples work
- About works
- User Guide works
- recording works

Stop the development server with Ctrl+C.

------------------------------------------------------------
STEP 2 — CREATE THE PRODUCTION BUILD
------------------------------------------------------------

Run:

npm run build

Successful Vite output creates:

dist/

The dist folder is the actual finished website.

Vite copies files in public/ into dist/, so the documentation and sample
folders are included in the production site.

------------------------------------------------------------
STEP 3 — CREATE A FREE CLOUDFLARE ACCOUNT
------------------------------------------------------------

Create/login to a Cloudflare account.

You do NOT need to purchase a domain.

------------------------------------------------------------
STEP 4 — LOG IN FROM POWERSHELL
------------------------------------------------------------

From the V1.0 project folder:

npx wrangler login

The first time, npm may ask permission to install Wrangler.
Answer y.

Your browser opens a Cloudflare authorization page.
Approve the connection.

Return to PowerShell.

------------------------------------------------------------
STEP 5 — FIRST PUBLIC DEPLOYMENT
------------------------------------------------------------

Run:

npx wrangler pages deploy dist

For the project name choose something simple, for example:

orchestra-gesture

If that name is unavailable, try:

orchestra-gesture-studio
orchestra-gesture-uthpala

When asked for the production branch, use:

main

Wrangler uploads the contents of dist.

At the end it will display a public URL similar to:

https://orchestra-gesture.pages.dev

That URL is your public website.

------------------------------------------------------------
STEP 6 — TEST THE PUBLIC WEBSITE
------------------------------------------------------------

Open the pages.dev URL in a new Chrome/Edge window.

Test:
1. Start Camera + Audio
2. Allow camera permission
3. Left hand chords
4. Right hand samples
5. Snap / Glide
6. Settings
7. About
8. User Guide
9. 3-2-1 recording
10. Preview + trim + MP4 export

Also test from another device/browser if possible.

------------------------------------------------------------
STEP 7 — FUTURE UPDATES
------------------------------------------------------------

Whenever you change code:

npm run build
npx wrangler pages deploy dist

The same pages.dev production site will update.

Do NOT upload src/ or node_modules manually. Deploy dist/.

------------------------------------------------------------
CHECK FILE LIMITS BEFORE DEPLOYMENT
------------------------------------------------------------

Cloudflare Pages Free currently supports:
- up to 20,000 site files with Wrangler
- maximum 25 MiB per individual static asset

To inspect very large files in PowerShell:

Get-ChildItem .\dist -Recurse -File |
Sort-Object Length -Descending |
Select-Object -First 20 FullName,@{Name="MB";Expression={[math]::Round($_.Length/1MB,2)}}

If no individual file exceeds 25 MB, the important per-file size rule is met.

------------------------------------------------------------
OPTIONAL: CHECK TOTAL WEBSITE SIZE
------------------------------------------------------------

PowerShell:

$bytes = (Get-ChildItem .\dist -Recurse -File | Measure-Object Length -Sum).Sum
"{0:N2} MB" -f ($bytes / 1MB)

This is useful for knowing how large the initial download might be.

------------------------------------------------------------
PUBLIC RELEASE NAME
------------------------------------------------------------

Orchestra / Gesture
Version 1.0

Creator:
Uthpala Kaushalya

Suggested public project URL:
orchestra-gesture.pages.dev

No paid domain is necessary.
