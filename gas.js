/* ===================================================================
   gas.js — 랭킹(리더보드) 모듈 + 정렬/검색 지원
   ───────────────────────────────────────────────────────────────────
   · 아래 [SERVER CODE] 블록을 Google Apps Script(script.google.com)에
     Code.gs 로 붙여넣고 "웹 앱"으로 배포하세요.
   · 시트 헤더(1행)는 다음 8개 컬럼 순서로 만들어 두세요:
     nickname | score | round | maxCombo | correctCount | totalCount
              | accuracy | maxCatLevel | timestamp
   · 배포 후 받은 URL 을 이 파일의 GAS_URL 에 입력하면 온라인 랭킹이
     동작합니다. URL 이 비어 있으면 자동으로 브라우저 localStorage 에
     저장하는 오프라인 모드로 동작합니다(미리보기/테스트용).
   ===================================================================

   ┌─────────────────────────[ SERVER CODE ]──────────────────────────┐
   │  // === Google Apps Script — Code.gs ===                          │
   │  // 시트 1행 헤더:                                                 │
   │  // nickname | score | round | maxCombo | correctCount |          │
   │  // totalCount | accuracy | maxCatLevel | timestamp               │
   │                                                                   │
   │  var SORT_FIELDS = ['score','round','maxCombo','correctCount',    │
   │                     'maxCatLevel','totalCount','accuracy'];       │
   │                                                                   │
   │  function readAll() {                                             │
   │    var rows = getSheet().getDataRange().getValues();              │
   │    rows.shift(); // 헤더 제거                                      │
   │    return rows.map(function (r) {                                 │
   │      return {                                                     │
   │        nickname: String(r[0]),                                    │
   │        score: Number(r[1]),                                       │
   │        round: Number(r[2]),                                       │
   │        maxCombo: Number(r[3]),                                    │
   │        correctCount: Number(r[4]),                                │
   │        totalCount: Number(r[5]),                                  │
   │        accuracy: Number(r[6]),                                    │
   │        maxCatLevel: Number(r[7]) || 0                             │
   │      };                                                           │
   │    });                                                            │
   │  }                                                                │
   │                                                                   │
   │  function sortBy(list, field, order) {                            │
   │    if (SORT_FIELDS.indexOf(field) < 0) field = 'score';           │
   │    var dir = order === 'asc' ? 1 : -1;                            │
   │    return list.slice().sort(function (a, b) {                     │
   │      var av = Number(a[field]) || 0, bv = Number(b[field]) || 0;  │
   │      if (av !== bv) return dir * (av - bv);                       │
   │      return (b.score || 0) - (a.score || 0); // 동점 시 점수 우선  │
   │    });                                                            │
   │  }                                                                │
   │                                                                   │
   │  function doGet(e) {                                              │
   │    var p = (e && e.parameter) || {};                              │
   │    var field = p.sort || 'score';                                 │
   │    var order = p.order === 'asc' ? 'asc' : 'desc';                │
   │    var list = sortBy(readAll(), field, order);                    │
   │                                                                   │
   │    if (p.search) {                                                │
   │      var q = String(p.search).toLowerCase();                      │
   │      var results = [];                                            │
   │      for (var i = 0; i < list.length; i++) {                      │
   │        if (String(list[i].nickname).toLowerCase().indexOf(q) >= 0)│
   │        {                                                          │
   │          var r = Object.assign({}, list[i]);                      │
   │          r.rank = i + 1;                                          │
   │          results.push(r);                                         │
   │        }                                                          │
   │      }                                                            │
   │      return json({ ok: true, results: results,                    │
   │                    total: list.length, sort: field, order: order });│
   │    }                                                              │
   │                                                                   │
   │    var limit = Math.min(100, Number(p.limit) || 100);             │
   │    return json({ ok: true, list: list.slice(0, limit),            │
   │                  total: list.length, sort: field, order: order });│
   │  }                                                                │
   │                                                                   │
   │  function doPost(e) {                                             │
   │    var entry;                                                     │
   │    try { entry = JSON.parse(e.postData.contents); }               │
   │    catch (err) { return json({ ok: false, reason: '형식 오류' }); }│
   │    var v = validateScoreEntry(entry);                             │
   │    if (!v.ok) return json(v);                                     │
   │    getSheet().appendRow([                                         │
   │      entry.nickname, entry.score, entry.round, entry.maxCombo,    │
   │      entry.correctCount, entry.totalCount, entry.accuracy,        │
   │      entry.maxCatLevel || 0, new Date()                           │
   │    ]);                                                            │
   │    return json({ ok: true });                                     │
   │  }                                                                │
   │                                                                   │
   │  function getSheet() {                                            │
   │    return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];   │
   │  }                                                                │
   │  function json(obj) {                                             │
   │    return ContentService                                          │
   │      .createTextOutput(JSON.stringify(obj))                       │
   │      .setMimeType(ContentService.MimeType.JSON);                  │
   │  }                                                                │
   │                                                                   │
   │  // validateScoreEntry 함수는 이 파일 하단의 클라이언트 함수와     │
   │  // 동일하게 작성해 Code.gs 에 함께 붙여 넣으세요.                 │
   └───────────────────────────────────────────────────────────────────┘
*/

