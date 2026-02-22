export type SeigaihaRendererBackend = "webgl" | "none";

export type SeigaihaRenderInput = {
  textureA: WebGLTexture;
  textureB: WebGLTexture;
  blendA: number;
  blendB: number;
  tileWidth: number;
  tileHeight: number;
};

export type SeigaihaWebGlRenderer = {
  backend: SeigaihaRendererBackend;
  clear: () => void;
  render: (input: SeigaihaRenderInput) => void;
  createTexture: () => WebGLTexture | null;
  uploadTexture: (texture: WebGLTexture, source: TexImageSource) => boolean;
  deleteTexture: (texture: WebGLTexture) => void;
};

function createNoopRenderer(canvas: HTMLCanvasElement | null): SeigaihaWebGlRenderer {
  if (canvas) {
    canvas.remove();
  }
  document.body.setAttribute("data-seigaiha-backend", "none");
  return {
    backend: "none",
    clear: () => {},
    render: () => {},
    createTexture: () => null,
    uploadTexture: () => false,
    deleteTexture: () => {},
  };
}

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertexSource = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() {
      vUv = (aPosition * 0.5) + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;
  const fragmentSource = `
    precision mediump float;
    uniform sampler2D uTextureA;
    uniform sampler2D uTextureB;
    uniform vec2 uResolution;
    uniform vec2 uTileSize;
    uniform float uBlendA;
    uniform float uBlendB;
    varying vec2 vUv;
    void main() {
      vec2 frag = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
      vec2 tiledUv = fract(frag / max(uTileSize, vec2(1.0, 1.0)));
      vec4 a = texture2D(uTextureA, tiledUv);
      vec4 b = texture2D(uTextureB, tiledUv);
      gl_FragColor = (a * uBlendA) + (b * uBlendB);
    }
  `;

  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

function ensureFullscreenCanvas(): HTMLCanvasElement {
  const existing = document.querySelector<HTMLCanvasElement>(
    "canvas[data-seigaiha-surface='1']"
  );
  if (existing) return existing;

  const canvas = document.createElement("canvas");
  canvas.className = "seigaiha-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.seigaihaSurface = "1";
  document.body.prepend(canvas);
  return canvas;
}

export function createSeigaihaWebGlRenderer(): SeigaihaWebGlRenderer {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      backend: "none",
      clear: () => {},
      render: () => {},
      createTexture: () => null,
      uploadTexture: () => false,
      deleteTexture: () => {},
    };
  }

  const canvas = ensureFullscreenCanvas();
  const context =
    canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    }) ?? canvas.getContext("experimental-webgl");

  if (!(context instanceof WebGLRenderingContext)) {
    return createNoopRenderer(canvas);
  }
  const gl: WebGLRenderingContext = context;

  const program = createProgram(gl);
  if (!program) {
    return createNoopRenderer(canvas);
  }

  const positionLoc = gl.getAttribLocation(program, "aPosition");
  const resolutionLoc = gl.getUniformLocation(program, "uResolution");
  const tileSizeLoc = gl.getUniformLocation(program, "uTileSize");
  const blendALoc = gl.getUniformLocation(program, "uBlendA");
  const blendBLoc = gl.getUniformLocation(program, "uBlendB");
  const textureALoc = gl.getUniformLocation(program, "uTextureA");
  const textureBLoc = gl.getUniformLocation(program, "uTextureB");

  if (
    positionLoc < 0 ||
    !resolutionLoc ||
    !tileSizeLoc ||
    !blendALoc ||
    !blendBLoc ||
    !textureALoc ||
    !textureBLoc
  ) {
    gl.deleteProgram(program);
    return createNoopRenderer(canvas);
  }

  const vertexBuffer = gl.createBuffer();
  if (!vertexBuffer) {
    gl.deleteProgram(program);
    return createNoopRenderer(canvas);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  let lastWidth = 0;
  let lastHeight = 0;

  function resizeToViewport(): void {
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const nextWidth = Math.max(1, Math.round(window.innerWidth * dpr));
    const nextHeight = Math.max(1, Math.round(window.innerHeight * dpr));
    if (nextWidth === lastWidth && nextHeight === lastHeight) {
      return;
    }
    lastWidth = nextWidth;
    lastHeight = nextHeight;
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    gl.viewport(0, 0, nextWidth, nextHeight);
  }

  window.addEventListener("resize", resizeToViewport, { passive: true });
  resizeToViewport();

  document.body.setAttribute("data-seigaiha-backend", "webgl");

  const clear = (): void => {
    resizeToViewport();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  clear();

  return {
    backend: "webgl",
    clear,
    createTexture: () => {
      const texture = gl.createTexture();
      if (!texture) return null;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // WebGL1 requires CLAMP_TO_EDGE for NPOT textures to stay complete.
      // We still tile by using fract() in the shader coordinates.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      return texture;
    },
    uploadTexture: (texture, source) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } catch {
        return false;
      }
      return true;
    },
    deleteTexture: (texture) => {
      gl.deleteTexture(texture);
    },
    render: (input) => {
      resizeToViewport();

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input.textureA);
      gl.uniform1i(textureALoc, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, input.textureB);
      gl.uniform1i(textureBLoc, 1);

      gl.uniform2f(resolutionLoc, canvas.width, canvas.height);
      gl.uniform2f(
        tileSizeLoc,
        Math.max(1, input.tileWidth),
        Math.max(1, input.tileHeight)
      );
      gl.uniform1f(blendALoc, input.blendA);
      gl.uniform1f(blendBLoc, input.blendB);

      clear();
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
  };
}
