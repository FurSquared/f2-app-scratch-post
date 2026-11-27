/** The ascended scene owns one WebGL canvas, two static textures, and a reusable sprite batch. */
type Vec3 = [number, number, number]
export type IconPainter = (
  ctx: CanvasRenderingContext2D,
  slot: number,
  x: number,
  y: number
) => void
type Accessor = { bufferView: number; count: number; componentType: number }
type Model = {
  accessors: Accessor[]
  bufferViews: { byteOffset?: number; byteLength: number }[]
  meshes: {
    primitives: { attributes: Record<string, number>; indices: number; material: number }[]
  }[]
  materials: {
    pbrMetallicRoughness: { baseColorTexture: { index: number } }
    extensions?: { KHR_materials_sheen?: { sheenColorFactor: number[] } }
  }[]
  images: { bufferView: number; mimeType: string }[]
  textures: { source: number; sampler: number }[]
  samplers: { wrapS: number; wrapT: number }[]
}

const yaw = 0.34
const elevation = 0.29
const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)]
const up: Vec3 = [
  -Math.sin(yaw) * Math.sin(elevation),
  Math.cos(elevation),
  -Math.cos(yaw) * Math.sin(elevation),
]
const eye: Vec3 = [
  Math.sin(yaw) * Math.cos(elevation),
  Math.sin(elevation),
  Math.cos(yaw) * Math.cos(elevation),
]
const centerY = 0.402
const cylinderRadius = 0.061
const padHalf = 0.185
const ground = 0.032
const tau = Math.PI * 2
const maxFibers = 360
const iconColumns = 8
const iconRows = 4
const stride = 6
const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n))

const projection = `
uniform vec3 right, up;
uniform mediump vec3 eye;
uniform vec2 scale;
vec4 project(vec3 p) {
  p.y -= ${centerY};
  return vec4(dot(p, right) * scale.x, dot(p, up) * scale.y, -dot(p, eye) * .55, 1.);
}`

function program(gl: WebGLRenderingContext, vertex: string, fragment: string) {
  const result = gl.createProgram()!
  for (const [kind, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(kind)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw Error(gl.getShaderInfoLog(shader) ?? '')
    }
    gl.attachShader(result, shader)
    gl.deleteShader(shader)
  }
  gl.linkProgram(result)
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
    throw Error(gl.getProgramInfoLog(result) ?? '')
  }
  return result
}

function createTexture(
  gl: WebGLRenderingContext,
  image: TexImageSource,
  wrapS: number,
  wrapT: number
) {
  const texture = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT)
  gl.generateMipmap(gl.TEXTURE_2D)
  return texture
}

