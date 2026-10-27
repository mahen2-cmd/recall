# Plan: Recall on my phone

Goal: revise on my phone from anywhere, including with no connection, while keeping one collection shared with the computer.

## Decision

- **Host:** a Hetzner Cloud server, the smallest shared plan (~€4–5/month). Always on, with enough RAM for Piper, Python and ffmpeg.
  - Free alternative to try first: Oracle Cloud Always Free (Arm, 2 OCPU / 12 GB). It needs an upgrade to Pay As You Go, which stays free within the limits, to avoid idle servers being reclaimed, and a home region with Arm capacity.
- **Access:** Tailscale on the server and on the phone. Recall has no login, so it stays off the public internet. Tailscale is free for personal use.
- **Offline:** make Recall a progressive web app (PWA). The page and audio are kept on the phone, reviews are saved locally, and they sync to the server when back online.

## Steps

### 1. Let the server be reached over Tailscale
- `server.js` listens on `127.0.0.1` and returns 403 to any `Host` other than `localhost`. Add a setting (e.g. `HOST` and `ALLOWED_HOSTS` environment variables) that allows the Tailscale name, such as `recall.<tailnet>.ts.net`. Keep the current behaviour as the default.
- Use **Tailscale Serve** to put Recall behind HTTPS on its `ts.net` name. Service workers only run on HTTPS (or `localhost`), so step 3 depends on this.

### 2. Installable app (home screen)
- Add `manifest.webmanifest` (name, colours, `display: standalone`) and app icons, and link them from `index.html`.
- `staticFile` in `server.js` only serves `/index.html`, `/js/` and `/css/`. Allow the manifest, icons and service worker as well.

### 3. Service worker: open with no connection
- Add `sw.js` to cache the app's files (`index.html`, `js/`, `css/`, icons), serving from cache when offline and updating when online.
- `index.html` loads an external stylesheet (line 8), probably the web fonts. Cache it too, or make sure the app looks right without it.
- Register the worker in `js/app.js`.

### 4. Audio on the phone
- Audio is fetched from `api/tts?text=…&lang=…` (`ttsUrl` in `js/app.js`). Have the service worker cache these responses.
- Add a "Download audio for offline" action that fetches every card side, reversed cards swapped, the same way `scripts/cache-voice.js` does on the server. Skip clips already cached.
- Cards added while offline have no server audio until back online. Fall back to the browser's `speechSynthesis`, which `canSpeak` already allows for.

### 5. Store the collection in IndexedDB
- `js/store.js` keeps a second copy in `localStorage`, limited to about 5 MB. Move it to IndexedDB, keeping the "newer copy wins" logic in `load()` and the retry in `flush()`.
- Move existing `localStorage` data across on first load.

### 6. Deploy to Hetzner
- Create the server (Ubuntu), install Node 22.15+ and Tailscale, then run `npm run setup-voice` and `npm run cache-voice`.
- Run Recall as a `systemd` service so it restarts on reboot.
- Copy `data/` from the computer to move the current collection across.
- Back up `data/` off the server (Hetzner backups at +20% of the server price, or a regular copy to the computer).

## Known limitation: sync conflicts

Saving replaces the whole collection, and the newer copy wins. If I revise offline on the phone and also revise on the computer before the phone reconnects, one set of reviews overwrites the other. Fine while I use one device at a time.

Fixing it properly would mean syncing per card, for example by sending the review log and merging by card and timestamp. Leave this for later and only do it if it becomes a problem.

## Costs

| Item | Cost |
|---|---|
| Hetzner server | ~€4–5/month |
| Hetzner backups (optional) | ~€1/month |
| Tailscale | Free |
| Text-to-speech | Free (Google/Edge/Piper; Azure free tier covers 500k characters/month) |
| Domain | Not needed with Tailscale |
