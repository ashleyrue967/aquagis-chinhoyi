# AquaGIS Chinhoyi - Backend setup (Netlify)

## What is in this folder
- public/            the app (index.html, logo, icons, service worker)
- netlify/functions/api.mjs   the backend (accounts, records, photos)
- netlify.toml, package.json  Netlify settings

IMPORTANT: the backend is a Netlify Function, so drag-and-drop (Netlify Drop)
will NOT work for this version. Deploy with GitHub or the Netlify CLI.

## Option A - GitHub (easiest to keep updated)
1. Create a free GitHub repository and upload everything in this folder
   (keep the folders as they are).
2. In Netlify: Add new site > Import an existing project > pick the repo.
   Build command: leave empty.  Publish directory: public
3. Go to Site configuration > Environment variables and add:
     JWT_SECRET  = a long random text, 32+ characters (never share it)
     SETUP_CODE  = a code only you know, 8+ characters
4. Deploys > Trigger deploy > Deploy site.

## Option B - Netlify CLI (from your computer, needs Node.js)
   npm install
   npm install -g netlify-cli
   netlify login
   netlify init
   netlify env:set JWT_SECRET "put-a-long-random-text-here-32-chars-or-more"
   netlify env:set SETUP_CODE "your-private-setup-code"
   netlify deploy --prod

## First use
1. Open https://YOUR-SITE.netlify.app/api/health
   You should see {"ok":true,"jwt":true,"setupCode":true}
   (if jwt/setupCode say false, the environment variables are missing)
2. Open the app > "First-time setup (administrator only)" > enter the SETUP_CODE
   and create the administrator account. This only works once.
3. Settings (gear) > Manage officers & access > add each officer, supervisor.
4. Officers sign in once with internet, then can work offline; records sync
   automatically when the phone is online.

## Roles
- Field Officer: collects readings; sees and syncs only their own records.
- Supervisor: sees all officers' records on the dashboard, map and records list.
- Administrator: everything above + manage accounts + delete records on the server.

## Notes
- Data is stored in Netlify Blobs (built into Netlify, no extra account).
  Comfortable for a few thousand records. For tens of thousands, move to a
  database (Supabase / Postgres) - ask and I will convert it.
- Back up regularly: Sync tab > Full backup / Export CSV / GeoJSON.
- If you wrap the app in an Android Studio APK from local files, set API_BASE
  at the top of the script in index.html to your https://...netlify.app address.
