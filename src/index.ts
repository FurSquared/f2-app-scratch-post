const motionMargin = 10
const inputHoldMilliseconds = 250
const intensityWindowMilliseconds = 120
const audioFadeSeconds = 0.1
const gravity = 620
const maximumTwines = 64
const minimumTwineIntervalMilliseconds = 100
const twineFadeMilliseconds = 1200
const baseMaskStartRatio = 0.755
const centralBaseRevealRatio = 0.875

export type MicroAppViewport = {
  width: number
  height: number
  devicePixelRatio: number
  backingWidth: number
  backingHeight: number
}

export type MicroAppAudio = {
  context: AudioContext
  destination: AudioNode
  resume: () => void
}

export type MicroAppHost = {
  surface: HTMLElement
  canvas: HTMLCanvasElement
  imageUrl: string
  audio?: MicroAppAudio
  signal: AbortSignal
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
}

export type MicroAppActivation = {
  reason: 'page-init' | 'user-launch' | 'restore'
  userInitiated: boolean
}

export type MicroApp = {
  mount: (host: MicroAppHost) => void
  activate: (activation: MicroAppActivation) => void
  suspend: (reason: 'minimized' | 'page-hidden') => void
  resize: (viewport: MicroAppViewport) => void
  destroy: () => void
}

export type MicroAppDefinition = {
  apiVersion: 1
  manifest: {
    id: string
    title: string
    description: string
    capabilities: {
      audio: boolean
    }
    window: {
      preferredWidth: number
      preferredHeight: number
      minWidth: number
      minHeight: number
      resizable: boolean
    }
  }
  create: () => MicroApp
}

type CompactBitmap = {
  width: number
  height: number
  bits: Uint8Array
}

type CollisionBitmaps = {
  scratchable: CompactBitmap
  base: CompactBitmap
}

type ImageLayout = {
  x: number
  y: number
  width: number
  height: number
}

let collisionBitmapCache: CollisionBitmaps | undefined

function setBitmapPixel(bitmap: CompactBitmap, index: number) {
  bitmap.bits[index >> 3] |= 1 << (index & 7)
}

function hasBitmapPixel(bitmap: CompactBitmap, x: number, y: number) {
  const pixelX = Math.floor(x)
  const pixelY = Math.floor(y)
  if (pixelX < 0 || pixelY < 0 || pixelX >= bitmap.width || pixelY >= bitmap.height) {
    return false
  }

  const index = pixelY * bitmap.width + pixelX
  return (bitmap.bits[index >> 3] & (1 << (index & 7))) !== 0
}

