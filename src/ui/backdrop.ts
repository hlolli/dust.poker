// The menu's backdrop: a fragment shader of a casino night. Velvet dark, a slow brass sunburst
// turning behind everything, chandelier bokeh drifting up through it, and a little glitter.
// Plain WebGL2, one triangle; stops with the menu. Stands still under reduced motion.

const VERT = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_size;
uniform float u_time;
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_size) / u_size.y; // centred, y in -0.5..0.5
  float t = u_time;

  // Velvet: deep at the edges, a warm glow up where the marquee hangs.
  vec3 velvet = vec3(0.086, 0.024, 0.063);
  vec3 col = velvet * (1.1 - 0.9 * length(p * vec2(0.7, 1.0)));
  col += vec3(0.35, 0.08, 0.16) * exp(-6.0 * length(p - vec2(0.0, 0.42)));

  // The sunburst: brass rays from behind the sign, turning once in a few minutes.
  vec2 q = p - vec2(0.0, 0.42);
  float a = atan(q.y, q.x) + t * 0.015;
  float rays = pow(0.5 + 0.5 * sin(a * 18.0), 6.0) * smoothstep(1.2, 0.1, length(q));
  col += vec3(0.79, 0.64, 0.29) * rays * 0.13;

  // Bokeh: soft discs of chandelier light, each on its own slow rise.
  for (int i = 0; i < 22; i++) {
    float fi = float(i);
    float seed = hash(vec2(fi, 1.7));
    float speed = 0.012 + 0.02 * hash(vec2(fi, 5.3));
    vec2 c = vec2(hash(vec2(fi, 2.9)) * 2.2 - 1.1, fract(seed + t * speed) * 1.3 - 0.65);
    c.x += 0.05 * sin(t * 0.3 + fi);
    float r = 0.02 + 0.06 * hash(vec2(fi, 9.1));
    float d = length(p - c);
    float disc = smoothstep(r, r * 0.55, d) * (0.35 + 0.65 * smoothstep(r * 0.9, r, d)); // a bright rim, a softer middle
    vec3 tint = mix(vec3(1.0, 0.77, 0.42), vec3(1.0, 0.45, 0.55), hash(vec2(fi, 4.2)) * 0.5);
    float fade = sin(fract(seed + t * speed) * 3.14159); // in and out along the rise
    col += tint * disc * 0.16 * fade;
  }

  // Glitter: a few pixels catching the light, blinking.
  vec2 g = floor(gl_FragCoord.xy / 3.0);
  float star = step(0.9985, hash(g)) * pow(0.5 + 0.5 * sin(t * 3.0 + hash(g + 7.0) * 40.0), 8.0);
  col += vec3(1.0, 0.92, 0.7) * star * 0.5;

  // Vignette and a touch of grain, as film.
  col *= 1.0 - 0.45 * pow(length(uv - 0.5) * 1.35, 2.5);
  col += (hash(gl_FragCoord.xy + fract(t)) - 0.5) * 0.02;
  o = vec4(col, 1.0);
}`;

export function startBackdrop(parent: HTMLElement): { stop(): void } {
  const canvas = document.createElement("canvas");
  canvas.className = "backdrop";
  parent.prepend(canvas);
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
  if (!gl) return { stop: () => canvas.remove() }; // the CSS velvet stays
  const program = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn("backdrop shader:", gl.getShaderInfoLog(s));
    gl.attachShader(program, s);
  }
  gl.linkProgram(program);
  gl.useProgram(program);
  const uSize = gl.getUniformLocation(program, "u_size");
  const uTime = gl.getUniformLocation(program, "u_time");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;
  const draw = (now: number) => {
    const scale = Math.min(devicePixelRatio, 1.5) * 0.75; // soft by nature; no need for every pixel
    const w = Math.floor(innerWidth * scale);
    const h = Math.floor(innerHeight * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(uSize, w, h);
    gl.uniform1f(uTime, still ? 40 : now / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!still) frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return {
    stop() {
      cancelAnimationFrame(frame);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}
