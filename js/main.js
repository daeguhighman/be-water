import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { GroundedSkybox } from "three/addons/objects/GroundedSkybox.js";
import { STAGES, QUOTES, DAY_MS, FINAL_DAY, FINAL_LINE } from "./data.js";
import { makeSfx } from "./sfx.js";
import { makeWalkman } from "./walkman.js";
import { makeFighter, FIGHTER_X } from "./fighter.js";
import { loadPlate, makePlateLayer, makeContactShadow } from "./backplate.js";

const R = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- 저장 ---------- */
const KEY = "be-water.v1";
let S = { start: 0, seen: -1, done: false, sound: true, everKicked: false };
try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.start) S = Object.assign(S, v); } catch (e) { /* 저장소를 못 쓰면 이번 실행만 기억함 */ }
if (!S.start) S.start = Date.now();
const simMatch = location.hash.match(/d=(\d+)/);
const SIM_DAY = simMatch ? Math.max(1, +simMatch[1]) : 0;
function save() { if (SIM_DAY) return; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 위와 같음 */ } }
save();
const dayNow = () => SIM_DAY || Math.floor((Date.now() - S.start) / DAY_MS) + 1;
const stageFor = (d) => STAGES.reduce((s, st, i) => (d >= st.from ? i : s), 0);

/* ---------- 렌더러와 카메라 ---------- */
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
const camBase = new THREE.Vector3(), camLook = new THREE.Vector3();
let sky = null;
function frame() {
  const w = window.innerWidth, h = window.innerHeight, a = w / h;
  renderer.setSize(w, h, false);
  camera.fov = a < 0.75 ? 58 : 42; camera.aspect = a; camera.updateProjectionMatrix();
  const t = Math.tan(camera.fov * R / 2);
  const dist = Math.max(1.5 / (t * a), 1.3 / t);
  camBase.set(-0.25, 1.3, dist);
  camLook.set(-0.25, a < 0.75 ? 1.2 : 1.0, 0);
  if (sky) placeSky();
}
window.addEventListener("resize", frame);

/* ---------- 불러오기 ---------- */
const texLoader = new THREE.TextureLoader();
const hdrLoader = new RGBELoader();
const pmrem = new THREE.PMREMGenerator(renderer);
const cache = new Map();
function once(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }
function loadTex(url, srgb, repeat) {
  return once(url + (repeat || ""), () => new Promise((res) => texLoader.load(url, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; if (repeat) t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 4; res(t);
  }, undefined, () => res(null))));
}
function loadEnv(name) {
  return once("env:" + name, () => new Promise((res, rej) => hdrLoader.load(`assets/${name}.hdr`, (t) => {
    t.mapping = THREE.EquirectangularReflectionMapping; const env = pmrem.fromEquirectangular(t).texture; t.dispose(); res(env);
  }, undefined, rej)));
}
function loadBg(name) {
  return once("bg:" + name, () => new Promise((res, rej) => texLoader.load(`assets/${name}.jpg`, (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; t.anisotropy = 8; res(t);
  }, undefined, rej)));
}
async function pbr(name, o) {
  const [map, normalMap, roughnessMap] = await Promise.all([
    o.noDiff ? null : loadTex(`assets/tex/${name}_diff.jpg`, true, o.repeat),
    loadTex(`assets/tex/${name}_nor.jpg`, false, o.repeat),
    loadTex(`assets/tex/${name}_rough.jpg`, false, o.repeat),
  ]);
  return new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, color: o.color || 0xffffff, roughness: o.roughness ?? 1, normalScale: new THREE.Vector2(o.ns || 1, o.ns || 1) });
}
function dotTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,.7)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
const DOT = dotTexture();
function canvasTex(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }

/* ---------- 입자 ---------- */
class Pool {
  constructor(n, o) {
    o = Object.assign({ size: 0.05, color: 0xffffff, additive: true, opacity: 1 }, o);
    this.n = n; this.i = 0; this.additive = o.additive; this.base = new THREE.Color(o.color);
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.c = new Float32Array(n * 3);
    this.l = new Float32Array(n); this.ml = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) this.p[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.p, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.c, 3));
    this.mat = new THREE.PointsMaterial({ size: o.size, map: DOT, vertexColors: true, transparent: true, opacity: o.opacity, depthWrite: false, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false;
  }
  spawn(x, y, z, vx, vy, vz, life) {
    const i = this.i; this.i = (i + 1) % this.n; const j = i * 3;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; this.v[j] = vx; this.v[j + 1] = vy; this.v[j + 2] = vz;
    this.l[i] = life; this.ml[i] = life;
  }
  update(dt, grav, drag, floor) {
    const p = this.p, v = this.v, c = this.c, b = this.base, k0 = Math.max(0, 1 - (drag || 0) * dt);
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      if (this.l[i] <= 0) { c[j] = c[j + 1] = c[j + 2] = 0; continue; }
      this.l[i] -= dt; v[j + 1] -= (grav || 0) * dt; v[j] *= k0; v[j + 1] *= k0; v[j + 2] *= k0;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      if (this.l[i] <= 0 || (floor !== undefined && p[j + 1] < floor)) { this.l[i] = 0; p[j + 1] = -999; continue; }
      const k = this.additive ? Math.min(1, (this.l[i] / this.ml[i]) * 1.6) : 1;
      c[j] = b.r * k; c[j + 1] = b.g * k; c[j + 2] = b.b * k;
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.pts.geometry.attributes.color.needsUpdate = true;
  }
}
const sparks = new Pool(260, { size: 0.04, color: 0xfff1d6 });
const chunks = new Pool(240, { size: 0.06, color: 0xffffff, additive: false });
const leaves = new Pool(80, { size: 0.07, color: 0x7d8a3c, additive: false });
scene.add(sparks.pts, chunks.pts, leaves.pts);

/**
 * 맞은 자리에서 튀는 무대별 입자. 동그란 파동 대신 그 장소에 있을 법한 것만 흩날림.
 * n 개수, sp 튀는 속도, g 중력(음수면 떠오름), drag 공기 저항, life 수명(초).
 */
const PUFF = {
  room:      { color: 0xc9bfae, n: 14, sp: 0.5, g: -0.05, drag: 2.5, life: [0.9, 1.8], size: 0.035 },
  gym:       { color: 0xd8c8a8, n: 22, sp: 0.9, g: 0.25, drag: 2.2, life: [0.7, 1.4], size: 0.05 },
  bamboo:    { color: 0xe8efd0, n: 10, sp: 0.6, g: 0.1, drag: 2.4, life: [0.6, 1.2], size: 0.035, leaves: 7 },
  snow:      { color: 0xffffff, n: 28, sp: 1.2, g: 1.4, drag: 1.6, life: [0.6, 1.3], size: 0.045 },
  waterfall: { color: 0xe6f8ff, n: 18, sp: 1.6, g: 4.0, drag: 0.6, life: [0.4, 0.8], size: 0.04 },
  water:     { color: 0xcff6ff, n: 16, sp: 0.6, g: -1.2, drag: 2.0, life: [1.0, 2.0], size: 0.05 },
};

