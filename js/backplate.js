// AI로 만든 배경 그림(가로 16:9) 위에 3D 캐릭터를 합성함.
// 그림은 눈높이 35mm 렌즈, 카메라 높이 1.3m, 지평선이 위에서 45%인 조건으로 만든다고 보고
// 같은 조건의 3D 카메라를 세워 바닥과 원근을 맞춤.

import * as THREE from "three";

export const PLATE = {
  camHeight: 1.3,        // 그림 속 카메라 높이(m)
  vfov: 37.8,            // 35mm 렌즈를 가로로 든 세로 화각(도)
  horizon: 0.45,         // 그림 위에서부터 지평선까지의 비율
  dist: 6.0,             // 카메라에서 캐릭터까지 거리(m). 발이 그림 위에서 약 75%에 옴
  centerX: -0.6,         // 카메라가 바라보는 가로 위치(m). 사람은 가운데, 찰 대상은 오른쪽 1/3
  anchorY: 0.5,          // 화면이 그림보다 넓어 위아래가 잘릴 때 남길 곳(0 위, 0.5 가운데, 1 아래)
};

/**
 * ### loadPlate
 * 배경 사진을 불러와 살짝 흐린 텍스처, 위·아래 평균 색을 돌려줌.
 * 사진이 없으면 null.
 */
export function loadPlate(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d");
      // 초점이 캐릭터에 맞은 것처럼 배경을 아주 살짝 흐림
      g.filter = `blur(${Math.max(1, Math.round(w / 900))}px)`;
      g.drawImage(img, 0, 0, w, h);
      g.filter = "none";
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      resolve({ tex, aspect: w / h, sky: average(g, w, h, 0, 0.4), ground: average(g, w, h, 0.7, 1) });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function average(g, w, h, y0, y1) {
  const s = 32, d = g.getImageData(0, Math.floor(h * y0), w, Math.max(1, Math.floor(h * (y1 - y0)))).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * s) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
  return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

/**
 * ### makePlateLayer
 * 화면을 꽉 채우는 배경 판. 화면 비율이 사진과 달라도 잘리기만 하고 늘어나지 않음.
 */
export function makePlateLayer() {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.MeshBasicMaterial({ toneMapped: false, depthTest: false, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  let plate = null, P = PLATE;
  return {
    scene, cam,
    /** 무대마다 그림이 달라서 PLATE 값 일부를 덮어쓸 수 있음 */
    set(p, override) { plate = p; P = { ...PLATE, ...override }; mat.map = p ? p.tex : null; mat.needsUpdate = true; },
    get plate() { return plate; },
    /** 화면 비율에 맞춰 사진을 잘라내고, 같은 원근이 되도록 3D 카메라를 맞춤 */
    fit(camera, screenAspect, shake) {
      if (!plate) return false;
      const ia = plate.aspect;
      // 사진 중 화면에 보이는 가로·세로 비율(cover)
      let fw = 1, fh = 1;
      if (screenAspect > ia) fh = ia / screenAspect; else fw = screenAspect / ia;
      const top = (1 - fh) * P.anchorY; // 보이는 영역의 위쪽 끝(그림 위에서부터 비율)
      plate.tex.repeat.set(fw, fh); plate.tex.offset.set((1 - fw) / 2, 1 - top - fh);
      const tFull = Math.tan((P.vfov * Math.PI) / 360);
      const tVis = tFull * fh;
      camera.fov = (Math.atan(tVis) * 360) / Math.PI; camera.aspect = screenAspect; camera.updateProjectionMatrix();
      // 지평선이 화면 가운데보다 얼마나 위에 있는지 → 카메라를 그만큼 아래로 숙임
      const hNdc = (0.5 - (P.horizon - top) / fh) * 2;
      const pitch = Math.atan(hNdc * tVis);
      camera.position.set(P.centerX + shake.x, P.camHeight + shake.y, P.dist);
      camera.rotation.set(-pitch, 0, 0);
      return true;
    },
  };
}

/**
 * ### makeContactShadow
 * 발밑의 짙은 접지 그림자. 실제 사진에서 발이 땅에 닿은 느낌을 만드는 가장 큰 요소.
 */
export function makeContactShadow() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(0,0,0,.75)"); gr.addColorStop(0.45, "rgba(0,0,0,.35)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.004; m.scale.set(0.9, 0.42, 1); m.renderOrder = 1;
  return m;
}
