/* ===================================================================
   분수 고양이 진화 — Google Apps Script 서버 코드
   ↑ 이 파일 전체를 Apps Script Code.gs 에 붙여넣고 "웹 앱"으로 배포
   =================================================================== */

const SORT_FIELDS = ['score', 'round', 'maxCombo', 'correctCount',
                     'maxCatLevel', 'totalCount', 'accuracy',
                     'playTime', 'clearTime'];

function getSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function readAll() {
  const rows = getSheet().getDataRange().getValues();
  rows.shift(); // 헤더 제거
  return rows.map(function (r) {
    return {
      nickname: String(r[0] || ''),
      score: Number(r[1]) || 0,
      round: Number(r[2]) || 0,
      maxCombo: Number(r[3]) || 0,
      correctCount: Number(r[4]) || 0,
      totalCount: Number(r[5]) || 0,
      accuracy: Number(r[6]) || 0,
      maxCatLevel: Number(r[7]) || 0,
      playTime: Number(r[8]) || 0,
      clearTime: Number(r[9]) || 0
    };
  }).filter(function (r) { return r.nickname; });
}

function sortBy(list, field, order) {
  if (SORT_FIELDS.indexOf(field) < 0) field = 'score';
  const dir = order === 'asc' ? 1 : -1;
  return list.slice().sort(function (a, b) {
    const av = Number(a[field]) || 0;
    const bv = Number(b[field]) || 0;
    if (av !== bv) return dir * (av - bv);
    return (Number(b.score) || 0) - (Number(a.score) || 0); // 동점 시 점수 우선
  });
}

/* GET: ?sort=<field>&order=<asc|desc>&limit=100
        ?search=<nickname>&sort=...&order=...           */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const field = p.sort || 'score';
  const order = p.order === 'asc' ? 'asc' : 'desc';
  let list = readAll();
  // 필터
  const minTotal = Number(p.minTotal);
  if (isFinite(minTotal) && minTotal > 0) {
    list = list.filter(function (r) { return r.totalCount >= minTotal; });
  }
  const minMaxCat = Number(p.minMaxCat);
  if (isFinite(minMaxCat) && minMaxCat > 0) {
    list = list.filter(function (r) { return r.maxCatLevel >= minMaxCat; });
  }
  // 빠른 클리어 정렬 시 미달성(clearTime=0) 자동 제외
  if (field === 'clearTime') {
    list = list.filter(function (r) { return r.clearTime > 0; });
  }
  list = sortBy(list, field, order);

  if (p.search) {
    const q = String(p.search).toLowerCase();
    const results = [];
    for (let i = 0; i < list.length; i++) {
      if (String(list[i].nickname).toLowerCase().indexOf(q) >= 0) {
        const r = Object.assign({}, list[i]);
        r.rank = i + 1;
        results.push(r);
      }
    }
    return json({ ok: true, results: results, total: list.length,
                  sort: field, order: order });
  }

  const limit = Math.min(100, Number(p.limit) || 100);
  return json({ ok: true, list: list.slice(0, limit),
                total: list.length, sort: field, order: order });
}

/* POST: 점수 등록 (브라우저에서 JSON 본문 전송) */
function doPost(e) {
  let entry;
  try { entry = JSON.parse(e.postData.contents); }
  catch (err) { return json({ ok: false, reason: '형식 오류' }); }

  const v = validateScoreEntry(entry);
  if (!v.ok) return json(v);

  getSheet().appendRow([
    entry.nickname, entry.score, entry.round, entry.maxCombo,
    entry.correctCount, entry.totalCount, entry.accuracy,
    entry.maxCatLevel || 0,
    entry.playTime || 0, entry.clearTime || 0,
    new Date()
  ]);
  return json({ ok: true });
}

/* 치트 방지 검증 — 클라이언트(gas.js)와 동일 */
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
    if (!isFinite(nums[i]) || nums[i] < 0) {
      return { ok: false, reason: '기록 값이 올바르지 않습니다.' };
    }
  }
  if (maxCat > 11) {
    return { ok: false, reason: '최고 고양이 단계가 올바르지 않습니다.' };
  }
  const pt = Number(entry.playTime), ct = Number(entry.clearTime);
  if (!isFinite(pt) || pt < 0 || pt > 1000 * 60 * 60 * 12) {
    return { ok: false, reason: '플레이 시간이 올바르지 않습니다.' };
  }
  if (!isFinite(ct) || ct < 0 || ct > pt) {
    return { ok: false, reason: '클리어 시간이 올바르지 않습니다.' };
  }
  if (correct > total) {
    return { ok: false, reason: '정답수가 총문제수보다 많습니다.' };
  }
  if (maxCombo > correct) {
    return { ok: false, reason: '콤보 기록이 정답수보다 많습니다.' };
  }
  const perCorrectMax = 50 + 10 * 30 + 12 * 20;
  const comboMax = 1 + Math.max(0, correct) * 0.25;
  const ceiling = perCorrectMax * comboMax * Math.max(1, correct) * 1.5 + 5000;
  if (score > ceiling) {
    return { ok: false, reason: '점수가 비정상적으로 높습니다.' };
  }
  return { ok: true };
}