/**
 * ### 공기 일그러짐
 * 다 그린 화면을 텍스처로 복사한 뒤, 맞은 자리를 중심으로 퍼지는 고리 부분만 바깥으로 밀어 다시 그림.
 * 빛이나 색을 더하지 않아 어떤 배경 위에서도 튀지 않음.
 */
const wave = (() => {
  let tex = new THREE.FramebufferTexture(1, 1);
  const size = new THREE.Vector2();
  const mat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: tex }, center: { value: new THREE.Vector2() }, radius: { value: 0 }, width: { value: 0.05 }, strength: { value: 0 }, aspect: { value: 1 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      uniform sampler2D tex; uniform vec2 center; uniform float radius, width, strength, aspect; varying vec2 vUv;
      void main(){
        vec2 d = vUv - center; d.x *= aspect; float r = length(d);
        float x = (r - radius) / width; float m = exp(-x * x * 2.0) * strength;
        if (m < 0.003) discard;
        vec2 dir = r > 0.0 ? d / r : vec2(0.0); dir.x /= aspect;
        vec2 off = dir * m * 0.04;
        // 가장자리에 아주 약한 색 갈라짐을 넣어 유리 너머를 보는 듯한 굴절감을 냄
        float cr = texture2D(tex, vUv - off * 1.06).r, cg = texture2D(tex, vUv - off).g, cb = texture2D(tex, vUv - off * 0.94).b;
        gl_FragColor = vec4(cr, cg, cb, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let t = 1, dur = 0.5, maxR = 0.2, power = 0;
  return {
    /** 화면 위 위치(0~1)에서 파동을 시작 */
    start(uv, p, slow, big) {
      mat.uniforms.center.value.copy(uv); t = 0; power = p;
      dur = big ? 1.1 : slow ? 0.9 : 0.45; maxR = big ? 0.85 : slow ? 0.26 : 0.2;
    },
    update(dt) { t = Math.min(1, t + dt / dur); },
    seek(v) { t = v; }, // 디버그용: 파동을 특정 순간에 멈춰 봄
    render(renderer) {
      if (t >= 1) return;
      renderer.getDrawingBufferSize(size);
      if (tex.image.width !== size.x || tex.image.height !== size.y) { tex.dispose(); tex = new THREE.FramebufferTexture(size.x, size.y); mat.uniforms.tex.value = tex; }
      renderer.copyFramebufferToTexture(tex);
      const e = 1 - Math.pow(1 - t, 3);
      mat.uniforms.radius.value = 0.015 + maxR * e;
      mat.uniforms.width.value = (0.025 + 0.05 * e) * (maxR > 0.5 ? 2.2 : 1);
      mat.uniforms.strength.value = power * Math.pow(1 - t, 1.4);
      mat.uniforms.aspect.value = size.x / size.y;
      renderer.render(sc, cam);
    },
  };
})();

/* ---------- 공통 조명 ---------- */
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 3, bottom: -1.5, near: 0.5, far: 25 });
sun.target.position.set(0.1, 0.8, 0);
scene.add(sun, sun.target);
const catcher = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.45 }));
catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.002; catcher.receiveShadow = true; scene.add(catcher);

/* ---------- AI 배경 합성 ---------- */
const plateLayer = makePlateLayer();
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0); scene.add(hemi);
const rim = new THREE.DirectionalLight(0xffffff, 0); rim.position.set(2.5, 3, -3); scene.add(rim);
const contact = makeContactShadow(); scene.add(contact);
const PLATE_TEST = /bgtest/.test(location.search);
function plateUrl(key) { return `assets/${PLATE_TEST ? "bg-test" : "bg"}/${key}.jpg`; }

function placeSky() {
  if (!sky) return;
  sky.position.set(camBase.x, stage.cfg.sky.height, camBase.z);
}

/* ---------- 무대별 찰 대상 ---------- */
let fighter = null;
const tmp = new THREE.Vector3();

