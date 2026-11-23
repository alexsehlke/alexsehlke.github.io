// The landing page: a 3D iPhone pinned behind the feature story (three.js) with
// Orion lighting up behind it, a playable puzzle, and the annotated screenshot carousel.
// Steps with data-clip play a gameplay clip on the phone (see Clips below).
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const isMobile = () => innerWidth <= 820;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- Choreography ----------
   One key per .step, in order. Each step's data-screen names its screen.
   rot:   phone rotation in radians (x tilt, y turn, z roll)
   zoom:  1 = the phone fits the stage; above 1 zooms into `focus`
   focus: the point on the screen (u from the left, v from the top) held on the anchor
   at:    anchor in the stage, -1..1 of the half width and height (atM: phones) */
const KEYS = [
  { rot: [-0.5, 0, 0], zoom: 1.18, focus: [0.5, 0.2], at: [0, -0.86], atM: [0, -0.42] },      // hero: the logo and dailies
  { rot: [0.05, -0.42, 0.03], zoom: 1, focus: [0.5, 0.5], at: [0.42, 0], atM: [0, 0.3] },     // rules
  { rot: [0.02, -0.14, 0], zoom: 1.9, focus: [0.5, 0.45], at: [0.44, 0], atM: [0, 0.3] },     // tap, mark: the solve clip's 6×6 grid
  { rot: [0.03, -0.3, 0], zoom: 1.6, focus: [0.5, 0.2], at: [0.42, 0], atM: [0, 0.3] },       // daily: your rank and the top
  { rot: [0.02, 0.16, 0], zoom: 1.15, focus: [0.5, 0.5], at: [0.44, 0], atM: [0, 0.3] },      // sky map, turning
  { rot: [0.04, -0.3, -0.02], zoom: 1.5, focus: [0.5, 0.42], at: [0.42, 0], atM: [0, 0.3] },  // stickers
  { rot: [0.03, 0.22, 0.02], zoom: 1.45, focus: [0.5, 0.34], at: [0.44, 0], atM: [0, 0.3] },  // badges
  { rot: [0.05, -0.38, 0.02], zoom: 1, focus: [0.5, 0.5], at: [0.42, 0], atM: [0, 0.3] },     // challenge race
  { rot: [0.03, 0.2, 0], zoom: 2.3, focus: [0.5, 0.1], at: [0.44, 0], atM: [0, 0.3] },        // battle rush: the tracker
  { rot: [0.02, -0.12, 0], zoom: 1.7, focus: [0.5, 0.2], at: [0.44, 0], atM: [0, 0.3] },      // leaderboards: periods and rank
  { rot: [0.04, -0.2, 0.01], zoom: 1.5, focus: [0.5, 0.36], at: [0.44, 0], atM: [0, 0.3] },   // levels: best times
  { rot: [0.1, Math.PI + 0.42, 0], zoom: 1, focus: [0.5, 0.5], at: [0.42, 0], atM: [0, 0.3] }, // back of the phone
];

/* ---------- Phone geometry (screen width = 1) ---------- */
window.__landingKeys = KEYS.length;   // read by check.mjs

const Q = Math.PI / 2;
const SW = 1, SH = 2622 / 1206;            // screen, 6.3-inch iPhone proportions (the capture simulator)
const RS = 0.135;                           // screen corner radius
const BEZ = 0.03, RIM = 0.022;              // black border, visible metal rim
const PW = SW + 2 * (BEZ + RIM), PH = SH + 2 * (BEZ + RIM);
const DEPTH = 0.112, BEVEL = 0.024, FRONT = DEPTH / 2;

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = w / 2, y = h / 2, k = 0.448 * r;
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y); s.bezierCurveTo(x - k, -y, x, -y + k, x, -y + r);
  s.lineTo(x, y - r); s.bezierCurveTo(x, y - k, x - k, y, x - r, y);
  s.lineTo(-x + r, y); s.bezierCurveTo(-x + k, y, -x, y - k, -x, y - r);
  s.lineTo(-x, -y + r); s.bezierCurveTo(-x, -y + k, -x + k, -y, -x + r, -y);
  return s;
}

// A five-pointed star, point up.
function starShape(outer, inner) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer, a = Q + (i * Math.PI) / 5;
    s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  return s;
}

// A flat rounded rectangle with 0..1 UVs across its bounds.
function plate(w, h, r) {
  const g = new THREE.ShapeGeometry(roundedRect(w, h, r), 24);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  return g;
}

