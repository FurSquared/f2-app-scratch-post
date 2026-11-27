# Scratch Post

The framework-free canvas micro app behind the **Scratch Post** window on the FurSquared Y2K site.

## Host contract

The package exports a versioned definition with a small lifecycle:

- `mount` receives host-owned surface and canvas elements, a frame scheduler, the packaged image URL, and optional host-owned services. A host can pass `modelUrl` to override the packaged GLB URL.
- `activate` enables drawing and pointer interaction.
- `suspend` stops drawing, pauses canvas simulation, and fades audio while the window or page is hidden. Purchased auto-scratchers continue advancing the persisted counter for as long as the app remains mounted.
- `resize` receives the canvas content size and device pixel ratio.
- `destroy` releases animation, input, image, and audio resources.

The host owns the shared `AudioContext` and a gain bus for this app. Scratch Post owns and disconnects the audio nodes connected to that bus. A host that restarts audio after a browser interruption can provide `audio.onRecovered`; Scratch Post then rebuilds only its audio graph without disrupting visual, input, or progress state. Storage is used to keep track of player progress.

## Development

```sh
npm install
npm run dev
npm test
npm run build
```

The Vite playground provides a draggable, resizable desktop window and exercises mount, resize, audio unlock, suspend, activate, destroy, and reopen behavior using `assets/scratch-post.webp`. Its shell lives outside the package `files` allowlist.

With WebGL available, eight sacrifice tokens unlock **Ascend**. A short tween moves the runes into formation as the post pixelates. The silent burn then takes 30 seconds, followed by two seconds to reveal the sky and four seconds for the landing. The game saves the ascended state, consumed tokens, and new inventory together after the landing. Closing before then leaves the pre-ascension save available.

In the playground, **Toggle ascension** opens the ascended game directly. Toggle it again to return to 2D with eight tokens and try the full sequence.

Publishing a `v*` tag runs the package checks and publishes the matching package version and image asset to GitHub Packages.
