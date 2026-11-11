// 무술가. assets/fighter.glb(Mixamo 뼈대와 동작)가 있으면 그 캐릭터를 쓰고,
// 없으면 관절을 직접 움직이는 임시 캐릭터를 씀(차기만 함).

import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const R = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
export const FIGHTER_X = -0.45;

/**
 * ### makeFighter
 * 무술가를 만들어 scene에 넣고, 옆차기를 시키는 조작을 돌려줌.
 * onLand는 발이 가장 멀리 뻗은 순간에 한 번 불림.
 */
export async function makeFighter(scene, { onLand, onPunch, onHit, onWhoosh }) {
  try {
    return await makeMixamo(scene, { onLand, onPunch, onHit, onWhoosh });
  } catch (e) {
    console.info("Mixamo 캐릭터를 쓰지 못해 임시 캐릭터를 씀:", e.message);
    return makeRig(scene, { onLand, onWhoosh });
  }
}

/* ---------- Mixamo ---------- */
// assets/fighter.glb: tools/build-fighter.html로 만든 파일.
// 동작: idle, kick, step_f, step_b, jab_head, fly_kick, spin_kick, combo8, elbow, pushup, rope, dance_*,
//       armada, martelo, jump, crouch, bat, uppercut, body, guitar, qb, pitch, breakdance
async function loadCharacter() {
  try {
    const gltf = await new GLTFLoader().loadAsync("assets/fighter.glb");
    gltf.scene.scale.setScalar(0.01); // Mixamo는 센티미터 단위
    return { base: gltf.scene, clips: gltf.animations };
  } catch (e) {
    const loader = new FBXLoader();
    const [base, kickSrc] = await Promise.all([loader.loadAsync("assets/fighter.fbx"), loader.loadAsync("assets/kick.fbx")]);
    base.scale.setScalar(0.01);
    base.animations[0].name = "idle"; kickSrc.animations[0].name = "kick";
    return { base, clips: [base.animations[0], kickSrc.animations[0]] };
  }
}


