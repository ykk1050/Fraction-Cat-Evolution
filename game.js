/* ===================================================================
   game.js — 분수 고양이 진화
   Matter.js 물리 · 충돌 병합 · 이미지 렌더링 · 아이템 시스템
   =================================================================== */
(function () {
  'use strict';

  const { Engine, Bodies, Body, Composite, Events } = Matter;

  /* =====================  상수 / 에셋  ===================== */
  const MAX_LEVEL = 11;            // 11단계가 최종 (이미지 없음 → 대체 렌더링)
  const PROBLEM_MIN_LEVEL = 3;     // 이 단계부터는 합칠 때 분수 문제를 풀어야 함
                                   // (1+1, 2+2 만 자동 진화, 3+3 부터 분수 문제)

  // 레벨 → 에셋 파일 (성능을 위해 512px 변형 사용)
  const CAT_ASSETS = {
    1:  'assets/jelly_nyan_stage1_512.png',
    2:  'assets/cheese_nyan_stage2_512.png',
    3:  'assets/jumeokbap_nyan_stage3_512.png',
    4:  'assets/godeungeo_nyan_stage4_512.png',
    5:  'assets/vanilla_nyan_stage5_512.png',
    6:  'assets/curry_nyan_stage6_512.png',
    7:  'assets/king_nyan_stage7_512.png',
    8:  'assets/lion_nyan_stage8_512.png',
    9:  'assets/galaxy_nyan_stage9_512.png',
    10: 'assets/wizard_nyan_stage10_512.png',
    11: 'assets/cat_god_stage11_512.png',     // 최종 단계: 냥신
  };
  const CAT_NAMES = {
    1: '젤리냥', 2: '치즈냥', 3: '주먹밥냥', 4: '고등어냥', 5: '바닐라냥',
    6: '카레냥', 7: '킹냥', 8: '라이언냥', 9: '갤럭시냥', 10: '마법사냥',
    11: '냥신',
  };
  // 이미지 로드 실패 시 사용할 대체 색상 (안전망)
  const CAT_COLORS = {
    1: '#ffd97d', 2: '#ffb347', 3: '#f6e3b4', 4: '#7ec8e3', 5: '#fff1d6',
    6: '#e6a157', 7: '#ffd24d', 8: '#ff9d5c', 9: '#9b6bff', 10: '#c77dff',
    11: '#ff9be8',
  };

  // 레벨별 반지름 비율(보드 너비 기준).
  // 수박게임 비율: 1단계는 보드 너비에 5~6개 들어가는 크기(지름 ≈ 0.18),
  // 최종 11단계는 지름이 보드 너비의 약 0.48(반지름 0.24) — 2개면 보드가 꽉 참.
  const RADIUS_FACTOR = {
    1: 0.090, 2: 0.100, 3: 0.110, 4: 0.122, 5: 0.134, 6: 0.148,
    7: 0.163, 8: 0.180, 9: 0.198, 10: 0.219, 11: 0.240,
  };

  /* ----- 이미지 미리 로드 (실패해도 게임은 동작) ----- */
  const catImages = {};
  const imageOK = {};
  Object.keys(CAT_ASSETS).forEach(function (key) {
    const lv = Number(key);
    const img = new Image();
    imageOK[lv] = false;
    img.onload = function () { imageOK[lv] = true; };
    img.onerror = function () {
      imageOK[lv] = false;
      console.warn(CAT_NAMES[lv] + ' 이미지를 찾을 수 없어 대체 그림을 사용합니다.');
    };
    img.src = CAT_ASSETS[lv];
    catImages[lv] = img;
  });

  /* =====================  아이템 정의  ===================== */
  // 모든 아이템은 0개로 시작 — 5연속 정답으로 하나씩 얻을 수 있음
  const ITEM_DEFS = [
    { id: 'lcm',    name: '치즈냥의 마법 분모', icon: '🧀', start: 0,
      desc: '문제의 두 분모의 최소공배수를 3초간 화면 구석에 보여줘요.' },
    { id: 'freeze', name: '생각 시간 멈춤', icon: '⏸️', start: 0,
      desc: '풀이 카운트다운을 즉시 멈춰요. 시간 압박 없이 천천히 풀 수 있어요.' },
    { id: 'punch',  name: '꾹꾹이 펀치', icon: '🐾', start: 0,
      desc: '보드 위의 고양이 1마리를 골라서 없애요. 위급할 때 공간을 확보할 수 있어요.' },
    { id: 'mixer',  name: '야옹 쳇바퀴', icon: '🌀', start: 0,
      desc: '보드를 흔들어 고양이들의 위치를 마구 섞어요. 막힌 상황을 풀어줘요.' },
    { id: 'spray',  name: '캣닢 스프레이', icon: '🌿', start: 0,
      desc: '다음에 떨어뜨릴 고양이를 1~3단계 중에서 직접 골라요.' },
    { id: 'churu',  name: '츄르 타임', icon: '🍥', start: 0,
      desc: '풀고 있던 분수 문제를 정답 처리하고 즉시 다음 단계로 진화시켜요.' },
  ];
  const PROBLEM_ITEM_IDS = ['lcm', 'freeze', 'churu'];   // 문제 풀이 중에 쓰는 아이템

  /* =====================  DOM 참조  ===================== */
  const $ = (id) => document.getElementById(id);
  const screens = {
    start: $('screen-start'),
    game:  $('screen-game'),
  };
  const canvas = $('game-canvas');
  const ctx = canvas.getContext('2d');
  const boardWrap = $('board-wrap');

  /* =====================  게임 상태  ===================== */
  let engine, world, walls = [];
  let BOARD_W = 360, BOARD_H = 600, DPR = 1;
  let LINE_Y = 90, DROP_Y = 44;

  const state = {
    running: false,
    paused: false,
    score: 0,
    combo: 0,
    maxCombo: 0,
    correctCount: 0,
    totalCount: 0,
    maxCatLevel: 0,         // 게임 중 도달한 최고 고양이 단계 (1~11)
    playTime: 0,            // 누적 플레이 시간 (ms) — 일시정지/탭숨김/메뉴 시 정지
    clearTime: 0,           // 11단계(냥신) 첫 도달 시점의 playTime. 0=미달성
    lastActiveTickAt: 0,    // 마지막 활성 프레임 timestamp
    problemTimeLeft: 0,     // 현재 분수 문제 남은 시간 (ms)
    rankSort: 'score',      // 랭킹 정렬 기준
    rankOrder: 'desc',      // 랭킹 정렬 방향 (desc/asc)
    dropLevel: 1,
    nextLevel: 1,
    upcomingQueue: [],      // 앞으로 나올 고양이 단계들 (queue[0]=현재, queue[1]=다음, ...)
    pendingX: 180,
    dropLocked: false,
    problemActive: false,
    currentProblem: null,
    currentPair: null,
    freezeProblem: false,   // '시간 멈춤' 사용 여부
    selectMode: false,      // '꾹꾹이 펀치' 선택 대기
    items: {},
    scoreSubmitted: false,
    ans: { whole: '', numer: '', denom: '' },  // 가상 키패드 입력값
    activeField: 'numer',                       // 현재 입력 중인 칸
    dragging: false,        // 보드 위에서 시작한 터치만 드롭으로 인정
    itemInfoItem: null,     // 현재 정보 팝업에 띄워둔 아이템 def
    choosingReward: false,  // 5연속 정답 보상 선택 중 (게임 일시정지)
    resumeGraceUntil: 0,    // 이 시각까지는 새 문제 충돌을 막음 (보상 후 안정화)
    needsMergeCheck: false, // 유예 중 스킵된 쌍이 있을 때 만료 직후 재검사 트리거
    mergeCheckUntil: 0,     // 합체 직후 일정 시간 동안 매 프레임 인접 쌍 안전 검사
    feedbackShown: false,   // 정답/오답 피드백을 보여주는 동안 입력·엔진 정지
    mergeShowUntil: 0,      // 정답 후 합쳐진 모습을 보여주는 동안 엔진 정지
    pendingResolution: null,// '확인' 버튼 누르면 처리할 결과: 'correct' | 'wrong'
    seenCats: {},           // 이 기기에서 만들어본 적 있는 단계 (4~11). 1~3은 항상 보임
  };

  /* 누적 정답수 → 현재 난이도 (1~10).
     낮은 단계에서 훨씬 더 많은 문제를 풀어야 다음으로 넘어가는 곡선.
     단계별 누적 정답수 임계값:
       난이도 1 시작:   0
       난이도 2 진입:  20  (= +20)
       난이도 3 진입:  35  (= +15)
       난이도 4 진입:  47  (= +12)
       난이도 5 진입:  57  (= +10)
       난이도 6 진입:  65  (= +8)
       난이도 7 진입:  72  (= +7)
       난이도 8 진입:  78  (= +6)
       난이도 9 진입:  83  (= +5)
       난이도 10 진입: 87  (= +4)                  */
  const DIFFICULTY_THRESHOLDS = [0, 20, 35, 47, 57, 65, 72, 78, 83, 87];
  function currentRound() {
    const c = state.correctCount;
    for (let d = DIFFICULTY_THRESHOLDS.length; d >= 1; d--) {
      if (c >= DIFFICULTY_THRESHOLDS[d - 1]) return d;
    }
    return 1;
  }

  /* =====================  오디오  =====================
     BGM(Sunny_Step_Up) 루프 + 효과음(drop, merge).
     설정(켜짐 여부 + 볼륨)은 localStorage 에 영구 저장. */
  const AUDIO_PREFS_KEY = 'fraction_cat_audio';
  const audioPrefs = (() => {
    try {
      const o = JSON.parse(localStorage.getItem(AUDIO_PREFS_KEY) || '{}');
      return {
        enabled: o.enabled !== false,
        volume: typeof o.volume === 'number' ? Math.min(1, Math.max(0, o.volume)) : 0.4,
      };
    } catch (e) { return { enabled: true, volume: 0.4 }; }
  })();
  function saveAudioPrefs() {
    try { localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(audioPrefs)); }
    catch (e) {}
  }

  const bgm = new Audio('Sunny_Step_Up.mp3');
  bgm.loop = true;
  bgm.volume = audioPrefs.volume;
  const sfxTemplates = {
    drop:  new Audio('drop.mp3'),
    merge: new Audio('merge.mp3'),
  };
  sfxTemplates.drop.preload = 'auto';
  sfxTemplates.merge.preload = 'auto';

  let lastDropSoundAt = 0;
  function playSFX(name, opts) {
    if (!audioPrefs.enabled) return;
    const tpl = sfxTemplates[name];
    if (!tpl) return;
    if (name === 'drop') {
      const now = performance.now();
      if (now - lastDropSoundAt < 80) return;   // 너무 잦은 충돌은 합침
      lastDropSoundAt = now;
    }
    try {
      const a = tpl.cloneNode();
      a.volume = (opts && typeof opts.volume === 'number') ? opts.volume : 0.6;
      a.play().catch(() => {});
    } catch (e) {}
  }

  function tryStartBGM() {
    if (!audioPrefs.enabled) return;
    bgm.volume = audioPrefs.volume;
    const p = bgm.play();
    if (p && p.catch) p.catch(() => {});   // 자동재생 차단되면 조용히 무시
  }
  function stopBGM() { bgm.pause(); }
  function setAudioEnabled(on) {
    audioPrefs.enabled = !!on;
    saveAudioPrefs();
    if (on) tryStartBGM(); else stopBGM();
    syncBGMButton();
  }
  function setBGMVolume(v) {
    audioPrefs.volume = Math.min(1, Math.max(0, v));
    bgm.volume = audioPrefs.volume;
    saveAudioPrefs();
  }
  function syncBGMButton() {
    const btn = document.getElementById('btn-bgm-toggle');
    if (!btn) return;
    btn.textContent = audioPrefs.enabled ? '🔊' : '🔇';
    btn.classList.toggle('muted', !audioPrefs.enabled);
    const slider = document.getElementById('bgm-volume');
    if (slider) slider.value = Math.round(audioPrefs.volume * 100);
  }

  /* =====================  진화 도감 (seenCats)  =====================
     이 기기에서 만들어본 적 있는 단계만 진화 순서 화면에서 그림으로 표시.
     1~3 단계는 자동 진화 단계라 늘 보이고, 4~11 단계는 만든 적 있을 때만. */
  const SEEN_CATS_KEY = 'fraction_cat_seen';
  function loadSeenCats() {
    try {
      const o = JSON.parse(localStorage.getItem(SEEN_CATS_KEY) || '{}');
      // 1~3 은 늘 보이도록 기본값 주입
      o[1] = o[2] = o[3] = true;
      return o;
    } catch (e) { return { 1: true, 2: true, 3: true }; }
  }
  function saveSeenCats() {
    try { localStorage.setItem(SEEN_CATS_KEY, JSON.stringify(state.seenCats)); }
    catch (e) {}
  }
  // 누적 마킹 — 11 을 만들었으면 4~11 까지 전부 보임 (도달 과정에서 모두 만들었기 때문)
  function markCatSeen(level) {
    let changed = false;
    for (let lv = 4; lv <= level; lv++) {
      if (!state.seenCats[lv]) { state.seenCats[lv] = true; changed = true; }
    }
    if (changed) saveSeenCats();
  }

  /* =====================  유틸  ===================== */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function catRadius(level) {
    return BOARD_W * (RADIUS_FACTOR[level] || 0.05);
  }
  // 떨어뜨릴 고양이는 무작위 1~3단계 (작은 단계 위주)
  function randomDropLevel() {
    const r = Math.random();
    return r < 0.6 ? 1 : r < 0.9 ? 2 : 3;
  }
  const UPCOMING_QUEUE_LEN = 8;       // 미리 뽑아두는 큐 길이 (드롭다운에 5마리 + 여유)
  function initUpcomingQueue() {
    state.upcomingQueue = [];
    for (let i = 0; i < UPCOMING_QUEUE_LEN; i++) {
      state.upcomingQueue.push(randomDropLevel());
    }
    state.dropLevel = state.upcomingQueue[0];
    state.nextLevel = state.upcomingQueue[1];
  }
  function advanceUpcomingQueue() {
    state.upcomingQueue.shift();
    state.upcomingQueue.push(randomDropLevel());
    while (state.upcomingQueue.length < UPCOMING_QUEUE_LEN) {
      state.upcomingQueue.push(randomDropLevel());
    }
    state.dropLevel = state.upcomingQueue[0];
    state.nextLevel = state.upcomingQueue[1];
  }
  function getCats() {
    return Composite.allBodies(world).filter((b) => b.label === 'cat');
  }

  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), ms || 1800);
  }

  /* =====================  캔버스 / 물리 세계  ===================== */
  function resizeCanvas() {
    const rect = boardWrap.getBoundingClientRect();
    BOARD_W = Math.max(200, rect.width);
    BOARD_H = Math.max(300, rect.height);
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = BOARD_W * DPR;
    canvas.height = BOARD_H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    LINE_Y = BOARD_H * 0.16;
    DROP_Y = BOARD_H * 0.075;
    state.pendingX = clamp(state.pendingX, 0, BOARD_W);
    if (world) buildWalls();
  }

  function buildWalls() {
    walls.forEach((w) => Composite.remove(world, w));
    const t = 240;
    walls = [
      Bodies.rectangle(-t / 2, BOARD_H / 2, t, BOARD_H * 3, { isStatic: true }),
      Bodies.rectangle(BOARD_W + t / 2, BOARD_H / 2, t, BOARD_H * 3, { isStatic: true }),
      Bodies.rectangle(BOARD_W / 2, BOARD_H + t / 2, BOARD_W * 3, t, { isStatic: true }),
    ];
    Composite.add(world, walls);
  }

  function setupPhysics() {
    engine = Engine.create();
    engine.gravity.y = 1.0;
    world = engine.world;
    buildWalls();
    Events.on(engine, 'collisionStart', onCollision);
  }

  /* =====================  고양이 생성 / 병합  ===================== */
  function makeCat(level, x, y) {
    const r = catRadius(level);
    const body = Bodies.circle(x, y, r, {
      restitution: 0.12,
      friction: 0.55,
      frictionStatic: 0.9,
      density: 0.0014,
      label: 'cat',
    });
    body.catLevel = level;
    body.bornAt = performance.now();
    body.cooldownUntil = 0;
    body.merging = false;
    body.overSince = 0;
    body.dead = false;        // 오답으로 진화 불가가 된 고양이
    if (level > state.maxCatLevel) state.maxCatLevel = level;
    markCatSeen(level);       // 도감에 등록 (4단계 이상만 실제 누적)
    // 11단계(냥신) 첫 도달 시점의 플레이 타임 기록 — '빠른 클리어' 랭킹용
    if (level >= MAX_LEVEL && state.clearTime === 0) {
      state.clearTime = Math.max(1, state.playTime);
    }

    Composite.add(world, body);
    return body;
  }

  function onCollision(evt) {
    if (state.problemActive || !state.running || state.paused) return;
    if (state.choosingReward) return;   // 보상 선택 중에는 새 충돌 처리 안 함
    const now = performance.now();
    // drop 효과음 — 고양이가 무언가에 부딪힐 때 (속도 1.5 이상)
    for (const pair of evt.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      if (a.label !== 'cat' && b.label !== 'cat') continue;
      const sa = Math.hypot(a.velocity?.x || 0, a.velocity?.y || 0);
      const sb = Math.hypot(b.velocity?.x || 0, b.velocity?.y || 0);
      if (Math.max(sa, sb) > 1.5) { playSFX('drop'); break; }
    }
    for (const pair of evt.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      if (a.label !== 'cat' || b.label !== 'cat') continue;
      if (a.catLevel !== b.catLevel) continue;
      if (a.merging || b.merging) continue;
      if (a.dead || b.dead) continue;   // 진화 불가 고양이는 병합 안 함
      if (now < a.cooldownUntil || now < b.cooldownUntil) continue;

      if (a.catLevel >= MAX_LEVEL) {
        maxMerge(a, b);
        continue;
      }
      if (a.catLevel < PROBLEM_MIN_LEVEL) {
        autoMerge(a, b);          // 1~3단계: 문제 없이 자동 진화
        continue;
      }
      // 보상 직후 유예 시간 동안에는 새 문제를 띄우지 않음.
      // Matter 의 collisionStart 는 접촉 시작 시점에 1회만 발생하므로,
      // 여기서 스킵된 쌍은 유예가 끝나도 다시 이벤트가 안 옴 → 영영 안 합쳐지는 버그.
      // 만료 직후 1회 재검사를 트리거하기 위해 플래그를 세움.
      if (now < state.resumeGraceUntil) { state.needsMergeCheck = true; continue; }
      startProblem(a, b);         // 4단계 이상: 분수 문제로 진화
      break;                      // 문제 팝업은 한 번에 하나만
    }
  }

  /* 합체 직후·유예 만료 후 안전망 — Matter.collisionStart 가 놓친 인접 쌍을 직접 처리.
     · Matter 는 두 원이 정확히 닿아야 collisionStart 가 발화하므로 1~2 픽셀 갭에는 안 잡힘
     · 합체 직후엔 새 고양이가 옆 고양이와 미세하게 떨어진 채 멈출 수 있음
     · 그래서 약간 너그러운 거리(3px)로 검사하고, 합체 후 일정 시간 동안 반복 실행. */
  function checkForPendingMerges() {
    if (state.problemActive || state.choosingReward) return;
    if (performance.now() < state.resumeGraceUntil) return;   // 유예 중엔 안 함
    const cats = getCats();
    const now = performance.now();
    for (let i = 0; i < cats.length; i++) {
      const a = cats[i];
      if (a.merging || a.dead || now < a.cooldownUntil) continue;
      for (let j = i + 1; j < cats.length; j++) {
        const b = cats[j];
        if (b.merging || b.dead || now < b.cooldownUntil) continue;
        if (a.catLevel !== b.catLevel) continue;
        const dx = a.position.x - b.position.x;
        const dy = a.position.y - b.position.y;
        const sumR = a.circleRadius + b.circleRadius;
        if (Math.hypot(dx, dy) > sumR + 3) continue;     // 거의 닿은 쌍 포함
        if (a.catLevel >= MAX_LEVEL) { maxMerge(a, b); return; }
        if (a.catLevel < PROBLEM_MIN_LEVEL) { autoMerge(a, b); return; }
        startProblem(a, b);
        return;     // 한 번에 한 쌍만 처리 (문제는 동시 진행 불가)
      }
    }
  }

  // 1~3단계용 자동 진화 — 문제 없이 즉시 다음 단계로 합쳐짐
  function autoMerge(a, b) {
    a.merging = b.merging = true;
    const mid = midpoint(a, b);
    const newLevel = a.catLevel + 1;
    Composite.remove(world, a);
    Composite.remove(world, b);
    makeCat(newLevel, mid.x, mid.y);
    state.score += 10 * newLevel;   // 작은 보너스 (문제 풀이 점수보다 훨씬 적음)
    playSFX('merge');
    state.mergeCheckUntil = performance.now() + 2500;   // 안전망 활성
    updateHUD();
  }

  // 최고 레벨끼리 만나면 문제 없이 보너스 후 사라짐
  function maxMerge(a, b) {
    a.merging = b.merging = true;
    const mid = midpoint(a, b);
    Composite.remove(world, a);
    Composite.remove(world, b);
    state.score += 2000;
    showComboFlash('대성공!');
    playSFX('merge', { volume: 0.9 });
    toast(CAT_NAMES[MAX_LEVEL] + '끼리 만나 별이 되었어요! +2000', 2000);
    state.mergeCheckUntil = performance.now() + 2500;
    updateHUD();
  }

  function midpoint(a, b) {
    return {
      x: (a.position.x + b.position.x) / 2,
      y: (a.position.y + b.position.y) / 2,
    };
  }

  function startProblem(a, b) {
    state.problemActive = true;
    state.currentPair = [a, b];
    a.merging = b.merging = true;
    state.freezeProblem = false;
    state.currentProblem = generateProblem(Math.min(10, currentRound()));
    // 제한 시간: 난이도가 올라갈수록 더 줌 (45s 기본 + 난이도×3s)
    state.problemTimeLeft = (45 + state.currentProblem.difficulty * 3) * 1000;
    openMathPopup();
  }

  /* 정답 처리 → 두 고양이 병합 */
  function resolveCorrect() {
    const [a, b] = state.currentPair;
    const mid = midpoint(a, b);
    const newLevel = a.catLevel + 1;
    Composite.remove(world, a);
    Composite.remove(world, b);
    makeCat(newLevel, mid.x, mid.y);
    playSFX('merge', { volume: 0.75 });

    state.correctCount++;
    state.totalCount++;
    state.combo++;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;

    const comboMul = 1 + Math.max(0, state.combo - 1) * 0.25;
    const gained = Math.round(
      (50 + state.currentProblem.difficulty * 30 + newLevel * 20) * comboMul
    );
    state.score += gained;

    showComboFlash(state.combo + '연속 정답!');   // 매 정답마다 표시
    // 5연속 정답마다 아이템 1개 보상 선택
    //   ※ setTimeout 전에 choosingReward 를 켜서 엔진을 즉시 정지시켜야
    //     딜레이 동안 새 충돌→문제팝업이 끼어드는 버그를 막을 수 있다.
    const willReward = state.combo > 0 && state.combo % 5 === 0;
    if (willReward) state.choosingReward = true;
    closeProblem();
    // 합쳐진 모습을 1초간 보여줌 — 그 동안 엔진 정지, 새 문제 팝업도 못 끼어듦
    state.mergeShowUntil = performance.now() + 1000;
    // 합체 직후 약 2.5초간 인접 쌍 안전 검사 활성 (Matter 가 놓친 미세 갭 보완)
    state.mergeCheckUntil = performance.now() + 2500;
    updateHUD();
    if (willReward) setTimeout(openRewardChooser, 1000);
  }

  /* 시간 초과 = 오답 처리 (두 고양이 진화 불가) */
  function handleProblemTimeout() {
    if (!state.problemActive) return;
    toast('시간 초과! 이 고양이는 더 진화할 수 없어요.', 2200);
    resolveWrong();
  }

  /* 오답 처리 → 두 고양이가 '진화 불가' 상태가 되고 팝업이 닫힘 */
  function resolveWrong() {
    state.totalCount++;
    state.combo = 0;
    if (state.currentPair) {
      state.currentPair.forEach(function (c) {
        if (c) { c.dead = true; c.merging = false; }
      });
    }
    closeProblem();
    // 팝업이 닫힌 후 게임 화면 위에서 안내 — 사용자가 진짜로 보게 됨
    toast('이 고양이들은 더 이상 진화할 수 없어요!', 2500);
    updateHUD();
  }

  function closeProblem() {
    if (state.currentPair) {
      state.currentPair.forEach((c) => {
        if (c) { c.merging = false; c.cooldownUntil = performance.now() + 1500; }
      });
    }
    state.problemActive = false;
    state.currentPair = null;
    state.currentProblem = null;
    state.freezeProblem = false;
    state.problemTimeLeft = 0;
    $('math-popup').classList.add('hidden');
    $('lcm-hint').classList.add('hidden');
    const ti = $('math-timer');
    if (ti) ti.style.color = '';     // 빨간색 잔재 제거
  }

  /* =====================  수학 문제 팝업  ===================== */
  function openMathPopup() {
    const p = state.currentProblem;
    $('math-tag').textContent = '분수의 ' + (p.op === '+' ? '덧셈' : '뺄셈')
      + ' · 난이도 ' + p.difficulty;
    const ti = $('math-timer');
    ti.textContent = Math.ceil(state.problemTimeLeft / 1000) + '초';
    ti.style.color = '';
    $('math-question').innerHTML = problemHTML(p);
    // 새 문제 — 결과 대기 상태와 확인 버튼 초기화
    state.pendingResolution = null;
    $('btn-math-submit').textContent = '정답 확인';
    setFeedbackMode(false);
    state.ans = { whole: '', numer: '', denom: '' };
    state.activeField = 'numer';
    refreshAnswerFields();
    $('math-feedback').textContent = '';
    $('math-feedback').className = 'math-feedback';
    $('math-popup').classList.remove('hidden');
  }

  /* ----- 가상 키패드 / 정답 입력 칸 ----- */
  function buildKeypad() {
    const pad = $('keypad');
    pad.innerHTML = '';
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']
      .forEach(function (k) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'key';
        if (k === 'clear') { btn.classList.add('key-fn'); btn.textContent = 'C'; }
        else if (k === 'back') { btn.classList.add('key-fn'); btn.textContent = '←'; }
        else btn.textContent = k;
        btn.addEventListener('click', function () { pressKey(k); });
        pad.appendChild(btn);
      });
  }

  function pressKey(k) {
    const f = state.activeField;
    if (k === 'clear') state.ans[f] = '';
    else if (k === 'back') state.ans[f] = state.ans[f].slice(0, -1);
    else if (state.ans[f].length < 3) state.ans[f] += k;
    refreshAnswerFields();
  }

  function setActiveField(f) {
    state.activeField = f;
    refreshAnswerFields();
  }

  function refreshAnswerFields() {
    [['whole', '자연수'], ['numer', '분자'], ['denom', '분모']].forEach(function (p) {
      const el = $('ans-' + p[0]);
      const v = state.ans[p[0]];
      el.textContent = v === '' ? p[1] : v;
      el.classList.toggle('placeholder', v === '');
      el.classList.toggle('active', state.activeField === p[0]);
    });
  }

  function submitMath() {
    if (!state.problemActive) return;

    // 두 번째 단계: 피드백 표시 중에 '확인' 버튼 → 결과를 실제로 적용
    if (state.pendingResolution) {
      const pending = state.pendingResolution;
      state.pendingResolution = null;
      setFeedbackMode(false);
      $('btn-math-submit').textContent = '정답 확인';
      if (pending === 'correct') resolveCorrect();
      else if (pending === 'wrong') resolveWrong();
      return;
    }

    // 첫 단계: 채점
    const a = state.ans;
    const res = checkAnswer(a.whole, a.numer, a.denom, state.currentProblem);
    const fb = $('math-feedback');

    if (res.status === 'correct') {
      fb.innerHTML = '정답이에요!';
      fb.className = 'math-feedback good';
      armConfirm('correct');
    } else if (res.status === 'not_reduced') {
      fb.textContent = res.message;
      fb.className = 'math-feedback bad';
      toast('기약분수로 입력해주세요!', 1800);
    } else if (res.status === 'improper_form') {
      fb.textContent = res.message;
      fb.className = 'math-feedback bad';
      toast(res.message, 1800);
    } else if (res.status === 'wrong') {
      fb.innerHTML = '오답이에요! 정답은 '
        + mixedFractionHTML(state.currentProblem.answer)
        + ' 이에요.';
      fb.className = 'math-feedback bad';
      armConfirm('wrong');
    } else {
      fb.textContent = res.message;
      fb.className = 'math-feedback bad';
    }
  }

  /* 결과를 보여주는 단계로 진입 — 제출 버튼이 '확인' 으로 바뀌고,
     키패드·아이템은 잠금. 엔진·카운트다운도 정지. */
  function armConfirm(result) {
    state.pendingResolution = result;
    setFeedbackMode(true);
    $('btn-math-submit').textContent = '확인';
  }

  /* 피드백 표시 모드 — 제출 버튼(확인)은 살리고 나머지 입력 잠금 */
  function setFeedbackMode(on) {
    state.feedbackShown = !!on;
    document.querySelectorAll('#math-items .math-item-btn').forEach((b) => { b.disabled = !!on; });
    document.querySelectorAll('#keypad .key').forEach((b) => { b.disabled = !!on; });
    document.querySelectorAll('.ans-field').forEach((b) => { b.disabled = !!on; });
  }

  /* =====================  드롭 조작  ===================== */
  function dropCat() {
    if (!state.running || state.paused || state.problemActive) return;
    if (state.dropLocked || state.selectMode) return;
    if (state.mergeShowUntil > performance.now()) return;   // 합쳐진 모습 보는 중

    const lv = state.dropLevel;
    const r = catRadius(lv);
    const x = clamp(state.pendingX, r, BOARD_W - r);
    makeCat(lv, x, DROP_Y);

    advanceUpcomingQueue();             // 큐를 한 칸 앞으로 + 새 고양이 추가
    state.dropLocked = true;
    setTimeout(() => { state.dropLocked = false; }, 480);
    updateNextPreview();
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * BOARD_W,
      y: (e.clientY - rect.top) / rect.height * BOARD_H,
    };
  }

  function onPointerDown(e) {
    if (!state.running || state.paused) return;
    const pos = pointerPos(e);

    if (state.selectMode) {           // 꾹꾹이 펀치: 고양이 선택
      const target = getCats().find(
        (c) => Math.hypot(c.position.x - pos.x, c.position.y - pos.y) <= c.circleRadius
      );
      if (target) {
        Composite.remove(world, target);
        // 선택 성공 시점에만 펀치 아이템 1개 차감
        if ((state.items.punch || 0) > 0) {
          state.items.punch--;
          updateItemBar();
        }
        toast(CAT_NAMES[target.catLevel] + ' 을(를) 없앴어요!');
        state.selectMode = false;
      } else {
        // 빗맞히면 아이템 그대로, 선택 모드도 유지 → 다시 시도 가능
        toast('고양이를 정확히 눌러주세요. (선택 취소: 일시정지)');
      }
      return;
    }
    // 보드 위에서 시작한 터치만 드롭으로 인정 (아이템 버튼 탭 등은 제외)
    state.dragging = true;
    state.pendingX = pos.x;
    // 손가락이 캔버스 밖으로 나가도 드래그가 끊기지 않도록 포인터 캡처
    if (e.pointerId !== undefined && canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }

  function onPointerMove(e) {
    if (!state.running || state.paused || state.selectMode) return;
    if (!state.dragging) return;
    state.pendingX = pointerPos(e).x;
  }

  function onPointerUp() {
    if (!state.dragging) return;
    state.dragging = false;
    dropCat();
  }

  // 드래그 중 시스템에 의해 끊긴 경우(예: 알림) — 드롭하지 않고 상태만 리셋
  function onPointerCancel() { state.dragging = false; }

  /* =====================  아이템  ===================== */
  function buildItemBar() {
    const bar = $('item-bar');
    bar.innerHTML = '';
    ITEM_DEFS.forEach((def) => {
      if (state.items[def.id] === undefined) state.items[def.id] = 0;
      const cnt = state.items[def.id] || 0;
      const btn = document.createElement('button');
      btn.className = 'item-btn';
      btn.id = 'item-' + def.id;
      btn.innerHTML =
        `<span class="item-icon">${def.icon}</span>` +
        `<span class="item-name">${def.name}</span>` +
        `<span class="item-count" id="count-${def.id}">${cnt}</span>`;
      btn.addEventListener('click', () => openItemInfo(def));
      bar.appendChild(btn);
    });
    updateItemBar();
  }

  // 아이템 개수 초기 세팅 (새 게임 시작 시에만)
  function resetItemCounts() {
    ITEM_DEFS.forEach((def) => { state.items[def.id] = def.start; });
  }

  // 문제 풀이 중에 쓸 수 있는 미니 아이템 3개를 수학 팝업 안에 표시
  function buildMathItems() {
    const wrap = $('math-items');
    wrap.innerHTML = '';
    PROBLEM_ITEM_IDS.forEach((id) => {
      const def = ITEM_DEFS.find((d) => d.id === id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'math-item-btn';
      btn.id = 'mi-' + id;
      const shortName = def.name.split(' ').slice(-2).join(' ');
      btn.innerHTML =
        `<span class="mi-icon">${def.icon}</span>` +
        `<span class="mi-name">${shortName}</span>` +
        `<span class="mi-count" id="mi-count-${id}">0</span>`;
      btn.addEventListener('click', () => openItemInfo(def));
      wrap.appendChild(btn);
    });
  }

  function updateItemBar() {
    ITEM_DEFS.forEach((def) => {
      const cnt = state.items[def.id] || 0;
      const c1 = document.getElementById('count-' + def.id);
      const b1 = document.getElementById('item-' + def.id);
      // 보유 0개여도 누르면 설명 팝업이 열리도록 disable 하지 않고 흐릿하게만 표시
      if (c1) c1.textContent = cnt;
      if (b1) b1.classList.toggle('item-empty', cnt <= 0);
      const c2 = document.getElementById('mi-count-' + def.id);
      const m2 = document.getElementById('mi-' + def.id);
      if (c2) c2.textContent = cnt;
      if (m2) m2.classList.toggle('item-empty', cnt <= 0);
    });
  }

  /* ----- 아이템 사용 흐름 -----
     1) 아이템 버튼 클릭 → openItemInfo: 설명 팝업 표시
     2) [사용] 버튼 → confirmUseItem: 효과 실행 + 개수 차감 */
  function openItemInfo(def) {
    if (!state.running) return;
    state.itemInfoItem = def;
    $('item-info-icon').textContent = def.icon;
    $('item-info-name').textContent = def.name;
    $('item-info-desc').textContent = def.desc;
    const cnt = state.items[def.id] || 0;
    $('item-info-count').textContent = '보유 ' + cnt + '개';

    let usable = true, reason = '사용';
    if (cnt <= 0) { usable = false; reason = '아이템이 없어요'; }
    else if (PROBLEM_ITEM_IDS.includes(def.id) && !state.problemActive) {
      usable = false; reason = '문제가 나왔을 때 사용 가능';
    }
    else if (!PROBLEM_ITEM_IDS.includes(def.id) && state.problemActive) {
      usable = false; reason = '문제를 먼저 풀어주세요';
    }
    const useBtn = $('btn-item-use');
    useBtn.disabled = !usable;
    useBtn.textContent = usable ? '사용' : reason;

    $('item-info-popup').classList.remove('hidden');
  }

  function confirmUseItem() {
    const def = state.itemInfoItem;
    if (!def) return;
    $('item-info-popup').classList.add('hidden');
    let consumed = true;
    switch (def.id) {
      case 'lcm':    consumed = itemLCM();    break;
      case 'freeze': consumed = itemFreeze(); break;
      case 'punch':  consumed = itemPunch();  break;
      case 'mixer':  consumed = itemMixer();  break;
      case 'spray':  consumed = itemSpray();  break;
      case 'churu':  consumed = itemChuru();  break;
    }
    if (consumed) {
      state.items[def.id]--;
      updateItemBar();
    }
    state.itemInfoItem = null;
  }

  /* 5연속 정답 → 아이템 1개를 직접 선택해 획득 */
  function openRewardChooser() {
    state.choosingReward = true;
    const list = $('reward-list');
    list.innerHTML = '';
    ITEM_DEFS.forEach((def) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'reward-card';
      card.innerHTML =
        `<span class="reward-icon">${def.icon}</span>` +
        `<span class="reward-name">${def.name}</span>` +
        `<span class="reward-desc">${def.desc}</span>`;
      card.addEventListener('click', () => {
        state.items[def.id] = (state.items[def.id] || 0) + 1;
        updateItemBar();
        $('reward-popup').classList.add('hidden');
        state.choosingReward = false;
        // 보상 직후 1.5초간 새 문제 충돌을 막아 합쳐진 고양이가 자연스럽게 자리를 잡게 함
        state.resumeGraceUntil = performance.now() + 1500;
        toast(def.name + ' 1개를 얻었어요!', 2000);
      });
      list.appendChild(card);
    });
    $('reward-popup').classList.remove('hidden');
  }

  // 1. 치즈냥의 마법 분모 — 최소공배수 3초 표시
  function itemLCM() {
    const hint = $('lcm-hint');
    hint.textContent = '최소공배수 = ' + state.currentProblem.denomLCM;
    hint.classList.remove('hidden');
    clearTimeout(itemLCM._t);
    itemLCM._t = setTimeout(() => hint.classList.add('hidden'), 3000);
    return true;
  }

  // 2. 생각 시간 멈춤 — 카운트다운과 물리를 함께 정지
  function itemFreeze() {
    state.freezeProblem = true;
    toast('시간이 멈췄어요! 천천히 풀어도 돼요.');
    return true;
  }

  // 3. 꾹꾹이 펀치 — 고양이 1마리 선택 제거
  //    선택 모드로 들어가기만 하고 실제 차감은 onPointerDown 에서 처리
  //    (잘못 누르거나 빈 곳을 누르면 아이템이 그대로 남도록)
  function itemPunch() {
    if (getCats().length === 0) { toast('없앨 고양이가 없어요.'); return false; }
    state.selectMode = true;
    toast('없앨 고양이를 한 번 눌러주세요.');
    return false;   // ★ 차감하지 않음 — 선택 성공 시점에 별도 차감
  }

  // 4. 야옹 믹서기 — 흔들기 + 위치 섞기
  function itemMixer() {
    boardWrap.classList.remove('shake');
    void boardWrap.offsetWidth;
    boardWrap.classList.add('shake');
    setTimeout(() => boardWrap.classList.remove('shake'), 600);

    getCats().forEach((c) => {
      const r = c.circleRadius;
      Body.setPosition(c, {
        x: clamp(Math.random() * BOARD_W, r, BOARD_W - r),
        y: clamp(LINE_Y + Math.random() * (BOARD_H - LINE_Y - r), r, BOARD_H - r),
      });
      Body.setVelocity(c, { x: (Math.random() - 0.5) * 8, y: 0 });
      Body.setAngularVelocity(c, (Math.random() - 0.5) * 0.4);
    });
    // 셔플 직후 우연한 충돌이 곧장 문제 팝업으로 이어지지 않도록 유예 시간 부여
    state.resumeGraceUntil = performance.now() + 1500;
    toast('고양이들이 뒤죽박죽 섞였어요!');
    return true;
  }

  // 5. 캣닢 스프레이 — 다음 고양이(1~3레벨) 선택
  function itemSpray() {
    showSprayChooser();
    return true; // 선택창을 띄우는 순간 소모
  }

  function showSprayChooser() {
    let ov = $('spray-popup');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'spray-popup';
      ov.className = 'overlay';
      ov.innerHTML =
        '<div class="popup-card"><h2 class="popup-title">다음 고양이 선택</h2>' +
        '<div class="spray-choices" id="spray-choices"></div></div>';
      $('app').appendChild(ov);
      const wrap = ov.querySelector('#spray-choices');
      for (let lv = 1; lv <= 3; lv++) {
        const b = document.createElement('button');
        b.className = 'spray-choice';
        b.innerHTML =
          `<span class="sc-img" style="background-image:url('${CAT_ASSETS[lv]}')"></span>` +
          `<span class="sc-name">${CAT_NAMES[lv]}</span>`;
        const chosen = lv;
        b.addEventListener('click', () => {
          state.dropLevel = chosen;
          state.upcomingQueue[0] = chosen;     // 큐의 첫 칸도 갱신
          ov.classList.add('hidden');
          updateNextPreview();
          toast(CAT_NAMES[chosen] + ' 을(를) 준비했어요!');
        });
        wrap.appendChild(b);
      }
    }
    ov.classList.remove('hidden');
  }

  // 6. 츄르 타임 — 문제를 정답 처리 (확인 버튼 누르면 진행)
  function itemChuru() {
    const fb = $('math-feedback');
    fb.innerHTML = '츄르 타임! 정답으로 통과!';
    fb.className = 'math-feedback good';
    armConfirm('correct');
    return true;
  }

  /* =====================  HUD / 미리보기  ===================== */
  function updateHUD() {
    $('hud-score').textContent = state.score;
    $('hud-round').textContent = currentRound();
    $('hud-combo').textContent = state.combo;
    const acc = state.totalCount
      ? Math.round((state.correctCount / state.totalCount) * 100) : 0;
    $('hud-accuracy').textContent = acc + '%';
    const ht = $('hud-time');
    if (ht) ht.textContent = formatTime(state.playTime);
  }

  function updateNextPreview() {
    const el = $('next-cat');
    el.style.backgroundImage = `url('${CAT_ASSETS[state.nextLevel]}')`;
    el.style.backgroundColor = CAT_COLORS[state.nextLevel];
    // 드롭다운이 열려 있으면 갱신된 큐로 다시 그림
    if (!$('upcoming-popup').classList.contains('hidden')) buildUpcomingList();
  }

  /* 다음 고양이 드롭다운 — queue[1] 부터 5마리 표시 (queue[0]은 캔버스 상단의 현재 대기 고양이) */
  function buildUpcomingList() {
    const list = $('upcoming-list');
    list.innerHTML = '';
    const labels = ['1번째', '2번째', '3번째', '4번째', '5번째'];
    for (let i = 0; i < 5; i++) {
      const lv = state.upcomingQueue[i + 1];
      if (!lv) continue;
      const item = document.createElement('div');
      item.className = 'up-item';
      const cat = document.createElement('span');
      cat.className = 'up-cat';
      cat.style.backgroundImage = "url('" + CAT_ASSETS[lv] + "')";
      cat.style.backgroundColor = CAT_COLORS[lv];
      const label = document.createElement('span');
      label.className = 'up-label';
      label.textContent = labels[i];
      item.appendChild(cat);
      item.appendChild(label);
      list.appendChild(item);
    }
  }
  function toggleUpcomingPopup() {
    const pop = $('upcoming-popup');
    if (pop.classList.contains('hidden')) {
      buildUpcomingList();
      pop.classList.remove('hidden');
    } else {
      pop.classList.add('hidden');
    }
  }

  /* 진화 순서 도감 — 만들어본 단계만 그림으로, 안 만든 단계는 ? 실루엣 */
  function buildCatGuide() {
    const grid = $('cat-guide-grid');
    grid.innerHTML = '';
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const cell = document.createElement('div');
      cell.className = 'cat-guide-item';
      const asset = CAT_ASSETS[lv];
      const seen = !!state.seenCats[lv];
      if (seen) {
        if (asset) {
          cell.style.backgroundImage = "url('" + asset.replace('_512', '_128') + "')";
        } else {
          cell.style.backgroundColor = CAT_COLORS[lv];   // 11단계: 이미지 대체
        }
      } else {
        cell.classList.add('cg-unseen');
        if (asset) {
          const sil = document.createElement('div');
          sil.className = 'cg-sil';
          sil.style.backgroundImage =
            "url('" + asset.replace('_512', '_128') + "')";
          cell.appendChild(sil);
        }
        const q = document.createElement('span');
        q.className = 'cg-q';
        q.textContent = '?';
        cell.appendChild(q);
      }
      const num = document.createElement('span');
      num.className = 'cg-num';
      num.textContent = lv;
      cell.appendChild(num);
      grid.appendChild(cell);
    }
  }


  function showComboFlash(text) {
    const el = $('combo-flash');
    el.textContent = text;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(showComboFlash._t);
    showComboFlash._t = setTimeout(() => el.classList.add('hidden'), 2000);
  }

  /* =====================  렌더링  ===================== */
  function drawCat(x, y, angle, level, radius, dead) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const img = catImages[level];
    if (imageOK[level] && img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -radius, -radius, radius * 2, radius * 2);
    } else {
      // 이미지가 없을 때(예: 마지막 단계) 대체 렌더링
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = CAT_COLORS[level] || '#ffd97d';
      ctx.fill();
      ctx.lineWidth = Math.max(2, radius * 0.08);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.stroke();
      ctx.fillStyle = '#2a1b4a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 ' + (radius * 0.42).toFixed(0) + 'px sans-serif';
      ctx.fillText(CAT_NAMES[level], 0, radius * 0.05);
    }
    // 진화 불가 고양이는 반투명 검은색으로 덮어 표시
    if (dead) {
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fill();
    }
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);

    // 게임 오버 경계선
    ctx.save();
    ctx.strokeStyle = 'rgba(255,92,92,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(0, LINE_Y);
    ctx.lineTo(BOARD_W, LINE_Y);
    ctx.stroke();
    ctx.restore();

    // 고양이들
    getCats().forEach((c) => {
      drawCat(c.position.x, c.position.y, c.angle, c.catLevel, c.circleRadius, c.dead);
    });

    // 떨어뜨릴 준비 중인 고양이 + 가이드 선
    if (state.running && !state.problemActive) {
      const r = catRadius(state.dropLevel);
      const x = clamp(state.pendingX, r, BOARD_W - r);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,204,77,0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(x, DROP_Y + r);
      ctx.lineTo(x, BOARD_H);
      ctx.stroke();
      ctx.restore();
      drawCat(x, DROP_Y, 0, state.dropLevel, r);
    }
  }

  /* =====================  게임 오버 판정  ===================== */
  function checkGameOver() {
    const now = performance.now();
    for (const c of getCats()) {
      if (now - c.bornAt < 2500) { c.overSince = 0; continue; } // 막 떨어진 고양이 유예
      const top = c.position.y - c.circleRadius;
      const speed = Math.hypot(c.velocity.x, c.velocity.y);
      if (top < LINE_Y && speed < 1.3) {
        if (!c.overSince) c.overSince = now;
        else if (now - c.overSince > 1800) { endGame(); return; }
      } else {
        c.overSince = 0;
      }
    }
  }

  /* =====================  메인 루프  ===================== */
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!state.running) { state.lastActiveTickAt = 0; return; }

    const visible = document.visibilityState === 'visible';
    const onGame = screens.game.classList.contains('active');
    // "활성 플레이" 조건: 게임 화면 위에 있고, 멈춤/숨김/보상선택 상태가 아님
    const isActive = !state.paused && !state.choosingReward && visible && onGame;

    // 플레이 타임 누적 (활성일 때만)
    let dt = 0;
    if (isActive) {
      if (state.lastActiveTickAt) {
        const raw = ts - state.lastActiveTickAt;
        if (raw > 0 && raw < 500) dt = raw;       // 큰 갭은 무시 (안전망)
      }
      state.playTime += dt;
      state.lastActiveTickAt = ts;
      // HUD 업데이트 (가벼움)
      const hudTime = $('hud-time');
      if (hudTime) hudTime.textContent = formatTime(state.playTime);
    } else {
      state.lastActiveTickAt = 0;
    }

    // 분수 문제 카운트다운
    if (state.problemActive) {
      const ti = $('math-timer');
      if (state.freezeProblem) {
        if (ti) { ti.textContent = '⏸️ 시간 멈춤'; ti.style.color = 'var(--accent)'; }
      } else if (state.feedbackShown) {
        // 정답/오답 피드백 표시 중에는 카운트다운 정지 (디스플레이도 그대로 유지)
      } else if (dt > 0) {
        state.problemTimeLeft -= dt;
        if (state.problemTimeLeft <= 0) {
          state.problemTimeLeft = 0;
          if (ti) ti.textContent = '0초';
          handleProblemTimeout();
        } else if (ti) {
          const sec = Math.ceil(state.problemTimeLeft / 1000);
          ti.textContent = sec + '초';
          ti.style.color = sec <= 10 ? '#ff5c5c' : '';
        }
      }
    }

    // 엔진 동결 조건
    //   · 정답/오답 피드백 표시 중에는 엔진을 멈춰 게임오버 위험을 차단
    //   · 정답 처리 직후엔 합쳐진 모습을 보여주기 위해 mergeShowUntil 동안 정지
    const engineFrozen = state.paused ||
      (state.problemActive && state.freezeProblem) ||
      state.choosingReward || !visible || !onGame ||
      state.feedbackShown ||
      state.mergeShowUntil > performance.now();
    if (!engineFrozen) {
      Engine.update(engine, 1000 / 60);
      checkGameOver();
      // 안전망: 합체 직후 일정 시간 동안 OR 유예 만료 직후
      //         인접한 같은 단계 쌍을 매 프레임 직접 스캔.
      const tnow = performance.now();
      const inMergeWindow = tnow < state.mergeCheckUntil;
      const graceExpired = tnow >= state.resumeGraceUntil;
      if (graceExpired && (inMergeWindow || state.needsMergeCheck)) {
        state.needsMergeCheck = false;
        checkForPendingMerges();
      }
    }
    render();
  }

  /* mm:ss 형식 */
  function formatTime(ms) {
    const s = Math.floor((Number(ms) || 0) / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  /* =====================  이어하기 (세이브/로드)  ===================== */
  const SAVE_KEY = 'fraction_cat_save';

  function saveGame() {
    if (!state.running) return;
    try {
      const cats = getCats().map((c) => ({
        lv: c.catLevel,
        x: c.position.x / Math.max(1, BOARD_W),
        y: c.position.y / Math.max(1, BOARD_H),
        vx: c.velocity.x, vy: c.velocity.y,
        a: c.angle, av: c.angularVelocity,
        d: !!c.dead,
      }));
      const snap = {
        v: 1,
        score: state.score, combo: state.combo, maxCombo: state.maxCombo,
        correctCount: state.correctCount, totalCount: state.totalCount,
        maxCatLevel: state.maxCatLevel,
        playTime: state.playTime, clearTime: state.clearTime,
        items: state.items,
        dropLevel: state.dropLevel, nextLevel: state.nextLevel,
        upcomingQueue: state.upcomingQueue.slice(),
        cats: cats,
        savedAt: Date.now(),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
    } catch (e) { /* 저장 실패는 조용히 */ }
  }
  function loadSavedGame() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function clearSavedGame() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }
  function hasSavedGame() { return !!loadSavedGame(); }

  function updateResumeButton() {
    const btn = document.getElementById('btn-resume-game');
    const empty = document.getElementById('resume-empty');
    const has = hasSavedGame();
    if (btn) btn.classList.toggle('hidden', !has);
    if (empty) empty.classList.toggle('hidden', has);
  }

  function resumeGame() {
    const snap = loadSavedGame();
    if (!snap) return false;
    hideAllOverlays();
    showScreen('game');
    if (!engine) setupPhysics();
    resizeCanvas();
    getCats().forEach((c) => Composite.remove(world, c));

    state.running = true;
    state.paused = false;
    state.score = snap.score || 0;
    state.combo = snap.combo || 0;
    state.maxCombo = snap.maxCombo || 0;
    state.correctCount = snap.correctCount || 0;
    state.totalCount = snap.totalCount || 0;
    state.maxCatLevel = snap.maxCatLevel || 0;
    state.playTime = snap.playTime || 0;
    state.clearTime = snap.clearTime || 0;
    markCatSeen(state.maxCatLevel);    // 이어하기 시 최고 단계까지 도감에 누적 반영
    state.items = Object.assign({}, snap.items || {});
    // 큐 복원 — 옛 저장본이면 dropLevel/nextLevel 로부터 새 큐 생성
    if (Array.isArray(snap.upcomingQueue) && snap.upcomingQueue.length >= 2) {
      state.upcomingQueue = snap.upcomingQueue.slice();
      while (state.upcomingQueue.length < UPCOMING_QUEUE_LEN) {
        state.upcomingQueue.push(randomDropLevel());
      }
      state.dropLevel = state.upcomingQueue[0];
      state.nextLevel = state.upcomingQueue[1];
    } else {
      initUpcomingQueue();
      state.upcomingQueue[0] = snap.dropLevel || state.upcomingQueue[0];
      state.upcomingQueue[1] = snap.nextLevel || state.upcomingQueue[1];
      state.dropLevel = state.upcomingQueue[0];
      state.nextLevel = state.upcomingQueue[1];
    }
    state.pendingX = BOARD_W / 2;
    state.dropLocked = false;
    state.dragging = false;
    state.problemActive = false;
    state.selectMode = false;
    state.currentPair = null;
    state.scoreSubmitted = false;
    state.choosingReward = false;
    state.resumeGraceUntil = performance.now() + 800;
    state.needsMergeCheck = false;
    state.mergeCheckUntil = 0;
    state.feedbackShown = false;
    state.mergeShowUntil = 0;
    state.pendingResolution = null;
    state.itemInfoItem = null;
    state.lastActiveTickAt = 0;

    // 고양이 복원 (좌표는 비율로 저장되어 보드 크기 변화에도 안전)
    for (const c of (snap.cats || [])) {
      const x = c.x * BOARD_W, y = c.y * BOARD_H;
      const body = makeCat(c.lv, x, y);
      Body.setVelocity(body, { x: c.vx || 0, y: c.vy || 0 });
      Body.setAngle(body, c.a || 0);
      Body.setAngularVelocity(body, c.av || 0);
      body.dead = !!c.d;
      body.bornAt = performance.now() - 3000;  // 이미 안정화된 것으로
    }

    buildItemBar();        // DOM 생성 (state.items 는 보존)
    updateHUD();
    updateNextPreview();
    return true;
  }

  /* =====================  화면 흐름  ===================== */
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }
  function hideAllOverlays() {
    ['math-popup', 'pause-popup', 'gameover-popup', 'privacy-popup',
     'rank-popup', 'help-popup', 'item-info-popup', 'reward-popup',
     'cat-guide-popup']
      .forEach((id) => $(id).classList.add('hidden'));
    const sp = $('spray-popup');
    if (sp) sp.classList.add('hidden');
  }

  function startGame() {
    hideAllOverlays();
    showScreen('game');
    if (!engine) setupPhysics();
    resizeCanvas();

    // 세계 초기화
    getCats().forEach((c) => Composite.remove(world, c));

    state.running = true;
    state.paused = false;
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.correctCount = 0;
    state.totalCount = 0;
    state.maxCatLevel = 0;
    state.playTime = 0;
    state.clearTime = 0;
    state.lastActiveTickAt = 0;
    initUpcomingQueue();                   // 앞으로 나올 8마리 큐 새로 채움
    state.pendingX = BOARD_W / 2;
    state.dropLocked = false;
    state.dragging = false;
    state.problemActive = false;
    state.selectMode = false;
    state.currentPair = null;
    state.scoreSubmitted = false;
    state.choosingReward = false;
    state.resumeGraceUntil = 0;
    state.needsMergeCheck = false;
    state.mergeCheckUntil = 0;
    state.feedbackShown = false;
    state.mergeShowUntil = 0;
    state.pendingResolution = null;
    state.itemInfoItem = null;

    resetItemCounts();      // 새 게임은 모든 아이템 0개로 초기화
    buildItemBar();
    updateHUD();
    updateNextPreview();
  }

  function endGame() {
    state.running = false;
    state.problemActive = false;
    clearSavedGame();           // 게임 종료 시 저장본 삭제
    stopBGM();
    hideAllOverlays();

    const acc = state.totalCount
      ? Math.round((state.correctCount / state.totalCount) * 100) : 0;
    $('result-score').textContent = state.score;
    $('result-round').textContent = currentRound();
    $('result-combo').textContent = state.maxCombo;
    $('result-correct').textContent = state.correctCount;
    $('result-total').textContent = state.totalCount;
    $('result-accuracy').textContent = acc + '%';
    $('result-max-cat').textContent = state.maxCatLevel
      ? state.maxCatLevel + '단계 ' + (CAT_NAMES[state.maxCatLevel] || '')
      : '-';
    const resultTime = $('result-play-time');
    if (resultTime) {
      resultTime.textContent = formatTime(state.playTime) +
        (state.clearTime > 0 ? ' (11단계 ' + formatTime(state.clearTime) + ')' : '');
    }
    $('nickname-input').value = '';
    $('nickname-feedback').textContent = '';
    $('gameover-popup').classList.remove('hidden');
  }

  /* =====================  랭킹  ===================== */
  function buildEntry(nickname) {
    const acc = state.totalCount
      ? Math.round((state.correctCount / state.totalCount) * 100) : 0;
    return {
      nickname: nickname,
      score: state.score,
      round: currentRound(),
      maxCombo: state.maxCombo,
      correctCount: state.correctCount,
      totalCount: state.totalCount,
      accuracy: acc,
      maxCatLevel: state.maxCatLevel || 0,
      playTime: Math.round(state.playTime || 0),
      clearTime: Math.round(state.clearTime || 0),
    };
  }

  // 검색 결과를 강조하기 위해 마지막에 본 검색어/하이라이트 닉네임 저장
  let lastSearchQuery = '';
  let lastHighlight = null;

  async function openRank(highlight) {
    hideAllOverlays();
    lastHighlight = highlight || null;
    $('rank-popup').classList.remove('hidden');
    $('rank-sort').value = state.rankSort;
    $('rank-order').value = state.rankOrder;
    $('rank-search-input').value = '';
    $('rank-search-result').classList.add('hidden');
    lastSearchQuery = '';
    await refreshRankTable();
  }

  /* 드롭다운 값을 실제 API 파라미터로 변환.
     '정답률 (50문제 이상)' 와 '빠른 11단계 클리어' 는 자동 필터 적용. */
  function rankParams() {
    const o = state.rankOrder;
    switch (state.rankSort) {
      case 'accuracy_filtered':
        return { sort: 'accuracy', order: o, minTotal: 50 };
      case 'clearTime_filtered':
        return { sort: 'clearTime', order: o, minMaxCat: 11 };
      default:
        return { sort: state.rankSort, order: o };
    }
  }

  async function refreshRankTable() {
    const body = $('rank-body');
    body.innerHTML = '<tr><td colspan="10" class="rank-empty">불러오는 중...</td></tr>';
    const list = await Leaderboard.fetchTop(rankParams(), 100);
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="10" class="rank-empty">조건에 맞는 기록이 아직 없어요.</td></tr>';
      return;
    }
    body.innerHTML = '';
    list.forEach((r, i) => {
      body.appendChild(buildRankRow(r, i + 1, lastHighlight));
    });
  }

  function buildRankRow(r, rank, highlight) {
    const tr = document.createElement('tr');
    if (highlight && r.nickname === highlight && Number(r.score) === state.score) {
      tr.style.background = 'rgba(255,204,77,0.18)';
    }
    // 시간 컬럼: 빠른 클리어 정렬이면 clearTime, 그 외엔 playTime + 🏆
    const showClear = state.rankSort === 'clearTime_filtered';
    const t = showClear ? r.clearTime : r.playTime;
    const timeCell = formatTime(t) + (!showClear && r.clearTime > 0 ? ' 🏆' : '');
    tr.innerHTML =
      `<td>${rank}</td><td>${escapeHTML(r.nickname)}</td>` +
      `<td>${r.score}</td><td>${r.round}</td><td>${r.maxCombo}</td>` +
      `<td>${r.correctCount}</td><td>${r.totalCount}</td><td>${r.accuracy}%</td>` +
      `<td>${r.maxCatLevel || '-'}</td><td>${timeCell}</td>`;
    return tr;
  }

  async function runRankSearch() {
    const q = $('rank-search-input').value.trim();
    const out = $('rank-search-result');
    lastSearchQuery = q;
    if (!q) { out.classList.add('hidden'); return; }
    out.classList.remove('hidden');
    out.innerHTML = '<div class="srt">검색 중...</div>';
    const results = await Leaderboard.search(q, rankParams());
    if (!results.length) {
      out.innerHTML =
        `<div class="srt">검색 결과</div>` +
        `<div class="snone">'${escapeHTML(q)}' 닉네임을 찾을 수 없어요.</div>`;
      return;
    }
    const showClear = state.rankSort === 'clearTime_filtered';
    let html =
      `<div class="srt">검색 결과 (${results.length}건 · 100위 밖도 포함)</div>` +
      `<table><tbody>`;
    for (const r of results) {
      const t = showClear ? r.clearTime : r.playTime;
      html += `<tr>
        <td class="srank">${r.rank}위</td>
        <td><b>${escapeHTML(r.nickname)}</b></td>
        <td>점수 ${r.score}</td>
        <td>정답률 ${r.accuracy}%</td>
        <td>${r.maxCatLevel || '-'}단계</td>
        <td>시간 ${formatTime(t)}${!showClear && r.clearTime > 0 ? ' 🏆' : ''}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
    out.innerHTML = html;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* =====================  이벤트 바인딩  ===================== */
  function bindEvents() {
    // 시작 화면
    $('btn-start').addEventListener('click', () => {
      clearSavedGame();           // 새 게임 시작 시 저장본 삭제
      startGame();
      updateResumeButton();
      tryStartBGM();
    });
    $('btn-resume-game').addEventListener('click', () => {
      if (resumeGame()) { updateResumeButton(); tryStartBGM(); }
    });
    $('btn-rank-start').addEventListener('click', () => openRank(null));
    $('btn-help').addEventListener('click', () => {
      hideAllOverlays(); $('help-popup').classList.remove('hidden');
    });
    $('btn-help-close').addEventListener('click', () => {
      $('help-popup').classList.add('hidden');
    });
    $('btn-rank-close').addEventListener('click', () => {
      $('rank-popup').classList.add('hidden');
      if (!state.running) showScreen('start');
    });
    // 랭킹 정렬 / 검색 컨트롤
    $('rank-sort').addEventListener('change', async (e) => {
      state.rankSort = e.target.value;
      // '빠른 11단계 클리어' 는 기본이 오름차순(빠를수록 1위)
      state.rankOrder = (state.rankSort === 'clearTime_filtered') ? 'asc' : 'desc';
      $('rank-order').value = state.rankOrder;
      await refreshRankTable();
      if (lastSearchQuery) await runRankSearch();
    });
    $('rank-order').addEventListener('change', async (e) => {
      state.rankOrder = e.target.value;
      await refreshRankTable();
      if (lastSearchQuery) await runRankSearch();
    });
    $('btn-rank-search').addEventListener('click', runRankSearch);
    $('rank-search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runRankSearch();
    });
    $('btn-rank-search-clear').addEventListener('click', () => {
      $('rank-search-input').value = '';
      $('rank-search-result').classList.add('hidden');
      lastSearchQuery = '';
    });

    // 캔버스 조작 — 드래그 중 캔버스를 벗어나도 끊기지 않도록 캡처/캔슬 처리
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('pointerup', onPointerUp);   // 캡처 미지원 환경 폴백

    // 수학 문제 — 정답 칸 선택 + 제출 (입력은 가상 키패드로만)
    $('btn-math-submit').addEventListener('click', submitMath);
    ['whole', 'numer', 'denom'].forEach(function (f) {
      $('ans-' + f).addEventListener('click', function () { setActiveField(f); });
    });

    // 아이템 사용 확인 팝업
    $('btn-item-use').addEventListener('click', confirmUseItem);
    $('btn-item-cancel').addEventListener('click', function () {
      $('item-info-popup').classList.add('hidden');
      state.itemInfoItem = null;
    });

    // 다음 고양이 미리보기 — 탭하면 앞으로 나올 5마리 드롭다운 토글
    $('next-cat-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleUpcomingPopup();
    });
    $('upcoming-popup').addEventListener('click', (e) => e.stopPropagation());
    // 바깥을 누르면 드롭다운 닫기
    document.addEventListener('click', () => {
      const pop = document.getElementById('upcoming-popup');
      if (pop && !pop.classList.contains('hidden')) pop.classList.add('hidden');
    });

    // 진화 순서 보기 (게임 화면 밖의 버튼 → 팝업)
    $('btn-cat-guide').addEventListener('click', function () {
      buildCatGuide();    // 그동안 새로 만난 고양이가 있으면 반영
      $('cat-guide-popup').classList.remove('hidden');
    });
    $('btn-cat-guide-close').addEventListener('click', function () {
      $('cat-guide-popup').classList.add('hidden');
    });

    // 배경음악 토글 / 볼륨
    $('btn-bgm-toggle').addEventListener('click', () => {
      setAudioEnabled(!audioPrefs.enabled);
    });
    $('bgm-volume').addEventListener('input', (e) => {
      setBGMVolume(Number(e.target.value) / 100);
      if (audioPrefs.enabled && bgm.paused) tryStartBGM();
    });
    syncBGMButton();

    // 일시정지
    $('btn-pause').addEventListener('click', () => {
      if (!state.running) return;
      state.selectMode = false;       // 펀치 선택 모드 중이면 취소
      state.paused = true;
      $('pause-popup').classList.remove('hidden');
      stopBGM();
    });
    $('btn-resume').addEventListener('click', () => {
      state.paused = false;
      $('pause-popup').classList.add('hidden');
      tryStartBGM();
    });
    // 다시 시작 = 저장본 삭제 후 새 게임 (아래 별도 listener 가 startGame 호출)
    $('btn-quit').addEventListener('click', () => {
      saveGame();                  // 메인으로 갈 때 현재 상태 저장 → 이어하기 가능
      state.running = false;
      state.paused = false;
      hideAllOverlays();
      showScreen('start');
      updateResumeButton();
      stopBGM();
    });
    $('btn-restart').addEventListener('click', () => {
      clearSavedGame();
      startGame();
    });

    // 게임 오버 → 닉네임
    $('btn-submit-score').addEventListener('click', () => {
      const nick = $('nickname-input').value.trim();
      const fb = $('nickname-feedback');
      if (!nick) {
        fb.textContent = '닉네임을 입력해주세요.';
        fb.className = 'math-feedback bad';
        return;
      }
      if (nick.length > 10) {
        fb.textContent = '닉네임은 10자 이내로 입력해주세요.';
        fb.className = 'math-feedback bad';
        return;
      }
      fb.textContent = '';
      $('privacy-nickname').textContent = nick;
      $('privacy-popup').classList.remove('hidden');
    });
    $('btn-skip-score').addEventListener('click', () => {
      hideAllOverlays();
      showScreen('start');
    });

    // 개인정보 확인 모달
    $('btn-privacy-yes').addEventListener('click', async () => {
      $('privacy-popup').classList.add('hidden');
      if (state.scoreSubmitted) { openRank(null); return; }
      const nick = $('nickname-input').value.trim();
      const res = await Leaderboard.submit(buildEntry(nick));
      if (res.ok) {
        state.scoreSubmitted = true;
        $('gameover-popup').classList.add('hidden');
        toast(res.offline ? '오프라인 랭킹에 저장했어요.' : '랭킹에 등록했어요!');
        openRank(nick);
      } else {
        $('gameover-popup').classList.remove('hidden');
        const fb = $('nickname-feedback');
        fb.textContent = res.reason || '등록에 실패했어요.';
        fb.className = 'math-feedback bad';
      }
    });
    $('btn-privacy-no').addEventListener('click', () => {
      $('privacy-popup').classList.add('hidden');
      $('gameover-popup').classList.remove('hidden');
      const fb = $('nickname-feedback');
      fb.textContent = '닉네임을 다시 확인해주세요.';
      fb.className = 'math-feedback';
    });

    window.addEventListener('resize', () => {
      if (screens.game.classList.contains('active')) resizeCanvas();
    });
  }

  /* =====================  시작  ===================== */
  /* --vw / --vh 를 #app 의 실제 픽셀 크기 기준으로 갱신.
     PC 가로 모니터(뷰포트 1920 등)에서도 800px 컨테이너에 맞게 내부 요소가 스케일된다. */
  function updateAppUnits() {
    const app = document.getElementById('app');
    if (!app) return;
    const w = app.offsetWidth, h = app.offsetHeight;
    if (w > 0) document.documentElement.style.setProperty('--vw', (w / 100) + 'px');
    if (h > 0) document.documentElement.style.setProperty('--vh', (h / 100) + 'px');
  }

  function init() {
    state.seenCats = loadSeenCats();   // 도감 로드 (1~3 자동 포함)
    bindEvents();
    buildKeypad();
    buildCatGuide();
    buildMathItems();
    updateAppUnits();
    updateResumeButton();
    window.addEventListener('resize', updateAppUnits);
    window.addEventListener('orientationchange', updateAppUnits);
    // 자동 저장 (3초마다, 실행 중일 때만)
    setInterval(saveGame, 3000);
    // 페이지가 닫히기 직전에도 한 번 저장
    window.addEventListener('beforeunload', saveGame);
    // 탭이 다시 보일 때 시간 기준 리셋 (큰 갭 방지)
    document.addEventListener('visibilitychange', function () {
      state.lastActiveTickAt = 0;
      // 탭이 숨겨지면 BGM 정지, 다시 보이면 (게임 진행 중일 때만) 재개
      if (document.visibilityState === 'visible') {
        if (state.running && !state.paused) tryStartBGM();
      } else {
        stopBGM();
      }
    });
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