function buildCollisionBitmaps(image: HTMLImageElement): CollisionBitmaps {
  if (
    collisionBitmapCache?.scratchable.width === image.naturalWidth &&
    collisionBitmapCache.scratchable.height === image.naturalHeight
  ) {
    return collisionBitmapCache
  }

  const width = image.naturalWidth
  const height = image.naturalHeight
  const pixelCount = width * height
  const bufferLength = Math.ceil(pixelCount / 8)
  const scratchable: CompactBitmap = {
    width,
    height,
    bits: new Uint8Array(bufferLength),
  }
  const base: CompactBitmap = {
    width,
    height,
    bits: new Uint8Array(bufferLength),
  }
  const buffer = image.ownerDocument.createElement('canvas')
  const bufferContext = buffer.getContext('2d', { willReadFrequently: true })
  buffer.width = width
  buffer.height = height
  if (!bufferContext) return { scratchable, base }

  bufferContext.drawImage(image, 0, 0)
  const pixels = bufferContext.getImageData(0, 0, width, height).data
  const baseStart = Math.floor(height * baseMaskStartRatio)
  const centralBaseReveal = Math.floor(height * centralBaseRevealRatio)
  const baseLeftEdges = new Int32Array(height)
  const baseRightEdges = new Int32Array(height)
  baseLeftEdges.fill(width)
  baseRightEdges.fill(-1)

  for (let index = 0; index < pixelCount; index += 1) {
    const channelIndex = index * 4
    const red = pixels[channelIndex]
    const green = pixels[channelIndex + 1]
    const blue = pixels[channelIndex + 2]
    const alpha = pixels[channelIndex + 3]
    if (alpha < 48) continue

    const row = Math.floor(index / width)
    const column = index - row * width
    const normalizedRow = row / height
    const normalizedColumn = column / width
    const isCentralPostColumn = normalizedColumn >= 0.34 && normalizedColumn <= 0.67
    const isLightRope =
      isCentralPostColumn &&
      normalizedRow >= 0.08 &&
      normalizedRow <= 0.83 &&
      red + green + blue > 180
    const isLowerBrownBase =
      row >= baseStart &&
      red - green > 20 &&
      green >= blue &&
      green - blue < 32 &&
      red < 205

    if (isLightRope) setBitmapPixel(scratchable, index)
    if (isLowerBrownBase) {
      baseLeftEdges[row] = Math.min(baseLeftEdges[row], column)
      baseRightEdges[row] = Math.max(baseRightEdges[row], column)
    }
  }

  for (let row = baseStart; row < height; row += 1) {
    const left = baseLeftEdges[row]
    const right = baseRightEdges[row]
    const spansBothSidesOfPost = left < width * 0.34 && right > width * 0.67
    if (!spansBothSidesOfPost) continue

    const rowStart = row * width
    for (let column = left; column <= right; column += 1) {
      const isBehindPostCore = column >= width * 0.38 && column <= width * 0.65
      if (isBehindPostCore && row < centralBaseReveal) continue
      setBitmapPixel(base, rowStart + column)
    }
  }

  buffer.width = 1
  buffer.height = 1
  collisionBitmapCache = { scratchable, base }
  return collisionBitmapCache
}

type MotionSample = {
  distance: number
  timestamp: number
}

type Twine = {
  x: number
  y: number
  velocityX: number
  velocityY: number
  angle: number
  angularVelocity: number
  length: number
  width: number
  bend: number
  bornAt: number
  lifetime: number
  settled: boolean
  landingSourceY?: number
}

function createScratchAudio(audio?: MicroAppAudio) {
  if (!audio) {
    return {
      setIntensity: (_intensity: number, _rampSeconds?: number) => {},
      destroy: () => {},
    }
  }

  const { context } = audio
  const source = context.createBufferSource()
  const filter = context.createBiquadFilter()
  const gain = context.createGain()
  const warble = context.createOscillator()
  const warbleGain = context.createGain()
  const tremoloGain = context.createGain()
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
  const samples = buffer.getChannelData(0)
  let destroyed = false

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.random() * 2 - 1
  }

  source.buffer = buffer
  source.loop = true
  filter.type = 'lowpass'
  filter.frequency.value = 700
  filter.Q.value = 1.2
  gain.gain.value = 0
  warble.type = 'triangle'
  warble.frequency.value = 18
  warbleGain.gain.value = 0
  tremoloGain.gain.value = 0

  source.connect(filter)
  filter.connect(gain)
  gain.connect(audio.destination)
  warble.connect(warbleGain)
  warble.connect(tremoloGain)
  warbleGain.connect(filter.detune)
  tremoloGain.connect(gain.gain)
  source.start()
  warble.start()

  const cancelScheduledChanges = (parameter: AudioParam, time: number) => {
    if (typeof parameter.cancelAndHoldAtTime === 'function') {
      parameter.cancelAndHoldAtTime(time)
      return
    }

    const currentValue = parameter.value
    parameter.cancelScheduledValues(time)
    parameter.setValueAtTime(currentValue, time)
  }

  const setIntensity = (intensity: number, rampSeconds = 0.025) => {
    if (destroyed) return
    if (intensity > 0) audio.resume()

    const normalizedIntensity = Math.max(0, Math.min(1, intensity))
    const now = context.currentTime
    const gainValue = gain.gain
    const filterFrequency = filter.frequency
    const warbleRate = warble.frequency
    const warbleDepth = warbleGain.gain
    const tremoloDepth = tremoloGain.gain

    cancelScheduledChanges(gainValue, now)
    cancelScheduledChanges(filterFrequency, now)
    cancelScheduledChanges(warbleRate, now)
    cancelScheduledChanges(warbleDepth, now)
    cancelScheduledChanges(tremoloDepth, now)
    gainValue.linearRampToValueAtTime(normalizedIntensity * 0.13, now + rampSeconds)
    filterFrequency.linearRampToValueAtTime(650 + normalizedIntensity * 1900, now + rampSeconds)
    warbleRate.linearRampToValueAtTime(18 + normalizedIntensity * 16, now + rampSeconds)
    warbleDepth.linearRampToValueAtTime(normalizedIntensity * 520, now + rampSeconds)
    tremoloDepth.linearRampToValueAtTime(normalizedIntensity * 0.026, now + rampSeconds)
  }

  return {
    setIntensity,
    destroy() {
      if (destroyed) return
      destroyed = true
      source.stop()
      warble.stop()
      source.disconnect()
      filter.disconnect()
      gain.disconnect()
      warble.disconnect()
      warbleGain.disconnect()
      tremoloGain.disconnect()
    },
  }
}