async function makeMixamo(scene, { onLand, onPunch, onHit, onWhoosh }) {
  const { base, clips: list } = await loadCharacter();
  const clips = Object.fromEntries(list.map((c) => [c.name, c]));
  if (!clips.idle || !clips.kick) throw new Error("동작이 들어 있지 않음");

  const holder = new THREE.Group(); holder.position.x = FIGHTER_X; scene.add(holder);
  const turn = new THREE.Group(); holder.add(turn);
  turn.add(base);
  base.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });

  const bones = {};
  base.traverse((o) => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/, "")] = o; });
  const hips = bones.Hips, footL = bones.LeftFoot, footR = bones.RightFoot, toeL = bones.LeftToeBase, toeR = bones.RightToeBase, head = bones.Head;
  if (!hips || !footL || !footR) throw new Error("뼈 이름이 Mixamo 형식이 아님");
  // 명상 자세는 기본 자세(T자)에서 관절을 돌려 직접 만듦
  const restQ = {}; for (const k in bones) restQ[k] = bones[k].quaternion.clone();

  // 걸음은 엉덩이가 앞으로 나간 거리만큼 캐릭터 전체를 옮기고, 모든 동작은 제자리에서 하도록 엉덩이의 앞뒤 이동을 지움
  const travel = {};
  for (const c of list) for (const tr of c.tracks) {
    if (!/Hips\.position$/.test(tr.name)) continue;
    const v = tr.values, x0 = v[0], z0 = v[2], n = v.length / 3;
    travel[c.name] = Math.hypot(v[(n - 1) * 3] - x0, v[(n - 1) * 3 + 2] - z0);
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }

  const mixer = new THREE.AnimationMixer(base);
  const act = (n, once) => {
    if (!clips[n]) return null;
    const a = mixer.clipAction(clips[n]);
    if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    return a;
  };
  const idle = act("idle"), kick = act("kick", true);
  const stepF = act("step_f", true), stepB = act("step_b", true);
  const punch = act("jab_head", true);

  /** 손·발 끝이 몸에서 가장 멀리 나간 순간을 찾음(dirX면 +x 방향 거리, 아니면 수평 거리) */
  const a = new THREE.Vector3(), h = new THREE.Vector3();
  function farthest(action, ends, dirX) {
    let best = { d: -1e9, t: 0, end: ends[0], dir: new THREE.Vector3(1, 0, 0), y: 0 };
    action.play(); action.setEffectiveWeight(1);
    for (let t = 0; t <= action.getClip().duration; t += 1 / 60) {
      action.time = t; mixer.update(0); holder.updateMatrixWorld(true);
      hips.getWorldPosition(h);
      for (const e of ends) {
        e.getWorldPosition(a);
        const dx = a.x - h.x, dz = a.z - h.z;
        const d = dirX ? dx : Math.hypot(dx, dz) + Math.max(0, a.y - 0.3) * 0.5;
        if (d > best.d) best = { d, t, end: e, dir: new THREE.Vector3(dx, 0, dz).normalize(), y: a.y };
      }
    }
    action.stop();
    return best;
  }

  // 옆차기: 발이 가장 멀리 나가는 순간과 방향을 찾고, 차는 방향이 화면 오른쪽(+x)을 향하도록 돌림
  const kb = farthest(kick, [footL, footR]);
  const faceKick = Math.atan2(kb.dir.z, kb.dir.x);
  turn.rotation.y = faceKick;
  const hitTime = kb.t;
  const tipBone = kb.end === footL ? (toeL || footL) : (toeR || footR);
  const tip = new THREE.Vector3();
  kick.play(); kick.time = hitTime; mixer.update(0); holder.updateMatrixWorld(true);
  tipBone.getWorldPosition(tip); kick.stop();
  const reach = { x: tip.x, y: tip.y };

  // 원인치 펀치: 주먹이 가장 앞(+x)으로 나간 순간
  let punchHit = 0, fist = null, fistReach = 0;
  if (punch) {
    const pb = farthest(punch, [bones.LeftHand, bones.RightHand].filter(Boolean), true);
    punchHit = pb.t; fist = pb.end;
    punch.play(); punch.time = punchHit; mixer.update(0); holder.updateMatrixWorld(true);
    fist.getWorldPosition(a); fistReach = a.x - holder.position.x; punch.stop();
  }

  // 걸음 속도(m/초): 원래 동작에서 엉덩이가 나간 거리 ÷ 동작 길이
  idle.play(); mixer.update(0); holder.updateMatrixWorld(true);
  const unit = hips.getWorldPosition(h).y / hips.position.y;
  const speed = {
    f: stepF ? (travel.step_f * unit) / clips.step_f.duration : 0.4,
    b: stepB ? (travel.step_b * unit) / clips.step_b.duration : 0.3,
  };

  /**
   * 명상: 바닥에 책상다리로 앉아 정면을 봄. T자 기본 자세에서 각 관절을 돌리는 각도(도, x·y·z).
   * hipsY는 앉았을 때 엉덩이 높이(m).
   */
  const LOTUS = {
    hipsY: 0.2,
    face: 180, // 몸이 바라볼 방향(도). 화면 쪽
    bones: {
      LeftUpLeg: [-90, 0, -55], RightUpLeg: [-90, 0, 55],
      LeftLeg: [140, 0, 0], RightLeg: [140, 0, 0],
      LeftFoot: [0, 0, 0], RightFoot: [0, 0, 0],
      Spine: [4, 0, 0], Spine1: [2, 0, 0], Spine2: [0, 0, 0], Neck: [6, 0, 0], Head: [4, 0, 0],
      LeftArm: [0, 0, -70], RightArm: [0, 0, 70],
      LeftForeArm: [0, -40, 0], RightForeArm: [0, 40, 0],
    },
  };
  const qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler();
  let sitW = 0;
  function applyLotus(w) {
    const k = w * w * (3 - 2 * w);
    for (const [n, [x, y, z]] of Object.entries(LOTUS.bones)) {
      const b = bones[n]; if (!b) continue;
      qTmp.copy(restQ[n]).multiply(new THREE.Quaternion().setFromEuler(eTmp.set(x * R, y * R, z * R)));
      b.quaternion.slerp(qTmp, k);
    }
    // 엉덩이를 바닥 가까이 내리고, 몸을 화면 쪽으로 돌림
    const hy = hips.position.y, want = LOTUS.hipsY / unit;
    hips.position.y = hy + (want - hy) * k;
    hips.quaternion.slerp(restQ.Hips, k);
    turn.rotation.y = faceKick + (LOTUS.face * R - faceKick) * k;
  }

  /**
   * 방향키와 함께 쓰는 공격. ends는 닿는 곳(feet 발, hands 주먹),
   * approach는 치기 전에 대상 앞으로 다가갈지(주먹 공격), from은 동작을 시작할 시점(초, 도움닫기를 건너뜀).
   */
  const STRIKES = {
    fly_kick: { ends: "feet", approach: false, power: 1.5 },
    spin_kick: { ends: "feet", approach: false, power: 1.3 },
    combo8: { ends: "hands", approach: true, power: 0.7 },
    elbow: { ends: "hands", approach: true, power: 1.1, elbow: true },
    armada: { ends: "feet", approach: false, power: 1.4 },   // 카포에라 돌려차기
    martelo: { ends: "feet", approach: false, power: 1.2 },  // 바닥을 짚고 돌며 차기
    uppercut: { ends: "hands", approach: true, power: 1.6 },  // 올려치기
    body: { ends: "hands", approach: true, power: 0.9 },      // 몸통 잇따라 치기
    bat: { ends: "hands", approach: true, power: 2.2, swing: true, extend: 0.8 }, // 빈손 야구 타격. 보이지 않는 방망이 끝(0.8m)이 맞음
  };
  /** 치지 않는 재주: 한 번 하고 서 있는 자세로 돌아옴 */
  const TRICKS = { jump: act("jump", true), qb: act("qb", true), pitch: act("pitch", true), freeze: act("breakdance", true) };
  const crouch = act("crouch");
  for (const [name, sk] of Object.entries(STRIKES)) {
    sk.action = act(name, true);
    if (!sk.action) continue;
    const ends = sk.ends === "head" ? [bones.HeadTop_End || head].filter(Boolean)
      : sk.ends === "feet" ? [toeL || footL, toeR || footR]
      : sk.elbow ? [bones.LeftForeArm, bones.RightForeArm, bones.LeftHand, bones.RightHand].filter(Boolean)
      : [bones.LeftHand, bones.RightHand].filter(Boolean);
    sk.yaw = 0; sk.from = sk.from || 0;
    if (sk.swing) { swingHit(sk, ends); continue; }
    sk.hits = contacts(sk.action, ends);
    // 발차기는 한 번만 맞음: 가장 멀리 뻗은 순간 하나만 남김
    if (sk.ends === "feet" && sk.hits.length > 1) sk.hits = [sk.hits.reduce((p, q) => (q.reach > p.reach ? q : p))];
  }

  /**
   * 휘두르는 동작(야구 타격): 손이 가장 빠른 순간을 맞는 순간으로 보고,
   * 그때 손이 나아가는 방향이 대상(+x)을 향하도록 몸을 얼마나 더 돌릴지(yaw) 구함
   */
  function swingHit(sk, ends) {
    const action = sk.action, p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    idle.stop(); action.play(); action.setEffectiveWeight(1);
    let best = { v: 0, t: 0, end: ends[0], dir: new THREE.Vector3(1, 0, 0) };
    const dur = action.getClip().duration, dt = 1 / 60;
    for (let t = 0; t + dt <= dur; t += dt) {
      for (const e of ends) {
        action.time = t; mixer.update(0); holder.updateMatrixWorld(true); e.getWorldPosition(p0);
        action.time = t + dt; mixer.update(0); holder.updateMatrixWorld(true); e.getWorldPosition(p1);
        const d = p1.sub(p0); d.y = 0; const v = d.length();
        if (v > best.v) best = { v, t, end: e, dir: d.normalize().clone() };
      }
    }
    // 손이 나아가는 방향을 +x로 돌리는 각도
    sk.yaw = Math.atan2(best.dir.z, best.dir.x);
    turn.rotation.y = faceKick + sk.yaw;
    action.time = best.t; mixer.update(0); holder.updateMatrixWorld(true);
    best.end.getWorldPosition(a);
    sk.hits = [{ t: best.t, end: best.end, reach: a.x - holder.position.x + (sk.extend || 0) }];
    turn.rotation.y = faceKick;
    action.stop(); idle.play(); mixer.update(0);
  }

  /** 손·발이 앞(+x)으로 가장 멀리 나간 순간들(여러 번 치는 동작은 여러 개) */
  function contacts(action, ends) {
    const samples = [];
    idle.stop(); action.play(); action.setEffectiveWeight(1);
    for (let t = 0; t <= action.getClip().duration; t += 1 / 60) {
      action.time = t; mixer.update(0); holder.updateMatrixWorld(true);
      hips.getWorldPosition(h);
      let best = -1e9, end = ends[0];
      for (const e of ends) { e.getWorldPosition(a); if (a.x - h.x > best) { best = a.x - h.x; end = e; } }
      samples.push({ t, d: best, end, reach: 0 });
    }
    action.stop();
    const max = Math.max(...samples.map((s) => s.d));
    const out = [];
    for (let i = 1; i < samples.length - 1; i++) {
      const s = samples[i];
      if (s.d >= max * 0.8 && s.d >= samples[i - 1].d && s.d > samples[i + 1].d && (!out.length || s.t - out[out.length - 1].t > 0.12)) out.push(s);
    }
    // 각 순간에 그 끝이 캐릭터 기준으로 얼마나 앞에 있는지(다가갈 거리 계산용)
    action.play();
    for (const o of out) { action.time = o.t; mixer.update(0); holder.updateMatrixWorld(true); o.end.getWorldPosition(a); o.reach = a.x - holder.position.x; }
    action.stop(); idle.play(); mixer.update(0);
    return out;
  }

  /** 팔굽혀펴기(누를 때마다 한 번)와 줄넘기(누르면 시작, 다시 누르면 멈춤) */
  const pushup = act("pushup", true), rope = act("rope"), guitar = act("guitar");
  // 힙합 춤: 누를 때마다 넷 중 하나를 골라 춤
  const dances = list.filter((c) => c.name.startsWith("dance_")).map((c) => act(c.name));
  // 줄넘기: 엉덩이가 가장 높은 순간(줄이 발밑을 지나는 때)을 찾아 줄을 돌리는 박자로 씀
  const ropePeaks = [];
  if (rope) {
    const tr = clips.rope.tracks.find((x) => /Hips\.position$/.test(x.name));
    if (tr) {
      const v = tr.values, tt = tr.times;
      for (let i = 1; i < tt.length - 1; i++) if (v[i * 3 + 1] > v[(i - 1) * 3 + 1] && v[i * 3 + 1] >= v[(i + 1) * 3 + 1]) ropePeaks.push(tt[i]);
    }
  }

  let mode = "idle", cur = idle, buffered = false, landed = false, whooshed = false, punched = false;
  let moveDir = 0, targetX = null, homeX = FIGHTER_X, chargeT = 0;
  let strike = null, strikeIdx = 0, approachT = 0, strikeWant = 0, pushMore = false;
  // 걸어갈 수 있는 범위(세계 x). 무대마다 바깥에서 정해 줌
  let rangeMin = FIGHTER_X - 2, rangeMax = FIGHTER_X + 0.05;

  /** 지금 동작에서 다음 동작으로 부드럽게 넘어감 */
  function go(next, fade) {
    if (!next) return;
    next.reset(); next.setEffectiveWeight(1); next.paused = false; next.play();
    if (cur && cur !== next) next.crossFadeFrom(cur, fade, false);
    cur = next;
  }
  function toIdle(fade) {
    mode = "idle"; go(idle, fade);
    if (moveDir) startStep();
  }
  function startStep() {
    const s = moveDir > 0 ? stepF : stepB; if (!s) return;
    mode = "step"; go(s, cur === stepF || cur === stepB ? 0.12 : 0.2);
  }
  function startKick() {
    mode = "kick"; landed = false; whooshed = false; go(kick, 0.12);
  }
  /** 공격을 시작함. 주먹 공격은 먼저 대상 앞으로 다가감 */
  function startStrike(name) {
    const sk = STRIKES[name]; if (!sk || !sk.action || !sk.hits.length) return false;
    strike = sk; strikeIdx = 0; whooshed = false; homeX = holder.position.x;
    // 주먹 공격은 대상 앞까지 다가가고, 발차기는 발이 대상을 파고들 만큼 가까우면 살짝 물러남
    const want = targetX === null ? null : targetX - sk.hits[0].reach - 0.01;
    if (want !== null && (sk.approach || want < holder.position.x)) { mode = "approach"; approachT = 0; strikeWant = want; go(idle, 0.15); }
    else playStrike();
    return true;
  }
  function playStrike() { mode = "strike"; go(strike.action, 0.12); strike.action.time = strike.from; }
  const free = () => mode === "idle" || mode === "step" || mode === "crouch";

  mixer.addEventListener("finished", (e) => {
    const x = e.action;
    if (x === kick) { if (buffered) { buffered = false; startKick(); } else toIdle(0.35); }
    else if (x === stepF || x === stepB) { if (moveDir) startStep(); else toIdle(0.2); }
    else if (x === punch || (strike && x === strike.action && strike.approach)) { mode = "recover"; go(idle, 0.5); }
    else if (strike && x === strike.action) toIdle(0.35);
    else if (Object.values(TRICKS).includes(x)) toIdle(0.3);
    else if (x === pushup) { if (pushMore) { pushMore = false; mode = "pushup"; go(pushup, 0.05); } else toIdle(0.6); }
  });

  return {
    kind: "mixamo", reach, hitTime, duration: clips.kick.duration,
    get mode() { return mode; },
    lotus: LOTUS, // 확인용: 명상 자세 각도를 바로 고쳐 봄
    /** 지금 서 있는 곳이 처음 자리에서 얼마나 떨어졌는지(m, 오른쪽이 +) */
    get offset() { return holder.position.x - FIGHTER_X; },
    // 확인용: 옆차기의 한 순간에서 멈춤
    freeze(t) { idle.stop(); kick.reset(); kick.play(); kick.time = t; kick.paused = true; mixer.update(0); cur = kick; mode = "idle"; },
    /** 확인용: 공격의 맞는 순간 목록 */
    strikes: STRIKES,
    /** 원인치 펀치 때 다가갈 대상의 앞면 x. 대상이 없는 무대는 null */
    setTarget(x) { targetX = x; },
    /** 걸어갈 수 있는 왼쪽·오른쪽 끝(세계 x) */
    setRange(min, max) { rangeMin = min; rangeMax = Math.max(min, max); if (mode === "idle") holder.position.x = THREE.MathUtils.clamp(holder.position.x, rangeMin, rangeMax); },
    /**
     * 발차기 버튼. dir은 누르고 있는 방향 {x, y}.
     * ↑ 날아 옆차기, ↓ 마르텔로 두 샤우, → 아르마다, ← 뒤돌려차기, 없으면 옆차기
     */
    kick(dir = { x: 0, y: 0 }) {
      if (mode === "kick" && !dir.x && !dir.y) { buffered = true; return; }
      if (!free()) return;
      if (dir.y > 0 && startStrike("fly_kick")) return;
      if (dir.y < 0 && startStrike("martelo")) return;
      if (dir.x > 0 && startStrike("armada")) return;
      if (dir.x < 0 && startStrike("spin_kick")) return;
      startKick();
    },
    /**
     * 주먹 버튼. ↑ 어퍼컷, ↓ 몸통 잇따라 치기, → 8연타, ← 팔꿈치 연계, 없으면 원인치 펀치.
     * 원인치 펀치면 "inch"를 돌려줌
     */
    punch(dir = { x: 0, y: 0 }) {
      if (!free()) return null;
      if (dir.y > 0 && startStrike("uppercut")) return "combo";
      if (dir.y < 0 && startStrike("body")) return "combo";
      if (dir.x > 0 && startStrike("combo8")) return "combo";
      if (dir.x < 0 && startStrike("elbow")) return "combo";
      return this.chargeStart() ? "inch" : null;
    },
    /** 빈손으로 야구 방망이를 휘두름 */
    bat() { return free() && startStrike("bat"); },
    /** jump(점프), qb(쿼터백 패스), pitch(야구 투구), freeze(브레이크댄스 한 손 물구나무) */
    trick(name) {
      const x = TRICKS[name]; if (!x || !free()) return false;
      mode = "trick"; go(x, 0.15); return true;
    },
    /** ↓를 누르고 있는 동안 웅크려 앉음 */
    crouch(on) {
      if (on && (mode === "idle" || mode === "step") && crouch) { mode = "crouch"; go(crouch, 0.25); }
      else if (!on && mode === "crouch") toIdle(0.3);
    },
    trigger() { this.kick(); },
    /** -1 왼쪽, 0 멈춤, 1 오른쪽 */
    move(dir) {
      moveDir = dir;
      if (dir && mode === "idle") startStep();
      if (dir && mode === "crouch") startStep();
    },
    /** sit(명상), pushup(팔굽혀펴기), rope(줄넘기), dance(힙합 춤), guitar(허공 기타). 같은 버튼을 다시 누르면 멈춤. 켜졌으면 true */
    action(name) {
      if (name === "sit") {
        if (mode === "sit") { toIdle(1.0); return false; }
        if (free()) { mode = "sit"; go(idle, 0.4); return true; }
        return false;
      }
      if (name === "pushup" && pushup) {
        if (mode === "pushup") { pushMore = true; return true; }
        if (free()) { mode = "pushup"; pushMore = false; go(pushup, 0.6); return true; }
        return false;
      }
      if (name === "dance" && dances.length) {
        if (mode === "dance") { toIdle(0.5); return false; }
        if (free()) { mode = "dance"; go(dances[Math.floor(Math.random() * dances.length)], 0.4); return true; }
        return false;
      }
      if (name === "guitar" && guitar) {
        if (mode === "guitar") { toIdle(0.5); return false; }
        if (free()) { mode = "guitar"; go(guitar, 0.4); return true; }
        return false;
      }
      if (name === "rope" && rope) {
        if (mode === "rope") { toIdle(0.5); return false; }
        if (free()) { mode = "rope"; go(rope, 0.4); return true; }
        return false;
      }
      return false;
    },
    /** 원인치 펀치: 대상 앞으로 다가가 주먹을 대고 힘을 모음 */
    chargeStart() {
      if (!punch || !free()) return false;
      mode = "charge"; chargeT = 0; homeX = holder.position.x; punched = false;
      go(punch, 0.35); punch.time = Math.max(0, punchHit - 0.09); punch.paused = true;
      return true;
    },
    /** 모은 힘으로 주먹을 내지름 */
    chargeRelease() {
      if (mode !== "charge") return 0;
      mode = "punch"; punch.paused = false;
      return 1 + Math.min(2, chargeT / 0.75);
    },
    get charge() { return mode === "charge" ? Math.min(1, chargeT / 1.5) : 0; },
    /** 줄넘기 줄의 각도(0 발밑 → 0.5 머리 위 → 1 발밑). 줄넘기 중이 아니면 null */
    ropePhase() {
      if (mode !== "rope" || ropePeaks.length < 2) return null;
      const t = rope.time;
      let i = ropePeaks.findIndex((p) => p > t);
      if (i <= 0) { // 마지막 정점과 다음 바퀴의 첫 정점 사이
        const last = ropePeaks[ropePeaks.length - 1], next = ropePeaks[0] + clips.rope.duration;
        const tt = t < ropePeaks[0] ? t + clips.rope.duration : t;
        return (tt - last) / (next - last);
      }
      return (t - ropePeaks[i - 1]) / (ropePeaks[i] - ropePeaks[i - 1]);
    },
    /** 줄넘기 줄을 그리는 데 쓰는 두 손 위치 */
    hands(l, r) { (bones.LeftHand || hips).getWorldPosition(l); (bones.RightHand || hips).getWorldPosition(r); },
    update(dt, t, opts) {
      mixer.timeScale = opts.slow;
      mixer.update(dt);
      // 휘두르는 동작은 몸을 대상 쪽으로 더 돌려서 함
      const yawWant = faceKick + ((mode === "strike" || mode === "approach") && strike ? strike.yaw : 0);
      turn.rotation.y += (yawWant - turn.rotation.y) * Math.min(1, dt * 12);
      sitW = THREE.MathUtils.clamp(sitW + (mode === "sit" ? dt : -dt) / 1.4, 0, 1);
      if (sitW > 0) applyLotus(sitW);
      holder.position.y = opts.floaty ? 0.04 + Math.sin(t * 0.7) * 0.03 : 0;
      const d = dt * opts.slow;
      if (mode === "step") {
        holder.position.x = THREE.MathUtils.clamp(holder.position.x + (cur === stepF ? speed.f : -speed.b) * d, rangeMin, rangeMax);
      }
      if (mode === "charge") {
        chargeT += dt;
        // 대상이 있으면 주먹이 닿기 직전까지 다가감
        if (targetX !== null) {
          const want = targetX - fistReach - 0.01;
          holder.position.x += (want - holder.position.x) * Math.min(1, dt * 5);
        }
        // 힘이 찰수록 몸이 미세하게 떨림
        const k = Math.min(1, chargeT / 1.5);
        turn.position.set((Math.random() - 0.5) * 0.006 * k, 0, (Math.random() - 0.5) * 0.006 * k);
      } else turn.position.set(0, 0, 0);
      if (mode === "approach") {
        // 첫 방이 대상에 딱 닿을 자리로 빠르게 옮겨 감
        approachT += d;
        holder.position.x += (strikeWant - holder.position.x) * Math.min(1, d * 9);
        if (approachT > 0.28 || Math.abs(strikeWant - holder.position.x) < 0.01) playStrike();
      }
      if (mode === "recover") {
        // 주먹 공격 뒤 원래 자리로 물러남
        holder.position.x += (homeX - holder.position.x) * Math.min(1, d * 3);
        if (Math.abs(homeX - holder.position.x) < 0.01) { holder.position.x = homeX; toIdle(0.3); }
      }
      if (mode === "kick" && !whooshed && kick.time > hitTime - 0.18) { whooshed = true; onWhoosh(); }
      if (mode === "kick" && !landed && kick.time >= hitTime) { landed = true; holder.updateMatrixWorld(true); onLand(); }
      if (mode === "punch" && !punched && punch.time >= punchHit) { punched = true; holder.updateMatrixWorld(true); onPunch(); }
      if (mode === "strike") {
        const hit = strike.hits[strikeIdx];
        if (hit && !whooshed && strike.ends === "feet" && strike.action.time > hit.t - 0.18) { whooshed = true; onWhoosh(); }
        if (hit && strike.action.time >= hit.t) {
          strikeIdx++; holder.updateMatrixWorld(true);
          const at = hit.end.getWorldPosition(new THREE.Vector3()); at.x += strike.extend || 0;
          onHit(at, strike.power, strikeIdx === strike.hits.length);
        }
      }
    },
    tip(v) { return tipBone.getWorldPosition(v); },
    fist(v) { return (fist || tipBone).getWorldPosition(v); },
    head(v) { return (head || hips).getWorldPosition(v); },
    hips(v) { return hips.getWorldPosition(v); },
  };
}

