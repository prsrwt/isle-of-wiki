import * as THREE from 'three';

/** 3-step light ramp: the flat cel-shaded look on MeshToonMaterial. */
export function createToonGradient(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([120, 195, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const withFog = (uniforms: Record<string, THREE.IUniform>) =>
  THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]);

/**
 * Paper material: toon shading plus screen-space pencil hatching in the shadows
 * (one diagonal set of strokes in mid-tones, cross-hatching in the darkest tones).
 */
export function createPaperMaterial(color: string, gradient: THREE.Texture, ink: string): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({ color, gradientMap: gradient });
  const inkColor = new THREE.Color(ink);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInk = { value: inkColor };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uInk;')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114)) / max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.001);
          vec2 p = gl_FragCoord.xy;
          float a = abs(fract((p.x + p.y) / 7.0) - 0.5) * 7.0;
          float b = abs(fract((p.x - p.y) / 9.0) - 0.5) * 9.0;
          float strokeA = (1.0 - smoothstep(0.55, 1.15, a)) * (1.0 - smoothstep(0.55, 0.75, lum));
          float strokeB = (1.0 - smoothstep(0.55, 1.15, b)) * (1.0 - smoothstep(0.35, 0.5, lum));
          outgoingLight = mix(outgoingLight, uInk, max(strokeA, strokeB) * 0.55);
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'paper-hatch';
  return material;
}

/**
 * Ink outline for instanced shapes ("inverted hull"): draws back faces of a slightly
 * inflated copy in ink. Width grows with distance so lines stay visible.
 */
export function createOutlineMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: withFog({ uColor: { value: new THREE.Color(color) } }),
    side: THREE.BackSide,
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      void main() {
        vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec4 base = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        float w = clamp(-base.z * 0.0024, 0.1, 1.4);
        vec3 p = position + sign(position) * w / s;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/** Instanced glyph quads sampling a glyph atlas; per-instance UV rect + colour. */
export function createTextMaterial(atlas: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: withFog({ map: { value: atlas } }),
    side: THREE.DoubleSide,
    fog: true,
    alphaToCoverage: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      attribute vec4 iUv;
      attribute vec3 iColor;
      varying vec2 vUv;
      varying vec3 vColor;
      #include <fog_pars_vertex>
      void main() {
        vUv = mix(iUv.xy, iUv.zw, uv);
        vColor = iColor;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec3 vColor;
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D(map, vUv).a;
        if (a < 0.25) discard;
        gl_FragColor = vec4(vColor, a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/** Arch-shaped cave mouth: black depth with a red glow at the rim and a slow swirl inside. */
export function createCaveMaterial(accent: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: withFog({ uTime: { value: 0 }, uAccent: { value: new THREE.Color(accent) } }),
    side: THREE.DoubleSide,
    fog: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vSeed;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vSeed = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uAccent;
      varying vec2 vUv;
      varying float vSeed;
      #include <fog_pars_fragment>
      void main() {
        // Straight sides up to 45% height, elliptical arch above.
        vec2 c = vec2((vUv.x - 0.5) / 0.5, max(vUv.y - 0.45, 0.0) / 0.55);
        float e = length(c);
        if (e > 1.0) discard;
        float swirl = sin(atan(c.y, c.x) * 5.0 + e * 9.0 - uTime * 2.0 + vSeed) * 0.5 + 0.5;
        vec3 col = vec3(0.01);
        col = mix(col, uAccent * 0.35, swirl * (1.0 - e) * 0.5);
        col = mix(col, uAccent, smoothstep(0.78, 0.97, e));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/** Manga halftone: the image becomes ink dots on paper, with an ink border. */
export function createHalftoneMaterial(map: THREE.Texture, width: number, height: number, ink: string, paper: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: withFog({
      map: { value: map },
      uCells: { value: new THREE.Vector2(Math.max(8, width * 4.5), Math.max(8, height * 4.5)) },
      uBorder: { value: new THREE.Vector2(0.25 / width, 0.25 / height) },
      uInk: { value: new THREE.Color(ink) },
      uPaper: { value: new THREE.Color(paper) },
    }),
    fog: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec2 uCells;
      uniform vec2 uBorder;
      uniform vec3 uInk;
      uniform vec3 uPaper;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        vec2 grid = vUv * uCells;
        vec2 cellCenter = (floor(grid) + 0.5) / uCells;
        float l = dot(texture2D(map, cellCenter).rgb, vec3(0.299, 0.587, 0.114));
        float r = sqrt(1.0 - clamp(l, 0.0, 1.0)) * 0.72;
        float d = length(fract(grid) - 0.5);
        float dotMask = 1.0 - smoothstep(r - 0.06, r + 0.06, d);
        vec2 edge = min(vUv, 1.0 - vUv);
        float border = 1.0 - step(uBorder.x, edge.x) * step(uBorder.y, edge.y);
        vec3 col = mix(uPaper, uInk, max(dotMask, border));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/** Full-colour ad inside an ink frame (advertisers get their real colours). */
export function createAdMaterial(map: THREE.Texture, width: number, height: number, ink: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: withFog({
      map: { value: map },
      uBorder: { value: new THREE.Vector2(0.3 / width, 0.3 / height) },
      uInk: { value: new THREE.Color(ink) },
    }),
    fog: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec2 uBorder;
      uniform vec3 uInk;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        vec2 edge = min(vUv, 1.0 - vUv);
        float border = 1.0 - step(uBorder.x, edge.x) * step(uBorder.y, edge.y);
        vec3 col = mix(texture2D(map, vUv).rgb, uInk, border);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/** Twinkling star points; sized in pixels, never fogged. */
export function createStarMaterial(pixelRatio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vAlpha = 0.55 + 0.45 * sin(uTime * (0.6 + aPhase) + aPhase * 40.0);
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        // Four-point sparkle: bright core plus thin cross.
        float core = 1.0 - smoothstep(0.08, 0.22, length(c));
        float cross = (1.0 - smoothstep(0.0, 0.05, min(abs(c.x), abs(c.y)))) * (1.0 - smoothstep(0.2, 0.5, length(c)));
        float a = max(core, cross * 0.7) * vAlpha;
        if (a < 0.02) discard;
        gl_FragColor = vec4(vec3(1.0), a);
      }
    `,
  });
}