export function createHeaven(
  surface: HTMLElement,
  under: HTMLCanvasElement,
  paintIcon: IconPainter
) {
  const doc = surface.ownerDocument
  const canvas = doc.createElement('canvas')
  const context = canvas.getContext('webgl', { alpha: true, antialias: true, depth: true })
  if (!context) {
    return undefined
  }
  const gl: WebGLRenderingContext = context
  canvas.setAttribute('aria-hidden', 'true')
  canvas.dataset.scratchPostWebgl = ''
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    visibility: 'hidden',
    zIndex: '0',
    background: `
      radial-gradient(ellipse 30% 7% at 93% 53%, #fff 8%, #f2faff 51%, transparent 100%),
      radial-gradient(ellipse 27% 8% at 94% 47%, #fff 10%, #eff9ff 48%, transparent 100%),
      radial-gradient(ellipse 17% 9% at 68% 64%, #fff 10%, #f3fbff 39%, transparent 100%),
      radial-gradient(ellipse 22% 8% at 9% 38%, #fff 12%, #edf8ff 44%, transparent 100%),
      radial-gradient(ellipse 28% 7% at 4% 44%, #fff 17%, #e8f6ff 53%, transparent 100%),
      radial-gradient(ellipse 68% 39% at 50% 88%, #fff8e8ba 9%, #f1fbff6b 55%, transparent 100%),
      linear-gradient(180deg, #5499e7 0%, #91cafa 29%, #caeaff 61%, #f2faff 91%, #d0eafa 100%)`,
  })
  const previous = {
    position: under.style.position,
    zIndex: under.style.zIndex,
    surfacePosition: surface.style.position,
  }
  if (doc.defaultView?.getComputedStyle(surface).position === 'static') {
    surface.style.position = 'relative'
  }
  if (doc.defaultView?.getComputedStyle(under).position === 'static') {
    under.style.position = 'relative'
  }
  under.style.zIndex = '1'
  surface.prepend(canvas)

  let modelProgram: WebGLProgram
  let spriteProgram: WebGLProgram
  try {
    modelProgram = program(
      gl,
      `
      attribute vec3 position, normal;
      attribute vec2 uv;
      uniform vec2 spring;
      ${projection}
      varying vec3 n;
      varying vec2 st;
      void main() {
        vec3 p = position;
        float stretch = 1. - spring.y;
        p.y = p.y * stretch + spring.x;
        n = normalize(vec3(normal.x, normal.y / stretch, normal.z));
        st = uv;
        gl_Position = project(p);
      }`,
      `
      precision mediump float;
      uniform sampler2D tex;
      uniform vec3 sheen;
      uniform mediump vec3 eye;
      varying vec3 n;
      varying vec2 st;
      void main() {
        vec3 normal = normalize(n);
        float light = .73 + .48 * max(0., dot(normal, vec3(.43,.77,.47)));
        vec3 color = pow(texture2D(tex, st).rgb, vec3(2.2));
        float grazing = pow(1. - max(0., dot(normal, eye)), 2.);
        gl_FragColor = vec4(pow(color * light + .4 * sheen * sqrt(color) * grazing, vec3(.45455)), 1.);
      }`
    )
    spriteProgram = program(
      gl,
      `
      attribute vec3 position;
      attribute vec2 uv;
      attribute float opacity;
      ${projection}
      varying vec2 st;
      varying float alpha;
      void main() {
        gl_Position = project(position);
        st = uv;
        alpha = opacity;
      }`,
      `
      precision mediump float;
      uniform sampler2D tex;
      varying vec2 st;
      varying float alpha;
      void main() {
        vec4 color = texture2D(tex, st);
        if (color.a < .12) discard;
        gl_FragColor = vec4(color.rgb, color.a * alpha);
      }`
    )
  } catch {
    canvas.remove()
    under.style.position = previous.position
    under.style.zIndex = previous.zIndex
    surface.style.position = previous.surfacePosition
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return undefined
  }

  const buffers: WebGLBuffer[] = []
  const textures: WebGLTexture[] = []
  const makeBuffer = () => {
    const buffer = gl.createBuffer()!
    buffers.push(buffer)
    return buffer
  }
  const spriteBuffer = makeBuffer()
  const spriteData = new Float32Array((maxFibers * 2 + 30) * 6 * stride)
  let vertexOffset = 0
  gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, spriteData.byteLength, gl.DYNAMIC_DRAW)

  const atlas = doc.createElement('canvas')
  atlas.width = iconColumns * 64
  atlas.height = iconRows * 64
  const atlasContext = atlas.getContext('2d')!
  for (let slot = 0; slot < 26; slot += 1) {
    const x = (slot % iconColumns) * 64 + 32
    const y = Math.floor(slot / iconColumns) * 64 + 32
    paintIcon(atlasContext, slot, x, y)
  }
  // A two-tone atlas cell gives each strand a raised cream edge.
  const fiberSlot = 26
  const stripeX = (fiberSlot % iconColumns) * 64
  const stripeY = Math.floor(fiberSlot / iconColumns) * 64
  atlasContext.fillStyle = '#94703f'
  atlasContext.fillRect(stripeX + 3, stripeY + 3, 58, 58)
  atlasContext.fillStyle = '#ead09a'
  atlasContext.fillRect(stripeX + 3, stripeY + 9, 58, 19)
  const spriteTexture = createTexture(gl, atlas, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE)
  textures.push(spriteTexture)

  const mesh = [] as Array<{
    positions: WebGLBuffer
    normals: WebGLBuffer
    uv: WebGLBuffer
    indices: WebGLBuffer
    count: number
    type: number
    texture: WebGLTexture
    sheen: number[]
  }>
  let disposed = false
  let ready = false
  let loadPromise: Promise<void> | undefined
  const resources = new AbortController()
  const channel = (target: number, data: Uint8Array<ArrayBuffer>) => {
    const buffer = makeBuffer()
    gl.bindBuffer(target, buffer)
    gl.bufferData(target, data, gl.STATIC_DRAW)
    return buffer
  }

  function prepare(url: string) {
    loadPromise ??= (async () => {
      const response = await fetch(url, { signal: resources.signal })
      if (!response.ok) {
        throw Error('Scratch post model unavailable')
      }
      const buffer = await response.arrayBuffer()
      const view = new DataView(buffer)
      const jsonSize = view.getUint32(12, true)
      if (
        view.getUint32(0, true) !== 0x46546c67 ||
        view.getUint32(4, true) !== 2 ||
        view.getUint32(8, true) !== buffer.byteLength
      ) {
        throw Error('Invalid scratch post model')
      }
      const model = JSON.parse(
        new TextDecoder().decode(new Uint8Array(buffer, 20, jsonSize))
      ) as Model
      const bytes = (index: number) => {
        const range = model.bufferViews[index]
        return new Uint8Array(buffer, jsonSize + 28 + (range.byteOffset ?? 0), range.byteLength)
      }
      const modelTextures = await Promise.all(
        model.textures.map(async ({ source, sampler }) => {
          const { bufferView, mimeType } = model.images[source]
          const { wrapS, wrapT } = model.samplers[sampler]
          const localUrl = URL.createObjectURL(new Blob([bytes(bufferView)], { type: mimeType }))
          try {
            const image = doc.createElement('img')
            image.src = localUrl
            await image.decode()
            if (disposed) {
              throw Error('Scene disposed')
            }
            const texture = createTexture(gl, image, wrapS, wrapT)
            textures.push(texture)
            return texture
          } finally {
            URL.revokeObjectURL(localUrl)
          }
        })
      )
      if (disposed) {
        return
      }
      const uploadAttribute = (index: number) =>
        channel(gl.ARRAY_BUFFER, bytes(model.accessors[index].bufferView))
      for (const primitive of model.meshes[0].primitives) {
        const { attributes, indices, material } = primitive
        const index = model.accessors[indices]
        const palette = model.materials[material]
        mesh.push({
          positions: uploadAttribute(attributes.POSITION),
          normals: uploadAttribute(attributes.NORMAL),
          uv: uploadAttribute(attributes.TEXCOORD_0),
          indices: channel(gl.ELEMENT_ARRAY_BUFFER, bytes(index.bufferView)),
          count: index.count,
          type: index.componentType,
          texture: modelTextures[palette.pbrMetallicRoughness.baseColorTexture.index],
          sheen: palette.extensions?.KHR_materials_sheen?.sheenColorFactor ?? [0, 0, 0],
        })
      }
      ready = true
      draw(
        0,
        Math.max(1, surface.clientWidth),
        Math.max(1, surface.clientHeight),
        1,
        0,
        -1,
        [],
        0,
        0
      )
      gl.flush()
    })()
    return loadPromise
  }

  const bindProjection = (shader: WebGLProgram) => ({
    right: gl.getUniformLocation(shader, 'right'),
    up: gl.getUniformLocation(shader, 'up'),
    eye: gl.getUniformLocation(shader, 'eye'),
    scale: gl.getUniformLocation(shader, 'scale'),
  })
  const modelCamera = bindProjection(modelProgram)
  const spriteCamera = bindProjection(spriteProgram)
  const modelAttrs = ['position', 'normal', 'uv'].map((name) =>
    gl.getAttribLocation(modelProgram, name)
  )
  const spriteAttrs = ['position', 'uv', 'opacity'].map((name) =>
    gl.getAttribLocation(spriteProgram, name)
  )
  const springLocation = gl.getUniformLocation(modelProgram, 'spring')
  const sheenLocation = gl.getUniformLocation(modelProgram, 'sheen')
  function camera(binding: typeof modelCamera) {
    gl.uniform3fv(binding.right, right)
    gl.uniform3fv(binding.up, up)
    gl.uniform3fv(binding.eye, eye)
    gl.uniform2f(binding.scale, scaleX, scaleY)
  }
  // All sprites share one streamed VBO and one atlas, regardless of upgrade inventory.
  function vertex(x: number, y: number, z: number, u: number, v: number, alpha: number) {
    spriteData[vertexOffset++] = x
    spriteData[vertexOffset++] = y
    spriteData[vertexOffset++] = z
    spriteData[vertexOffset++] = u
    spriteData[vertexOffset++] = v
    spriteData[vertexOffset++] = alpha
  }
  function quad(
    x: number,
    y: number,
    z: number,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    slot: number,
    alpha: number
  ) {
    const margin = slot === fiberSlot ? 5 : 1
    const u = ((slot % iconColumns) * 64 + margin) / atlas.width
    const v = (Math.floor(slot / iconColumns) * 64 + margin) / atlas.height
    const u2 = u + (64 - margin * 2) / atlas.width
    const v2 = v + (64 - margin * 2) / atlas.height
    vertex(x - a + d, y - b + e, z - c + f, u, v, alpha)
    vertex(x - a - d, y - b - e, z - c - f, u, v2, alpha)
    vertex(x + a + d, y + b + e, z + c + f, u2, v, alpha)
    vertex(x + a + d, y + b + e, z + c + f, u2, v, alpha)
    vertex(x - a - d, y - b - e, z - c - f, u, v2, alpha)
    vertex(x + a - d, y + b - e, z + c - f, u2, v2, alpha)
  }
  function billboard(x: number, y: number, z: number, size: number, angle: number, slot: number) {
    const s = Math.sin(angle) * size
    const c = Math.cos(angle) * size
    quad(
      x,
      y,
      z,
      right[0] * c + up[0] * s,
      up[1] * s,
      right[2] * c + up[2] * s,
      up[0] * c - right[0] * s,
      up[1] * c,
      up[2] * c - right[2] * s,
      slot,
      1
    )
  }

  // Struct-of-arrays keeps particle work bounded. A slot is recycled without allocation.
  const offsets = new Float32Array(maxFibers * 13)
  let fibers = 0
  let scratchRemainder = 0
  let bounce = 0
  let bounceV = 0
  let scaleX = 2,
    scaleY = 2
  let landingKick = false
  let visible = false
  let previousTime = 0
  let time = 0
  let previousHandCount = 0
  let handClock = 0
  let handSpeed = 1
  const handX = new Float32Array(10)
  const handZ = new Float32Array(10)
  const handSweep = new Int32Array(10).fill(-1)
  const lastSwept = new Int32Array(maxFibers * 10).fill(-1)

  function fiber(x: number, y: number, z: number, strength: number) {
    if (fibers >= maxFibers) {
      return
    }
    const i = fibers++ * 13
    offsets[i] = x
    offsets[i + 1] = y
    offsets[i + 2] = z
    offsets[i + 3] = x * (2 + strength * 5) + (Math.random() - 0.5) * 0.15
    offsets[i + 4] = 0.13 + Math.random() * 0.3
    offsets[i + 5] = z * (2 + strength * 5) + (Math.random() - 0.5) * 0.15
    offsets[i + 6] = Math.random() * tau
    offsets[i + 7] = Math.random() * 7 - 3.5
    offsets[i + 8] = 0.014 + Math.random() * 0.025
    offsets[i + 9] = 0.0011 + Math.random() * 0.0016
    offsets[i + 10] = 0
    offsets[i + 11] = 4 + Math.random() * 4
    offsets[i + 12] = 0
    lastSwept.fill(-1, (fibers - 1) * 10, fibers * 10)
  }

  function pawPose(tier: number, clock: number) {
    const angle = clock * (0.66 + tier * 0.055) + tier * 2.4 + yaw - 0.56
    const rake = Math.sin(clock * (5.2 + tier * 2.4) + tier) * 0.5 + 0.5
    const y = 0.47 + Math.sin(clock * 0.93 + tier * 1.2) * 0.13 - 0.115 * rake
    return { angle, y: Math.abs(y - 0.413) < 0.015 ? y + 0.016 : y, radius: 0.1 + 0.027 * rake }
  }

  function autoFiber(tier: number, count: number) {
    const pose = pawPose(tier, time)
    for (let i = 0; i < Math.min(5, count); i += 1) {
      const angle = pose.angle + (Math.random() - 0.5) * 0.4
      fiber(
        Math.sin(angle) * 0.063,
        pose.y + (Math.random() - 0.5) * 0.025,
        Math.cos(angle) * 0.063,
        0.3
      )
    }
  }

  function hit(x: number, y: number, w: number, h: number) {
    const sx = ((x / w) * 2 - 1) / scaleX
    const sy = (1 - (y / h) * 2) / scaleY
    const ox = sx * right[0] + sy * up[0]
    const oz = sx * right[2] + sy * up[2]
    const horizontal = eye[0] ** 2 + eye[2] ** 2
    const middle = -(ox * eye[0] + oz * eye[2]) / horizontal
    const nx = ox + middle * eye[0]
    const nz = oz + middle * eye[2]
    const chord = (cylinderRadius * cylinderRadius - nx * nx - nz * nz) / horizontal
    if (chord < 0) {
      return undefined
    }
    const t = middle + Math.sqrt(chord)
    const height = (centerY + sy * up[1] + t * eye[1]) / (1 - bounce)
    if (height < 0.089 || height > 0.733 || (height > 0.406 && height < 0.421)) {
      return undefined
    }
    return { x: ox + t * eye[0], y: height, z: oz + t * eye[2] }
  }
  function scratch(
    point: { x: number; y: number; z: number },
    distance: number,
    speed: number,
    width: number
  ) {
    const amount = clamp(speed / 1800, 0.01, 1)
    bounceV += Math.min(0.18, distance * 0.011) * amount
    scratchRemainder += distance
    const interval = Math.max(12, width * 0.042)
    if (scratchRemainder < interval) {
      return false
    }
    scratchRemainder %= interval
    fiber(point.x, point.y * (1 - bounce), point.z, amount)
    return true
  }

  function hand(index: number, clock: number, handCount: number) {
    const local = clock * (0.94 + (index % 7) * 0.02) + index * 2.215
    const cycle = Math.floor(local / 8)
    const phase = local - cycle * 8
    const dir = cycle % 2 ? -1 : 1
    const active = phase >= 5.65 && phase < 7.45
    const sweep = smooth(clamp((phase - 5.65) / 1.8))
    const angle = yaw + (sweep * 2 - 1) * dir * Math.PI * 0.56
    const rad = 0.125 + (index % 3) * 0.012 + 0.009 * Math.sin(sweep * Math.PI)
    const x = Math.sin(angle) * rad
    const z = Math.cos(angle) * rad
    if (active && index < previousHandCount && handSweep[index] === cycle) {
      const dx = x - handX[index],
        dz = z - handZ[index]
      const length = dx * dx + dz * dz
      if (length > 1e-10) {
        const speedX = dx / Math.sqrt(length)
        const speedZ = dz / Math.sqrt(length)
        for (let n = 0; n < fibers; n += 1) {
          const i = n * 13
          const record = n * 10 + index
          if (offsets[i + 1] > 0.083 || lastSwept[record] === cycle) {
            continue
          }
          const mark = clamp(
            ((offsets[i] - handX[index]) * dx + (offsets[i + 2] - handZ[index]) * dz) / length
          )
          const px = offsets[i] - handX[index] - dx * mark
          const pz = offsets[i + 2] - handZ[index] - dz * mark
          if (px * px + pz * pz > 0.039 ** 2) {
            continue
          }
          lastSwept[record] = cycle
          offsets[i + 3] += speedX * (0.2 + Math.random() * 0.17)
          offsets[i + 4] = 0.12 + Math.random() * 0.15
          offsets[i + 5] += speedZ * (0.2 + Math.random() * 0.17)
          offsets[i + 12] = 2
        }
      }
    }
    handX[index] = x
    handZ[index] = z
    handSweep[index] = cycle
    const slot = 6 + index * 2 + Number(active)
    const bob = Math.sin(local * 4) * 0.002
    billboard(
      x,
      ground + 0.045 + bob,
      z,
      Math.max(0.041, 0.049 - handCount * 0.0008),
      dir * (0.14 + 0.45 * Math.sin(sweep * Math.PI)),
      slot
    )
  }

  function renderFibers(dt: number) {
    for (let n = 0; n < fibers; ) {
      const i = n * 13
      let x = offsets[i],
        y = offsets[i + 1],
        z = offsets[i + 2]
      offsets[i + 10] += dt
      if (offsets[i + 10] > offsets[i + 11] || y < -0.21) {
        const last = --fibers
        offsets.copyWithin(i, last * 13, (last + 1) * 13)
        lastSwept.copyWithin(n * 10, last * 10, (last + 1) * 10)
        continue
      }
      if (offsets[i + 12] !== 1) {
        const previousY = y
        offsets[i + 4] -= 2.1 * dt
        x += offsets[i + 3] * dt
        y += offsets[i + 4] * dt
        z += offsets[i + 5] * dt
        offsets[i + 6] += offsets[i + 7] * dt
        if (y > ground && y < 0.8) {
          const radius = Math.hypot(x, z)
          if (radius < cylinderRadius && radius > 0.0001) {
            x *= cylinderRadius / radius
            z *= cylinderRadius / radius
          }
        }
        if (
          y <= ground &&
          previousY >= ground &&
          Math.abs(x) < padHalf - 0.004 &&
          Math.abs(z) < padHalf - 0.004 &&
          offsets[i + 12] !== 2
        ) {
          offsets[i + 12] = 1
          y = ground + 0.001 + (n % 5) * 0.0008
          offsets[i + 3] = offsets[i + 4] = offsets[i + 5] = 0
        }
        offsets[i] = x
        offsets[i + 1] = y
        offsets[i + 2] = z
      }
      const a = offsets[i + 6]
      const len = offsets[i + 8] * 0.24
      const width = offsets[i + 9]
      const alpha = clamp((offsets[i + 11] - offsets[i + 10]) / 1.15)
      for (let end = -1; end <= 1; end += 2) {
        const c = Math.cos(a + end * 0.24) * len
        const s = Math.sin(a + end * 0.24) * len
        if (offsets[i + 12] === 1) {
          quad(
            x + end * c,
            y,
            z + end * s,
            c,
            0,
            s,
            (-s / len) * width,
            0,
            (c / len) * width,
            fiberSlot,
            alpha
          )
        } else {
          quad(
            x + end * c * right[0],
            y + end * s,
            z + end * c * right[2],
            c * right[0],
            s,
            c * right[2],
            (-s / len) * right[0] * width,
            (c / len) * width,
            (-s / len) * right[2] * width,
            fiberSlot,
            alpha
          )
        }
      }
      n += 1
    }
  }

  function draw(
    timestamp: number,
    w: number,
    h: number,
    dpr: number,
    drop: number,
    landingTime: number,
    tiers: readonly number[],
    handCount: number,
    handLevel: number
  ) {
    if (disposed || gl.isContextLost()) {
      return
    }
    const width = Math.max(1, Math.round(w * Math.min(1.5, dpr)))
    const height = Math.max(1, Math.round(h * Math.min(1.5, dpr)))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
    }
    const sceneScale = Math.min(w / 0.57, h / 1.045)
    scaleX = (2 * sceneScale) / w
    scaleY = (2 * sceneScale) / h
    const dt = previousTime && timestamp ? clamp((timestamp - previousTime) / 1000, 0, 0.034) : 0
    previousTime = timestamp
    time += dt
    if (landingTime >= 0.87 && !landingKick) {
      landingKick = true
      bounceV = 1.95
    }
    bounceV += (-43 * bounce - (landingTime >= 0 ? 2.9 : 4.4) * bounceV) * dt
    bounce = clamp(bounce + bounceV * dt, -0.19, 0.26)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.useProgram(modelProgram)
    camera(modelCamera)
    gl.uniform2f(springLocation, drop, bounce)
    for (const location of modelAttrs) {
      gl.enableVertexAttribArray(location)
    }

    if (drop < 1.55) {
      for (const part of mesh) {
        gl.bindBuffer(gl.ARRAY_BUFFER, part.positions)
        gl.vertexAttribPointer(modelAttrs[0], 3, gl.FLOAT, false, 0, 0)
        gl.bindBuffer(gl.ARRAY_BUFFER, part.normals)
        gl.vertexAttribPointer(modelAttrs[1], 3, gl.FLOAT, false, 0, 0)
        gl.bindBuffer(gl.ARRAY_BUFFER, part.uv)
        gl.vertexAttribPointer(modelAttrs[2], 2, gl.FLOAT, false, 0, 0)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.indices)
        gl.uniform3fv(sheenLocation, part.sheen)
        gl.bindTexture(gl.TEXTURE_2D, part.texture)
        gl.drawElements(gl.TRIANGLES, part.count, part.type, 0)
      }
    }
    for (const location of modelAttrs) {
      gl.disableVertexAttribArray(location)
    }

    vertexOffset = 0
    const targetSpeed = Math.min(10, 1.1 ** Math.max(0, handLevel - 1))
    handSpeed += (targetSpeed - handSpeed) * (1 - Math.exp(-dt * 3.5))
    handClock += dt * handSpeed
    for (let index = 0; index < handCount; index += 1) {
      hand(index, handClock, handCount)
    }
    previousHandCount = handCount
    tiers.forEach((count, tier) => {
      if (!count) {
        return
      }
      const pose = pawPose(tier, time)
      const x = Math.sin(pose.angle) * pose.radius
      const z = Math.cos(pose.angle) * pose.radius
      billboard(x, pose.y, z, 0.048, Math.sin(pose.angle - yaw) * 0.48, tier)
    })
    renderFibers(dt)
    if (!vertexOffset) {
      return
    }

    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(spriteProgram)
    camera(spriteCamera)
    gl.bindTexture(gl.TEXTURE_2D, spriteTexture)
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, spriteData.subarray(0, vertexOffset))
    for (const location of spriteAttrs) {
      gl.enableVertexAttribArray(location)
    }
    gl.vertexAttribPointer(spriteAttrs[0], 3, gl.FLOAT, false, stride * 4, 0)
    gl.vertexAttribPointer(spriteAttrs[1], 2, gl.FLOAT, false, stride * 4, 12)
    gl.vertexAttribPointer(spriteAttrs[2], 1, gl.FLOAT, false, stride * 4, 20)
    gl.drawArrays(gl.TRIANGLES, 0, vertexOffset / stride)
    for (const location of spriteAttrs) {
      gl.disableVertexAttribArray(location)
    }
  }

  gl.enable(gl.DEPTH_TEST)
  return {
    canvas,
    prepare,
    draw,
    hit,
    scratch,
    autoFiber,
    beginPlay() {
      time = 0
    },
    resetStroke() {
      scratchRemainder = 0
    },
    get ready() {
      return ready && !gl.isContextLost()
    },
    get available() {
      return !disposed && !gl.isContextLost()
    },
    show(next: boolean) {
      if (visible !== next) {
        visible = next
        canvas.style.visibility = next ? 'visible' : 'hidden'
      }
    },
    destroy() {
      disposed = true
      resources.abort()
      for (const buffer of buffers) {
        gl.deleteBuffer(buffer)
      }
      for (const texture of textures) {
        gl.deleteTexture(texture)
      }
      gl.deleteProgram(modelProgram)
      gl.deleteProgram(spriteProgram)
      canvas.remove()
      under.style.position = previous.position
      under.style.zIndex = previous.zIndex
      surface.style.position = previous.surfacePosition
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