function buildPhone(screenMaterial) {
  const phone = new THREE.Group();
  const metal = new THREE.MeshPhysicalMaterial({ color: 0xc3c7cf, metalness: 1, roughness: 0.28, clearcoat: 0.4 });
  const glassBlack = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.08, clearcoat: 1 });

  const frame = new THREE.ExtrudeGeometry(roundedRect(PW - 2 * BEVEL, PH - 2 * BEVEL, RS + BEZ + RIM - BEVEL), {
    depth: DEPTH - 2 * BEVEL, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL,
    bevelSegments: 8, curveSegments: 32,
  });
  frame.translate(0, 0, -(DEPTH - 2 * BEVEL) / 2);
  phone.add(new THREE.Mesh(frame, metal));

  const glass = new THREE.Mesh(plate(SW + 2 * BEZ, SH + 2 * BEZ, RS + BEZ), glassBlack);
  glass.position.z = FRONT + 0.001;
  const screen = new THREE.Mesh(plate(SW, SH, RS), screenMaterial);
  screen.position.z = FRONT + 0.002;
  const island = new THREE.Mesh(plate(0.27, 0.076, 0.038), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  island.position.set(0, SH * (0.5 - 0.034), FRONT + 0.003);
  phone.add(glass, screen, island);

  // Buttons: action and volume on the left, side button and camera control on the right.
  const edge = PW / 2 + 0.004;
  for (const [side, y, len] of [[-1, 0.66, 0.11], [-1, 0.42, 0.2], [-1, 0.16, 0.2], [1, 0.48, 0.3], [1, -0.22, 0.17]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.014, len, 0.042), metal);
    b.position.set(side * edge, y, 0);
    phone.add(b);
  }

  // Back: deep blue glass, a gold star, and the camera plateau (top left, seen from behind).
  const back = new THREE.Mesh(plate(SW + 2 * BEZ, SH + 2 * BEZ, RS + BEZ),
    new THREE.MeshPhysicalMaterial({ color: 0x1d2a4d, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
  back.rotation.y = Math.PI;
  back.position.z = -FRONT - 0.001;
  const logo = new THREE.Mesh(
    new THREE.ExtrudeGeometry(starShape(0.19, 0.085), { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 3 }),
    new THREE.MeshPhysicalMaterial({ color: 0xffd76a, metalness: 1, roughness: 0.18, clearcoat: 0.6, emissive: 0x4a3300 }));
  logo.rotation.y = Math.PI;
  logo.position.set(0, 0.05, -FRONT - 0.002);
  phone.add(back, logo);

  const bump = new THREE.Group();
  const plateau = new THREE.ExtrudeGeometry(roundedRect(0.5, 0.5, 0.13), { depth: 0.018, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3 });
  bump.add(new THREE.Mesh(plateau, new THREE.MeshPhysicalMaterial({ color: 0x26345c, roughness: 0.35, clearcoat: 0.6 })));
  const lensGlass = new THREE.MeshPhysicalMaterial({ color: 0x050608, roughness: 0.05, clearcoat: 1, metalness: 0.2 });
  for (const [x, y] of [[-0.11, 0.11], [-0.11, -0.11], [0.11, 0]]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 40), metal);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.032, 40), lensGlass);
    for (const m of [ring, lens]) { m.rotation.x = Q; m.position.set(x, y, 0.03); bump.add(m); }
  }
  bump.rotation.y = Math.PI;
  bump.position.set(PW / 2 - 0.33, PH / 2 - 0.33, -FRONT);
  phone.add(bump);

  return { phone, screen };
}

/* ---------- Sky ----------
   Orion from the app's star catalogue: [right ascension°, declination°, magnitude],
   and the lines between them. It lights up in step with the story, starting from
   Alnilam, the middle star of the belt: one lone star at the top of the page. */