const BUILD = {
  async room(g, reach) {
    const motes = new Pool(140, { size: 0.016, color: 0xffe2b0, opacity: 0.7 });
    for (let i = 0; i < 140; i++) motes.spawn(rand(-1.6, 1.6), rand(0.2, 2.4), rand(-1.5, 1.5), rand(-0.02, 0.02), rand(-0.01, 0.01), rand(-0.02, 0.02), 1e9);
    g.add(motes.pts);
    return {
      update(dt) {
        const p = motes.p, v = motes.v;
        for (let i = 0; i < motes.n; i++) { const j = i * 3; v[j] += rand(-0.02, 0.02) * dt; v[j + 1] += rand(-0.02, 0.02) * dt; for (let k = 0; k < 3; k++) v[j + k] *= 1 - 0.6 * dt;
          if (p[j + 1] < 0.1 || p[j + 1] > 2.6) v[j + 1] *= -1; if (Math.abs(p[j]) > 1.8) v[j] *= -1; }
        motes.update(dt, 0, 0);
      },
      hit(tip) {
        const p = motes.p, v = motes.v;
        for (let i = 0; i < motes.n; i++) { const j = i * 3, dx = p[j] - tip.x, dy = p[j + 1] - tip.y, d2 = dx * dx + dy * dy;
          if (d2 < 0.5) { const f = (0.5 - d2) * 1.6; v[j] += f * (0.6 + Math.max(0, dx)); v[j + 1] += dy * f; v[j + 2] += rand(-0.3, 0.3) * f; } }
        return { pos: tip.clone().add(new THREE.Vector3(0.08, 0, 0)), power: 0.35, sound: "air" };
      },
    };
  },

  async gym(g, reach) {
    const leather = await pbr("leather_red_02", { noDiff: true, color: 0x6e120c, repeat: [3, 2], ns: 1.2 });
    leather.roughness = 0.75;
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a0705, roughness: 0.6 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, metalness: 1, roughness: 0.32 });
    const R0 = 0.19, top = 1.85, len = 1.2, x = reach.x + R0 - 0.02;
    // 천장 고리에서 흔들리도록 축을 천장에 둠
    const ceil = 4.0, hook = top + 0.3;
    const pivot = new THREE.Group(); pivot.position.set(x, ceil, 0); g.add(pivot);
    const links = Math.round((ceil - hook) / 0.034);
    for (let i = 0; i < links; i++) { const l = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 16), metal); l.position.y = -0.02 - i * 0.034; l.rotation.y = i % 2 ? Math.PI / 2 : 0; l.castShadow = true; pivot.add(l); }
    const body = new THREE.Group(); body.position.y = -(ceil - top) - len / 2; pivot.add(body);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(R0, R0 * 0.98, len, 48, 8), leather); cyl.castShadow = cyl.receiveShadow = true; body.add(cyl);
    for (const y of [len / 2 - 0.03, -len / 2 + 0.03]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(R0 + 0.004, R0 + 0.004, 0.06, 48), dark); b.position.y = y; b.castShadow = true; body.add(b); }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(R0, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), leather); cap.scale.y = 0.18; cap.position.y = len / 2; body.add(cap);
    const cap2 = cap.clone(); cap2.rotation.x = Math.PI; cap2.position.y = -len / 2; body.add(cap2);
    for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.62, 6), metal); const a = i * Math.PI / 2 + Math.PI / 4;
      s.position.set(Math.cos(a) * R0 * 0.55, len / 2 + 0.28, Math.sin(a) * R0 * 0.55); s.rotation.set(Math.sin(a) * 0.33, 0, -Math.cos(a) * 0.33); body.add(s); }
    let th = 0, om = 0, sq = 0, tw = 0, two = 0;
    return {
      update(dt) {
        om += (-3.6 * th - 0.35 * om) * dt; th += om * dt;
        two += (-3 * tw - 0.5 * two) * dt; tw += two * dt; sq *= Math.pow(0.0005, dt);
        pivot.rotation.z = th; pivot.rotation.y = tw;
        body.scale.set(1 - 0.1 * sq, 1 + 0.02 * sq, 1 + 0.05 * sq);
      },
      hit(tip, power) {
        om += 0.32 * power; two += rand(-0.35, 0.35); sq = power;
        return { pos: new THREE.Vector3(Math.min(tip.x, x - R0), tip.y, 0.03), power, sound: "bag" };
      },
    };
  },

  async bamboo(g, reach) {
    const m = await pbr("bamboo_veneer", { color: 0x8fb04f, repeat: [0.4, 6], roughness: 0.55, ns: 0.6 });
    const node = new THREE.MeshStandardMaterial({ color: 0x5c6e2c, roughness: 0.5 });
    const r = 0.048, x = reach.x + r - 0.01, segs = []; let parent = g; const segLen = 1.6;
    for (let k = 0; k < 5; k++) {
      const sg = new THREE.Group(); if (k) sg.position.y = segLen; else sg.position.set(x, 0, 0); parent.add(sg); segs.push(sg);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r * (1 - k * 0.07), r * (1 - (k - 1) * 0.07), segLen, 24), m); c.position.y = segLen / 2; c.castShadow = c.receiveShadow = true; sg.add(c);
      for (let n = 0; n < 4; n++) { const ri = new THREE.Mesh(new THREE.TorusGeometry(r * (1 - k * 0.07) + 0.002, 0.005, 8, 24), node); ri.rotation.x = Math.PI / 2; ri.position.y = segLen * (n / 4); sg.add(ri); }
      parent = sg;
    }
    const leafM = new THREE.MeshStandardMaterial({ color: 0x7f9c3a, side: THREE.DoubleSide, roughness: 0.6 });
    const leafGeo = new THREE.PlaneGeometry(0.13, 0.024); const leaves = [];
    for (let i = 0; i < 40; i++) { const l = new THREE.Mesh(leafGeo, leafM); l.visible = false; l.castShadow = true; g.add(l); leaves.push({ m: l, life: 0, vx: 0, vy: 0, ph: 0 }); }
    function drop(px, py, pz) { const L = leaves.find((l) => l.life <= 0); if (!L) return; L.life = 7; L.m.visible = true; L.m.position.set(px, py, pz); L.vx = rand(-0.15, 0.25); L.vy = -rand(0.25, 0.45); L.ph = rand(0, 6); }
    let a = 0, av = 0;
    return {
      update(dt, t) {
        av += (-34 * a - 2 * av) * dt; a += av * dt;
        segs.forEach((sg, k) => { sg.rotation.z = -a * (0.3 + k * 0.12) + Math.sin(t * 0.8 + k) * 0.003; });
        if (Math.random() < dt * 0.25) drop(rand(-2, 2.5), 4.2, rand(-2, 1));
        for (const L of leaves) { if (L.life <= 0) continue; L.life -= dt; L.ph += dt * 3;
          L.m.position.x += (L.vx + Math.sin(L.ph) * 0.35) * dt; L.m.position.y += L.vy * dt; L.m.rotation.set(Math.sin(L.ph) * 1.2, L.ph * 0.7, Math.cos(L.ph) * 0.8);
          if (L.m.position.y < 0.01) { L.m.position.y = 0.01; L.vy = 0; L.vx = 0; L.m.rotation.set(-Math.PI / 2, L.ph, 0); }
          if (L.life <= 0) L.m.visible = false; }
      },
      hit(tip, power) {
        av += 1.1 * power;
        for (let i = 0; i < 8; i++) drop(x + rand(-0.6, 0.6), rand(3.4, 4.8), rand(-0.5, 0.5));
        return { pos: new THREE.Vector3(Math.min(tip.x, x - r), tip.y, 0.03), power, sound: "bamboo" };
      },
      // 원인치 펀치: 숲 전체의 잎이 쏟아짐
      blast() { for (let i = 0; i < 40; i++) drop(rand(-2, 3), rand(3, 5), rand(-1.5, 0.8)); },
    };
  },

  async snow(g, reach) {
    const bark = await pbr("japanese_cedar_bark", { repeat: [1, 3], ns: 1.4 });
    const snowM = await pbr("snow_02", { repeat: [1, 1], ns: 0.8 });
    const straw = new THREE.MeshStandardMaterial({ color: 0xa88a55, roughness: 1 });
    const r = 0.14, x = reach.x + r - 0.02;
    const post = new THREE.Group(); post.position.set(x, 0, 0); g.add(post);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, 1.9, 40, 6), bark); trunk.position.y = 0.95; trunk.castShadow = trunk.receiveShadow = true; post.add(trunk);
    for (let k = 0; k < 7; k++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.012, r + 0.012, 0.042, 40), straw); s.position.y = reach.y - 0.22 + k * 0.065; s.castShadow = true; post.add(s); }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.15, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), snowM); cap.scale.y = 0.6; cap.position.y = 1.9; cap.castShadow = true; post.add(cap);
    const flakes = new Pool(800, { size: 0.03, color: 0xffffff, additive: false, opacity: 0.95 });
    for (let i = 0; i < 800; i++) flakes.spawn(rand(-4, 4), rand(0, 6), rand(-6, 3), 0, -rand(0.3, 0.7), 0, 1e9);
    g.add(flakes.pts);
    const breath = new Pool(60, { size: 0.12, color: 0x8a929c, opacity: 0.45 }); g.add(breath.pts);
    let pr = 0, pv = 0, capH = 0.6, nextBreath = 2;
    return {
      update(dt, t) {
        const p = flakes.p;
        for (let i = 0; i < flakes.n; i++) { const j = i * 3; p[j] += Math.sin(t * 0.8 + i) * 0.12 * dt; if (p[j + 1] < 0) { p[j + 1] = 6; p[j] = rand(-4, 4); } }
        flakes.update(dt, 0, 0);
        nextBreath -= dt;
        if (nextBreath < 0) { nextBreath = rand(2.6, 3.6); fighter.head(tmp); for (let i = 0; i < 8; i++) breath.spawn(tmp.x + 0.1, tmp.y + 0.02, tmp.z, rand(0.12, 0.3), rand(0.02, 0.1), rand(-0.05, 0.05), rand(1, 1.6)); }
        breath.update(dt, -0.02, 0.6);
        pv += (-60 * pr - 6 * pv) * dt; pr += pv * dt; post.rotation.z = -pr;
        capH = Math.min(0.6, capH + dt * 0.004); cap.scale.y = capH;
      },
      hit(tip, power) {
        pv += 0.5 * power;
        const n = Math.round(14 + 14 * capH);
        for (let i = 0; i < n; i++) chunks.spawn(x + rand(-0.15, 0.15), 1.9 + rand(0, 0.1), rand(-0.15, 0.15), rand(-0.1, 0.5), rand(0, 0.6), rand(-0.3, 0.3), 3);
        capH = Math.max(0.2, capH - 0.07);
        return { pos: new THREE.Vector3(Math.min(tip.x, x - r), tip.y, 0.03), power, sound: "post" };
      },
      // 원인치 펀치: 기둥 위 눈이 한꺼번에 털려 날아감
      blast(pos, power) {
        for (let i = 0; i < 120; i++) chunks.spawn(x + rand(-0.2, 0.2), 1.9 + rand(0, 0.15), rand(-0.2, 0.2), rand(0.3, 2.5) * power * 0.5, rand(0.5, 2.2), rand(-0.8, 0.8), 3);
        capH = 0.05;
      },
    };
  },

  async waterfall(g, reach, plated) { return waterColumn(g, reach, plated); },

  async water(g, reach, plated) {
    scene.fog = plated ? null : new THREE.FogExp2(0x0b4a63, 0.075);
    const caus = canvasTex(256, 256, (c, w, h) => { c.fillStyle = "#000"; c.fillRect(0, 0, w, h); c.strokeStyle = "rgba(200,255,255,.9)"; c.lineWidth = 2.2;
      for (let i = 0; i < 160; i++) { c.beginPath(); const x = rand(0, w), y = rand(0, h), r = rand(8, 26); c.ellipse(x, y, r, r * rand(0.5, 1), rand(0, 3), 0, Math.PI * 2); c.stroke(); } });
    caus.wrapS = caus.wrapT = THREE.RepeatWrapping; caus.repeat.set(4, 4);
    const causM = new THREE.MeshBasicMaterial({ map: caus, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    const causPlane = new THREE.Mesh(new THREE.CircleGeometry(6, 48), causM); causPlane.rotation.x = -Math.PI / 2; causPlane.position.y = 0.01; g.add(causPlane);
    const rayTex = canvasTex(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "rgba(200,245,255,.6)"); gr.addColorStop(1, "rgba(200,245,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
    const rays = [];
    for (let i = 0; i < 8; i++) { const r = new THREE.Mesh(new THREE.PlaneGeometry(rand(0.4, 1), 8), new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      r.position.set(rand(-3, 3), 4.2, rand(-4, -0.5)); r.rotation.z = rand(-0.25, 0.1); g.add(r); rays.push({ m: r, ph: rand(0, 6) }); }
    const bub = new Pool(340, { size: 0.035, color: 0xd8f6ff, opacity: 0.85 }); g.add(bub.pts);
    for (let i = 0; i < 90; i++) bub.spawn(rand(-3, 3), rand(0, 5), rand(-3, 1), 0, rand(0.2, 0.5), 0, rand(4, 12));
    const motes = new Pool(260, { size: 0.02, color: 0xa8e0ee, opacity: 0.6 });
    for (let i = 0; i < 260; i++) motes.spawn(rand(-3, 3), rand(0, 4), rand(-3, 2), 0, 0, 0, 1e9);
    g.add(motes.pts);
    let nextBub = 1;
    return {
      update(dt, t) {
        caus.offset.set(Math.sin(t * 0.15) * 0.05, t * 0.015); causM.opacity = 0.08 + Math.sin(t * 0.9) * 0.03;
        for (const r of rays) { r.m.material.opacity = 0.2 + 0.14 * Math.sin(t * 0.6 + r.ph); r.m.rotation.z = -0.1 + Math.sin(t * 0.25 + r.ph) * 0.08; }
        if (Math.random() < dt * 6) bub.spawn(rand(-3, 3), 0.05, rand(-3, 1), 0, rand(0.2, 0.5), 0, rand(6, 12));
        nextBub -= dt;
        if (nextBub < 0) { nextBub = rand(3, 5); fighter.head(tmp); for (let i = 0; i < 6; i++) bub.spawn(tmp.x + 0.1, tmp.y + 0.02, tmp.z, rand(-0.03, 0.03), rand(0.3, 0.5), 0, rand(3, 5)); }
        const p = bub.p; for (let i = 0; i < bub.n; i++) p[i * 3] += Math.sin(t * 3 + i) * 0.05 * dt;
        bub.update(dt, -0.05, 0.3);
        const mp = motes.p, mv = motes.v;
        for (let i = 0; i < motes.n; i++) { const j = i * 3; mv[j] *= 1 - 0.5 * dt; mv[j + 1] *= 1 - 0.5 * dt; mp[j] += Math.sin(t * 0.3 + i) * 0.03 * dt; }
        motes.update(dt, 0, 0);
      },
      hit(tip) {
        for (let i = 0; i < 50; i++) bub.spawn(tip.x + rand(-0.05, 0.05), tip.y + rand(-0.08, 0.08), rand(-0.08, 0.08), rand(0.4, 1.6), rand(-0.3, 0.6), rand(-0.5, 0.5), rand(1.5, 3));
        const mp = motes.p, mv = motes.v;
        for (let i = 0; i < motes.n; i++) { const j = i * 3, dx = mp[j] - tip.x, dy = mp[j + 1] - tip.y, d2 = dx * dx + dy * dy; if (d2 < 1.2) { mv[j] += (1.2 - d2) * 0.8; mv[j + 1] += dy * 0.5; } }
        return { pos: tip.clone().add(new THREE.Vector3(0.12, 0, 0)), power: 0.6, sound: "underwater", faceX: true };
      },
    };
  },
};

function waterColumn(g, reach, plated) {
  const k = plated ? 0.5 : 1; // 배경 그림이 밝아 더하기 합성이 하얗게 타지 않도록 줄임
  const x0 = reach.x - 0.01, x1 = x0 + 0.5;
  const sheetTex = canvasTex(64, 256, (c, w, h) => { c.clearRect(0, 0, w, h); for (let i = 0; i < 120; i++) { c.fillStyle = `rgba(235,250,255,${rand(0.08, 0.35)})`; const x = rand(0, w), y = rand(0, h), sw = rand(1, 4), sl = rand(20, 90); c.fillRect(x, y, sw, sl); c.fillRect(x, y - h, sw, sl); } });
  sheetTex.wrapS = sheetTex.wrapT = THREE.RepeatWrapping; sheetTex.repeat.set(2, 2);
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 0.1, 8), new THREE.MeshBasicMaterial({ map: sheetTex, transparent: true, opacity: 0.7 * k, depthWrite: false, blending: THREE.AdditiveBlending }));
  sheet.position.set((x0 + x1) / 2, 4, -0.3); g.add(sheet);
  const N = 2000, fall = new Pool(N, { size: 0.045, color: 0xd8f2ff, opacity: 0.85 * k }); g.add(fall.pts);
  for (let i = 0; i < N; i++) { const y = rand(0, 8), v0 = rand(2.5, 4); fall.spawn(rand(x0, x1), y, rand(-0.28, 0.22), 0, -Math.sqrt(v0 * v0 + 7 * (8 - y)), 0, 1e9); }
  const mist = new Pool(140, { size: 0.5, color: 0xa9c2c8, opacity: 0.2 * k }); g.add(mist.pts);
  const splash = new Pool(240, { size: 0.045, color: 0xe6f8ff }); g.add(splash.pts);
  let gap = 0, gapY = reach.y;
  return {
    update(dt) {
      sheetTex.offset.y = (sheetTex.offset.y + dt * 1.6) % 1;
      const p = fall.p, v = fall.v; gap *= Math.pow(0.12, dt);
      for (let i = 0; i < N; i++) { const j = i * 3;
        if (p[j + 1] < 0.04 || p[j] > x1 + 1.2) { p[j] = rand(x0, x1); p[j + 1] = rand(7.5, 8); p[j + 2] = rand(-0.28, 0.22); v[j] = 0; v[j + 1] = -rand(2.5, 4); v[j + 2] = 0;
          if (Math.random() < 0.12) mist.spawn(p[j], 0.15, p[j + 2] + 0.2, rand(-0.25, 0.25), rand(0.05, 0.2), rand(0, 0.3), rand(1.5, 3)); }
        if (gap > 0.05 && Math.abs(p[j + 1] - gapY) < 0.35 * gap + 0.05 && p[j] < x0 + 0.35) { v[j] += 90 * gap * dt; v[j + 2] += rand(-1, 1) * gap * dt * 10; }
      }
      fall.update(dt, 3.5, 0); mist.update(dt, -0.02, 0.4); splash.update(dt, 5, 0.5, 0.02);
    },
    hit(tip, power) {
      gap = 1; gapY = tip.y;
      for (let i = 0; i < 44; i++) splash.spawn(x0, tip.y + rand(-0.12, 0.12), rand(-0.15, 0.15), rand(0.3, 2.2), rand(-0.4, 1.6), rand(-1.2, 1.2), rand(0.4, 0.9));
      return { pos: new THREE.Vector3(Math.min(tip.x, x0), tip.y, 0.05), power, sound: "splash" };
    },
    // 원인치 펀치: 폭포가 높이 갈라지고 물보라가 크게 튐
    blast(pos, power) {
      gap = 2.2 + power * 0.4;
      for (let i = 0; i < 150; i++) splash.spawn(x0, pos.y + rand(-0.5, 0.5), rand(-0.3, 0.3), rand(1, 4.5), rand(-0.5, 2.5), rand(-2, 2), rand(0.6, 1.4));
    },
  };
}

/* ---------- 무대 바꾸기 ---------- */
let stageIdx = -1, stage = null;
async function setStage(i) {
  const cfg = STAGES[i];
  const plate = await once("plate:" + plateUrl(cfg.key), () => loadPlate(plateUrl(cfg.key)));
  const [env, bg] = plate ? [null, null] : await Promise.all([loadEnv(cfg.hdr), loadBg(cfg.hdr)]);
  if (stage) scene.remove(stage.group);
  if (sky) { scene.remove(sky); sky = null; }
  scene.fog = null;
  const group = new THREE.Group(); scene.add(group);
  sun.color.set(cfg.sun.color);
  sun.position.set(...cfg.sun.dir).normalize().multiplyScalar(8).add(sun.target.position);
  plateLayer.set(plate, cfg.plate);
  if (plate) {
    // 배경 사진의 위·아래 색으로 캐릭터를 비추고, 사진의 분위기로 반사광을 만듦
    const envTex = plate.tex.clone(); envTex.mapping = THREE.EquirectangularReflectionMapping; envTex.needsUpdate = true;
    scene.environment = pmrem.fromEquirectangular(envTex).texture; scene.environmentIntensity = 0.55;
    hemi.color.copy(plate.sky); hemi.groundColor.copy(plate.ground); hemi.intensity = 1.4;
    rim.color.copy(plate.sky).lerp(new THREE.Color(0xffffff), 0.4); rim.intensity = 1.6;
    sun.intensity = cfg.sun.intensity * 0.8;
    renderer.toneMappingExposure = 1;
    catcher.material.opacity = 0.35; contact.visible = true;
  } else {
    sky = new GroundedSkybox(bg, cfg.sky.height, cfg.sky.radius, 96);
    sky.rotation.y = cfg.sky.rot * R;
    if (cfg.underwater) sky.material.color.set(0x5fa6b8);
    scene.add(sky);
    scene.environment = env; scene.environmentIntensity = cfg.env;
    scene.environmentRotation = new THREE.Euler(0, cfg.sky.rot * R, 0);
    hemi.intensity = 0; rim.intensity = 0; sun.intensity = cfg.sun.intensity;
    renderer.toneMappingExposure = cfg.exposure;
    catcher.material.opacity = 0.45; contact.visible = false;
  }
  stageIdx = i;
  stage = { cfg, group, plate: !!plate };
  fighter.setTarget(HAS_TARGET[cfg.key] ? fighter.reach.x - 0.02 : null);
  placeSky();
  Object.assign(stage, await BUILD[cfg.key](group, fighter.reach, !!plate));
  document.body.dataset.ink = cfg.ink;
  quoteBag = [];
  sfx.ambient(cfg.key);
}

/* ---------- 발이 닿았을 때 ---------- */
let shake = 0;
/** 찰 대상이 있는 무대. 대상의 앞면은 발이 가장 멀리 나간 자리 바로 앞에 있음 */
const HAS_TARGET = { gym: true, bamboo: true, snow: true, waterfall: true };
function targetX() { return HAS_TARGET[stage.cfg.key] ? fighter.reach.x - 0.02 : null; }

function onLand() {
  if (!stage || !stage.hit) return;
  hitAt(fighter.tip(new THREE.Vector3()), rand(0.9, 1.1), true);
}

/** 날아 옆차기·뒤돌려차기·연타·팔꿈치: 맞는 순간마다 불림. last면 마지막 한 방이라 명언을 띄움 */
function onHit(pos, power, last) {
  if (!stage || !stage.hit) return;
  hitAt(pos, power * rand(0.9, 1.1), last);
}

/** pos(손·발 끝)에서 대상을 침. 멀면 허공만 일렁임 */
function hitAt(tip, power, quote) {
  // 대상에서 멀어져 있으면 허공을 참: 공기만 살짝 일렁이고 명언은 나오지 않음
  const tx = targetX();
  if (tx !== null && tip.x < tx - 0.1) {
    const sp = tip.clone().project(camera);
    wave.start(new THREE.Vector2((sp.x + 1) / 2, (sp.y + 1) / 2), 0.35, !!stage.cfg.underwater);
    sfx.impact("air", 0.4);
    return;
  }
  const res = stage.hit(tip, power);
  const uw = !!stage.cfg.underwater;
  const sp = res.pos.clone().project(camera);
  wave.start(new THREE.Vector2((sp.x + 1) / 2, (sp.y + 1) / 2), res.power, uw);
  shake = 0.03 * res.power;
  const f = PUFF[stage.cfg.key];
  sparks.base.set(f.color); sparks.mat.size = f.size;
  const n = Math.round(f.n * res.power);
  for (let i = 0; i < n; i++) {
    // 발이 나아가는 쪽(+X)으로 치우쳐 사방으로 흩어짐
    const a = rand(-1.3, 1.3), v = f.sp * rand(0.4, 1.2);
    sparks.spawn(res.pos.x, res.pos.y + rand(-0.06, 0.06), res.pos.z, Math.cos(a) * v, Math.sin(a) * v, rand(-0.5, 0.5) * v, rand(...f.life));
  }
  for (let i = 0; i < (f.leaves || 0); i++) leaves.spawn(res.pos.x + rand(0, 0.2), res.pos.y + rand(0, 1.2), rand(-0.2, 0.2), rand(0.1, 0.8), rand(0, 0.6), rand(-0.3, 0.3), rand(2, 3.5));
  sfx.impact(res.sound, res.power);
  if (quote) showQuote();
}

/* ---------- 줄넘기 줄 ---------- */
// 두 손 사이로 몸 앞뒤를 크게 도는 줄. 손 위치와 줄넘기 박자에 맞춰 매 장면 다시 그림
const ROPE_N = 40;
const ropeMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.7 });
const ropeLine = new THREE.Mesh(new THREE.BufferGeometry(), ropeMat);
ropeLine.frustumCulled = false; ropeLine.visible = false; ropeLine.castShadow = true; scene.add(ropeLine);
const hL = new THREE.Vector3(), hR = new THREE.Vector3(), ropeCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
function updateRope() {
  const ph = fighter && fighter.ropePhase ? fighter.ropePhase() : null;
  ropeLine.visible = ph !== null;
  if (ph === null) return;
  fighter.hands(hL, hR);
  const mid = hL.clone().add(hR).multiplyScalar(0.5);
  const r = Math.max(0.6, mid.y - 0.02);                          // 발밑에 닿을 만큼
  const a = ph * Math.PI * 2;                                      // 0 발밑, π 머리 위
  // 몸이 +x를 보고 있으니 줄은 x·y 평면에서 돔
  const apex = new THREE.Vector3(mid.x - Math.sin(a) * r * 0.55, mid.y - Math.cos(a) * r, mid.z);
  // 줄 중간은 손보다 늦게 따라와 활처럼 휨: 옆구리 점은 조금 덜 돈 각도에 둠
  const b = a - 0.7, rs = r * 0.75;
  const sideL = new THREE.Vector3(mid.x - Math.sin(b) * rs * 0.55, mid.y - Math.cos(b) * rs, (hL.z + mid.z) / 2 + (hL.z - mid.z) * 0.4);
  const sideR = new THREE.Vector3(sideL.x, sideL.y, (hR.z + mid.z) / 2 + (hR.z - mid.z) * 0.4);
  ropeCurve.points[0].copy(hL); ropeCurve.points[1].copy(sideL); ropeCurve.points[2].copy(apex); ropeCurve.points[3].copy(sideR); ropeCurve.points[4].copy(hR);
  ropeLine.geometry.dispose();
  ropeLine.geometry = new THREE.TubeGeometry(ropeCurve, ROPE_N, 0.007, 5, false);
}

