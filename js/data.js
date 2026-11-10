// 기간, 무대, 문구

export const DAY_MS = 86400000;
export const FINAL_DAY = 108;
export const FINAL_LINE = "백팔 번뇌를 끊었다.";

/**
 * 무대마다 시작하는 날, 넘어갈 때 나오는 한 줄, 배경 사진과 그 사진의 촬영 높이, 조명.
 * sky.height는 사진을 찍은 카메라의 높이(m), sky.radius는 사진을 투영할 공의 반지름(m),
 * sky.rot은 배경을 돌리는 각도(도), sun은 그림자를 만드는 빛의 방향과 세기.
 * plate는 assets/bg 그림에 맞춘 카메라 값(backplate.js의 PLATE를 덮어씀).
 */
export const STAGES = [
  { key: "room", name: "작은 방", from: 1, line: "아무것도 없는 방. 상대는 오직 나 자신이다.",
    hdr: "abandoned_tiled_room", sky: { height: 1.6, radius: 20, rot: 0 }, exposure: 0.85, env: 0.7,
    sun: { dir: [-2.2, 1.2, 2.6], intensity: 2.6, color: 0xffd9a8 }, ink: "light",
    plate: { dist: 5.6, horizon: 0.6, anchorY: 1 } }, // 바닥이 그림 아래 20%뿐이라 아래쪽을 남기고 사람을 앞으로
  { key: "gym", name: "체육관", from: 4, line: "작심삼일을 넘었다. 체육관 문이 열린다.",
    hdr: "basement_boxing_ring", sky: { height: 1.6, radius: 14, rot: 0 }, exposure: 1.0, env: 1.0,
    sun: { dir: [0.4, 5, 1.5], intensity: 1.8, color: 0xfff1de }, ink: "light" },
  { key: "bamboo", name: "대나무 숲", from: 8, line: "이레를 버텼다. 세상이 지어진 시간이다.",
    hdr: "bamboo_tunnel", sky: { height: 1.7, radius: 40, rot: 0 }, exposure: 1.0, env: 1.0,
    sun: { dir: [-2, 6, 2], intensity: 1.6, color: 0xfff6e0 }, ink: "light" },
  { key: "snow", name: "눈 덮인 산", from: 15, line: "보름이 지났다. 달이 한 번 가득 찼다.",
    hdr: "pisztyk", sky: { height: 1.7, radius: 60, rot: 0 }, exposure: 0.95, env: 1.0,
    sun: { dir: [-4, 3, 2], intensity: 2.4, color: 0xffe2c4 }, ink: "light" },
  { key: "waterfall", name: "폭포 아래", from: 41, line: "광야의 사십 일이 끝났다.",
    hdr: "crystal_falls", sky: { height: 1.7, radius: 40, rot: 0 }, exposure: 1.0, env: 1.0,
    sun: { dir: [-2, 6, 3], intensity: 2.4, color: 0xfff4e4 }, ink: "light" },
  { key: "water", name: "물 속", from: 67, line: "육십육 일. 이제 버티는 것이 몸이 되었다.",
    hdr: "crystal_falls", sky: { height: 1.7, radius: 40, rot: 0 }, exposure: 0.9, env: 0.8,
    sun: { dir: [0.5, 8, 1.5], intensity: 1.6, color: 0x9fe6ff }, ink: "light", underwater: true },
];

export const QUOTES = [
  [ "한계란 없다. 정체가 있을 뿐이다. 거기서 멈추지 말고 넘어서라.",
    "쉬운 삶을 바라지 마라. 어려운 삶을 견딜 힘을 바라라.",
    "나는 너의 기대에 맞추려고 이 세상에 온 것이 아니다.",
    "상황 따위는 상관없다. 나는 기회를 만든다.",
    "생각하는 대로 된다.",
    "실패를 두려워하지 마라. 죄는 실패가 아니라 낮은 목표다.",
    "아무도 너를 구하러 오지 않는다. 네가 필요한 사람이 되어라.",
    "가장 큰 적은 네 안에 있다." ],
  [ "만 가지 발차기를 한 번씩 연습한 사람은 두렵지 않다. 한 가지 발차기를 만 번 연습한 사람이 두렵다.",
    "쓸모 있는 것은 받아들이고, 쓸모없는 것은 버리고, 나만의 것을 더하라.",
    "성공한 무사는 평범한 사람이다. 다만 한 점에 집중했을 뿐이다.",
    "오래가는 꾸준함이 짧은 열정을 이긴다.",
    "주먹을 내야 할 때 주먹을 내고, 발을 차야 할 때 발을 차라.",
    "재능은 신화다. 반복만이 진짜다." ],
  [ "가장 뻣뻣한 나무가 가장 쉽게 부러진다. 대나무와 버들은 바람에 휘어서 살아남는다.",
    "생각하지 마라. 느껴라.",
    "부드러워져라. 굽히되 꺾이지 마라.",
    "원리를 배우고, 원리를 따르고, 그리고 원리를 녹여라.",
    "방법 없음을 방법으로, 한계 없음을 한계로 삼아라." ],
  [ "인내는 수동적인 것이 아니다. 한데 모은 힘이다.",
    "패배는 마음의 상태다. 받아들이기 전까지는 누구도 패배하지 않는다.",
    "행복하되 결코 만족하지 마라.",
    "계속 걸어라.",
    "삶 자체가 스승이다. 너는 늘 배우는 중이다.",
    "목표는 꼭 닿기 위해 있는 것이 아니다. 겨눌 곳이 되어주면 충분하다.",
    "상처가 너의 스승이 되게 하라.",
    "가장 큰 힘은 아무도 보지 않는 곳에서 자란다." ],
  [ "네 잔을 비워라. 그래야 채울 수 있다.",
    "매일 더하는 것이 아니라 매일 덜어내는 것이다. 본질이 아닌 것을 쳐내라.",
    "단순함이 탁월함의 열쇠다.",
    "흐르는 물은 썩지 않는다. 그러니 계속 흘러라.",
    "물처럼 틈을 찾아 흘러라. 맞서지 말고 맞추면 돌아가든 뚫든 길이 난다.",
    "완벽함은 너의 적이다." ],
  [ "마음을 비워라. 형태도 모양도 없이, 물처럼.",
    "물을 컵에 부으면 컵이 되고, 병에 부으면 병이 된다.",
    "물은 흐를 수도, 부술 수도 있다. 물이 되어라, 친구여.",
    "물은 너무 고와서 한 줌도 쥘 수 없다. 쳐도 다치지 않고 찔러도 상처 입지 않는다.",
    "영원히 사는 길은 먼저 기억될 만한 삶을 사는 것이다." ],
];
