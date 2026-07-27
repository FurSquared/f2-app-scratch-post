# Scratch Post

The framework-free canvas micro app behind the **Scratch Post** window on the FurSquared Y2K site.

## Host contract

The package exports a versioned definition with a small lifecycle:

- `mount` receives host-owned surface and canvas elements, a frame scheduler, the packaged image URL, and an optional host-owned audio bus.
- `activate` enables drawing and pointer interaction.
- `suspend` stops drawing and fades audio while the window or page is hidden.
- `resize` receives the canvas content size and device pixel ratio.
- `destroy` releases animation, input, image, and audio resources.

The host owns the shared `AudioContext` and a gain bus for this app. Scratch Post owns and disconnects the audio nodes connected to that bus.

## Development

```sh
npm install
npm test
npm run build
```

Publishing a `v*` tag runs the package checks and publishes the matching package version and image asset to GitHub Packages.