/* ---------- 걸어갈 수 있는 범위 ---------- */
// 화면 왼쪽·오른쪽 끝이 캐릭터가 선 자리(z=0)에서 세계 x로 어디인지 구해, 몸이 화면 밖으로 나가지 않게 함
const rayC = new THREE.Raycaster(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hitP = new THREE.Vector3();
function edgeX(ndcX) {
  rayC.setFromCamera({ x: ndcX, y: -0.2 }, camera);
  return rayC.ray.intersectPlane(floorPlane, hitP) ? hitP.x : null;
}
function updateRange() {
  if (!fighter || !stage) return;
  const l = edgeX(-1), r = edgeX(1);
  if (l === null || r === null) return;
  const min = l + 0.45;                                            // 뒷발이 화면 안에 남도록
  const max = HAS_TARGET[stage.cfg.key] ? FIGHTER_X + 0.05 : r - 1.45; // 대상이 있으면 발차기 거리까지, 없으면 뻗은 발이 오른쪽 버튼에 가리지 않도록
  fighter.setRange(min, max);
}

/* ---------- 원인치 펀치 ---------- */
let warp = 0; // 남은 시간 멈춤(실제 초)
function onPunch() {
  if (!stage || !stage.hit) return;
  const power = punchPower;
  const fist = fighter.fist(new THREE.Vector3());
  const tx = targetX();
  const touching = tx === null || fist.x >= tx - 0.12;
  // 맞는 순간 시간이 멈추듯 느려지고, 그동안 공기의 충격파가 화면 끝까지 퍼짐
  warp = 0.32 + 0.08 * power;
  const res = touching ? stage.hit(fist, power * 1.6) : { pos: fist.clone(), power: 1, sound: "air" };
  if (touching && stage.blast) stage.blast(res.pos, power);
  const sp = res.pos.clone().project(camera);
  wave.start(new THREE.Vector2((sp.x + 1) / 2, (sp.y + 1) / 2), 1.2 + power * 0.6, !!stage.cfg.underwater, true);
  shake = 0.05 + 0.035 * power;
  // 주변이 힘에 밀려남: 바닥을 따라 동심원으로 흩어짐
  const f = PUFF[stage.cfg.key];
  sparks.base.set(f.color); sparks.mat.size = f.size * 1.2;
  for (let i = 0; i < 140; i++) {
    const a = rand(0, Math.PI * 2), v = rand(2, 4.5) * (0.6 + power * 0.25);
    sparks.spawn(res.pos.x + Math.cos(a) * 0.1, rand(0.03, 0.12), Math.sin(a) * 0.1, Math.cos(a) * v, rand(0.05, 0.5), Math.sin(a) * v, rand(0.6, 1.3));
  }
  for (let i = 0; i < 60; i++) {
    const a = rand(-1.4, 1.4), v = rand(1.5, 4) * power * 0.5;
    sparks.spawn(res.pos.x, res.pos.y, res.pos.z, Math.cos(a) * v, Math.sin(a) * v, rand(-1, 1) * v * 0.5, rand(0.5, 1.1));
  }
  for (let i = 0; i < (f.leaves ? 30 : 0); i++) leaves.spawn(res.pos.x + rand(-1, 1.5), res.pos.y + rand(0, 2.5), rand(-0.6, 0.6), rand(0.4, 2), rand(0, 1), rand(-0.6, 0.6), rand(2.5, 4));
  sfx.boom(power);
  if (touching) sfx.impact(res.sound, Math.min(2, power));
  showQuote();
}

/* ---------- 명언 ---------- */
const quoteEl = document.getElementById("quote");
let quoteBag = [], quoteTimer = 0;
function nextQuote() {
  if (!quoteBag.length) { quoteBag = QUOTES[stageIdx].slice(); for (let i = quoteBag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [quoteBag[i], quoteBag[j]] = [quoteBag[j], quoteBag[i]]; } }
  return quoteBag.pop();
}
function showQuote() {
  const q = nextQuote(); clearTimeout(quoteTimer);
  const show = () => { quoteEl.textContent = q; quoteEl.classList.add("on"); quoteTimer = setTimeout(() => quoteEl.classList.remove("on"), 4200); };
  if (quoteEl.classList.contains("on")) { quoteEl.classList.remove("on"); quoteTimer = setTimeout(show, 450); } else show();
}

/* ---------- 화면 ---------- */
const sfx = makeSfx({ isOn: () => S.sound, isSlow: () => !!(stage && stage.cfg.underwater) });
const dayN = document.getElementById("dayN"), dayM = document.getElementById("dayM");
const curtain = document.getElementById("curtain"), cStage = document.getElementById("cStage"), cLine = document.getElementById("cLine");
const sndBtn = document.getElementById("snd");
const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
function paintSnd() { sndBtn.innerHTML = S.sound ? ICON_ON : ICON_OFF; sndBtn.setAttribute("aria-label", S.sound ? "소리 끄기" : "소리 켜기"); }
paintSnd();
sndBtn.addEventListener("click", (e) => { e.stopPropagation(); sfx.init(); S.sound = !S.sound; save(); sfx.setOn(S.sound); paintSnd(); });

let curtainBusy = false;
function showCurtain(stageName, line, swap) {
  curtainBusy = true;
  curtain.classList.remove("off", "text");
  setTimeout(async () => {
    if (swap) await swap();
    cStage.textContent = stageName; cLine.textContent = line;
    curtain.classList.add("text");
    setTimeout(() => {
      curtain.classList.remove("text");
      setTimeout(() => { curtain.classList.add("off"); curtainBusy = false; }, 900);
    }, 3600);
  }, 1700);
}

async function refreshDay(initial) {
  const d = dayNow(), si = stageFor(d);
  dayN.textContent = d;
  dayM.textContent = d <= FINAL_DAY ? "/ " + FINAL_DAY : "";
  if (si !== stageIdx) {
    const isNew = si > S.seen;
    if (initial && !isNew) { await setStage(si); curtain.classList.add("off"); }
    else if (initial) { await setStage(si); showCurtain(STAGES[si].name, STAGES[si].line); }
    else showCurtain(STAGES[si].name, STAGES[si].line, () => setStage(si));
    if (isNew) { S.seen = si; save(); }
  } else if (initial) curtain.classList.add("off");
  if (d >= FINAL_DAY && !S.done && !curtainBusy) { S.done = true; save(); showCurtain(FINAL_DAY + "일", FINAL_LINE); }
}

/* ---------- 조작 ---------- */
// 차기와 동작은 모두 화면 아래 버튼으로 함
let punchPower = 2.4, held = new Set();
let usedUp = false;
/** 지금 누르고 있는 방향 {x: 1 오른쪽(앞) / -1 왼쪽(뒤), y: 1 위 / -1 아래} */
function dirHeld() {
  const l = held.has("L"), r = held.has("R"), u = held.has("U"), d = held.has("D");
  return { x: l === r ? 0 : l ? -1 : 1, y: u === d ? 0 : u ? 1 : -1 };
}
function setMove() {
  const l = held.has("L"), r = held.has("R");
  fighter.move(l === r ? 0 : l ? -1 : 1);
}
function press(kind) {
  if (!fighter) return;
  sfx.init();
  if (kind === "L" || kind === "R") { held.add(kind); setMove(); }
  else if (kind === "U") { held.add("U"); usedUp = false; }
  else if (kind === "D") { held.add("D"); fighter.crouch(true); }
  else if (kind === "kick") { if (!S.everKicked) { S.everKicked = true; save(); } usedUp = true; fighter.kick(dirHeld()); }
  else if (kind === "punch") {
    // 방향키 없이: 원인치 펀치(다가가 잠깐 힘을 모은 뒤 내지름). 다른 조합은 fighter.punch 참고
    usedUp = true;
    if (fighter.punch(dirHeld()) === "inch") { sfx.chargeStart(); setTimeout(() => { sfx.chargeStop(); fighter.chargeRelease(); }, 520); }
  }
  else if (kind === "bat") fighter.bat();
  else if (kind === "qb" || kind === "pitch" || kind === "freeze") fighter.trick(kind);
  else fighter.action(kind);
  paintButtons();
}
function release(kind) {
  if (!fighter) return;
  if (kind === "L" || kind === "R") { held.delete(kind); setMove(); }
  // ↑를 짧게 눌렀다 떼면 점프. 누른 채로 주먹·발차기를 썼으면 점프하지 않음
  if (kind === "U") { held.delete("U"); if (!usedUp) fighter.trick("jump"); }
  if (kind === "D") { held.delete("D"); fighter.crouch(false); }
}
for (const b of document.querySelectorAll(".ctl button[data-k]")) {
  const kind = b.dataset.k;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault(); b.classList.add("down");
    try { b.setPointerCapture(e.pointerId); } catch (err) { /* 손가락을 붙잡지 못해도 누름은 처리함 */ }
    press(kind);
  });
  const up = () => { if (!b.classList.contains("down")) return; b.classList.remove("down"); release(kind); };
  b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}