/* =====================  설정  ===================== */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzPE7Wm4P5WI2ZDWOGYd_uOYMEsAFgq6pm1Dgt1mw91sjKOCn8dIRv1n0iNE4wrwuoI/exec';   // 배포한 GAS 웹앱 URL 입력. 비우면 localStorage 오프라인 모드.
const LOCAL_KEY = 'fraction_cat_ranking';
const SORT_FIELDS = ['score', 'round', 'maxCombo', 'correctCount',
                     'maxCatLevel', 'totalCount', 'accuracy',
                     'playTime', 'clearTime'];

/* =====================  치트 방지 검증  =====================
   불가능한 고득점/모순된 기록을 거른다(느슨한 검증). */
function validateScoreEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return { ok: false, reason: '잘못된 기록입니다.' };
  }
  const nick = String(entry.nickname || '').trim();
  const score = Number(entry.score);
  const round = Number(entry.round);
  const maxCombo = Number(entry.maxCombo);
  const correct = Number(entry.correctCount);
  const total = Number(entry.totalCount);
  const acc = Number(entry.accuracy);
  const maxCat = Number(entry.maxCatLevel);

  if (!nick || nick.length > 10) {
    return { ok: false, reason: '닉네임을 확인해주세요.' };
  }
  const nums = [score, round, maxCombo, correct, total, acc, maxCat];
  for (let i = 0; i < nums.length; i++) {
    if (!Number.isFinite(nums[i]) || nums[i] < 0) {
      return { ok: false, reason: '기록 값이 올바르지 않습니다.' };
    }
  }
  if (maxCat > 11) {
    return { ok: false, reason: '최고 고양이 단계가 올바르지 않습니다.' };
  }
  const pt = Number(entry.playTime), ct = Number(entry.clearTime);
  if (!Number.isFinite(pt) || pt < 0 || pt > 1000 * 60 * 60 * 12) {
    return { ok: false, reason: '플레이 시간이 올바르지 않습니다.' };
  }
  if (!Number.isFinite(ct) || ct < 0 || ct > pt) {
    return { ok: false, reason: '클리어 시간이 올바르지 않습니다.' };
  }
  if (correct > total) {
    return { ok: false, reason: '정답수가 총문제수보다 많습니다.' };
  }
  if (maxCombo > correct) {
    return { ok: false, reason: '콤보 기록이 정답수보다 많습니다.' };
  }
  // 점수 상한선: 정답 1개당 최대치 × 콤보 배수 + 넉넉한 여유
  const perCorrectMax = 50 + 10 * 30 + 12 * 20;
  const comboMax = 1 + Math.max(0, correct) * 0.25;
  const ceiling = perCorrectMax * comboMax * Math.max(1, correct) * 1.5 + 5000;
  if (score > ceiling) {
    return { ok: false, reason: '점수가 비정상적으로 높습니다.' };
  }
  return { ok: true };
}

