// 화면 왼쪽 위 워크맨. 노래를 차례로(무작위 순서) 틀어 줌.
// 노래를 찾는 순서:
//   1. assets/music/list.json(["파일.mp3", ...])
//   2. assets/music 폴더 목록(내 맥의 로컬 서버에서만 보임, 안쪽 폴더 두 단계까지)
//   3. 이 기기에서 골라 둔 노래(브라우저 저장소 IndexedDB에만 저장, 어디에도 올라가지 않음)
// 아무 노래도 없으면 워크맨을 눌렀을 때 기기의 파일에서 노래를 고르게 함.

const EXT = /\.(mp3|m4a|aac|wav|ogg)$/i;

/** 파일 이름에서 확장자와 앞 번호를 떼어 곡 제목으로 씀 */
function titleOf(name) {
  const base = decodeURIComponent(name).split("/").pop();
  return base.replace(EXT, "").replace(/^\d+[\s._-]*/, "");
}

async function loadServerList() {
  try {
    const r = await fetch("assets/music/list.json", { cache: "no-store" });
    if (r.ok) return (await r.json()).filter((n) => EXT.test(n));
  } catch (e) { /* 목록 파일이 없으면 폴더 목록으로 */ }
  async function crawl(dir, depth) {
    try {
      const r = await fetch("assets/music/" + dir, { cache: "no-store" });
      if (!r.ok) return [];
      const html = await r.text();
      const links = [...html.matchAll(/href="([^"?#]+)"/g)].map((m) => m[1]).filter((n) => !n.startsWith(".") && !n.startsWith("/") && !n.includes("://"));
      const files = links.filter((n) => EXT.test(n)).map((n) => dir + n);
      if (depth > 0) for (const sub of links.filter((n) => n.endsWith("/"))) files.push(...await crawl(dir + sub, depth - 1));
      return files;
    } catch (e) { return []; }
  }
  return (await crawl("", 2)).sort();
}

/* ---------- 이 기기에 골라 둔 노래(IndexedDB) ---------- */
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("be-water-music", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("songs", { keyPath: "name" });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function loadSaved() {
  try {
    const d = await db();
    return await new Promise((res) => { const q = d.transaction("songs").objectStore("songs").getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); });
  } catch (e) { return []; }
}
async function saveSongs(files) {
  try {
    const d = await db();
    const st = d.transaction("songs", "readwrite").objectStore("songs");
    st.clear();
    for (const f of files) st.put({ name: f.name, blob: f });
  } catch (e) { /* 저장 못 해도 이번에는 들을 수 있음 */ }
}

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * ### makeWalkman
 * 워크맨 버튼을 만들어 붙임. 누르면 재생과 멈춤이 번갈아 되고, 길게 누르면 다음 곡.
 * 노래가 하나도 없으면 기기 파일에서 고르게 함.
 * 돌려주는 play()는 시작 화면에서 테이프를 넣었을 때 부름.
 */
export function makeWalkman(root) {
  const audio = new Audio();
  audio.preload = "none";
  /** @type {{name: string, src: string}[]} */
  let list = [], idx = 0;

  root.innerHTML = `
    <svg viewBox="0 0 64 44" aria-hidden="true">
      <rect x="1.5" y="1.5" width="61" height="41" rx="5" fill="#2b4a6b" stroke="#c8d3dd" stroke-width="1.5"/>
      <rect x="8" y="8" width="38" height="20" rx="3" fill="#0d1620" stroke="#8fa3b5"/>
      <g class="reel" style="transform-origin:19px 18px"><circle cx="19" cy="18" r="6" fill="#e9e2d0"/><path d="M19 12v12M13 18h12" stroke="#5a4a32" stroke-width="1.6"/></g>
      <g class="reel" style="transform-origin:35px 18px"><circle cx="35" cy="18" r="6" fill="#e9e2d0"/><path d="M35 12v12M29 18h12" stroke="#5a4a32" stroke-width="1.6"/></g>
      <rect x="50" y="8" width="8" height="5" rx="1" fill="#e08a2c"/><rect x="50" y="16" width="8" height="5" rx="1" fill="#c8d3dd"/>
      <text x="8" y="38" font-size="6" fill="#c8d3dd" font-family="sans-serif">AWESOME MIX</text>
    </svg>
    <span class="song" aria-live="polite"></span>`;
  const song = root.querySelector(".song");
  const picker = Object.assign(document.createElement("input"), { type: "file", accept: "audio/*,.mp3,.m4a", multiple: true, hidden: true });
  document.body.appendChild(picker);

  // 시작할 때 미리 노래 목록을 만들어 둠(아이폰은 누른 순간에만 파일 고르기 창을 열 수 있어서)
  const ready = (async () => {
    const server = await loadServerList();
    if (server.length) list = server.map((n) => ({ name: n, src: "assets/music/" + n }));
    else list = (await loadSaved()).map((s) => ({ name: s.name, src: URL.createObjectURL(s.blob) }));
    shuffle(list);
  })();

  picker.addEventListener("change", () => {
    const files = [...picker.files].filter((f) => EXT.test(f.name) || f.type.startsWith("audio/"));
    if (!files.length) return;
    saveSongs(files);
    list = shuffle(files.map((f) => ({ name: f.name, src: URL.createObjectURL(f) })));
    playAt(0);
  });

  function show(text) { song.textContent = text; }
  function playAt(i) {
    if (!list.length) return;
    idx = (i + list.length) % list.length;
    audio.src = list[idx].src;
    audio.play().catch(() => setOn(false));
    show(titleOf(list[idx].name));
  }
  function setOn(on) {
    root.classList.toggle("on", on);
    root.setAttribute("aria-pressed", on ? "true" : "false");
  }
  audio.addEventListener("ended", () => playAt(idx + 1));
  audio.addEventListener("play", () => setOn(true));
  audio.addEventListener("pause", () => setOn(false));

  let skipClick = false;
  root.addEventListener("click", (e) => {
    e.stopPropagation();
    if (skipClick) { skipClick = false; return; } // 길게 눌러 다음 곡으로 넘긴 경우
    if (!list.length) { picker.click(); return; }   // 노래가 없으면 기기에서 고르기
    if (audio.paused) { if (audio.src) audio.play().catch(() => {}); else playAt(0); }
    else audio.pause();
  });
  // 길게 누르면 다음 곡(노래가 없으면 다시 고르기)
  let pressT = 0;
  root.addEventListener("pointerdown", () => { pressT = setTimeout(() => { pressT = -1; if (list.length) playAt(idx + 1); }, 600); });
  root.addEventListener("pointerup", () => { if (pressT === -1) skipClick = true; clearTimeout(pressT); });

  return {
    /** 노래가 있으면 재생하고 true */
    async play() { await ready; if (!list.length) return false; playAt(0); return true; },
    get hasSongs() { return list.length > 0; },
  };
}