// 컴퓨터에서 확인할 때 쓰는 키
const KEYS = { ArrowLeft: "L", ArrowRight: "R", ArrowUp: "U", ArrowDown: "D", Space: "kick", KeyF: "punch", KeyU: "pushup", KeyJ: "rope", KeyD: "dance", KeyB: "bat", KeyG: "guitar", KeyQ: "qb", KeyT: "pitch", KeyZ: "freeze" };
window.addEventListener("keydown", (e) => {
  if (e.repeat || !KEYS[e.code]) return;
  e.preventDefault(); press(KEYS[e.code]);
});
window.addEventListener("keyup", (e) => { if (KEYS[e.code]) release(KEYS[e.code]); });

const toggles = ["rope", "dance", "guitar"].map((k) => [k, document.querySelector(`[data-k="${k}"]`)]);
function paintButtons() {
  if (!fighter) return;
  for (const [k, b] of toggles) if (b) b.setAttribute("aria-pressed", fighter.mode === k ? "true" : "false");
}

/** 명상 중에는 화면과 소리가 고요해지고, 힘을 모을 때는 화면 가장자리가 어두워짐 */
let calmOn = false;
function updateMood() {
  if (!fighter) return;
  const calmNow = fighter.mode === "sit";
  if (calmNow !== calmOn) { calmOn = calmNow; document.body.classList.toggle("calm", calmOn); sfx.setCalm(calmOn); paintButtons(); }
  document.body.style.setProperty("--charge", fighter.charge.toFixed(3));
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshDay(false); });

