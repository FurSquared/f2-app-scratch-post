export const ascensionStorageKey = 'ascended'
export const ascensionTokens = 8
export const ascensionIntroDuration = 950
export const revealDuration = 2_000
export const landingDuration = 4_000
export const fallDurationSeconds = 0.87
const castDuration = 3_750
const runeInterval = 2_800
export const burnDuration = (ascensionTokens - 1) * runeInterval + castDuration
export const ascensionDuration =
  ascensionIntroDuration + burnDuration + revealDuration + landingDuration

type Frame = { x: number; y: number; width: number; height: number }
type Token = (
  x: number,
  y: number,
  radius: number,
  alpha: number,
  rotation: number,
  artworkRadius: number
) => void

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const pixel = (r: number, g: number, b: number, a = 255) => r | (g << 8) | (b << 16) | (a << 24)

export function ascensionRuneAt(time: number) {
  return Math.min(ascensionTokens - 1, Math.floor(Math.max(0, time) / runeInterval))
}

export function sacrificeRuneRadius(w: number, h: number) {
  return Math.max(34, Math.min(68, w * 0.15, h * 0.11))
}

export function sacrificeRunePose(timestamp: number, w: number, h: number, index: number) {
  const radius = sacrificeRuneRadius(w, h)
  const row = Math.floor(index / 2)
  const right = index % 2 === 0
  const phase = index * 1.73
  const speed = 0.00055 + index * 0.00009
  const hover = 4 + (index % 3) * 1.5
  return {
    x:
      (right ? w - radius * 0.72 : radius * 0.72) +
      Math.cos(timestamp * speed * 0.73 + phase) * hover * 0.35,
    y:
      radius * 0.85 +
      (Math.max(0, h - radius * 1.7) * row) / 4 +
      Math.sin(timestamp * speed + phase) * hover,
    rotation: timestamp * (0.000045 + index * 0.000014) * (right ? 1 : -1) + phase,
  }
}

