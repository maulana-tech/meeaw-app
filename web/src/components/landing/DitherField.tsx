"use client";

// Adapted from toMaker's DitherBackground (Apache-2.0,
// github.com/maulana-tech/tomaker): fractal noise through a 4x4 Bayer dither,
// so the field only ever holds two colours as hard pixels. No blend, no glow.

import { useEffect, useRef } from "react";

const VERTEX = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform vec2  u_resolution;
uniform float u_time;
uniform vec3  u_light;
uniform vec3  u_dark;
uniform float u_scale;

float hash(vec2 p) {
  p = fract(p * vec2(127.13, 311.7));
  p += dot(p, p.yx + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    total += noise(p) * amplitude;
    p *= 2.0;
    amplitude *= 0.5;
  }
  return total;
}

float bayer(vec2 pixel) {
  int x = int(mod(pixel.x, 4.0));
  int y = int(mod(pixel.y, 4.0));
  int index = x + y * 4;
  float m[16];
  m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
  m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
  m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
  for (int i = 0; i < 16; i++) {
    if (i == index) return m[i] / 16.0;
  }
  return 0.0;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  uv.x *= u_resolution.x / u_resolution.y;
  float field = fbm(uv * u_scale + vec2(u_time * 0.02, u_time * 0.013));
  // Lean toward light at the top so the headline has somewhere quiet to sit.
  // The -0.08 thins the blue a step so body copy over it stays readable.
  field = field * 0.85 + (1.0 - gl_FragCoord.y / u_resolution.y) * 0.3 - 0.08;
  gl_FragColor = vec4(field > bayer(gl_FragCoord.xy) ? u_dark : u_light, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
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

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Fills its positioned parent; wrap it in an aria-hidden element. Without
 *  WebGL it renders nothing and the section's paper background shows. */
export function DitherField({
  light = "#faf7f0",
  dark = "#5ea6e5",
  scale = 3,
  className = "",
}: {
  light?: string;
  dark?: string;
  scale?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "u_resolution");
    const uTime = gl.getUniformLocation(program, "u_time");
    gl.uniform3fv(gl.getUniformLocation(program, "u_light"), rgb(light));
    gl.uniform3fv(gl.getUniformLocation(program, "u_dark"), rgb(dark));
    gl.uniform1f(gl.getUniformLocation(program, "u_scale"), scale);

    // CSS pixels, not device pixels: on retina the dither cells would shrink
    // below the size where the pattern reads.
    const resize = () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uResolution, width, height);
    };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    let visible = true;
    const draw = () => {
      resize();
      gl.uniform1f(uTime, still ? 0 : (performance.now() - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!still && visible) raf = requestAnimationFrame(draw);
    };
    draw();

    // Only animate while the field is on screen.
    const io = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry.isIntersecting;
      if (visible && !was) draw();
      if (!visible) cancelAnimationFrame(raf);
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      if (still || !visible) draw();
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
    };
  }, [light, dark, scale]);

  return (
    <canvas
      ref={ref}
      className={`pointer-events-none absolute inset-0 block size-full ${className}`}
    />
  );
}