const ORION = {
  stars: [[76.14, 15.4, 4.65], [74.09, 13.51, 4.06], [73.72, 10.15, 4.64], [72.65, 8.9, 4.35], [72.46, 6.96, 3.19],
    [72.8, 5.61, 3.68], [73.56, 2.44, 3.71], [74.64, 1.71, 4.47], [81.28, 6.35, 1.64], [83.78, 9.93, 3.39],
    [88.79, 7.41, 0.45], [90.6, 9.65, 4.12], [91.89, 14.77, 4.42], [88.6, 20.28, 4.39], [90.98, 20.14, 4.64],
    [92.98, 14.21, 4.45], [85.19, -1.94, 1.74], [84.05, -1.2, 1.69], [83, -0.3, 2.25], [86.94, -9.67, 2.07],
    [81.12, -2.4, 3.35], [78.63, -8.2, 0.18]],
  links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [4, 8], [8, 9], [9, 10], [8, 10], [10, 11], [11, 12],
    [12, 13], [13, 14], [14, 15], [15, 12], [10, 16], [16, 17], [17, 18], [18, 8], [16, 19], [18, 20], [20, 21]],
  first: 17,
};

function startSky(svg) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  // A fixed, seeded starfield, so every visit sees the same sky.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const field = el('g', { class: 'field' });
  const dust = Array.from({ length: 150 }, () => ({ x: rand(), y: rand(), r: 0.35 + rand() * rand() * 1.3, o: 0.12 + rand() * 0.45 }));
  const dots = dust.map((d) => field.appendChild(el('circle', { r: d.r, opacity: d.o.toFixed(2) })));

  // Light order: breadth-first along the lines from the first star.
  const order = [ORION.first], seen = new Set(order);
  for (let i = 0; i < order.length; i++) {
    for (const [a, b] of ORION.links) {
      const n = a === order[i] ? b : b === order[i] ? a : -1;
      if (n >= 0 && !seen.has(n)) { seen.add(n); order.push(n); }
    }
  }
  const rank = []; order.forEach((s, i) => { rank[s] = i; });

  const orion = el('g', { class: 'orion' });
  const lines = ORION.links.map(([a, b]) => ({ a, b, node: orion.appendChild(el('line', {})) }));
  const stars = ORION.stars.map(([, , mag]) => orion.appendChild(el('circle', { r: clamp(3.4 - 0.55 * mag, 1.1, 3.4).toFixed(2) })));
  svg.append(field, orion);

  // Project around the constellation's centre; east (higher RA) is to the left, as in the sky.
  const ra0 = 82.7, dec0 = 5.3, cos0 = Math.cos((dec0 * Math.PI) / 180);
  const proj = ORION.stars.map(([ra, dec]) => [-(ra - ra0) * cos0, -(dec - dec0)]);

  function layout(w, h) {
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    dust.forEach((d, i) => { dots[i].setAttribute('cx', (d.x * w).toFixed(1)); dots[i].setAttribute('cy', (d.y * h).toFixed(1)); });
    const [cx, cy, tall] = isMobile() ? [0.5 * w, 0.34 * h, 0.66 * h] : [0.55 * w, 0.5 * h, 0.78 * h];
    const k = tall / 30;  // Orion spans about 30° of declination
    const pt = proj.map(([x, y]) => [cx + x * k, cy + y * k]);
    stars.forEach((s, i) => { s.setAttribute('cx', pt[i][0].toFixed(1)); s.setAttribute('cy', pt[i][1].toFixed(1)); });
    for (const l of lines) {
      l.node.setAttribute('x1', pt[l.a][0].toFixed(1)); l.node.setAttribute('y1', pt[l.a][1].toFixed(1));
      l.node.setAttribute('x2', pt[l.b][0].toFixed(1)); l.node.setAttribute('y2', pt[l.b][1].toFixed(1));
    }
  }

  let lit = -1;
  function light(fraction) {
    const n = 1 + Math.round(clamp(fraction, 0, 1) * (order.length - 1));
    if (n === lit) return;
    lit = n;
    stars.forEach((s, i) => s.classList.toggle('is-lit', rank[i] < n));
    for (const l of lines) l.node.classList.toggle('is-lit', rank[l.a] < n && rank[l.b] < n);
  }

  return { layout, light };
}