const walkman = makeWalkman(document.getElementById("walkman"));

/* ---------- 시작 화면: 카세트를 넣으면 시작 ---------- */
// 누르는 순간 소리를 켜야 아이폰에서도 소리가 나서, 시작을 이 화면 한 번의 탭으로 함
const intro = document.getElementById("intro");
document.getElementById("introDay").textContent = dayNow() + "일째";
let started = false;
function begin() {
  if (started) return; started = true;
  sfx.init(); sfx.cassette();
  intro.classList.add("in");
  const music = walkman.play();                     // 노래가 있으면 바로 재생
  setTimeout(() => intro.classList.add("play"), 450);
  setTimeout(() => intro.classList.add("off"), 1400);
  return music;
}
intro.addEventListener("click", begin);
intro.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); begin(); } });

/* ---------- 시작하고 흐른 시간 ---------- */
// "4일 16:47:15"처럼 처음 연 뒤로 쌓인 시간. #d=N으로 날짜를 흉내 낼 때는 그날에 맞춰 보여줌
const elapsedEl = document.getElementById("elapsed");
const pad2 = (n) => String(n).padStart(2, "0");
function paintElapsed() {
  let ms = Date.now() - S.start;
  if (SIM_DAY) ms = (SIM_DAY - 1) * DAY_MS + (ms % DAY_MS);
  const sec = Math.floor(ms / 1000), d = Math.floor(sec / 86400);
  elapsedEl.textContent = `${d}일 ${pad2(Math.floor(sec / 3600) % 24)}:${pad2(Math.floor(sec / 60) % 60)}:${pad2(sec % 60)}`;
}
paintElapsed(); setInterval(paintElapsed, 1000);

