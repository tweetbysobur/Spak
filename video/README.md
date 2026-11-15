# SPak demo film

Output: `../public/demo/spak-product-demo.mp4`. 1920x1080, 30 fps, 96 s, H.264 and AAC, about 33 MB.

## Sources

| Material | Origin |
|---|---|
| Website footage | Browser capture of production, usespak.vercel.app |
| App footage | Browser capture of a local build of the current code on mainnet settings, with a simulated, empty wallet. Labelled on screen |
| Intelligence data | Live read of public mainnet wallets, because the demo wallet is empty. Labelled on screen |
| Logo | Real brand SVGs from `public/brand/` |
| Voiceover | Kokoro-82M text to speech (voice am_michael), script in `audio/script.json` |
| Music and sound effects | Synthesised by `audio/score.mjs`. No licensed audio |
| Fonts | Sora, Inter, JetBrains Mono (@fontsource) |

No transfer was made. The film shows no settlement and says so.

## Storyboard

See `../docs/SPAK-DEMO-VIDEO.md`. Scene timing lives in `src/timeline.json`.

## Reproduce

    npm install
    npm run capture        # needs the app running locally on port 3100
    npm run voice
    npm run score
    npx remotion render src/index.ts SpakDemo out/spak-product-demo.mp4

Layout: `capture/` capture scripts, `audio/` voice and score, `public/shots/` captures, `public/audio/` sound, `src/` the Remotion film.
