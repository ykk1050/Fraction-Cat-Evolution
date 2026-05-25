/* ===================================================================
   math.js — 분수 연산 · 문제 생성 · 기약분수 검증
   (한국 초등 5학년: 분수의 덧셈과 뺄셈)
   =================================================================== */

/* ---------- 기본 수학 도우미 ---------- */
function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a || 1;
}
function lcm(a, b) {
  return Math.abs(a * b) / gcd(a, b);
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

/* ---------- 분수 클래스 ---------- */
class Fraction {
  constructor(n, d) {
    if (d === 0) d = 1;
    if (d < 0) { n = -n; d = -d; }   // 부호는 분자로
    this.n = n;
    this.d = d;
  }
  /** 약분된 새 분수 반환 */
  reduced() {
    const g = gcd(this.n, this.d);
    return new Fraction(this.n / g, this.d / g);
  }
  /** 더 이상 약분되지 않는가(기약분수인가) */
  isIrreducible() {
    return gcd(this.n, this.d) === 1;
  }
  /** 값이 같은가 (교차곱 비교) */
  equals(other) {
    return this.n * other.d === other.n * this.d;
  }
  value() { return this.n / this.d; }

  static add(a, b) { return new Fraction(a.n * b.d + b.n * a.d, a.d * b.d); }
  static sub(a, b) { return new Fraction(a.n * b.d - b.n * a.d, a.d * b.d); }
}

/* ---------- 난이도별 설정 (1~10단계) ---------- */
// 모든 난이도에서 덧셈·뺄셈이 무작위로 출제되도록 ops 는 ['+', '-'] 로 통일
const DIFFICULTY = {
  1:  { denoms: [2, 3, 4, 5],             mode: 'related', ops: ['+', '-'] },
  2:  { denoms: [2, 3, 4, 5, 6],          mode: 'related', ops: ['+', '-'] },
  3:  { denoms: [2, 3, 4, 6],             mode: 'related', ops: ['+', '-'] },
  4:  { denoms: [2, 3, 4, 5, 6],          mode: 'related', ops: ['+', '-'] },
  5:  { denoms: [2, 3, 4, 5, 6],          mode: 'diff',    ops: ['+', '-'] },
  6:  { denoms: [2, 3, 4, 5, 6, 8, 9],    mode: 'diff',    ops: ['+', '-'] },
  7:  { denoms: [3, 4, 5, 6, 8, 9, 12],   mode: 'diff',    ops: ['+', '-'], improper: true },
  8:  { denoms: [4, 5, 6, 8, 9, 10, 12],  mode: 'diff',    ops: ['+', '-'], improper: true },
  9:  { denoms: [5, 6, 8, 9, 10, 12, 15], mode: 'diff',    ops: ['+', '-'], improper: true },
  10: { denoms: [6, 8, 9, 10, 12, 15, 16],mode: 'diff',    ops: ['+', '-'], improper: true },
};

/** 분모에 맞는 분수 1개 생성 (난이도가 높으면 가분수도 가끔 허용) */
function makeFraction(denom, allowImproper) {
  let maxN = denom - 1;
  if (allowImproper && Math.random() < 0.35) {
    maxN = denom + Math.floor(denom / 2);
  }
  return new Fraction(randInt(1, Math.max(1, maxN)), denom);
}

/**
 * 난이도(1~10)에 맞는 분수 문제 1개 생성.
 * 반환: { op, a, b, answer(기약분수), denomLCM }
 */
function generateProblem(difficulty) {
  difficulty = Math.min(10, Math.max(1, difficulty | 0));
  const cfg = DIFFICULTY[difficulty];
  const op = pick(cfg.ops);

  let d1, d2;
  if (cfg.mode === 'related') {
    // 한 분모가 다른 분모의 배수 (예: 1/2 + 1/4) — 서로 다른 분모
    d1 = pick(cfg.denoms);
    d2 = d1 * pick([2, 3]);
    if (Math.random() < 0.5) { const t = d1; d1 = d2; d2 = t; }
  } else {
    d1 = pick(cfg.denoms);
    let guard = 0;
    do { d2 = pick(cfg.denoms); guard++; } while (d2 === d1 && guard < 12);
  }
  // 분모는 항상 서로 다르게
  if (d1 === d2) return generateProblem(difficulty);

  let a = makeFraction(d1, cfg.improper);
  let b = makeFraction(d2, cfg.improper);

  let answer;
  if (op === '+') {
    answer = Fraction.add(a, b);
  } else {
    if (a.value() < b.value()) { const t = a; a = b; b = t; } // a >= b 보장
    answer = Fraction.sub(a, b);
  }

  // 정답이 0이면 다시 생성
  if (answer.n === 0) return generateProblem(difficulty);

  return {
    op: op,
    a: a,
    b: b,
    answer: answer.reduced(),
    denomLCM: lcm(a.d, b.d),
    difficulty: difficulty,
  };
}

/**
 * 사용자가 입력한 답 채점. 자연수 칸(대분수)도 지원.
 * 인자: 자연수, 분자, 분모 (각각 빈칸이면 '' 또는 null)
 * 반환 status: 'invalid' | 'wrong' | 'not_reduced' | 'correct'
 *
 *  · 분수(가분수 포함):  자연수 비움 + 분자/분모
 *  · 대분수:             자연수 + 분자/분모
 *  · 자연수(정수):       자연수만 입력
 */
function checkAnswer(wholeRaw, numerRaw, denomRaw, problem) {
  const norm = (v) =>
    (v === '' || v === null || v === undefined) ? null : Number(v);
  const w = norm(wholeRaw), n = norm(numerRaw), d = norm(denomRaw);

  if (w === null && n === null && d === null) {
    return { status: 'invalid', message: '답을 입력해주세요.' };
  }
  if (n !== null && d === null) {
    return { status: 'invalid', message: '분모도 입력해주세요.' };
  }
  if (d !== null && d === 0) {
    return { status: 'invalid', message: '분모는 0이 될 수 없어요.' };
  }
  for (const x of [w, n, d]) {
    if (x !== null && (!Number.isFinite(x) || x < 0)) {
      return { status: 'invalid', message: '올바른 수를 입력해주세요.' };
    }
  }

  const whole = w || 0;
  const hasFrac = d !== null;          // 분모가 있으면 분수부 존재
  const numer = n || 0;
  const denom = hasFrac ? d : 1;

  const user = hasFrac
    ? new Fraction(whole * denom + numer, denom)
    : new Fraction(whole, 1);

  if (!user.equals(problem.answer)) {
    return { status: 'wrong', message: '아쉬워요! 다시 한 번 풀어볼까요?' };
  }
  // 기약분수 검사: 분수부가 있으면 분자/분모가 더 약분되면 안 됨
  if (hasFrac && numer > 0 && gcd(numer, denom) !== 1) {
    return { status: 'not_reduced', message: '기약분수로 입력해주세요!' };
  }
  return { status: 'correct', message: '정답이에요! 고양이가 진화해요!' };
}

/* ---------- 화면 표시용 마크업 ---------- */
function fractionHTML(f) {
  if (f.d === 1) return `<span class="fr-whole">${f.n}</span>`;
  return `<span class="fr"><span class="fr-n">${f.n}</span>` +
         `<span class="fr-d">${f.d}</span></span>`;
}
function problemHTML(p) {
  return `${fractionHTML(p.a)}` +
         `<span class="fr-op">${p.op}</span>` +
         `${fractionHTML(p.b)}` +
         `<span class="fr-op">=</span>` +
         `<span class="fr-q">?</span>`;
}
