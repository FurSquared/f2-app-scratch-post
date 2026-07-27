const motionMargin = 10
const inputHoldMilliseconds = 250
const intensityWindowMilliseconds = 120
const audioFadeSeconds = 0.1
const gravity = 620
const maximumTwines = 1_000
const minimumTwineIntervalMilliseconds = 100
const twineFadeMilliseconds = 1200
const baseMaskStartRatio = 0.755
const centralBaseRevealRatio = 0.875
const twinesScratchedStorageKey = 'twines-scratched'
const scratchCounterStorageKey = 'scratch-counter'
const autoScratchersStorageKey = 'auto-scratchers'
const storageSyncMilliseconds = 1000
const twineCounterRevealCount = 100
const twineDingCounts = new Set<number>([
  200,
  300,
  1_000,
  2_000,
  10_000,
  50_000,
])

type AutoScratcherId =
  | 'clawless-bapper'
  | 'kitty-claws'
  | 'bear-claws'
  | 'tiger-claws'

type AutoScratcherDefinition = {
  id: AutoScratcherId
  label: string
  color: string
  cost: number
  twinesPerSecond: number
}

type AutoScratcherActor = {
  countdownSeconds: number
  anchorSourceX?: number
  anchorSourceY?: number
  positionPhaseX: number
  positionPhaseY: number
  anglePhase: number
  positionAngularSpeed: number
  angleAngularSpeed: number
  baseAngle: number
  positionAmplitudeX: number
  positionAmplitudeY: number
  angleAmplitude: number
  scratchDistance: number
  visualSourceX?: number
  visualSourceY?: number
  visualAngle?: number
  lastVisualPoseAt?: number
}

type AutoScratcherMotionProfile = {
  positionSpeed: readonly [number, number]
  angleSpeed: readonly [number, number]
  positionAmplitudeX: readonly [number, number]
  positionAmplitudeY: readonly [number, number]
  angleAmplitude: readonly [number, number]
}

const autoScratcherMotionProfiles: Record<AutoScratcherId, AutoScratcherMotionProfile> = {
  'clawless-bapper': {
    positionSpeed: [0.55, 0.75],
    angleSpeed: [0.75, 1.05],
    positionAmplitudeX: [0.006, 0.014],
    positionAmplitudeY: [0.035, 0.06],
    angleAmplitude: [0.12, 0.24],
  },
  'kitty-claws': {
    positionSpeed: [0.85, 1.15],
    angleSpeed: [0.9, 1.3],
    positionAmplitudeX: [0.009, 0.018],
    positionAmplitudeY: [0.025, 0.05],
    angleAmplitude: [0.16, 0.3],
  },
  'tiger-claws': {
    positionSpeed: [0.4, 0.55],
    angleSpeed: [0.65, 0.9],
    positionAmplitudeX: [0.006, 0.012],
    positionAmplitudeY: [0.06, 0.1],
    angleAmplitude: [0.12, 0.24],
  },
  'bear-claws': {
    positionSpeed: [0.45, 0.65],
    angleSpeed: [0.7, 1],
    positionAmplitudeX: [0.007, 0.014],
    positionAmplitudeY: [0.05, 0.085],
    angleAmplitude: [0.14, 0.28],
  },
}

const autoScratcherDefinitions: AutoScratcherDefinition[] = [
  {
    id: 'clawless-bapper',
    label: 'Clawless Bapper',
    color: '#fff',
    cost: 100,
    twinesPerSecond: 1,
  },
  {
    id: 'kitty-claws',
    label: 'Kitty Claws',
    color: '#111',
    cost: 500,
    twinesPerSecond: 10,
  },
  {
    id: 'tiger-claws',
    label: 'Tiger Claws',
    color: '#f28c28',
    cost: 10_000,
    twinesPerSecond: 50,
  },
  {
    id: 'bear-claws',
    label: 'Bear Claws',
    color: '#8b5a2b',
    cost: 50_000,
    twinesPerSecond: 200,
  },
]

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

export type MicroAppStorage = {
  get: <Value = unknown>(key: string) => Promise<Value | undefined>
  set: <Value = unknown>(key: string, value: Value) => Promise<void>
  getMany: <Value = unknown>(keys: string[]) => Promise<Map<string, Value>>
  setMany: (entries: Iterable<readonly [string, unknown]>) => Promise<void>
  entries: <Value = unknown>(options?: {
    prefix?: string
    limit?: number
    cursor?: string
  }) => Promise<{
    entries: Array<[string, Value]>
    cursor?: string
  }>
  delete: (key: string) => Promise<void>
  clear: () => Promise<void>
}

