# Block Blast

A clean, **ad-free** Block Blast clone you can install on your phone. Pure
HTML/CSS/JS — no build step, no tracking, no ads. Works offline once installed.

## How to play

- An 8×8 board and a tray of **3 pieces** at the bottom.
- **Drag** a piece onto the board. Pieces can't be rotated (just like the original).
- Fill a complete **row or column** to clear it. Clearing multiple lines at once,
  or clearing on consecutive moves (**combos**), scores big.
- When **none** of your three pieces can fit anywhere, it's game over.
- Your **best score** is saved on the device.

## Install on your iPhone (no App Store)

1. Open the game's URL in **Safari**.
2. Tap the **Share** button (the square with an arrow).
3. Tap **Add to Home Screen**.
4. Launch it from the home-screen icon — it runs full-screen, ad-free, and offline.

Android/Chrome: open the URL, then menu → **Install app** / **Add to Home screen**.

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | App shell + PWA meta tags |
| `styles.css` | Theme variables, board/blocks, animations |
| `engine.js` | Pure game logic (pieces, clears, scoring, game-over) — unit tested |
| `app.js` | Rendering, drag-and-drop input, animations, persistence |
| `manifest.webmanifest`, `sw.js` | PWA install + offline cache |
| `icons/`, `favicon.svg` | App icons (regenerate with `tools/gen_icons.py`) |
| `test/` | `engine.test.mjs` (logic) + `ui.smoke.mjs` (headless Chrome) |

## Develop & test

```bash
# run the game locally
python3 -m http.server 8000
# then open http://localhost:8000

# logic tests (no deps)
node test/engine.test.mjs

# headless UI smoke test (needs Google Chrome installed)
node test/ui.smoke.mjs
```

## Deploy

Any static host works. This repo is set up for **GitHub Pages** — push to `main`
and enable Pages (Settings → Pages → Deploy from branch → `main` / root). All
paths are relative, so it works under the `/<repo>/` subpath.

## Regenerate icons

```bash
python3 tools/gen_icons.py          # writes favicon.svg + tools/icon-src.svg
# rasterize with headless Chrome, then resize with sips (see tools/gen_icons.py header)
```