/* ---------- 임시 캐릭터 ---------- */
function makeRig(scene, { onLand, onWhoosh }) {
  const skinM = new THREE.MeshPhysicalMaterial({ color: 0xb98057, roughness: 0.55, sheen: 0.4, sheenColor: 0xffc9a0, clearcoat: 0.08 });
  const pantsM = new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.92 });
  const hairM = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.35 });
  const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const mesh = (g, m) => sh(new THREE.Mesh(g, m));
  function limb(parent, len, r1, r2, m, z) {
    const g = new THREE.Group(); g.position.z = z || 0; parent.add(g);
    g.add(mesh(new THREE.SphereGeometry(r1 * 1.02, 20, 14), m));
    const c = mesh(new THREE.CapsuleGeometry((r1 + r2) / 2, len - (r1 + r2) / 2, 6, 16), m); c.position.y = -len / 2; g.add(c);
    const e = new THREE.Group(); e.position.y = -len; g.add(e);
    return { g, e };
  }
  const F = {};
  const root = new THREE.Group(); scene.add(root); F.root = root;
  const pelvis = mesh(new THREE.CylinderGeometry(0.135, 0.125, 0.17, 24), pantsM); pelvis.position.y = -0.01; pelvis.scale.z = 0.85; root.add(pelvis);
  const torso = new THREE.Group(); root.add(torso); F.torso = torso;
  const abd = mesh(new THREE.CapsuleGeometry(0.115, 0.12, 6, 20), skinM); abd.position.y = 0.15; abd.scale.z = 0.78; torso.add(abd);
  const chest = mesh(new THREE.SphereGeometry(1, 28, 20), skinM); chest.scale.set(0.16, 0.19, 0.115); chest.position.set(0.01, 0.35, 0); torso.add(chest); F.chest = chest;
  const lats = mesh(new THREE.SphereGeometry(1, 20, 14), skinM); lats.scale.set(0.13, 0.13, 0.155); lats.position.set(-0.02, 0.38, 0); torso.add(lats);
  const neck = mesh(new THREE.CylinderGeometry(0.045, 0.054, 0.1, 16), skinM); neck.position.y = 0.52; torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.56; torso.add(head); F.head = head;
  const skull = mesh(new THREE.SphereGeometry(0.095, 28, 20), skinM); skull.scale.set(0.95, 1.12, 0.92); skull.position.set(0.008, 0.1, 0); head.add(skull);
  const jaw = mesh(new THREE.SphereGeometry(0.06, 16, 12), skinM); jaw.scale.set(1.05, 0.8, 1.1); jaw.position.set(0.035, 0.045, 0); head.add(jaw);
  const hair = mesh(new THREE.SphereGeometry(0.1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), hairM); hair.position.set(-0.008, 0.125, 0); hair.rotation.z = 0.3; head.add(hair);
  const shF = new THREE.Group(), shB = new THREE.Group(); shF.position.set(0, 0.45, 0.165); shB.position.set(0, 0.45, -0.165); torso.add(shF, shB);
  for (const s of [shF, shB]) { const d = mesh(new THREE.SphereGeometry(0.062, 16, 12), skinM); d.scale.set(1, 1.1, 1); s.add(d); }
  F.fa1 = limb(shF, 0.28, 0.046, 0.038, skinM); F.fa2 = limb(F.fa1.e, 0.26, 0.038, 0.032, skinM);
  F.ba1 = limb(shB, 0.28, 0.046, 0.038, skinM); F.ba2 = limb(F.ba1.e, 0.26, 0.038, 0.032, skinM);
  for (const a of [F.fa2, F.ba2]) { const f = mesh(new THREE.SphereGeometry(0.045, 14, 10), skinM); f.scale.set(1.05, 1.1, 0.85); f.position.y = -0.02; a.e.add(f); }
  F.fl1 = limb(root, 0.42, 0.085, 0.068, pantsM, 0.085); F.fl2 = limb(F.fl1.e, 0.42, 0.066, 0.076, pantsM);
  F.bl1 = limb(root, 0.42, 0.085, 0.068, pantsM, -0.085); F.bl2 = limb(F.bl1.e, 0.42, 0.066, 0.076, pantsM);
  for (const L of [F.fl2, F.bl2]) { const foot = mesh(new THREE.BoxGeometry(0.2, 0.05, 0.085), skinM); foot.position.set(0.05, -0.035, 0); L.e.add(foot); L.foot = foot; }

  const STANCE = { t: 6, fa1: 32, fa2: 152, ba1: 14, ba2: 162, fl1: 18, fl2: 4, bl1: -20, bl2: -14, hx: 0, hy: 0, hd: 0 };
  const P = (o) => Object.assign({}, STANCE, o);
  function seq() {
    const v = rand(-5, 6);
    const ext = P({ t: -38, fl1: 92 + v, fl2: 92 + v, bl1: -13, bl2: -18, hx: 11, fa1: 62, fa2: 108, ba1: -38, ba2: -16, hd: 12 });
    return [
      [P({ t: 3, hx: -4, hy: -0.035, fl1: 13, bl1: -17, bl2: -17, fa1: 36, fa2: 156 }), 120, "s"],
      [P({ t: -16, fl1: 104 + v, fl2: -42, bl1: -8, bl2: -12, hy: 0.012, hx: -2, fa1: 42, fa2: 164, ba1: 22, ba2: 166, hd: 6 }), 175, "s"],
      [ext, 95, "o", true],
      [Object.assign({}, ext, { t: -39, hx: 12 }), 75, "s"],
      [P({ t: -14, fl1: 100 + v, fl2: -36, bl1: -8, bl2: -12, fa1: 42, fa2: 162, ba1: 20, ba2: 166, hd: 5 }), 175, "s"],
      [STANCE, 280, "s"],
    ];
  }
  const ease = { s: (k) => 0.5 - 0.5 * Math.cos(Math.PI * k), o: (k) => 1 - Math.pow(1 - k, 3) };
  const K = { cur: Object.assign({}, STANCE), from: null, steps: [], el: 0, buffered: false, whooshed: false, landed: false };
  const start = () => { K.steps = seq(); K.from = Object.assign({}, K.cur); K.el = 0; K.whooshed = false; };
  let idleT = 1;
  function pose(t, floaty) {
    const p = K.cur, idle = K.steps.length ? 0 : 1; idleT += (idle - idleT) * 0.08;
    const sway = floaty ? 2.2 : 1;
    const bob = Math.sin(t * 2.2) * 0.008 * sway * idleT + (floaty ? Math.sin(t * 0.7) * 0.02 : 0);
    const arm = Math.sin(t * 1.3) * 4 * sway * idleT;
    const hipY = 0.42 * (Math.cos(p.bl1 * R) + Math.cos(p.bl2 * R)) + 0.06 + p.hy + bob;
    root.position.set(FIGHTER_X + 0.07 + p.hx / 100, hipY, 0);
    torso.rotation.z = -(p.t + Math.sin(t * 2.2) * 0.8 * idleT) * R;
    const br = 1 + Math.sin(t * 1.7) * 0.012; chest.scale.set(0.16 * br, 0.19, 0.115 * br);
    head.rotation.z = (p.t * 0.55 + p.hd) * R;
    F.fa1.g.rotation.z = (p.fa1 + p.t + arm) * R; F.fa2.g.rotation.z = (p.fa2 - p.fa1 - arm * 0.5) * R;
    F.ba1.g.rotation.z = (p.ba1 + p.t - arm * 0.6) * R; F.ba2.g.rotation.z = (p.ba2 - p.ba1) * R;
    F.fl1.g.rotation.z = p.fl1 * R; F.fl2.g.rotation.z = (p.fl2 - p.fl1) * R;
    F.bl1.g.rotation.z = p.bl1 * R; F.bl2.g.rotation.z = (p.bl2 - p.bl1) * R;
  }
  return {
    kind: "rig", reach: { x: FIGHTER_X + 0.07 + 0.11 + 0.84 + 0.03, y: 0.88 },
    // 임시 캐릭터는 차기만 함
    mode: "idle", offset: 0, charge: 0,
    setTarget() {}, setRange() {}, move() {}, action() { return false; }, chargeStart() { return false; }, chargeRelease() { return 0; },
    kick() { this.trigger(); }, punch() { return null; }, hands() {},
    fist(v) { return F.fl2.foot.getWorldPosition(v); },
    trigger() { if (K.steps.length) K.buffered = true; else start(); },
    update(dt, t, opts) {
      const d = dt * opts.slow;
      if (K.steps.length) {
        const [to, dur, e, hit] = K.steps[0];
        K.el += d * 1000; if (hit && !K.whooshed) { K.whooshed = true; onWhoosh(); }
        const k = Math.min(1, K.el / dur), f = ease[e](k);
        for (const key in to) K.cur[key] = K.from[key] + (to[key] - K.from[key]) * f;
        if (k >= 1) { K.steps.shift(); K.from = Object.assign({}, K.cur); K.el = 0; if (hit) K.landed = true;
          if (!K.steps.length && K.buffered) { K.buffered = false; start(); } }
      }
      pose(t * (opts.floaty ? 0.7 : 1), opts.floaty);
      if (K.landed) { K.landed = false; root.updateMatrixWorld(true); onLand(); }
    },
    tip(v) { return F.fl2.foot.getWorldPosition(v); },
    head(v) { return head.getWorldPosition(v); },
    hips(v) { return root.getWorldPosition(v); },
  };
}