export function createAscensionFire(
  image: HTMLImageElement,
  sourceTimestamp: number,
  sourceRunes: number
) {
  const bitmap = image.ownerDocument.createElement('canvas')
  const width = 104
  const height = Math.round((width * image.naturalHeight) / image.naturalWidth)
  let transitionCanvas: HTMLCanvasElement | undefined
  let transitionContext: CanvasRenderingContext2D | undefined
  const rotationOffsets = Array.from({ length: ascensionTokens }, (_, index) => {
    const difference = sacrificeRunePose(sourceTimestamp, 0, 0, index).rotation - index
    return Math.atan2(Math.sin(difference), Math.cos(difference))
  })
  bitmap.width = width
  bitmap.height = height
  const pixels = bitmap.getContext('2d', { willReadFrequently: true })!
  pixels.drawImage(image, 0, 0, width, height)
  const picture = pixels.getImageData(0, 0, width, height)
  const output = new Uint32Array(picture.data.buffer)
  const original = output.slice()
  const heat = new Float32Array(output.length)
  const deadline = new Float32Array(output.length)
  const bandByCell = new Uint8Array(output.length)
  const consumed = new Uint8Array(output.length)
  const ash = new Uint8Array(output.length)
  const grains = new Uint8Array(output.length)
  const visited = new Uint8Array(output.length)
  const cells = new Uint32Array(output.length)
  let previousTick = -1
  let settled = false
  let backdrop: CanvasGradient | undefined
  let previousWidth = 0
  let previousHeight = 0

  for (let i = 0; i < output.length; i += 1) {
    const x = i % width
    const y = Math.floor(i / width)
    const spread = Math.sin(x * 0.235 + y * 0.16) * 0.24 + Math.sin(x * 0.083 - y * 0.12) * 0.34
    const fray = 3.6 * Math.sin(x * 0.3 + y * 0.12) + 2.1 * Math.sin(x * 0.81 - y * 0.22)
    const row = Math.max(0, ((y + fray) / height) * ascensionTokens)
    const band = Math.min(ascensionTokens - 1, Math.floor(row))
    bandByCell[i] = band
    const local = clamp((row - band) * 0.55 + spread + Math.random() * 0.34)
    deadline[i] = band * runeInterval + 170 + local * 1740
    heat[i] = Number.POSITIVE_INFINITY
    grains[i] = Math.floor(Math.random() * 24)
  }

  function clearAirborneAsh() {
    let head = 0
    let tail = 0
    const floor = (height - 4) * width
    function mark(i: number) {
      if (ash[i] && !visited[i]) {
        visited[i] = 1
        cells[tail++] = i
      }
    }
    for (let x = 0; x < width; x += 1) {
      mark(floor + x)
    }
    while (head < tail) {
      const center = cells[head++]
      for (let y = -1; y <= 1; y += 1) {
        for (let x = -1; x <= 1; x += 1) {
          mark(center + y * width + x)
        }
      }
    }
    for (let i = 0; i < ash.length; i += 1) {
      if (!visited[i]) {
        ash[i] = 0
      }
    }
  }

  function simulate(now: number) {
    const tick = Math.floor(now / 33)
    if (previousTick === tick) {
      return
    }
    previousTick = tick

    // Falling ash uses a bottom-up pass so that a grain moves at most one cell per tick.
    for (let y = height - 5; y >= 1; y -= 1) {
      const side = (y + tick) % 2 ? 1 : -1
      for (let x = 2; x < width - 2; x += 1) {
        const i = y * width + x
        if (!ash[i]) {
          continue
        }
        let target = i + width
        if (ash[target]) {
          target += side
          if (ash[target]) {
            target -= 2 * side
          }
        }
        if (!ash[target]) {
          ash[target] = ash[i]
          ash[i] = 0
        }
      }
    }

    for (let i = 0; i < output.length; i += 1) {
      output[i] = 0
      const source = original[i]
      if (source >>> 24 < 80 || consumed[i]) {
        continue
      }
      const start = bandByCell[i] * runeInterval
      if (
        now >= deadline[i] ||
        (now > start + 260 &&
          grains[i] < 7 &&
          (heat[i - 1] + 300 < now || heat[i - width] + 300 < now))
      ) {
        heat[i] = Math.min(heat[i], now)
      }
      const age = now - heat[i]
      if (now < start || age < 0) {
        output[i] = source
        continue
      }
      if (age > 520 + grains[i] * 36 || now >= burnDuration - 460) {
        consumed[i] = 1
        if (grains[i] < 8) {
          const gx = Math.max(3, Math.min(width - 4, (i % width) + (grains[i] - 4) * 2))
          const gy = Math.min(height - 5, Math.floor(i / width))
          ash[gy * width + gx] = grains[i] + 1
        }
        continue
      }
      const char = clamp(age / 290) * 0.92
      if (grains[i] > 13 && age < 510 && (i + tick) % 13 > 3) {
        output[i] = age < 210 ? pixel(255, 156 + grains[i], 54) : pixel(239, 63 + grains[i], 20)
      } else {
        const coal = 15 + grains[i]
        output[i] = pixel(
          mix(source & 255, coal + 11, char),
          mix((source >> 8) & 255, coal, char),
          mix((source >> 16) & 255, coal - 1, char),
          source >>> 24
        )
      }
    }

    // Give the ash a low, uneven mound at the eighth and final token.
    if (now > burnDuration - 1150) {
      const progress = clamp((now - burnDuration + 1150) / 820)
      for (let x = 5; x < width - 5; x += 1) {
        const profile = Math.max(0, 1 - Math.abs(x - width * 0.52) / (width * 0.48))
        const depth = Math.floor(progress * (13 * profile ** 1.5 + grains[x] * 0.15))
        for (let row = 0; row < depth; row += 1) {
          ash[(height - 4 - row) * width + x] ||= 1 + ((x + row * 3) % 9)
        }
      }
    }
    if (!settled && now >= burnDuration - 295) {
      settled = true
      clearAirborneAsh()
    }
    for (let i = 0; i < output.length; i += 1) {
      if (ash[i]) {
        const light = 37 + ash[i] * 4 + grains[i]
        output[i] = pixel(light + 4, light + 1, light)
      }
    }
    pixels.putImageData(picture, 0, 0)
  }

  function draw(
    ctx: CanvasRenderingContext2D,
    elapsed: number,
    w: number,
    h: number,
    frame: Frame,
    token: Token
  ) {
    const time = Math.max(0, Math.min(elapsed, burnDuration))
    const progress = clamp(1 + elapsed / ascensionIntroDuration)
    const intro = progress * progress * (3 - 2 * progress)
    if (!backdrop || previousWidth !== w || previousHeight !== h) {
      previousWidth = w
      previousHeight = h
      backdrop = ctx.createRadialGradient(w * 0.53, h * 0.5, 5, w * 0.53, h * 0.5, h * 0.75)
      backdrop.addColorStop(0, '#32191b')
      backdrop.addColorStop(0.56, '#180e17')
      backdrop.addColorStop(1, '#08070e')
    }
    ctx.save()
    if (elapsed > burnDuration) {
      const u = clamp((elapsed - burnDuration) / revealDuration)
      ctx.translate(0, h * (u * u * (3 - 2 * u)))
    }
    ctx.fillStyle = backdrop
    ctx.globalAlpha = intro
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1
    if (elapsed < 0) {
      const pixelRatio = ctx.getTransform().a
      const nativeWidth = Math.max(width, Math.min(512, Math.round(frame.width * pixelRatio)))
      const nativeHeight = Math.round((nativeWidth * height) / width)
      if (!transitionCanvas) {
        transitionCanvas = image.ownerDocument.createElement('canvas')
        transitionContext = transitionCanvas.getContext('2d') ?? undefined
      }
      if (transitionCanvas.width !== nativeWidth || transitionCanvas.height !== nativeHeight) {
        transitionCanvas.width = nativeWidth
        transitionCanvas.height = nativeHeight
      }
      const blend = clamp(intro * 3.5)
      if (blend < 1 || !transitionContext) {
        ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height)
      }
      if (transitionContext && blend > 0) {
        // Keep one buffer and progressively sample a smaller grid, then draw it with nearest filtering.
        const sampleWidth = Math.round(mix(nativeWidth, width, intro))
        const sampleHeight = Math.round((sampleWidth * height) / width)
        transitionContext.clearRect(0, 0, sampleWidth, sampleHeight)
        transitionContext.drawImage(image, 0, 0, sampleWidth, sampleHeight)
        ctx.imageSmoothingEnabled = false
        ctx.globalAlpha = blend
        ctx.drawImage(
          transitionCanvas,
          0,
          0,
          sampleWidth,
          sampleHeight,
          frame.x,
          frame.y,
          frame.width,
          frame.height
        )
        ctx.globalAlpha = 1
      }
    } else {
      transitionCanvas = undefined
      transitionContext = undefined
      simulate(time)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(bitmap, frame.x, frame.y, frame.width, frame.height)
    }

    const active = ascensionRuneAt(time)
    const artworkRadius = sacrificeRuneRadius(w, h)
    const ritualRadius = Math.min(w * 0.067, 26)
    // The outgoing sparks can finish while the next rune starts its own cast.
    for (let n = Math.max(0, active - 1); n < ascensionTokens; n += 1) {
      const casting = n <= active
      const step = Math.max(0, (time - n * runeInterval) / castDuration)
      if (casting && step >= 0.91) {
        continue
      }
      const launch = clamp(step * 4)
      const wake = clamp(step * 6)
      const ignition = wake * wake * (3 - 2 * wake)
      const onRight = n % 2 === 0
      const rail = onRight ? w - Math.min(43, w * 0.12) : Math.min(43, w * 0.12)
      const railY = h * (0.15 + 0.22 * Math.floor(n / 2))
      const focusY = frame.y + frame.height * ((n + 0.48) / ascensionTokens)
      const focusX = frame.x + frame.width * (onRight ? 0.61 : 0.43)
      const shift = casting ? launch * launch : 0
      const x = mix(rail, focusX, shift * 0.78)
      const y = mix(railY + Math.sin(time * 0.003 + n) * 3, focusY, shift)
      const alpha = casting ? mix(0.48, 1, ignition) * (1 - clamp((step - 0.51) / 0.4)) : 0.48
      const source = elapsed < 0 ? sacrificeRunePose(sourceTimestamp, w, h, n) : undefined
      if (alpha > 0.01) {
        token(
          source ? mix(source.x, x, intro) : x,
          source ? mix(source.y, y, intro) : y,
          mix(artworkRadius, ritualRadius * (casting ? 1 + 0.14 * ignition : 1), intro),
          mix(0.78, alpha, intro),
          time * 0.001 + n + rotationOffsets[n] * (1 - intro),
          artworkRadius
        )
      }
      if (elapsed < 0 || !casting || step > 0.86) {
        continue
      }

      // A short spray of sparks marks the active rune's strike as the heat front spreads.
      const scale = Math.max(2, frame.width / width)
      for (let p = 0; p < 52; p += 1) {
        const phase = (step * (1.2 + (p % 7) * 0.09) + p * 0.127) % 1
        const spread = Math.sin(p * 7.13 + step * 4) * (6 + (p % 11)) * phase
        const emberX = mix(x, focusX, Math.min(1, phase * 1.8)) + spread
        const emberY = mix(y, focusY, phase) - (p % 9) * phase * 3 + phase * phase * 25
        ctx.globalAlpha = (1 - phase) * (0.8 - step * 0.56) * ignition
        ctx.fillStyle = p % 6 === 0 ? '#fff1a6' : p % 3 ? '#ff883b' : '#f73c32'
        ctx.fillRect(
          Math.round(emberX / scale) * scale,
          Math.round(emberY / scale) * scale,
          scale,
          scale
        )
      }
      ctx.globalAlpha = 1
    }
    if (elapsed < 0) {
      for (let n = ascensionTokens; n < sourceRunes; n += 1) {
        const source = sacrificeRunePose(sourceTimestamp, w, h, n)
        token(
          source.x,
          source.y,
          artworkRadius * (1 - intro * 0.65),
          0.78 * (1 - intro),
          source.rotation,
          artworkRadius
        )
      }
    }
    ctx.restore()
  }
  return { draw }
}
