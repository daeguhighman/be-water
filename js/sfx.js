// 타격음과 무대별 환경음. 소리 파일 없이 Web Audio로 합성함.

const rand = (a, b) => a + Math.random() * (b - a);

export function makeSfx({ isOn, isSlow }) {
  let ac = null, master = null, calm = null, noise = null, hum = null, ambNodes = [], ambKey = null, tickTimer = 0, blipT = 0;

  function init() {
    if (ac) { if (ac.state === "suspended") ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ac = new AC(); master = ac.createGain(); master.gain.value = isOn() ? 1 : 0;
    // 명상할 때 소리를 낮추고 먹먹하게 하는 필터
    calm = ac.createBiquadFilter(); calm.type = "lowpass"; calm.frequency.value = 20000;
    master.connect(calm); calm.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (ambKey) ambient(ambKey, true);
  }
  function src(loop) { const s = ac.createBufferSource(); s.buffer = noise; s.loop = !!loop; return s; }
  function nz(dur, gain, type, f0, f1, q, delay) {
    if (!ac) return; const t = ac.currentTime + (delay || 0), s = src(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = type; f.Q.value = q || 1; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  function tone(f0, f1, dur, gain, type, delay) {
    if (!ac) return; const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function stopAmb() { for (const n of ambNodes) { try { n.stop ? n.stop() : n.disconnect(); } catch (e) { /* 이미 멈춘 소리 */ } } ambNodes = []; }
  function layer(type, freq, q, gain, lfoRate, lfoDepth, lfoTarget) {
    const s = src(true), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(master); s.start(0, Math.random() * 2); ambNodes.push(s, g);
    if (lfoRate) {
      const o = ac.createOscillator(), od = ac.createGain(); o.frequency.value = lfoRate; od.gain.value = lfoDepth;
      o.connect(od); od.connect(lfoTarget === "f" ? f.frequency : g.gain); o.start(); ambNodes.push(o);
    }
  }
  function ambient(key, force) {
    if (key === ambKey && !force) return; ambKey = key; if (!ac) return; stopAmb();
    if (key === "room") { layer("lowpass", 260, 0.7, 0.025); }
    if (key === "gym") { layer("bandpass", 180, 0.8, 0.05); layer("lowpass", 90, 1, 0.03); }
    if (key === "bamboo") { layer("bandpass", 1100, 0.6, 0.05, 0.12, 0.04); layer("highpass", 4200, 0.7, 0.012, 0.3, 0.01); }
    if (key === "snow") { layer("bandpass", 520, 2.2, 0.06, 0.09, 260, "f"); layer("lowpass", 300, 0.7, 0.03, 0.05, 0.02); }
    if (key === "waterfall") { layer("lowpass", 2600, 0.5, 0.16); layer("lowpass", 380, 0.8, 0.12); layer("highpass", 5000, 0.5, 0.02); }
    if (key === "water") { layer("lowpass", 220, 0.9, 0.22, 0.07, 0.08); layer("bandpass", 600, 1.5, 0.015, 0.2, 0.01); }
  }
  function tick(dt) {
    if (!ac) return;
    if (ambKey === "room") { tickTimer -= dt; if (tickTimer < 0) { tickTimer += 1; nz(0.03, 0.03, "highpass", 3000, 0, 1); tone(1800, 1500, 0.02, 0.01, "square"); } }
    if (ambKey === "water") { blipT -= dt; if (blipT < 0) { blipT = rand(0.6, 2.2); const f = rand(500, 1100); tone(f, f * 1.8, 0.07, 0.02); } }
  }
  return {
    init, ambient, tick,
    setOn(on) { if (master) master.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, 0.05); },
    /** 명상 중: 소리를 줄이고 고음을 걸러 잔잔하게 함 */
    setCalm(on) {
      if (!ac) return;
      calm.frequency.setTargetAtTime(on ? 520 : 20000, ac.currentTime, on ? 0.8 : 0.4);
    },
    /** 원인치 펀치에 힘을 모으는 동안 낮게 차오르는 울림 */
    chargeStart() {
      if (!ac || hum) return;
      const t = ac.currentTime, o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
      o.type = "sawtooth"; o.frequency.setValueAtTime(48, t); o.frequency.linearRampToValueAtTime(96, t + 1.5);
      o2.type = "sine"; o2.frequency.setValueAtTime(96, t); o2.frequency.linearRampToValueAtTime(190, t + 1.5);
      f.type = "lowpass"; f.frequency.setValueAtTime(160, t); f.frequency.linearRampToValueAtTime(900, t + 1.5);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 1.5);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(master); o.start(t); o2.start(t);
      hum = { o, o2, g };
    },
    chargeStop() {
      if (!hum) return; const t = ac.currentTime;
      hum.g.gain.cancelScheduledValues(t); hum.g.gain.setTargetAtTime(0.0001, t, 0.02);
      hum.o.stop(t + 0.2); hum.o2.stop(t + 0.2); hum = null;
    },
    /** 카세트를 넣는 찰칵 소리와 테이프가 감기기 시작하는 소리 */
    cassette() {
      nz(0.03, 0.35, "highpass", 2200, 0, 0.8);
      nz(0.05, 0.25, "bandpass", 1200, 0, 2, 0.06);
      tone(180, 120, 0.06, 0.2, "square", 0.05);
      nz(0.6, 0.05, "bandpass", 900, 1400, 3, 0.5);
      tone(60, 70, 0.6, 0.06, "sawtooth", 0.5);
    },
    /** 원인치 펀치: 공기가 갈라지는 소리와 깊은 울림 */
    boom(p) {
      nz(0.06, 0.5, "highpass", 1800, 0, 0.7);
      tone(70, 24, 1.6, 0.9 * Math.min(1, p / 2));
      tone(140, 40, 0.5, 0.4);
      nz(1.4, 0.35, "lowpass", 1400, 90, 0.7, 0.02);
      nz(2.2, 0.08, "bandpass", 300, 120, 0.6, 0.3);
    },
    whoosh() { const slow = isSlow(); nz(slow ? 0.35 : 0.16, slow ? 0.08 : 0.16, "bandpass", slow ? 250 : 500, slow ? 600 : 1800, 1.2); },
    impact(kind, p) {
      if (kind === "air") { nz(0.05, 0.12, "highpass", 2500, 0, 0.7); nz(0.12, 0.05, "lowpass", 400, 0, 1); }
      if (kind === "bag") { tone(95, 42, 0.32, 0.55 * p); nz(0.14, 0.35 * p, "lowpass", 900, 200, 0.8); nz(0.04, 0.12, "highpass", 2500, 0, 0.7); }
      if (kind === "bamboo") { tone(420, 380, 0.16, 0.25); tone(640, 600, 0.12, 0.12); nz(0.05, 0.15, "bandpass", 1800, 0, 2); nz(0.9, 0.05, "highpass", 4000, 0, 0.5, 0.05); }
      if (kind === "post") { tone(140, 70, 0.28, 0.45); nz(0.08, 0.2, "lowpass", 800, 0, 0.8); nz(0.6, 0.08, "lowpass", 2200, 600, 0.6, 0.12); }
      if (kind === "splash") { nz(0.5, 0.3, "bandpass", 2400, 700, 0.6); nz(0.2, 0.2, "lowpass", 500, 0, 0.8); }
      if (kind === "underwater") { tone(70, 38, 0.6, 0.45); nz(0.5, 0.15, "lowpass", 300, 120, 0.8); for (let i = 0; i < 6; i++) { const f = rand(400, 900); tone(f, f * 2, 0.06, 0.03, "sine", rand(0.05, 0.6)); } }
    },
  };
}