/* ---------- Story ---------- */
function startStory() {
  const canvas = document.getElementById('phone');
  const stage = canvas.parentElement;
  const stepEls = [...document.querySelectorAll('.step')];
  if (stepEls.length !== KEYS.length) console.warn('landing: steps and keys differ', stepEls.length, KEYS.length);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    document.documentElement.classList.add('no-webgl');
    return;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const sky = startSky(stage.querySelector('.sky'));

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(4, 5, 6);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 60);
  camera.position.z = 12;

  // Screens: full size on large screens (the zooms need it), medium on phones.
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const suffix = isMobile() ? '-md' : '';
  const textures = {};
  const texture = (name) => textures[name] ||= Object.assign(
    loader.load(`/screens/${name}${suffix}.webp`, () => { needsRender = true; }),
    { colorSpace: THREE.NoColorSpace, anisotropy: maxAniso });

  // The screen shows two screens mixed, so it can crossfade while the phone moves,
  // plus a faint band of light that slides across the glass as the phone turns.
  const screenMaterial = new THREE.ShaderMaterial({
    uniforms: { mapA: { value: null }, mapB: { value: null }, mixv: { value: 0 }, sheen: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D mapA, mapB; uniform float mixv, sheen; varying vec2 vUv;
      void main(){
        vec3 c = mix(texture2D(mapA, vUv).rgb, texture2D(mapB, vUv).rgb, mixv);
        float band = exp(-pow((vUv.x * 0.55 + (1.0 - vUv.y) * 0.45 - sheen) * 5.0, 2.0));
        gl_FragColor = vec4(mix(c, vec3(1.0), band * 0.06), 1.0);
      }`,
  });

  const { phone } = buildPhone(screenMaterial);
  scene.add(phone);

  // Clips (ported from the Spellblox site): real gameplay, played once at normal speed when its step
  // comes up, and from the start again whenever the reader comes back to it. A clip shows its first frame
  // (the -poster still) until it can show video; with reduced motion the step's screenshot is all there is.
  // iOS loads nothing for a video until it plays, so each clip is played (muted, inline) and paused at once.
  // Where even that is refused (Low Power Mode), the first tap retries.
  const steps = stepEls.map((el) => ({ still: el.dataset.screen, clip: reduceMotion ? null : el.dataset.clip }));
  const clips = window.__lonestarClips = {};
  let shown = -1;
  function play(c) {
    c.v.currentTime = 0;
    let p;
    try { p = c.v.play(); } catch (e) { p = Promise.reject(e); }
    if (p && p.catch) p.catch(() => { c.blocked = true; });
  }
  function prime(c) {
    if (c.primed || c.priming) return;
    c.priming = true;
    const done = () => { c.priming = false; c.primed = true; c.blocked = false; if (!c.active) c.v.pause(); markReady(c); };
    let p;
    try { p = c.v.play(); } catch (e) { p = Promise.reject(e); }
    // An AbortError only means show() paused the clip mid-load (the reader scrolled on); prime again later.
    if (p && p.then) p.then(done, (e) => { c.priming = false; if (e?.name !== 'AbortError') c.blocked = true; });
    else done();
  }
  function markReady(c) {
    if (c.ready || !c.primed || c.v.readyState < 2) return;
    c.ready = true;
    if (c.active) play(c);
    needsRender = true;
  }
  // The step on screen plays its clip from the start; the one it takes over from stops.
  function show(i) {
    if (i === shown) return;
    const old = shown >= 0 && steps[shown].clip && clips[steps[shown].clip];
    if (old) { old.active = false; old.v.pause(); }
    shown = i;
    const c = steps[i].clip && clip(steps[i].clip);
    if (c) { c.active = true; if (c.ready) play(c); else if (!c.primed) prime(c); }
  }
  function clip(name) {
    if (clips[name]) return clips[name];
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    const c = clips[name] = { name, v, ready: false, primed: false, blocked: false, active: false };
    c.texture = Object.assign(new THREE.VideoTexture(v), { colorSpace: THREE.NoColorSpace, anisotropy: maxAniso,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    for (const type of ['loadeddata', 'canplay', 'playing']) v.addEventListener(type, () => markReady(c));
    v.addEventListener('seeked', () => { c.texture.needsUpdate = true; needsRender = true; });
    v.addEventListener('error', () => { c.failed = true; needsRender = true; });
    v.src = `/clips/${name}${suffix}.mp4`;
    v.load();
    prime(c);
    return c;
  }
  const retry = () => Object.values(clips).forEach((c) => {
    if (!c.blocked) return;
    if (!c.primed) prime(c);
    else if (c.active) { c.blocked = false; play(c); }
  });
  addEventListener('touchend', retry, { passive: true });
  addEventListener('click', retry);
  // A step's screen: its clip once it can show a frame, else its poster (or still).
  function stepTexture(i) {
    const s = steps[i];
    if (s.clip) {
      const c = clip(s.clip);
      return c.ready && !c.failed ? c.texture : texture(`${s.clip}-poster`);
    }
    return texture(s.still);
  }
  // Clips load only near the reader: the step on screen and its neighbours.
  function warm(p) {
    const i = Math.round(p);
    for (let k = Math.max(0, i - 1); k <= Math.min(steps.length - 1, i + 2); k++) stepTexture(k);
  }
  stepTexture(0);
  addEventListener('load', () => steps.forEach((s) => texture(s.clip ? `${s.clip}-poster` : s.still)), { once: true });

  // Layout: world-space keys, recomputed on resize.
  let view = { w: 1, h: 1 }, frames = [], centers = [];
  const euler = new THREE.Euler(), focusPoint = new THREE.Vector3(), corner = new THREE.Vector3();

  function fit() {
    const { w, h } = view;
    return isMobile() ? Math.min(h * 0.5 / PH, w * 0.7 / PW) : Math.min(h * 0.72 / PH, w * 0.42 / PW);
  }

  function layout() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    view.h = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    view.w = view.h * camera.aspect;
    sky.layout(w, h);

    // Keep zoomed phones clear of the text column on desktop.
    const firstStep = stepEls[1];
    const textRight = firstStep ? (firstStep.firstElementChild.getBoundingClientRect().left + 450) / w : 0.4;
    const limit = (textRight - 0.5) * view.w + 0.15;

    frames = KEYS.map((k, i) => {
      const at = isMobile() ? k.atM : k.at;
      // Phones get gentler zooms: the stage is narrow and the text sits below.
      let s = (isMobile() ? 1 + (k.zoom - 1) * 0.45 : k.zoom) * fit();
      const ax = at[0] * view.w / 2, ay = at[1] * view.h / 2;
      if (!isMobile() && i > 0) {
        euler.set(...k.rot);
        let minX = Infinity;
        for (const [cx, cy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          corner.set(cx * PW / 2 - (k.focus[0] - 0.5) * SW, cy * PH / 2 - (0.5 - k.focus[1]) * SH, 0).applyEuler(euler);
          minX = Math.min(minX, corner.x);
        }
        if (ax + minX * s < limit && minX < 0) s = Math.min(s, (ax - limit) / -minX);
      }
      return { rot: k.rot, s, fu: k.focus[0], fv: k.focus[1], ax, ay };
    });

    centers = stepEls.map((el) => { const r = el.getBoundingClientRect(); return r.top + scrollY + r.height / 2; });
    needsRender = true;
  }

  // Scroll position as a float step index.
  function progress() {
    const y = scrollY + innerHeight / 2;
    if (y <= centers[0]) return 0;
    for (let i = 0; i < centers.length - 1; i++) {
      if (y < centers[i + 1]) return i + (y - centers[i]) / (centers[i + 1] - centers[i]);
    }
    return centers.length - 1;
  }

  let target = 0, current = 0, needsRender = true, running = false, last = 0;
  let pointer = { x: 0, y: 0 }, tilt = { x: 0, y: 0 };
  const introStart = performance.now();

  function apply(p, time, dt) {
    const i = Math.min(Math.floor(p), frames.length - 2), t = p - i;
    const a = frames[i], b = frames[i + 1], e = smooth(0, 1, t);
    const intro = reduceMotion ? 1 : smooth(0, 1, (time - introStart) / 1600);
    const idle = reduceMotion ? 0 : Math.sin(time / 2200);

    euler.set(
      lerp(a.rot[0], b.rot[0], e) + tilt.y * 0.06 + (1 - intro) * 0.5,
      lerp(a.rot[1], b.rot[1], e) + tilt.x * 0.09 + idle * 0.025,
      lerp(a.rot[2], b.rot[2], e),
    );
    const s = lerp(a.s, b.s, e);
    focusPoint.set((lerp(a.fu, b.fu, e) - 0.5) * SW, (0.5 - lerp(a.fv, b.fv, e)) * SH, FRONT)
      .multiplyScalar(s).applyEuler(euler);
    phone.rotation.copy(euler);
    phone.scale.setScalar(s);
    phone.position.set(
      lerp(a.ax, b.ax, e) - focusPoint.x,
      lerp(a.ay, b.ay, e) - focusPoint.y - (1 - intro) * view.h * 0.5,
      -focusPoint.z,
    );

    const u = screenMaterial.uniforms;
    u.mapA.value = stepTexture(i);
    u.mapB.value = stepTexture(i + 1);
    show(Math.round(p));
    warm(p);
    u.mixv.value = smooth(0.42, 0.58, t); // a quick swap, like iOS crossfading between screens
    u.sheen.value = 0.5 + euler.y * 0.9 + euler.x * 0.6;

    const ax = lerp(a.ax, b.ax, e) / view.w, ay = lerp(a.ay, b.ay, e) / view.h;
    stage.style.setProperty('--glow-x', `${50 + ax * 100}%`);
    stage.style.setProperty('--glow-y', `${50 - ay * 100}%`);
    stage.style.setProperty('--fade', smooth(0.2, 0.8, p).toFixed(3));
    sky.light(p / (frames.length - 1));
  }

  function fadeSteps() {
    const mid = innerHeight / 2;
    stepEls.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const d = (r.top + r.height / 2 - mid) / innerHeight;
      const vis = i === 0 && d > 0 ? 1 : clamp(1 - (Math.abs(d) - 0.2) * 2.4, 0, 1);
      el.style.setProperty('--vis', vis.toFixed(3));
    });
  }

  function frame(time) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (time - (last || time)) / 1000);
    last = time;
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 7);
    current += (target - current) * k;
    tilt.x += (pointer.x - tilt.x) * k * 0.6;
    tilt.y += (pointer.y - tilt.y) * k * 0.6;
    // The idle float keeps the phone moving; with reduced motion, draw only on change.
    const settled = reduceMotion && Math.abs(target - current) < 1e-4;
    if (settled && !needsRender) return;
    apply(current, time, dt);
    renderer.render(scene, camera);
    needsRender = false;
  }

  // needsRender: with reduced motion the phone jumps straight to the target, so the frame loop sees
  // nothing left to animate and would otherwise never redraw.
  const onScroll = () => { target = progress(); fadeSteps(); needsRender = true; };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { layout(); onScroll(); });
  new ResizeObserver(() => { layout(); onScroll(); }).observe(document.querySelector('.steps'));
  if (finePointer && !reduceMotion) {
    addEventListener('pointermove', (e) => {
      pointer.x = (e.clientX / innerWidth) * 2 - 1;
      pointer.y = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
  }

  // Only animate while the story is on screen.
  new IntersectionObserver(([entry]) => {
    const was = running;
    running = entry.isIntersecting;
    if (running && !was) { last = 0; requestAnimationFrame(frame); }
  }).observe(document.querySelector('.story'));

  layout();
  onScroll();
  current = target;
}

/* ---------- Try one: Beginner level 1, playable ----------
   Each cell cycles empty → star → X → empty, like the app. Stars that share a row,
   column or region, or touch, turn red. Six stars and no conflicts solves it. */
// The app's board palette (StickerKit.regionPalette): region n uses colour n − 1.
const REGION_COLORS = ['#F4D27A', '#EE8496', '#7FD0EE', '#B895E8', '#7FEBB2', '#F0AE7C', '#84A6EE', '#E08AEE', '#FFF1C4', '#63C9B8'];
const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="star" stroke="#1b1b22" stroke-width="1.8" stroke-linejoin="round" d="M12 2.8l2.8 5.9 6.5.8-4.8 4.4 1.3 6.4L12 17.1l-5.8 3.2 1.3-6.4-4.8-4.4 6.5-.8z"/></svg>';
const X_SVG = '<svg class="x" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>';

function startPuzzle(board) {
  const regions = JSON.parse(board.dataset.regions);
  const n = regions.length;
  const status = board.parentElement.querySelector('.board-status');
  const names = ['empty', 'star', 'X'];
  let state, started, solved, focus = 0;

  const cells = regions.flat().map((region, i) => {
    const r = Math.floor(i / n), c = i % n;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.setAttribute('role', 'gridcell');
    cell.style.setProperty('--region', REGION_COLORS[(region - 1) % REGION_COLORS.length]);
    if (c < n - 1 && regions[r][c + 1] !== region) cell.classList.add('r');
    if (r < n - 1 && regions[r + 1][c] !== region) cell.classList.add('b');
    cell.addEventListener('click', () => { focus = i; cycle(i); });
    board.append(cell);
    return cell;
  });

  board.addEventListener('keydown', (e) => {
    const r = Math.floor(focus / n), c = focus % n;
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!move) return;
    e.preventDefault();
    focus = clamp(r + move[0], 0, n - 1) * n + clamp(c + move[1], 0, n - 1);
    render();
    cells[focus].focus();
  });

  function cycle(i) {
    if (solved) return;
    started ||= performance.now();
    state[i] = (state[i] + 1) % 3;
    render();
  }

  function conflicts() {
    const stars = state.flatMap((v, i) => (v === 1 ? [i] : []));
    const bad = new Set();
    for (const a of stars) for (const b of stars) {
      if (a >= b) continue;
      const ra = Math.floor(a / n), ca = a % n, rb = Math.floor(b / n), cb = b % n;
      const touch = Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1;
      if (ra === rb || ca === cb || regions[ra][ca] === regions[rb][cb] || touch) { bad.add(a); bad.add(b); }
    }
    return { stars, bad };
  }

  function render() {
    const { stars, bad } = conflicts();
    solved = stars.length === n && bad.size === 0;
    cells.forEach((cell, i) => {
      const v = state[i];
      if (cell.dataset.v !== String(v)) { cell.innerHTML = v === 1 ? STAR_SVG : v === 2 ? X_SVG : ''; cell.dataset.v = v; }
      cell.classList.toggle('is-star', v === 1);
      cell.classList.toggle('is-bad', bad.has(i));
      cell.tabIndex = i === focus ? 0 : -1;
      cell.setAttribute('aria-label', `Row ${Math.floor(i / n) + 1}, column ${(i % n) + 1}, ${names[v]}${bad.has(i) ? ', conflict' : ''}`);
    });
    stars.forEach((s, k) => cells[s].style.setProperty('--i', k));
    board.classList.toggle('is-solved', solved);

    if (solved) {
      const secs = Math.max(1, Math.round((performance.now() - started) / 1000));
      status.textContent = `Solved in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}. Only 12,499 to go.`;
    } else if (bad.size) {
      status.textContent = 'Two stars clash. Look for the pink.';
    } else {
      const left = n - stars.length;
      status.textContent = `${left} ${left === 1 ? 'star' : 'stars'} to place`;
    }
  }

  function reset() {
    state = Array(n * n).fill(0);
    started = 0;
    render();
  }

  board.parentElement.querySelector('.board-reset').addEventListener('click', reset);
  reset();
}

/* ---------- Carousel ---------- */
function startCarousel(root) {
  const track = root.querySelector('.track');
  const slides = [...track.children];
  const dots = root.querySelector('.dots');
  const [prev, next] = root.querySelectorAll('.arrow');
  let active = -1;

  const dotButtons = slides.map((slide, i) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', slide.querySelector('h3').textContent);
    b.addEventListener('click', () => go(i));
    dots.append(b);
    return b;
  });

  function go(i) {
    const s = slides[clamp(i, 0, slides.length - 1)];
    track.scrollTo({ left: s.offsetLeft + s.offsetWidth / 2 - track.clientWidth / 2 });
  }

  function setActive(i) {
    if (i === active) return;
    active = i;
    slides.forEach((s, k) => s.classList.toggle('is-active', k === i));
    dotButtons.forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
    prev.disabled = i === 0;
    next.disabled = i === slides.length - 1;
  }

  let ticking = false;
  track.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      slides.forEach((s, k) => {
        if (Math.abs(s.offsetLeft + s.offsetWidth / 2 - mid) < Math.abs(slides[best].offsetLeft + slides[best].offsetWidth / 2 - mid)) best = k;
      });
      setActive(best);
    });
  }, { passive: true });

  prev.addEventListener('click', () => go(active - 1));
  next.addEventListener('click', () => go(active + 1));
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
  });

  slides.forEach((slide, k) => {
    slide.addEventListener('click', (e) => { if (k !== active && !e.target.closest('.pin')) go(k); });
    // A pin and its note light up together.
    const hot = (n, on) => slide.querySelectorAll(`[data-n="${n}"]`).forEach((el) => el.classList.toggle('is-hot', on));
    slide.querySelectorAll('[data-n]').forEach((el) => {
      const n = el.dataset.n;
      el.addEventListener('mouseenter', () => hot(n, true));
      el.addEventListener('mouseleave', () => hot(n, false));
      el.addEventListener('focus', () => hot(n, true));
      el.addEventListener('blur', () => hot(n, false));
    });
    slide.querySelectorAll('.pin').forEach((pin) => pin.setAttribute('aria-label', slide.querySelector(`li[data-n="${pin.dataset.n}"]`).textContent));
  });

  setActive(0);
}

startStory();
document.querySelectorAll('.board').forEach(startPuzzle);
document.querySelectorAll('[data-carousel]').forEach(startCarousel);
