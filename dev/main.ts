import scratchPostApp, {
  type MicroApp,
  type MicroAppActivation,
  type MicroAppAudio,
} from '../src'
import { createMicroAppStorage } from './microAppStorage'
import './styles.css'

const imageUrl = new URL('../assets/scratch-post.webp', import.meta.url).href
const appWindow = document.querySelector<HTMLElement>('#app-window')!
const surface = document.querySelector<HTMLElement>('#app-surface')!
const canvas = document.querySelector<HTMLCanvasElement>('#app-canvas')!
const titleBar = document.querySelector<HTMLElement>('#title-bar')!
const desktopShortcut = document.querySelector<HTMLButtonElement>('#desktop-shortcut')!
const addBillionPointsButton =
  document.querySelector<HTMLButtonElement>('#add-billion-points')!
const taskButton = document.querySelector<HTMLButtonElement>('#task-button')!
const minimizeButton = document.querySelector<HTMLButtonElement>('#minimize')!
const closeButton = document.querySelector<HTMLButtonElement>('#close')!
const status = document.querySelector<HTMLElement>('#status')!
const storage = createMicroAppStorage(scratchPostApp.manifest.id)

let sharedAudioContext: AudioContext | undefined
let appAudioGain: GainNode | undefined
let app: MicroApp | undefined
let abortController: AbortController | undefined
let minimized = false

const updateStatus = () => {
  const state = !app ? 'closed' : minimized ? 'suspended' : document.hidden ? 'page hidden' : 'active'
  const audioState = sharedAudioContext?.state ?? 'not created'
  status.textContent = `${state} · audio ${audioState} · ${canvas.width}×${canvas.height}`
}

const unlockAudio = () => {
  if (!sharedAudioContext) {
    sharedAudioContext = new window.AudioContext()
    sharedAudioContext.addEventListener('statechange', updateStatus)
  }
  if (
    sharedAudioContext.state !== 'running' &&
    sharedAudioContext.state !== 'closed'
  ) {
    void sharedAudioContext.resume().catch(() => {}).finally(updateStatus)
  }
  updateStatus()
}

const createAudioBus = (): MicroAppAudio => {
  unlockAudio()
  const context = sharedAudioContext!
  appAudioGain = context.createGain()
  appAudioGain.connect(context.destination)

  return {
    context,
    destination: appAudioGain,
    resume: unlockAudio,
  }
}

const setAudioActive = (active: boolean) => {
  if (!sharedAudioContext || !appAudioGain) return

  const now = sharedAudioContext.currentTime
  appAudioGain.gain.cancelScheduledValues(now)
  appAudioGain.gain.setValueAtTime(appAudioGain.gain.value, now)
  appAudioGain.gain.linearRampToValueAtTime(active ? 1 : 0, now + 0.04)
}

const resize = () => {
  if (!app) return

  const rect = surface.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return

  const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  const backingWidth = Math.max(1, Math.round(width * devicePixelRatio))
  const backingHeight = Math.max(1, Math.round(height * devicePixelRatio))
  if (canvas.width !== backingWidth) canvas.width = backingWidth
  if (canvas.height !== backingHeight) canvas.height = backingHeight
  app.resize({ width, height, devicePixelRatio, backingWidth, backingHeight })
  updateStatus()
}

const activate = (activation: MicroAppActivation) => {
  if (!app || minimized || document.hidden) return
  setAudioActive(true)
  app.activate(activation)
  updateStatus()
}

const mount = (activation: MicroAppActivation) => {
  if (app) {
    activate(activation)
    return
  }

  abortController = new AbortController()
  app = scratchPostApp.create()
  app.mount({
    surface,
    canvas,
    imageUrl,
    audio: createAudioBus(),
    storage,
    signal: abortController.signal,
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  })
  resize()
  activate(activation)
}

const open = () => {
  unlockAudio()
  const reason = app ? 'restore' : 'user-launch'
  minimized = false
  appWindow.hidden = false
  taskButton.hidden = false
  mount({ reason, userInitiated: true })
  updateStatus()
}

const minimize = () => {
  minimized = true
  setAudioActive(false)
  app?.suspend('minimized')
  appWindow.hidden = true
  updateStatus()
}

const close = () => {
  app?.destroy()
  abortController?.abort()
  appAudioGain?.disconnect()
  app = undefined
  abortController = undefined
  appAudioGain = undefined
  minimized = false
  appWindow.hidden = true
  taskButton.hidden = true
  canvas.width = 1
  canvas.height = 1
  updateStatus()
}

const addBillionPoints = async () => {
  addBillionPointsButton.disabled = true
  close()

  try {
    const storedCount = await storage.get<number>('twines-scratched')
    const currentCount =
      typeof storedCount === 'number' &&
      Number.isSafeInteger(storedCount) &&
      storedCount >= 0
        ? storedCount
        : 0
    await storage.setMany([
      [
        'twines-scratched',
        Math.min(Number.MAX_SAFE_INTEGER, currentCount + 1_000_000_000),
      ],
      ['scratch-counter', true],
    ])
  } finally {
    open()
    addBillionPointsButton.disabled = false
  }
}

new ResizeObserver(resize).observe(surface)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    setAudioActive(false)
    app?.suspend('page-hidden')
  } else {
    activate({ reason: 'restore', userInitiated: false })
  }
  updateStatus()
})
surface.addEventListener('pointerdown', unlockAudio)
desktopShortcut.addEventListener('dblclick', open)
taskButton.addEventListener('click', open)
minimizeButton.addEventListener('click', minimize)
closeButton.addEventListener('click', close)
addBillionPointsButton.addEventListener('click', () => {
  void addBillionPoints()
})

let drag:
  | {
      pointerId: number
      offsetX: number
      offsetY: number
    }
  | undefined

titleBar.addEventListener('pointerdown', (event) => {
  if ((event.target as Element).closest('button')) return
  const rect = appWindow.getBoundingClientRect()
  drag = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  }
  titleBar.setPointerCapture(event.pointerId)
})
titleBar.addEventListener('pointermove', (event) => {
  if (drag?.pointerId !== event.pointerId) return
  appWindow.style.left = `${Math.max(0, event.clientX - drag.offsetX)}px`
  appWindow.style.top = `${Math.max(0, event.clientY - drag.offsetY)}px`
})
titleBar.addEventListener('pointerup', (event) => {
  if (drag?.pointerId === event.pointerId) titleBar.releasePointerCapture(event.pointerId)
  drag = undefined
})

mount({ reason: 'page-init', userInitiated: false })