function createScratchPostApp(): MicroApp {
  let mounted = false
  let activateApp = () => {}
  let suspendApp = () => {}
  let resizeApp = (_viewport: MicroAppViewport) => {}
  let destroyApp = () => {}

  return {
    mount(host) {
      if (mounted) throw new Error('Scratch Post is already mounted')

      const { canvas, surface } = host
      const context = canvas.getContext('2d')
      const ImageConstructor = surface.ownerDocument.defaultView?.Image
      if (!context || !ImageConstructor) {
        throw new Error('Scratch Post requires a browser 2D canvas context')
      }

      mounted = true
      const image = new ImageConstructor()
      const scratchAudio = createScratchAudio(host.audio)
    let animationFrame = 0
    let pixelRatio = 1
    let displayWidth = 1
    let displayHeight = 1
    let lastInputAt = 0
    let lastPointerPosition: { x: number; y: number; timestamp: number } | undefined
    let motionSamples: MotionSample[] = []
    let audioFading = false
    let imageReady = false
    let collisionBitmaps: CollisionBitmaps | undefined
    let lastIntensity = 0
    let lastFrameAt = 0
    let distanceSinceLastTwine = 0
    let nextTwineDistance = 18 + Math.random() * 18
    let lastTwineAt = Number.NEGATIVE_INFINITY
    let twines: Twine[] = []
      let appActive = false

    const imageLayout = () => {
      const availableWidth = displayWidth - motionMargin * 2
      const availableHeight = displayHeight - motionMargin * 2
      const scale = Math.min(
        availableWidth / image.naturalWidth,
        availableHeight / image.naturalHeight
      )
      const width = image.naturalWidth * scale
      const height = image.naturalHeight * scale

      return {
        x: (displayWidth - width) / 2,
        y: (displayHeight - height) / 2,
        width,
        height,
      }
    }

    const bitmapCoordinates = (x: number, y: number, layout: ImageLayout) => ({
      x: ((x - layout.x) / layout.width) * image.naturalWidth,
      y: ((y - layout.y) / layout.height) * image.naturalHeight,
    })

    const hitsBitmap = (bitmap: CompactBitmap, x: number, y: number, layout: ImageLayout) => {
      const point = bitmapCoordinates(x, y, layout)
      return hasBitmapPixel(bitmap, point.x, point.y)
    }

    const findBaseContact = (
      twine: Twine,
      previousY: number,
      radius: number,
      layout: ImageLayout
    ) => {
      const base = collisionBitmaps?.base
      if (!base || twine.y <= previousY) return undefined

      const sourceScale = layout.height / image.naturalHeight
      const previousBottom = previousY + radius
      const currentBottom = twine.y + radius
      const halfLengthX = Math.abs(Math.cos(twine.angle) * twine.length * 0.5)
      const sampleXs = [twine.x - halfLengthX, twine.x, twine.x + halfLengthX]
      let earliestContact:
        | {
            surface: number
            sourceX: number
            sourceY: number
          }
        | undefined

      sampleXs.forEach((sampleX) => {
        const sourceX = ((sampleX - layout.x) / layout.width) * image.naturalWidth
        const startY = Math.max(
          0,
          Math.floor(((previousBottom - layout.y) / layout.height) * image.naturalHeight)
        )
        const endY = Math.min(
          image.naturalHeight - 1,
          Math.ceil(((currentBottom - layout.y) / layout.height) * image.naturalHeight)
        )

        for (let sourceY = startY; sourceY <= endY; sourceY += 1) {
          if (!hasBitmapPixel(base, sourceX, sourceY)) continue
          const surface = layout.y + sourceY * sourceScale
          if (!earliestContact || surface < earliestContact.surface) {
            earliestContact = { surface, sourceX, sourceY }
          }
          break
        }
      })

      return earliestContact
    }

    const chooseLandingSourceY = (sourceX: number, firstSourceY: number) => {
      const base = collisionBitmaps?.base
      if (!base) return firstSourceY

      const candidates: number[] = []
      for (let sourceY = firstSourceY; sourceY < base.height; sourceY += 1) {
        if (hasBitmapPixel(base, sourceX, sourceY)) candidates.push(sourceY)
      }
      if (!candidates.length) return firstSourceY

      const interiorProgress = 0.18 + Math.random() * 0.68
      return candidates[Math.min(candidates.length - 1, Math.floor(candidates.length * interiorProgress))]
    }

    const resize = (viewport: MicroAppViewport) => {
      const previousWidth = displayWidth
      const previousHeight = displayHeight
      pixelRatio = viewport.devicePixelRatio
      displayWidth = viewport.width
      displayHeight = viewport.height
      const scaleX = displayWidth / previousWidth
      const scaleY = displayHeight / previousHeight
      if (previousWidth > 1 && previousHeight > 1) {
        twines.forEach((twine) => {
          twine.x *= scaleX
          twine.y *= scaleY
          twine.velocityX *= scaleX
          twine.velocityY *= scaleY
        })
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      requestDraw()
    }

    const currentIntensity = (timestamp: number) => {
      motionSamples = motionSamples.filter(
        (sample) => timestamp - sample.timestamp <= intensityWindowMilliseconds
      )
      const distance = motionSamples.reduce((total, sample) => total + sample.distance, 0)
      return Math.min(1, distance / 120)
    }

    const requestDraw = () => {
      if (appActive && !animationFrame) animationFrame = host.requestFrame(draw)
    }

    const updateTwines = (timestamp: number, layout: ImageLayout) => {
      const elapsed = lastFrameAt ? Math.min(0.034, (timestamp - lastFrameAt) / 1000) : 0

      twines = twines.filter((twine) => {
        if (timestamp - twine.bornAt >= twine.lifetime) return false
        if (!elapsed || twine.settled) return true

        const previousY = twine.y
        twine.velocityY += gravity * elapsed
        twine.x += twine.velocityX * elapsed
        twine.y += twine.velocityY * elapsed
        twine.angle += twine.angularVelocity * elapsed

        const radius = twine.length / 2 + Math.abs(twine.bend) + twine.width
        if (twine.x < radius) {
          twine.x = radius
          twine.velocityX = Math.abs(twine.velocityX) * 0.42
        } else if (twine.x > displayWidth - radius) {
          twine.x = displayWidth - radius
          twine.velocityX = -Math.abs(twine.velocityX) * 0.42
        }

        if (twine.y < radius) {
          twine.y = radius
          twine.velocityY = Math.abs(twine.velocityY) * 0.42
        }

        const sourceScale = layout.height / image.naturalHeight
        const landingY =
          twine.landingSourceY === undefined
            ? undefined
            : layout.y + twine.landingSourceY * sourceScale
        if (landingY !== undefined && twine.y >= landingY) {
          twine.y = landingY
          twine.settled = true
          twine.velocityX = 0
          twine.velocityY = 0
          twine.angularVelocity = 0
          twine.angle = Math.max(-0.28, Math.min(0.28, twine.angle))
        } else if (twine.landingSourceY === undefined) {
          const baseContact = findBaseContact(twine, previousY, radius, layout)
          if (baseContact) {
            twine.landingSourceY = chooseLandingSourceY(
              baseContact.sourceX,
              baseContact.sourceY
            )
            twine.velocityX = 0
            twine.angularVelocity *= 0.35
          }
        }

        return twine.y - radius <= displayHeight
      })
    }

    const drawTwines = (timestamp: number, offsetX: number, offsetY: number) => {
      context.save()
      context.beginPath()
      context.rect(0, 0, displayWidth, displayHeight)
      context.clip()
      context.lineCap = 'round'

      twines.forEach((twine) => {
        const age = timestamp - twine.bornAt
        const fadeStartsAt = twine.lifetime - twineFadeMilliseconds
        const opacity =
          age > fadeStartsAt ? Math.max(0, (twine.lifetime - age) / twineFadeMilliseconds) : 1
        const halfLength = twine.length / 2

        context.save()
        context.translate(
          twine.x + (twine.settled ? offsetX : 0),
          twine.y + (twine.settled ? offsetY : 0)
        )
        context.rotate(twine.angle + (twine.settled ? offsetX * 0.012 : 0))
        context.globalAlpha = opacity * 0.92
        context.strokeStyle = '#9b763f'
        context.lineWidth = twine.width
        context.beginPath()
        context.moveTo(-halfLength, 0)
        context.quadraticCurveTo(0, twine.bend, halfLength, 0)
        context.stroke()

        context.globalAlpha = opacity * 0.72
        context.strokeStyle = '#ead39a'
        context.lineWidth = Math.max(0.55, twine.width * 0.38)
        context.beginPath()
        context.moveTo(-halfLength, -twine.width * 0.2)
        context.quadraticCurveTo(0, twine.bend - twine.width * 0.25, halfLength, 0)
        context.stroke()
        context.restore()
      })

      context.restore()
    }

    const draw = (timestamp: number) => {
      animationFrame = 0
      if (!appActive) return
      context.clearRect(0, 0, displayWidth, displayHeight)
      if (!imageReady) return

      const idleMilliseconds = timestamp - lastInputAt
      const inputActive = idleMilliseconds <= inputHoldMilliseconds
      const intensity = inputActive
        ? lastIntensity * Math.max(0, 1 - idleMilliseconds / inputHoldMilliseconds)
        : 0
      const amplitude = inputActive && intensity > 0 ? 1 + intensity * 7 : 0
      const offsetX = amplitude ? (Math.random() * 2 - 1) * amplitude : 0
      const offsetY = amplitude ? (Math.random() * 2 - 1) * amplitude : 0
      const layout = imageLayout()

      context.drawImage(
        image,
        layout.x + offsetX,
        layout.y + offsetY,
        layout.width,
        layout.height
      )
      updateTwines(timestamp, layout)
      drawTwines(timestamp, offsetX, offsetY)
      lastFrameAt = timestamp

      if (!inputActive && !audioFading) {
        audioFading = true
        scratchAudio.setIntensity(0, audioFadeSeconds)
      }

      if (inputActive || twines.length) requestDraw()
    }

    const emitTwine = (
      x: number,
      y: number,
      movementX: number,
      movementY: number,
      elapsedMilliseconds: number,
      distance: number,
      timestamp: number
    ) => {
      if (!imageReady) return

      const layout = imageLayout()
      distanceSinceLastTwine += distance
      if (
        distanceSinceLastTwine < nextTwineDistance ||
        timestamp - lastTwineAt < minimumTwineIntervalMilliseconds ||
        twines.length >= maximumTwines
      ) {
        return
      }

      const elapsedSeconds = Math.max(1 / 120, Math.min(0.08, elapsedMilliseconds / 1000))
      const gestureSpeed = distance / elapsedSeconds
      const directionX = movementX / distance
      const directionY = movementY / distance
      const shedSpeed = Math.min(520, Math.max(105, gestureSpeed * (0.3 + Math.random() * 0.2)))

      twines.push({
        x: x + (Math.random() * 4 - 2),
        y: y + (Math.random() * 4 - 2),
        velocityX: directionX * shedSpeed + (Math.random() * 70 - 35),
        velocityY: directionY * shedSpeed + (Math.random() * 70 - 35),
        angle: Math.atan2(movementY, movementX) + (Math.random() * 0.7 - 0.35),
        angularVelocity: Math.random() * 9 - 4.5,
        length: 7 + Math.random() * 11,
        width: 1 + Math.random() * 1.25,
        bend: Math.random() * 5 - 2.5,
        bornAt: timestamp,
        lifetime: 3000 + Math.random() * 7000,
        settled: false,
      })
      distanceSinceLastTwine = 0
      nextTwineDistance = 18 + Math.random() * 18
      lastTwineAt = timestamp
    }

    const recordMovement = (event: PointerEvent) => {
      if (!appActive) return

      const timestamp = performance.now()
      const rect = surface.getBoundingClientRect()
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top
      const scratchable = collisionBitmaps?.scratchable
      if (!scratchable || !hitsBitmap(scratchable, localX, localY, imageLayout())) {
        resetPointer()
        return
      }

      const previous = lastPointerPosition
      const distance = previous
        ? Math.hypot(event.clientX - previous.x, event.clientY - previous.y)
        : 0

      lastPointerPosition = { x: event.clientX, y: event.clientY, timestamp }
      if (
        !previous ||
        distance < 0.5 ||
        timestamp - previous.timestamp > inputHoldMilliseconds
      ) {
        return
      }

      emitTwine(
        localX,
        localY,
        event.clientX - previous.x,
        event.clientY - previous.y,
        timestamp - previous.timestamp,
        distance,
        timestamp
      )
      motionSamples.push({ distance, timestamp })
      lastInputAt = timestamp
      audioFading = false
      lastIntensity = currentIntensity(timestamp)
      scratchAudio.setIntensity(lastIntensity)
      requestDraw()
    }

    const resetPointer = () => {
      lastPointerPosition = undefined
      distanceSinceLastTwine = 0
      nextTwineDistance = 18 + Math.random() * 18
    }

    const handleImageLoad = () => {
      collisionBitmaps = buildCollisionBitmaps(image)
      imageReady = true
      requestDraw()
    }
    image.addEventListener('load', handleImageLoad)
    image.src = host.imageUrl

    surface.addEventListener('pointermove', recordMovement)
    surface.addEventListener('pointerleave', resetPointer)
    surface.addEventListener('pointerup', resetPointer)
    surface.addEventListener('pointercancel', resetPointer)

      activateApp = () => {
        if (appActive) return
        appActive = true
        requestDraw()
      }
      suspendApp = () => {
        appActive = false
        if (animationFrame) host.cancelFrame(animationFrame)
        animationFrame = 0
        resetPointer()
        scratchAudio.setIntensity(0, audioFadeSeconds)
      }
      resizeApp = resize
      destroyApp = () => {
        if (!mounted) return
        suspendApp()
        mounted = false
        image.removeEventListener('load', handleImageLoad)
      surface.removeEventListener('pointermove', recordMovement)
      surface.removeEventListener('pointerleave', resetPointer)
      surface.removeEventListener('pointerup', resetPointer)
      surface.removeEventListener('pointercancel', resetPointer)
      image.src = ''
      twines = []
      context.clearRect(0, 0, displayWidth, displayHeight)
        scratchAudio.destroy()
      }
    },

    activate() {
      if (!mounted) throw new Error('Scratch Post must be mounted before activation')
      activateApp()
    },

    suspend() {
      suspendApp()
    },

    resize(viewport) {
      if (!mounted) throw new Error('Scratch Post must be mounted before resize')
      resizeApp(viewport)
    },

    destroy() {
      destroyApp()
    }
  }
}

export const scratchPostApp: MicroAppDefinition = {
  apiVersion: 1,
  manifest: {
    id: 'scratch-post',
    title: 'Scratch Post',
    description: 'Scratch that itch',
    capabilities: {
      audio: true,
    },
    window: {
      preferredWidth: 330,
      preferredHeight: 520,
      minWidth: 260,
      minHeight: 360,
      resizable: false,
    },
  },
  create: createScratchPostApp,
}

export default scratchPostApp