/* =====================  리더보드 모듈  ===================== */
const Leaderboard = {
  online: !!GAS_URL,

  /** 정렬·필터 옵션을 객체로 받음 — { sort, order, minTotal, minMaxCat } */
  async fetchTop(params, limit) {
    const opts = this._normParams(params);
    limit = Math.min(100, Math.max(1, Number(limit) || 100));

    if (GAS_URL) {
      try {
        const url = GAS_URL + this._queryString(opts) + '&limit=' + limit;
        const res = await fetch(url, { method: 'GET', redirect: 'follow' });
        const data = await res.json();
        if (data && data.ok && Array.isArray(data.list)) return data.list;
      } catch (e) {
        console.warn('랭킹 조회 실패, 오프라인 기록을 사용합니다.', e);
      }
    }
    return this._localFiltered(opts).slice(0, limit);
  },

  /** 닉네임 검색 — 정렬 기준 + 필터를 모두 반영, 100위 밖도 포함 */
  async search(nickname, params) {
    const q = String(nickname || '').trim();
    if (!q) return [];
    const opts = this._normParams(params);

    if (GAS_URL) {
      try {
        const url = GAS_URL + this._queryString(opts) +
          '&search=' + encodeURIComponent(q);
        const res = await fetch(url, { method: 'GET', redirect: 'follow' });
        const data = await res.json();
        if (data && data.ok && Array.isArray(data.results)) return data.results;
      } catch (e) {
        console.warn('검색 실패, 오프라인 기록에서 찾습니다.', e);
      }
    }
    const list = this._localFiltered(opts);
    const ql = q.toLowerCase();
    return list
      .map((e, i) => Object.assign({}, e, { rank: i + 1 }))
      .filter((e) => String(e.nickname || '').toLowerCase().includes(ql));
  },

  _normParams(p) {
    p = p || {};
    return {
      sort: SORT_FIELDS.includes(p.sort) ? p.sort : 'score',
      order: p.order === 'asc' ? 'asc' : 'desc',
      minTotal: Number(p.minTotal) > 0 ? Number(p.minTotal) : 0,
      minMaxCat: Number(p.minMaxCat) > 0 ? Number(p.minMaxCat) : 0,
    };
  },
  _queryString(o) {
    let q = '?sort=' + encodeURIComponent(o.sort) +
            '&order=' + encodeURIComponent(o.order);
    if (o.minTotal) q += '&minTotal=' + o.minTotal;
    if (o.minMaxCat) q += '&minMaxCat=' + o.minMaxCat;
    return q;
  },

  /** 점수 등록 → { ok, reason? } */
  async submit(entry) {
    const v = validateScoreEntry(entry);
    if (!v.ok) return v;
    if (GAS_URL) {
      try {
        await fetch(GAS_URL, {
          method: 'POST',
          redirect: 'follow',
          body: JSON.stringify(entry),
        });
        return { ok: true };
      } catch (e) {
        console.warn('온라인 등록 실패, 오프라인에 저장합니다.', e);
      }
    }
    this._localSave(entry);
    return { ok: true, offline: true };
  },

  /* ---- localStorage 오프라인 모드 ---- */
  _localList() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); }
    catch (e) { return []; }
  },
  _localSorted(field, order) {
    const list = this._localList();
    const dir = order === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const av = Number(a[field]) || 0, bv = Number(b[field]) || 0;
      if (av !== bv) return dir * (av - bv);
      return (Number(b.score) || 0) - (Number(a.score) || 0);
    });
  },
  _localFiltered(opts) {
    let list = this._localSorted(opts.sort, opts.order);
    if (opts.minTotal) list = list.filter((r) => (Number(r.totalCount) || 0) >= opts.minTotal);
    if (opts.minMaxCat) list = list.filter((r) => (Number(r.maxCatLevel) || 0) >= opts.minMaxCat);
    // 빠른 클리어 정렬 시 clearTime=0(미달성)은 제외
    if (opts.sort === 'clearTime') list = list.filter((r) => Number(r.clearTime) > 0);
    return list;
  },
  _localSave(entry) {
    const list = this._localList();
    list.push({
      nickname: entry.nickname, score: entry.score, round: entry.round,
      maxCombo: entry.maxCombo, correctCount: entry.correctCount,
      totalCount: entry.totalCount, accuracy: entry.accuracy,
      maxCatLevel: entry.maxCatLevel || 0,
      playTime: entry.playTime || 0,
      clearTime: entry.clearTime || 0,
    });
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, 500))); }
    catch (e) { console.warn('오프라인 저장 실패', e); }
  },
};