export type MicroAppHost = {
  surface: HTMLElement
  canvas: HTMLCanvasElement
  imageUrl: string
  audio?: MicroAppAudio
  storage?: MicroAppStorage
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
      storage: boolean
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

export type DrawPawOptions = {
  color: string
  x: number
  y: number
  scale?: number
  rotation?: number
  alpha?: number
  strokeColor?: string
  strokeWidth?: number
  anchorX?: number
  anchorY?: number
}

const pawPalmCenter = { x: 9, y: 16 }
const pawCenterToe = { x: 18, y: 8 }
const pawForwardX = pawCenterToe.x - pawPalmCenter.x
const pawForwardY = pawCenterToe.y - pawPalmCenter.y
const pawForwardAngle = Math.atan2(pawForwardY, pawForwardX)
const pawCenterToeDistance = Math.hypot(pawForwardX, pawForwardY)

export function drawPaw(
  context: CanvasRenderingContext2D,
  {
    color,
    x,
    y,
    scale = 1,
    rotation = 0,
    alpha = 1,
    strokeColor,
    strokeWidth = 0,
    anchorX = 0,
    anchorY = 0,
  }: DrawPawOptions
) {
  context.save()
  context.translate(x, y)
  context.rotate(rotation)
  context.scale(scale, scale)
  context.translate(-anchorX, -anchorY)
  context.globalAlpha *= alpha
  context.fillStyle = color
  context.strokeStyle = strokeColor ?? 'transparent'
  context.lineWidth = strokeWidth
  context.lineJoin = 'round'

  const toePads = [
    { x: 11, y: 4, radius: 2 },
    { x: 18, y: 8, radius: 2 },
    { x: 20, y: 16, radius: 2 },
  ]
  toePads.forEach((pad) => {
    context.beginPath()
    context.arc(pad.x, pad.y, pad.radius, 0, Math.PI * 2)
    context.fill()
    if (strokeColor && strokeWidth > 0) context.stroke()
  })

  const body = new Path2D(
    'M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z'
  )
  context.fill(body)
  if (strokeColor && strokeWidth > 0) context.stroke(body)
  context.restore()
}

function createScratchAudio(audio?: MicroAppAudio) {
  if (!audio) {
    return {
      setIntensity: (_intensity: number, _rampSeconds?: number) => {},
      playDing: () => {},
      playThump: () => {},
      playMew: () => {},
      playRoar: () => {},
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
  const activeSounds = new Set<{
    sources: AudioScheduledSourceNode[]
    nodes: AudioNode[]
  }>()
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

  const scheduleSound = (
    sources: AudioScheduledSourceNode[],
    nodes: AudioNode[],
    startAt: number,
    duration: number
  ) => {
    const sound = { sources, nodes }
    activeSounds.add(sound)
    sources[0].addEventListener('ended', () => {
      nodes.forEach((node) => node.disconnect())
      activeSounds.delete(sound)
    })
    sources.forEach((soundSource) => {
      soundSource.start(startAt)
      soundSource.stop(startAt + duration)
    })
  }

  const playDing = () => {
    if (destroyed) return
    audio.resume()

    const now = context.currentTime
    const duration = 0.8
    const fundamental = context.createOscillator()
    const overtone = context.createOscillator()
    const overtoneGain = context.createGain()
    const envelope = context.createGain()
    const sources = [fundamental, overtone]
    const nodes: AudioNode[] = [fundamental, overtone, overtoneGain, envelope]

    fundamental.type = 'sine'
    fundamental.frequency.setValueAtTime(880, now)
    overtone.type = 'sine'
    overtone.frequency.setValueAtTime(1760, now)
    overtoneGain.gain.value = 0.24
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(0.12, now + 0.008)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration)

    fundamental.connect(envelope)
    overtone.connect(overtoneGain)
    overtoneGain.connect(envelope)
    envelope.connect(audio.destination)
    scheduleSound(sources, nodes, now, duration)
  }

  const playThump = () => {
    if (destroyed) return
    audio.resume()

    const now = context.currentTime
    const duration = 0.3
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(145, now)
    oscillator.frequency.exponentialRampToValueAtTime(52, now + duration)
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(0.2, now + 0.006)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.connect(envelope)
    envelope.connect(audio.destination)
    scheduleSound([oscillator], [oscillator, envelope], now, duration)
  }

  const playMew = () => {
    if (destroyed) return
    audio.resume()

    const now = context.currentTime
    const duration = 0.65
    const voice = context.createOscillator()
    const vibrato = context.createOscillator()
    const vibratoDepth = context.createGain()
    const envelope = context.createGain()
    voice.type = 'triangle'
    voice.frequency.setValueAtTime(520, now)
    voice.frequency.exponentialRampToValueAtTime(780, now + 0.18)
    voice.frequency.exponentialRampToValueAtTime(460, now + duration)
    vibrato.type = 'sine'
    vibrato.frequency.value = 24
    vibratoDepth.gain.value = 20
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(0.09, now + 0.035)
    envelope.gain.setValueAtTime(0.08, now + 0.3)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    vibrato.connect(vibratoDepth)
    vibratoDepth.connect(voice.frequency)
    voice.connect(envelope)
    envelope.connect(audio.destination)
    scheduleSound(
      [voice, vibrato],
      [voice, vibrato, vibratoDepth, envelope],
      now,
      duration
    )
  }

  const playRoar = () => {
    if (destroyed) return
    audio.resume()

    const now = context.currentTime
    const duration = 1.15
    const noiseBuffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * duration),
      context.sampleRate
    )
    const noiseSamples = noiseBuffer.getChannelData(0)
    for (let index = 0; index < noiseSamples.length; index += 1) {
      noiseSamples[index] = Math.random() * 2 - 1
    }

    const noise = context.createBufferSource()
    const growl = context.createOscillator()
    const growlGain = context.createGain()
    const filter = context.createBiquadFilter()
    const envelope = context.createGain()
    noise.buffer = noiseBuffer
    growl.type = 'sawtooth'
    growl.frequency.setValueAtTime(82, now)
    growl.frequency.exponentialRampToValueAtTime(44, now + duration)
    growlGain.gain.value = 0.18
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(520, now)
    filter.frequency.exponentialRampToValueAtTime(180, now + duration)
    filter.Q.value = 1.4
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(0.16, now + 0.06)
    envelope.gain.setValueAtTime(0.13, now + 0.45)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    noise.connect(filter)
    growl.connect(growlGain)
    growlGain.connect(filter)
    filter.connect(envelope)
    envelope.connect(audio.destination)
    scheduleSound(
      [noise, growl],
      [noise, growl, growlGain, filter, envelope],
      now,
      duration
    )
  }

  return {
    setIntensity,
    playDing,
    playThump,
    playMew,
    playRoar,
    destroy() {
      if (destroyed) return
      destroyed = true
      activeSounds.forEach(({ sources, nodes }) => {
        sources.forEach((soundSource) => soundSource.stop())
        nodes.forEach((node) => node.disconnect())
      })
      activeSounds.clear()
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
      const originalCursor = surface.style.cursor
      const randomInRange = ([minimum, maximum]: readonly [number, number]) =>
        minimum + Math.random() * (maximum - minimum)
      const createAutoScratcherActor = (id: AutoScratcherId): AutoScratcherActor => {
        const profile = autoScratcherMotionProfiles[id]
        return {
          countdownSeconds: Number.POSITIVE_INFINITY,
          positionPhaseX: Math.random() * Math.PI * 2,
          positionPhaseY: Math.random() * Math.PI * 2,
          anglePhase: Math.random() * Math.PI * 2,
          positionAngularSpeed: randomInRange(profile.positionSpeed),
          angleAngularSpeed: randomInRange(profile.angleSpeed),
          baseAngle: -Math.PI / 2,
          positionAmplitudeX: randomInRange(profile.positionAmplitudeX),
          positionAmplitudeY: randomInRange(profile.positionAmplitudeY),
          angleAmplitude: randomInRange(profile.angleAmplitude),
          scratchDistance: 28 + Math.random() * 12,
        }
      }
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
    let twinesScratched = 0
    let twinesScratchedThisMount = 0
    let twinesScratchedLoaded = false
    let twinesScratchedDirty = false
    let autoScratchersDirty = false
    let scratchCounterActive = false
    const autoScratchers = Object.fromEntries(
      autoScratcherDefinitions.map((definition) => [
        definition.id,
        {
          actors: [] as AutoScratcherActor[],
          purchasedThisMount: 0,
        },
      ])
    ) as Record<
      AutoScratcherId,
      {
        actors: AutoScratcherActor[]
        purchasedThisMount: number
      }
    >
    const particleGenerationCredits = Object.fromEntries(
      autoScratcherDefinitions.map((definition) => [definition.id, 0])
    ) as Record<AutoScratcherId, number>
    let purchaseHitRegions: Array<{
      id: AutoScratcherId
      x: number
      y: number
      width: number
      height: number
    }> = []
    let appActive = false

    const staggerAutoScratcherActors = (
      definition: AutoScratcherDefinition,
      immediateActor?: AutoScratcherActor
    ) => {
      const actors = autoScratchers[definition.id].actors
      if (!actors.length) return

      const stepSeconds = 1 / (definition.twinesPerSecond * actors.length)
      let nextOffset = immediateActor ? stepSeconds : 0
      actors.forEach((actor) => {
        if (actor === immediateActor) {
          actor.countdownSeconds = 0
          return
        }
        actor.countdownSeconds = nextOffset
        nextOffset += stepSeconds
      })
    }

    const playCrossedTwineDings = (previousCount: number, nextCount: number) => {
      twineDingCounts.forEach((dingCount) => {
        if (previousCount < dingCount && nextCount >= dingCount) scratchAudio.playDing()
      })
    }

    const activateScratchCounter = () => {
      if (scratchCounterActive) return
      scratchCounterActive = true
      if (host.storage) {
        void host.storage.set(scratchCounterStorageKey, true).catch(() => {})
      }
    }

    const recordTwineScratched = () => {
      const previousCount = twinesScratched
      twinesScratched += 1
      twinesScratchedThisMount += 1
      twinesScratchedDirty = true
      if (previousCount < twineCounterRevealCount && twinesScratched >= twineCounterRevealCount) {
        activateScratchCounter()
      }
      if (twinesScratchedLoaded) {
        playCrossedTwineDings(previousCount, twinesScratched)
      }
    }

    const storedAutoScratcherCounts = () =>
      Object.fromEntries(
        autoScratcherDefinitions.map((definition) => [
          definition.id,
          autoScratchers[definition.id].actors.length,
        ])
      )

    const persistAppState = async () => {
      if (
        !host.storage ||
        !twinesScratchedLoaded ||
        (!twinesScratchedDirty && !autoScratchersDirty)
      ) {
        return
      }

      const count = twinesScratched
      const autoScratcherCounts = storedAutoScratcherCounts()
      try {
        await host.storage.setMany([
          [twinesScratchedStorageKey, count],
          [autoScratchersStorageKey, autoScratcherCounts],
        ])
        if (twinesScratched === count) twinesScratchedDirty = false
        if (
          autoScratcherDefinitions.every(
            (definition) =>
              autoScratchers[definition.id].actors.length ===
                autoScratcherCounts[definition.id]
          )
        ) {
          autoScratchersDirty = false
        }
      } catch {
        // Persistence is best-effort so storage failures never interrupt the app.
      }
    }

    const loadAppState = async () => {
      if (!host.storage) {
        twinesScratchedLoaded = true
        return
      }

      try {
        const storedState = await host.storage.getMany([
          twinesScratchedStorageKey,
          scratchCounterStorageKey,
          autoScratchersStorageKey,
        ])
        const storedCount = storedState.get(twinesScratchedStorageKey)
        const validStoredCount =
          typeof storedCount === 'number' &&
          Number.isSafeInteger(storedCount) &&
          storedCount >= 0
            ? storedCount
            : 0
        twinesScratched = validStoredCount + twinesScratchedThisMount
        if (twinesScratchedThisMount > 0) {
          playCrossedTwineDings(validStoredCount, twinesScratched)
        }
        const storedCounterActive = storedState.get(scratchCounterStorageKey) === true
        scratchCounterActive = storedCounterActive || twinesScratched >= twineCounterRevealCount
        if (scratchCounterActive && !storedCounterActive) {
          void host.storage.set(scratchCounterStorageKey, true).catch(() => {})
        }

        const storedAutoScratchers = storedState.get(autoScratchersStorageKey)
        autoScratcherDefinitions.forEach((definition) => {
          const storedAutoCount =
            storedAutoScratchers &&
            typeof storedAutoScratchers === 'object' &&
            definition.id in storedAutoScratchers
              ? (storedAutoScratchers as Record<string, unknown>)[definition.id]
              : 0
          const validAutoCount =
            typeof storedAutoCount === 'number' &&
            Number.isSafeInteger(storedAutoCount) &&
            storedAutoCount >= 0
              ? storedAutoCount
              : 0
          const state = autoScratchers[definition.id]
          const totalCount = validAutoCount + state.purchasedThisMount
          while (state.actors.length < totalCount) {
            state.actors.push(createAutoScratcherActor(definition.id))
          }
          staggerAutoScratcherActors(definition, state.actors[0])
        })
        twinesScratchedDirty = twinesScratchedThisMount > 0
        autoScratchersDirty = autoScratcherDefinitions.some(
          (definition) => autoScratchers[definition.id].purchasedThisMount > 0
        )
      } catch {
        twinesScratched = twinesScratchedThisMount
        playCrossedTwineDings(0, twinesScratched)
        if (twinesScratched >= twineCounterRevealCount) activateScratchCounter()
      } finally {
        twinesScratchedLoaded = true
        if (mounted) requestDraw()
        else void persistAppState()
      }
    }

    void loadAppState()
    const storageSyncHandle = setInterval(() => {
      void persistAppState()
    }, storageSyncMilliseconds)

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

    const drawTwineCounter = () => {
      if (!twinesScratchedLoaded || !scratchCounterActive) return

      const label = String(twinesScratched)
      const fontSize = Math.max(16, Math.min(22, displayWidth * 0.045))
      const x = 12
      const y = 10

      context.save()
      context.font = `bold ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
      context.textBaseline = 'top'
      context.lineJoin = 'round'
      context.lineWidth = Math.max(3, fontSize * 0.18)
      context.strokeStyle = 'rgba(42, 31, 22, 0.9)'
      context.strokeText(label, x, y)
      context.fillStyle = '#fff'
      context.fillText(label, x, y)
      context.restore()
    }

    const drawAutoScratcherOptions = () => {
      purchaseHitRegions = []
      if (!twinesScratchedLoaded) return

      const fontSize = Math.max(13, Math.min(17, displayWidth * 0.035))
      let y = 40
      autoScratcherDefinitions.forEach((definition) => {
        if (twinesScratched < definition.cost) return

        const state = autoScratchers[definition.id]
        const actorCount = state.actors.length
        const label =
          actorCount > 0 ? `${definition.label} ×${actorCount}` : definition.label
        const pawScale = fontSize / 20
        const pawX = 9
        const pawY = y - 2
        const textX = 38

        drawPaw(context, {
          color: definition.color,
          x: pawX,
          y: pawY,
          scale: pawScale,
          strokeColor: 'rgba(42, 31, 22, 0.9)',
          strokeWidth: Math.max(2, fontSize * 0.14) / pawScale,
        })

        context.save()
        context.font = `bold ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
        context.textBaseline = 'top'
        context.lineJoin = 'round'
        context.lineWidth = Math.max(3, fontSize * 0.18)
        context.strokeStyle = 'rgba(42, 31, 22, 0.9)'
        context.strokeText(label, textX, y)
        context.fillStyle = '#fff'
        context.fillText(label, textX, y)
        const width = textX + context.measureText(label).width - pawX
        context.restore()

        purchaseHitRegions.push({
          id: definition.id,
          x: pawX,
          y: pawY,
          width,
          height: Math.max(24 * pawScale, fontSize + 6),
        })
        y += Math.max(30, fontSize + 12)
      })
    }

    const shedTwine = (
      x: number,
      y: number,
      movementX: number,
      movementY: number,
      elapsedMilliseconds: number,
      distance: number,
      timestamp: number,
      variation = 1,
      countWhenParticleLimitReached = false,
      createParticle = true
    ) => {
      if (!imageReady || distance <= 0) return false
      if (!createParticle || twines.length >= maximumTwines) {
        if (countWhenParticleLimitReached) recordTwineScratched()
        return countWhenParticleLimitReached
      }

      const elapsedSeconds = Math.max(1 / 120, Math.min(0.08, elapsedMilliseconds / 1000))
      const gestureSpeed = distance / elapsedSeconds
      const directionX = movementX / distance
      const directionY = movementY / distance
      const shedSpeed = Math.min(520, Math.max(105, gestureSpeed * (0.3 + Math.random() * 0.2)))

      twines.push({
        x: x + (Math.random() * 4 - 2) * variation,
        y: y + (Math.random() * 4 - 2) * variation,
        velocityX: directionX * shedSpeed + (Math.random() * 70 - 35) * variation,
        velocityY: directionY * shedSpeed + (Math.random() * 70 - 35) * variation,
        angle:
          Math.atan2(movementY, movementX) + (Math.random() * 0.7 - 0.35) * variation,
        angularVelocity: Math.random() * 9 - 4.5,
        length: 7 + Math.random() * 11,
        width: 1 + Math.random() * 1.25,
        bend: Math.random() * 5 - 2.5,
        bornAt: timestamp,
        lifetime: 3000 + Math.random() * 7000,
        settled: false,
      })
      recordTwineScratched()
      return true
    }

    const randomScratchSourcePoint = () => {
      const scratchable = collisionBitmaps?.scratchable
      if (!scratchable) return undefined

      for (let attempt = 0; attempt < 40; attempt += 1) {
        const sourceX = scratchable.width * (0.47 + Math.random() * 0.06)
        const sourceY = scratchable.height * (0.1 + Math.random() * 0.58)
        if (!hasBitmapPixel(scratchable, sourceX, sourceY)) continue

        return { x: sourceX, y: sourceY }
      }

      return undefined
    }

    const automaticScratchPose = (
      actor: AutoScratcherActor,
      timestamp: number,
      layout: ImageLayout
    ) => {
      const scratchable = collisionBitmaps?.scratchable
      if (!scratchable) return undefined
      if (actor.anchorSourceX === undefined || actor.anchorSourceY === undefined) {
        const anchor = randomScratchSourcePoint()
        if (!anchor) return undefined
        actor.anchorSourceX = anchor.x
        actor.anchorSourceY = anchor.y
      }

      const timeSeconds = timestamp / 1000
      const offsetX =
        Math.sin(timeSeconds * actor.positionAngularSpeed + actor.positionPhaseX) *
        scratchable.width *
        actor.positionAmplitudeX
      const offsetY =
        Math.sin(
          timeSeconds * actor.positionAngularSpeed * 0.45 + actor.positionPhaseY
        ) *
        scratchable.height *
        actor.positionAmplitudeY
      const validAtScale = (scale: number) =>
        hasBitmapPixel(
          scratchable,
          actor.anchorSourceX! + offsetX * scale,
          actor.anchorSourceY! + offsetY * scale
        )
      let amplitudeScale = 1
      if (!validAtScale(amplitudeScale)) {
        let validScale = 0
        let invalidScale = 1
        for (let iteration = 0; iteration < 10; iteration += 1) {
          const candidateScale = (validScale + invalidScale) / 2
          if (validAtScale(candidateScale)) validScale = candidateScale
          else invalidScale = candidateScale
        }
        amplitudeScale = validScale
      }

      const targetSourceX = actor.anchorSourceX + offsetX * amplitudeScale
      const targetSourceY = actor.anchorSourceY + offsetY * amplitudeScale
      const targetAngle =
        actor.baseAngle +
        Math.sin(timeSeconds * actor.angleAngularSpeed + actor.anglePhase) *
          actor.angleAmplitude
      if (
        actor.visualSourceX === undefined ||
        actor.visualSourceY === undefined ||
        actor.visualAngle === undefined ||
        actor.lastVisualPoseAt === undefined
      ) {
        actor.visualSourceX = targetSourceX
        actor.visualSourceY = targetSourceY
        actor.visualAngle = targetAngle
      } else {
        const elapsedSeconds = Math.max(
          0,
          Math.min(0.05, (timestamp - actor.lastVisualPoseAt) / 1000)
        )
        const blend = 1 - Math.exp(-elapsedSeconds * 14)
        actor.visualSourceX += (targetSourceX - actor.visualSourceX) * blend
        actor.visualSourceY += (targetSourceY - actor.visualSourceY) * blend
        actor.visualAngle += (targetAngle - actor.visualAngle) * blend
      }
      actor.lastVisualPoseAt = timestamp

      return {
        x: layout.x + (actor.visualSourceX / scratchable.width) * layout.width,
        y: layout.y + (actor.visualSourceY / scratchable.height) * layout.height,
        angle: actor.visualAngle,
      }
    }

    const emitAutomaticTwine = (
      actor: AutoScratcherActor,
      timestamp: number,
      layout: ImageLayout,
      createParticle: boolean
    ) => {
      const pose = automaticScratchPose(actor, timestamp, layout)
      if (!pose) return false

      const distance = actor.scratchDistance
      return shedTwine(
        pose.x,
        pose.y,
        Math.cos(pose.angle) * distance,
        Math.sin(pose.angle) * distance,
        24,
        distance,
        timestamp,
        0,
        true,
        createParticle
      )
    }

    const advanceAutoScratcherCountdowns = (timestamp: number) => {
      const elapsedSeconds = lastFrameAt
        ? Math.min(0.034, (timestamp - lastFrameAt) / 1000)
        : 0
      if (!elapsedSeconds) return

      autoScratcherDefinitions.forEach((definition) => {
        const state = autoScratchers[definition.id]
        state.actors.forEach((actor) => {
          actor.countdownSeconds -= elapsedSeconds
        })
      })
    }

    const drawAutoScratcherPaws = (timestamp: number, layout: ImageLayout) => {
      const timeSeconds = timestamp / 1000
      autoScratcherDefinitions.forEach((definition) => {
        const actors = autoScratchers[definition.id].actors
        if (!actors.length) return

        const visualActor = actors[0]
        const pose = automaticScratchPose(visualActor, timestamp, layout)
        if (!pose) return

        const constantMotion = actors.length >= 3
        const productionRate = definition.twinesPerSecond * actors.length
        const strokeDistance =
          Math.max(13, Math.min(24, layout.width * 0.065)) * 3
        const pawScale =
          Math.max(0.62, Math.min(0.9, layout.width / 360)) * 2
        const levelSpeedMultiplier =
          actors.length === 1 ? 0.45 : actors.length === 2 ? 0.72 : 1.45
        const visualPixelsPerSecond = Math.min(
          180,
          Math.max(
            constantMotion ? 150 : 0,
            (70 + Math.log1p(definition.twinesPerSecond) * 18) *
              levelSpeedMultiplier
          )
        )
        const travelSeconds = (strokeDistance * 2) / visualPixelsPerSecond
        const dwellSeconds = constantMotion
          ? 0
          : Math.max(0.08, 0.42 - Math.log1p(productionRate) * 0.07)
        const cycleSeconds = travelSeconds + dwellSeconds
        const phaseOffset =
          (visualActor.positionPhaseX / (Math.PI * 2)) * cycleSeconds
        const cycleElapsed = (timeSeconds + phaseOffset) % cycleSeconds
        const travelProgress = Math.min(1, cycleElapsed / travelSeconds)
        const scratchProgress =
          cycleElapsed >= travelSeconds
            ? 0
            : 0.5 - Math.cos(travelProgress * Math.PI * 2) * 0.5
        const centerToeDistance = pawCenterToeDistance * pawScale
        const scratchOffset = strokeDistance * (scratchProgress - 0.5)
        const pawX =
          pose.x -
          Math.cos(pose.angle) * (centerToeDistance - scratchOffset)
        const pawY =
          pose.y -
          Math.sin(pose.angle) * (centerToeDistance - scratchOffset)

        drawPaw(context, {
          color: definition.color,
          x: pawX,
          y: pawY,
          scale: pawScale,
          rotation: pose.angle - pawForwardAngle,
          alpha: 0.92,
          strokeColor: 'rgba(42, 31, 22, 0.9)',
          strokeWidth: 2.2 / pawScale,
          anchorX: pawPalmCenter.x,
          anchorY: pawPalmCenter.y,
        })
      })
    }

    const emitDueAutoScratches = (timestamp: number, layout: ImageLayout) => {
      const dueBatches: Array<{
        definition: AutoScratcherDefinition
        visualActor: AutoScratcherActor
        count: number
      }> = []

      autoScratcherDefinitions.forEach((definition) => {
        const state = autoScratchers[definition.id]
        const visualActor = state.actors[0]
        if (!visualActor) return

        const intervalSeconds = 1 / definition.twinesPerSecond
        let dueCount = 0
        state.actors.forEach((actor) => {
          while (actor.countdownSeconds <= 0) {
            dueCount += 1
            actor.countdownSeconds += intervalSeconds
          }
        })
        if (dueCount > 0) {
          dueBatches.push({ definition, visualActor, count: dueCount })
        }
      })

      const totalDue = dueBatches.reduce((total, batch) => total + batch.count, 0)
      if (!totalDue) return

      const availableParticles = Math.min(
        totalDue,
        Math.max(0, maximumTwines - twines.length)
      )
      const particleAllocations = Object.fromEntries(
        autoScratcherDefinitions.map((definition) => [definition.id, 0])
      ) as Record<AutoScratcherId, number>

      if (availableParticles === totalDue) {
        dueBatches.forEach((batch) => {
          particleAllocations[batch.definition.id] = batch.count
          particleGenerationCredits[batch.definition.id] = 0
        })
      } else if (availableParticles > 0) {
        dueBatches.forEach((batch) => {
          particleGenerationCredits[batch.definition.id] +=
            (availableParticles * batch.count) / totalDue
        })

        for (let slot = 0; slot < availableParticles; slot += 1) {
          const batch = dueBatches
            .filter(
              (candidate) =>
                particleAllocations[candidate.definition.id] < candidate.count
            )
            .sort(
              (left, right) =>
                particleGenerationCredits[right.definition.id] -
                particleGenerationCredits[left.definition.id]
            )[0]
          if (!batch) break

          particleAllocations[batch.definition.id] += 1
          particleGenerationCredits[batch.definition.id] -= 1
        }
      }

      dueBatches.forEach((batch) => {
        const particleCount = particleAllocations[batch.definition.id]
        for (let emission = 0; emission < batch.count; emission += 1) {
          emitAutomaticTwine(
            batch.visualActor,
            timestamp,
            layout,
            emission < particleCount
          )
        }
      })
    }

    const hasAutoScratchers = () =>
      autoScratcherDefinitions.some(
        (definition) => autoScratchers[definition.id].actors.length > 0
      )

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
      advanceAutoScratcherCountdowns(timestamp)
      updateTwines(timestamp, layout)
      drawTwines(timestamp, offsetX, offsetY)
      drawAutoScratcherPaws(timestamp, layout)
      emitDueAutoScratches(timestamp, layout)
      drawTwineCounter()
      drawAutoScratcherOptions()
      lastFrameAt = timestamp

      if (!inputActive && !audioFading) {
        audioFading = true
        scratchAudio.setIntensity(0, audioFadeSeconds)
      }

      if (inputActive || twines.length || hasAutoScratchers()) requestDraw()
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

      if (
        shedTwine(
          x,
          y,
          movementX,
          movementY,
          elapsedMilliseconds,
          distance,
          timestamp
        )
      ) {
        distanceSinceLastTwine = 0
        nextTwineDistance = 18 + Math.random() * 18
        lastTwineAt = timestamp
      }
    }

    const findPurchaseAt = (x: number, y: number) =>
      purchaseHitRegions.find(
        (region) =>
          x >= region.x &&
          x <= region.x + region.width &&
          y >= region.y &&
          y <= region.y + region.height
      )

    const buyAutoScratcher = (id: AutoScratcherId) => {
      const definition = autoScratcherDefinitions.find((candidate) => candidate.id === id)
      if (!definition || twinesScratched < definition.cost) return

      twinesScratched -= definition.cost
      twinesScratchedDirty = true
      const state = autoScratchers[id]
      const actor = createAutoScratcherActor(id)
      state.actors.push(actor)
      state.purchasedThisMount += 1
      staggerAutoScratcherActors(definition, actor)
      autoScratchersDirty = true

      if (id === 'clawless-bapper') scratchAudio.playThump()
      else if (id === 'kitty-claws') scratchAudio.playMew()
      else scratchAudio.playRoar()
      requestDraw()
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!appActive) return

      const rect = surface.getBoundingClientRect()
      const purchase = findPurchaseAt(event.clientX - rect.left, event.clientY - rect.top)
      if (!purchase) return

      event.preventDefault()
      resetPointer()
      buyAutoScratcher(purchase.id)
    }

    const recordMovement = (event: PointerEvent) => {
      if (!appActive) return

      const timestamp = performance.now()
      const rect = surface.getBoundingClientRect()
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top
      const purchase = findPurchaseAt(localX, localY)
      surface.style.cursor = purchase ? 'pointer' : originalCursor
      if (purchase) {
        resetPointer()
        return
      }
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

    const handlePointerLeave = () => {
      surface.style.cursor = originalCursor
      resetPointer()
    }

    const handleImageLoad = () => {
      collisionBitmaps = buildCollisionBitmaps(image)
      imageReady = true
      requestDraw()
    }
    image.addEventListener('load', handleImageLoad)
    image.src = host.imageUrl

    surface.addEventListener('pointerdown', handlePointerDown)
    surface.addEventListener('pointermove', recordMovement)
    surface.addEventListener('pointerleave', handlePointerLeave)
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
        surface.style.cursor = originalCursor
        resetPointer()
        scratchAudio.setIntensity(0, audioFadeSeconds)
      }
      resizeApp = resize
      destroyApp = () => {
        if (!mounted) return
        clearInterval(storageSyncHandle)
        void persistAppState()
        suspendApp()
        mounted = false
        image.removeEventListener('load', handleImageLoad)
      surface.removeEventListener('pointerdown', handlePointerDown)
      surface.removeEventListener('pointermove', recordMovement)
      surface.removeEventListener('pointerleave', handlePointerLeave)
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
      storage: true,
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