/* ---------- 필름 그레인 ---------- */
(function grain() {
  const c = document.createElement("canvas"); c.width = c.height = 160; const g = c.getContext("2d"); const d = g.createImageData(160, 160);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0);
  document.getElementById("grain").style.backgroundImage = `url(${c.toDataURL()})`;
})();

/* ---------- 시작 ---------- */
frame();
fighter = await makeFighter(scene, { onLand, onPunch, onHit, onWhoosh: () => sfx.whoosh() });
await refreshDay(true);
setInterval(() => refreshDay(false), 30000);
window.__game = { scene, camera, fighter, get stage() { return stage; }, setStage, wave, timeScale: 1 };

const clock = new THREE.Clock();
/** 한 장면을 그림. fakeDt를 주면 그만큼 시간이 흐른 것으로 침(창이 숨겨져 있을 때 확인용) */
let fakeT = 0;
function tick(fakeDt) {
  const raw = fakeDt !== undefined ? fakeDt : Math.min(0.05, clock.getDelta()) * window.__game.timeScale;
  if (fakeDt !== undefined) fakeT += fakeDt;
  const t = clock.elapsedTime + fakeT;
  const dt = warp > 0 ? raw * 0.03 : raw; warp -= raw;
  const uw = !!(stage && stage.cfg.underwater);
  fighter.update(dt, t, { slow: uw ? 0.55 : 1, floaty: uw });
  if (stage && stage.update) stage.update(dt, t);
  const f = stage && PUFF[stage.cfg.key];
  sparks.update(dt, f ? f.g : 2.5, f ? f.drag : 0.8);
  chunks.update(dt, 6, 0.3, 0.02);
  leaves.update(dt, 0.5, 1.8, 0.02);
  { const lv = leaves.v; for (let i = 0; i < leaves.n; i++) lv[i * 3] += Math.sin(t * 3 + i) * 0.6 * dt; } // 잎이 좌우로 하늘거림
  wave.update(raw);
  updateMood(raw);
  sfx.tick(dt);
  shake *= Math.pow(0.0008, raw);
  const sh = { x: rand(-1, 1) * shake, y: rand(-1, 1) * shake };
  if (contact.visible) { fighter.hips(tmp); contact.position.x = tmp.x + 0.05; }
  renderer.autoClear = false; renderer.clear();
  if (plateLayer.fit(camera, window.innerWidth / window.innerHeight, sh)) {
    renderer.render(plateLayer.scene, plateLayer.cam);
  } else {
    camera.position.copy(camBase).add(new THREE.Vector3(sh.x, sh.y, 0));
    camera.lookAt(camLook);
  }
  updateRange();
  updateRope();
  renderer.render(scene, camera);
  wave.render(renderer);
}
renderer.setAnimationLoop(() => tick());
/** 확인용: 1/30초씩 n번 진행 */
window.__game.step = (sec) => { for (let i = 0; i < Math.round(sec * 30); i++) tick(1 / 30); };
