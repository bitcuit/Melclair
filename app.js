'use strict';

const BASE_FONT = '"Noto Sans KR", "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif';
let FONT = BASE_FONT;
let LFONT = BASE_FONT;   // 가사 글꼴(따로 안 고르면 FONT와 같음)
const FADE = 0.35;          // 이미지·가사 전환에 걸리는 초
const CD_TURN = 4;          // CD 한 바퀴 대략 몇 초 (루프가 끊기지 않게 정수 바퀴로 맞춤)
const ENV_RATE = 50;        // 소리 크기를 1초에 몇 번 재 두는지
const GIF_MAX_FRAMES = 350; // 트위터 GIF 한도
const GIF_MAX_MB = 15;
const MP4_FPS = 30;
const STORE = 'spincard:v1';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const ctx = stage.getContext('2d');

const state = {
  mode: 'player',
  bgMode: 'blur',
  images: [],        // { url, img, cache }
  audio: null,       // { name, buf, peaks, env, a, b }
  playing: true,
  t: 0,
  busy: false,       // 저장 중
  cancel: false,
  tap: null,         // 박자 찍기 중이면 { texts, stamps }
  fx: 'fade',        // 가사 효과
  imgTrans: 'fade',  // 이미지가 바뀔 때
  glow: 'soft',      // 주변 빛: off | soft | vivid
  lyStyle: { player: 'none', cd: 'none', yt: 'box' },  // 가사 스타일(모양마다): none | box | stroke | glow
  lyCustom: false,   // 가사 색을 직접 골랐는지(아니면 배경에 맞춘 기본 색)
  capPos: { dx: 0, dy: 0 },  // 동영상 자막 자리(옮긴 만큼, u 단위)
  imgMode: 'sec',    // 이미지 바꾸는 때: sec(초마다) | lyric(가사 따라)
  // 글자 정렬. 모양마다, 묶음(제목·가사)마다 따로
  align: { player: { title: 'left', lyric: 'left' }, cd: { title: 'center', lyric: 'center' }, yt: { title: 'center', lyric: 'center' } },
  stickers: [],
  unit: 'line',      // 이미지 저장 단위
};
// 이미지 저장용 한 장을 그릴 때만 채운다: { img, items }
let still = null;

// ---------- 설정 저장 (텍스트만) ----------
const FIELDS = ['title', 'artist', 'lyrics', 'lineSec', 'shift', 'imgSec', 'bgColor', 'size', 'fps', 'gmap', 'gmA', 'gmB', 'font', 'glowAmt', 'chName', 'subs', 'likes', 'vTitle', 'glowSpread', 'discAngle', 'lyFont', 'lyColor', 'pronColor', 'transColor', 'fxColor'];
function settingsObj() {
  const o = { mode: state.mode, bgMode: state.bgMode, fx: state.fx, glow: state.glow, imgGlitch: $('imgGlitch').checked, notes, imgTrans: state.imgTrans, imgMode: state.imgMode,
      bokeh: $('bokeh').checked, gMain: $('gMain').checked, gPron: $('gPron').checked, gTrans: $('gTrans').checked,
      align: state.align, nextLine: $('nextLine').checked, prevLine: $('prevLine').checked, beatSync: $('beatSync').checked, spin: $('spin').checked, ytDark: $('ytDark').checked,
      lyStyle: state.lyStyle, lyCustom: state.lyCustom, capPos: state.capPos, gapCalc: $('gapCalc').checked };
  for (const f of FIELDS) o[f] = $(f).value;
  return o;
}
function saveSettings() {
  try {
    localStorage.setItem(STORE, JSON.stringify(settingsObj()));
  } catch (e) {}
}
function loadSettings() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!o) return;
    for (const f of FIELDS) if (o[f] != null) $(f).value = o[f];
    if (o.mode) setSeg('mode', o.mode);
    if (o.bgMode) setSeg('bgMode', o.bgMode);
    if (o.fx) setSeg('fx', o.fx);
    // 예전 저장값(켬/끔 체크)도 읽는다
    if (o.glow) setSeg('glow', o.glow);
    else if (o.glowOn === false) setSeg('glow', 'off');
    if (o.imgGlitch != null) $('imgGlitch').checked = o.imgGlitch;
    if (o.imgTrans) setSeg('imgTrans', o.imgTrans);
    if (o.lyStyle) Object.assign(state.lyStyle, o.lyStyle);
    if (o.lyCustom != null) state.lyCustom = o.lyCustom;
    if (o.capPos) Object.assign(state.capPos, o.capPos);
    if (o.imgMode) setSeg('imgMode', o.imgMode);
    for (const id of ['bokeh', 'gMain', 'gPron', 'gTrans', 'nextLine', 'prevLine', 'beatSync', 'spin', 'ytDark', 'gapCalc']) if (o[id] != null) $(id).checked = o[id];
    // 예전 저장값(모양마다 정렬 하나)은 두 묶음에 같이 넣는다
    if (o.align) for (const m of ['player', 'cd', 'yt']) {
      const v = o.align[m];
      if (typeof v === 'string') state.align[m] = { title: v, lyric: v };
      else if (v) Object.assign(state.align[m], v);
    }
    if (o.notes) Object.assign(notes, o.notes);
  } catch (e) {}
}

function setSeg(id, v) {
  for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
  state[id] = v;
}

function num(id, fallback) {
  const v = parseFloat($(id).value);
  return v > 0 ? v : fallback;
}

// ---------- 시간 표기 ----------
function fmt(s) {
  s = Math.max(0, Math.floor(s + 1e-6));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function fmtTenth(s) {
  const whole = Math.floor(s);
  return fmt(whole) + '.' + Math.floor((s - whole) * 10 + 1e-6);
}
function fmtLrc(s) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `[${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}]`;
}
// "1:23.4" 또는 "83.4"
function parseTime(str) {
  const m = String(str).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  return (m[1] ? parseInt(m[1], 10) * 60 : 0) + parseFloat(m[2]);
}

// ---------- 가사 ----------
// 시간표([mm:ss.xx])가 붙은 줄이 하나라도 있으면 노래 시간 기준, 아니면 한 줄당 N초씩.
function parseLyrics() {
  const rows = $('lyrics').value.split('\n');
  const stamp = /^\s*\[(\d+):(\d+(?:\.\d+)?)\]/;
  // para: 문단 번호. 빈 줄(또는 글자 없는 시간표 줄)에서 다음 문단으로 넘어간다
  if (rows.some((r) => stamp.test(r))) {
    const lines = [];
    let para = 0;
    for (const raw of rows) {
      let s = raw, times = [], m;
      while ((m = s.match(stamp))) {
        times.push(parseInt(m[1], 10) * 60 + parseFloat(m[2]));
        s = s.slice(m[0].length);
      }
      if (!s.trim()) para++;
      for (const start of times) lines.push({ text: s.trim(), start, para });
    }
    lines.sort((x, y) => x.start - y.start);
    // 반주·빈 구간 계산: 줄 길이를 글자 수로 어림해서, 다음 줄까지 틈이 크면 그 사이는 비운다
    const gap = $('gapCalc').checked;
    lines.forEach((l, i) => {
      const next = i + 1 < lines.length ? lines[i + 1].start : null;
      if (!gap || !l.text) { l.end = next != null ? next : l.start + num('lineSec', 3); return; }
      const est = Math.max(2.5, Math.min(8, 1.2 + [...l.text].length * 0.32));
      if (next == null) l.end = l.start + est;
      else l.end = next - (l.start + est) > 1.5 ? l.start + est : next;
    });
    return { timed: true, lines };
  }
  const base = num('lineSec', 3);
  const lines = [];
  let at = 0, para = 0;
  for (const raw of rows) {
    const s = raw.trim();
    if (!s) { para++; continue; }
    const m = s.match(/^\[(\d+(?:\.\d+)?)\]\s*(.*)$/);
    const dur = m && parseFloat(m[1]) > 0 ? parseFloat(m[1]) : base;
    lines.push({ text: m ? m[2] : s, start: at, end: at + dur, para });
    at += dur;
  }
  return { timed: false, lines };
}

// 줄별 발음·번역. 가사 글자를 열쇠로 둬서 박자를 다시 찍어도 남는다
const notes = {};
function noteOf(text) {
  const n = notes[text];
  return { pron: (n && n.p) || '', trans: (n && n.tr) || '', gl: !!(n && n.gl) };
}

// 미리보기·저장의 t(0~길이)를 노래 시각으로 바꿀 때 더하는 값
function songBase(lyr = parseLyrics()) {
  if (state.audio) return state.audio.a;
  if (lyr.timed && lyr.lines.length) return lyr.lines[0].start;
  return 0;
}

function duration() {
  if (state.audio) return Math.max(0.5, state.audio.b - state.audio.a);
  const lyr = parseLyrics();
  if (lyr.lines.length) {
    const last = lyr.lines[lyr.lines.length - 1];
    return Math.max(0.5, last.end - songBase(lyr));
  }
  const n = Math.max(state.images.length, 1);
  const total = state.images.reduce((a, it) => a + imgSecOf(it), 0);
  return Math.max(total || n * num('imgSec', 3), 3);
}

function lyricAt(t) {
  const lyr = parseLyrics();
  const shift = parseFloat($('shift').value) || 0;
  const at = (lyr.timed ? songBase(lyr) : 0) + t - shift;
  for (let i = 0; i < lyr.lines.length; i++) {
    const l = lyr.lines[i];
    if (at >= l.start && at < l.end) {
      const dur = l.end - l.start;
      const fade = Math.min(FADE, dur / 3);
      const alpha = state.fx === 'none' ? 1 : Math.min(1, (at - l.start) / fade, (l.end - at) / fade);
      const nx = lyr.lines.slice(i + 1).find((x) => x.text);
      const pv = lyr.lines.slice(0, i).reverse().find((x) => x.text);
      return { text: l.text, alpha: Math.max(0, alpha), since: at - l.start, at, next: nx ? nx.text : '', prev: pv ? pv.text : '', ...noteOf(l.text) };
    }
  }
  return null;
}

// ---------- 이미지 ----------
function addFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  // 고른 순서를 지키도록 다 읽은 뒤 한꺼번에 넣는다
  return Promise.all(list.map((f) => new Promise((resolve) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => resolve({ url, img, cache: {} });
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  }))).then((items) => {
    state.images.push(...items.filter(Boolean));
    renderThumbs();
  });
}

function renderThumbs() {
  const box = $('thumbs');
  box.innerHTML = '';
  state.images.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    const im = document.createElement('img');
    im.src = it.url;
    im.alt = '';
    const x = document.createElement('button');
    x.textContent = '×';
    x.setAttribute('aria-label', '이미지 빼기');
    x.onclick = () => {
      URL.revokeObjectURL(it.url);
      state.images.splice(i, 1);
      renderThumbs();
    };
    const n = document.createElement('span');
    n.className = 'num';
    n.textContent = i + 1;
    im.draggable = false;
    // 끌어서 순서 바꾸기: 놓은 칸의 왼쪽 절반이면 그 앞, 오른쪽 절반이면 그 뒤로
    d.draggable = true;
    d.addEventListener('dragstart', (e) => {
      thumbFrom = i;
      d.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    });
    d.addEventListener('dragend', () => {
      thumbFrom = -1;
      for (const el of box.querySelectorAll('.thumb')) el.classList.remove('dragging', 'before', 'after');
    });
    d.addEventListener('dragover', (e) => {
      if (thumbFrom < 0) return;
      e.preventDefault();
      const r = d.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      for (const el of box.querySelectorAll('.thumb')) el.classList.remove('before', 'after');
      if (i !== thumbFrom) d.classList.add(after ? 'after' : 'before');
    });
    d.addEventListener('drop', (e) => {
      if (thumbFrom < 0) return;
      e.preventDefault();
      const r = d.getBoundingClientRect();
      let to = e.clientX > r.left + r.width / 2 ? i + 1 : i;
      const [moved] = state.images.splice(thumbFrom, 1);
      if (thumbFrom < to) to--;
      state.images.splice(to, 0, moved);
      thumbFrom = -1;
      renderThumbs();
    });
    d.append(im, x, n);
    const cell = document.createElement('div');
    cell.className = 'thumb-cell';
    const sec = document.createElement('input');
    sec.type = 'number';
    sec.min = '0.5';
    sec.step = '0.5';
    sec.className = 'thumb-sec';
    sec.setAttribute('aria-label', `${i + 1}번 이미지 초`);
    // 초마다 모드와 가사 따라 모드의 값은 따로 기억한다
    sec.addEventListener('input', () => {
      const v = parseFloat(sec.value);
      it[state.imgMode === 'lyric' ? 'lsec' : 'sec'] = v > 0 ? v : undefined;
      updateInfo();
    });
    const secWrap = document.createElement('div');
    secWrap.className = 'sec-wrap';
    const unit = document.createElement('span');
    unit.textContent = '초';
    secWrap.append(sec, unit);
    cell.append(d, secWrap);
    box.append(cell);
  });
  syncImgMode();
  updateInfo();
}
let thumbFrom = -1;

// 지금 시각에 보일 이미지와 다음 이미지로 넘어가는 정도(0~1)
// 이미지마다 정한 초. 비워 두면 기본값
function imgSecOf(it) {
  return it.sec > 0 ? it.sec : num('imgSec', 3);
}

// 이미지가 보이는 구간표 { segs: [{ start, end, it }], period }. t를 period로 나눈 나머지로 찾는다
let schedCache = { key: '', val: null };
function imageSchedule() {
  const imgs = state.images;
  const au = state.audio;
  const key = [state.imgMode, $('imgSec').value, $('lineSec').value, $('shift').value, imgs.length,
    imgs.map((i) => (i.sec || '') + '/' + (i.lsec || '')).join(','), au ? au.a + ',' + au.b : '', $('lyrics').value].join('|');
  // 이미지 순서가 바뀌어도 다시 만든다
  if (schedCache.key === key && schedCache.order === imgs.map((i) => i.url).join()) return schedCache.val;

  let val = null;
  if (state.imgMode === 'lyric') val = lyricSchedule();
  if (!val) {
    // 초마다: 이미지마다 정한 초를 이어 붙여 한 바퀴
    const segs = [];
    let at = 0;
    for (const it of imgs) { const d = imgSecOf(it); segs.push({ start: at, end: at + d, it }); at += d; }
    val = { segs, period: at };
  }
  schedCache = { key, order: imgs.map((i) => i.url).join(), val };
  return val;
}

// 가사 따라: 줄이 바뀔 때 이미지가 바뀐다. 이미지마다 한 번씩 나온다.
// 줄이 많으면 줄을 고르게 묶고, 적으면 한 줄을 정수 초로 나눠 여러 장을 넣고
// 남는 시간(소수점 포함)은 그 줄의 마지막 장이 갖는다
function lyricSchedule(useOverrides = true) {
  const imgs = state.images;
  const n = imgs.length;
  const lyr = parseLyrics();
  const T = duration();
  const base = lyr.timed ? songBase(lyr) : 0;
  const shift = parseFloat($('shift').value) || 0;
  const lines = lyr.lines
    .filter((l) => l.text)
    .map((l) => ({ start: l.start - base + shift, end: l.end - base + shift }))
    .filter((l) => l.end > 0 && l.start < T)
    .map((l) => ({ start: Math.max(0, l.start), end: Math.min(T, l.end) }));
  if (!lines.length) return null;
  // 줄 사이 빈 시간은 앞 줄 이미지가 이어서 보이게, 첫 줄 앞은 첫 줄 이미지로
  lines[0].start = 0;
  for (let i = 0; i < lines.length - 1; i++) lines[i].end = lines[i + 1].start;
  lines[lines.length - 1].end = T;

  const segs = [];
  if (lines.length >= n) {
    // 줄이 이미지보다 많으면 줄을 이미지 수만큼 고르게 묶는다. 남는 줄은 앞 이미지부터 하나씩 더
    const per = Math.floor(lines.length / n), extra = lines.length % n;
    let li = 0;
    imgs.forEach((it, k) => {
      const cnt = per + (k < extra ? 1 : 0);
      segs.push({ start: lines[li].start, end: lines[li + cnt - 1].end, it });
      li += cnt;
    });
  } else {
    const per = Math.floor(n / lines.length), extra = n % lines.length;
    let k = 0;
    lines.forEach((l, i) => {
      const cnt = per + (i < extra ? 1 : 0);
      const d = l.end - l.start;
      const step = Math.floor(d / cnt);
      let at = l.start;
      for (let j = 0; j < cnt; j++) {
        // 한 줄이 장 수보다 짧으면 정수로 못 나눠서 똑같이 나눈다
        const len = step >= 1 ? (j < cnt - 1 ? step : l.end - at) : d / cnt;
        segs.push({ start: at, end: j < cnt - 1 ? at + len : l.end, it: imgs[k++] });
        at += len;
      }
    });
  }
  // 직접 고친 초가 있으면 그 길이로 바꾸고 뒤는 밀거나 당긴다. 끝은 전체 길이에 맞춘다
  if (useOverrides && imgs.some((it) => it.lsec > 0)) {
    let at = 0;
    const out = [];
    for (const sg of segs) {
      if (at >= T) break;
      const d = sg.it.lsec > 0 ? sg.it.lsec : sg.end - sg.start;
      out.push({ start: at, end: Math.min(T, at + d), it: sg.it });
      at += d;
    }
    out[out.length - 1].end = T;
    return { segs: out, period: T };
  }
  return { segs, period: T };
}

// 썸네일 아래 초 칸: 흐린 숫자는 지금 모드의 기본값(가사 따라면 가사에서 계산한 첫 구간 길이)
function refreshThumbSecs() {
  $('refit').disabled = !state.images.some((it) => it.lsec > 0);
  const cells = document.querySelectorAll('.thumb-sec');
  const auto = state.imgMode === 'lyric' ? lyricSchedule(false) : null;
  cells.forEach((el, i) => {
    const it = state.images[i];
    if (!it) return;
    if (state.imgMode === 'lyric') {
      const sg = auto && auto.segs.find((x) => x.it === it);
      el.placeholder = sg ? (Math.round((sg.end - sg.start) * 10) / 10).toString() : '-';
      if (document.activeElement !== el) el.value = it.lsec || '';
    } else {
      el.placeholder = $('imgSec').value || '3';
      if (document.activeElement !== el) el.value = it.sec || '';
    }
  });
}

function segAt(t) {
  const sc = imageSchedule();
  const tt = sc.period > 0 ? ((t % sc.period) + sc.period) % sc.period : 0;
  const segs = sc.segs;
  let k = segs.length - 1;
  for (let i = 0; i < segs.length; i++) if (tt < segs[i].end) { k = i; break; }
  return { segs, k, tt };
}

function imageAt(t) {
  if (still) return { a: still.img, b: null, p: 0 };
  const n = state.images.length;
  if (!n) return { a: null, b: null, p: 0 };
  if (n === 1) return { a: state.images[0], b: null, p: 0 };
  const { segs, k, tt } = segAt(t);
  const sg = segs[k];
  const a = sg.it;
  const b = segs[(k + 1) % segs.length].it;
  const dur = sg.end - sg.start;
  const into = tt - sg.start;
  // 페이드일 때만 겹쳐 넘어가고, 글리치·바로는 경계에서 딱 바뀐다
  const fade = Math.min(FADE, dur / 3);
  const p = state.imgTrans === 'fade' && a !== b && into > dur - fade ? (into - (dur - fade)) / fade : 0;
  return { a, b, p: Math.min(1, Math.max(0, p)) };
}

// fit: 이미지별 위치·확대 { fx, fy, zoom }. 없으면 가운데 꽉 채움
function drawCover(g, img, x, y, w, h, fit) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const zoom = fit ? fit.zoom || 1 : 1;
  const s = Math.max(w / iw, h / ih) * zoom;
  const sw = w / s, sh = h / s;
  const fx = fit && fit.fx != null ? fit.fx : 0.5;
  const fy = fit && fit.fy != null ? fit.fy : 0.5;
  g.drawImage(img, (iw - sw) * fx, (ih - sh) * fy, sw, sh, x, y, w, h);
}

// ---------- 그라디언트 맵 ----------
const GMAPS = {
  dawn: ['#1b1440', '#ff7eb6', '#ffe8d2'],
  sea: ['#08263d', '#2bb3c0', '#e6fff6'],
  sunset: ['#2a0a1f', '#e2563b', '#ffd27a'],
  mono: ['#111111', '#f2f2f2'],
  sepia: ['#2b1b10', '#c8935a', '#f6e7c8'],
  neon: ['#120458', '#ff00a0', '#f5ff6a'],
  duoPink: ['#1d1a6b', '#ff4d8d', '#ffd1e3'],
  duoBlueOrange: ['#0c2340', '#2f6fb0', '#ff9a3c', '#ffe9c7'],
  duoRedCyan: ['#2b0a0f', '#d7263d', '#7ff3f0'],
  mint: ['#0b2b26', '#2fa37f', '#e0fff4'],
  fadeLight: ['#7d8aa6', '#e8d9d0', '#fff8f0'],
  fadeDark: ['#1a1a24', '#4b3f5c', '#a8939b'],
  vintage: ['#1e1712', '#8a8178', '#efe8dc'],
  selenium: ['#14161f', '#6d7486', '#e4e8ef'],
  hyper: ['#2d00f7', '#f20089', '#ffbd00', '#fffbe0'],
  dream: ['#1a1036', '#6b4fa0', '#c8a2d6', '#f6e9ff'],
};
function gmStops() {
  const v = $('gmap').value;
  if (v === 'custom') return [$('gmA').value, $('gmB').value];
  return GMAPS[v] || null;
}
function gmKey() {
  const s = gmStops();
  return s ? s.join('') : '';
}
// 밝기에 따라 색을 다시 입힌 이미지. 색 조합마다 한 번만 만든다
function srcOf(it) {
  const stops = gmStops();
  if (!stops) return it.img;
  const key = 'gm' + stops.join('');
  if (it.cache[key]) return it.cache[key];
  const iw = it.img.naturalWidth, ih = it.img.naturalHeight;
  const k = Math.min(1, 1200 / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.round(iw * k); c.height = Math.round(ih * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(it.img, 0, 0, c.width, c.height);
  const rgb = stops.map((h) => { const v = parseInt(h.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; });
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const p = (i / 255) * (rgb.length - 1);
    const j = Math.min(rgb.length - 2, Math.floor(p)), f = p - j;
    for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = rgb[j][ch] + (rgb[j + 1][ch] - rgb[j][ch]) * f;
  }
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const l = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    px[i] = lut[l * 3]; px[i + 1] = lut[l * 3 + 1]; px[i + 2] = lut[l * 3 + 2];
  }
  g.putImageData(d, 0, 0);
  // 다른 색 조합으로 만든 것은 버린다
  for (const k2 of Object.keys(it.cache)) if (k2.startsWith('gm')) delete it.cache[k2];
  it.cache[key] = c;
  return c;
}

// 흐린 배경은 무거워서 크기별로 한 번만 만든다
function blurredBg(it, W, H) {
  // 화려하게일 때는 어두운 막을 옅게 해서 색이 살게
  const vivid = state.glow === 'vivid';
  const key = 'bg' + W + (vivid ? 'v' : '');
  if (it.cache[key]) return it.cache[key];
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = W * 0.06;
  g.filter = `blur(${r}px) saturate(1.2)`;
  drawCover(g, it.img, -r * 2, -r * 2, W + r * 4, H + r * 4);
  g.filter = 'none';
  g.fillStyle = vivid ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.38)';
  g.fillRect(0, 0, W, H);
  it.cache[key] = c;
  return c;
}

// 아트 뒤로 번지는 빛(은은하게). 모양(네모·원)과 크기별로 한 번만 만든다
function glowImage(it, size, round, u) {
  // 주변 빛은 그림에서 번지는 빛이라 그라디언트 맵 색을 따른다(흐린 배경은 원래 색)
  const key = 'glow' + size + (round ? 'o' : 's') + gmKey() + [it.fx, it.fy, it.zoom].join();
  if (it.cache[key]) return it.cache[key];
  const pad = Math.round(size * 0.45);
  const c = document.createElement('canvas');
  c.width = c.height = size + pad * 2;
  const g = c.getContext('2d');
  const src = document.createElement('canvas');
  src.width = src.height = c.width;
  const sg = src.getContext('2d');
  sg.save();
  sg.beginPath();
  if (round) sg.arc(c.width / 2, c.width / 2, size / 2, 0, Math.PI * 2);
  else sg.roundRect(pad, pad, size, size, 14 * u);
  sg.clip();
  drawCover(sg, srcOf(it), pad, pad, size, size, it);
  sg.restore();
  g.filter = `blur(${size * 0.09}px) saturate(1.8) brightness(1.15)`;
  g.drawImage(src, 0, 0);
  it.cache[key] = c;
  return c;
}

// ---------- 소리 ----------
let actx = null;
function audioCtx() {
  if (!actx) actx = new AudioContext();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

async function loadAudio(file) {
  const msg = $('status');
  msg.textContent = '노래 읽는 중';
  try {
    const buf = await audioCtx().decodeAudioData(await file.arrayBuffer());
    const ch = [];
    for (let i = 0; i < buf.numberOfChannels; i++) ch.push(buf.getChannelData(i));
    const len = buf.length;

    // 파형
    const peaks = new Float32Array(800);
    const per = Math.max(1, Math.floor(len / peaks.length));
    for (let i = 0; i < peaks.length; i++) {
      let m = 0;
      for (let j = i * per, end = Math.min(len, j + per); j < end; j += 4) {
        const v = Math.abs(ch[0][j]);
        if (v > m) m = v;
      }
      peaks[i] = m;
    }

    // 소리 크기(주변 빛 세기). 빨리 커지고 천천히 줄어든다
    const step = Math.floor(buf.sampleRate / ENV_RATE);
    const raw = new Float32Array(Math.ceil(len / step));
    for (let i = 0; i < raw.length; i++) {
      let s = 0, n = 0;
      for (let j = i * step, end = Math.min(len, j + step); j < end; j += 2) {
        let v = 0;
        for (const c of ch) v += c[j];
        v /= ch.length;
        s += v * v; n++;
      }
      raw[i] = Math.sqrt(s / Math.max(1, n));
    }
    const sorted = Float32Array.from(raw).sort();
    const top = sorted[Math.floor(sorted.length * 0.95)] || 1;
    const env = new Float32Array(raw.length);
    let cur = 0;
    for (let i = 0; i < raw.length; i++) {
      const v = Math.min(1, raw[i] / top);
      cur += (v - cur) * (v > cur ? 0.6 : 0.08);
      env[i] = cur;
    }

    // 소리가 툭 커지는 순간(박자). 박자에 맞춘 글리치에 쓴다
    const onsets = [];
    let lastOn = -1;
    for (let i = 4; i < raw.length; i++) {
      const prev = (raw[i - 1] + raw[i - 2] + raw[i - 3] + raw[i - 4]) / 4;
      const flux = (raw[i] - prev) / top;
      const tt = i / ENV_RATE;
      if (flux > 0.18 && tt - lastOn > 0.2) { onsets.push({ t: tt, s: Math.min(1, flux / 0.7) }); lastOn = tt; }
    }

    state.audio = { name: file.name, buf, peaks, env, onsets, a: 0, b: Math.min(15, buf.duration) };

    // "가수 - 제목.mp3" 꼴이면 빈 칸을 채운다
    const stem = file.name.replace(/\.[^.]+$/, '');
    const parts = stem.split(/\s+-\s+/);
    if (parts.length >= 2) {
      if (!$('artist').value.trim()) $('artist').value = parts[0].trim();
      if (!$('title').value.trim()) $('title').value = parts.slice(1).join(' - ').trim();
    } else if (!$('title').value.trim()) {
      $('title').value = stem;
    }

    msg.textContent = '';
    $('audioName').textContent = file.name;
    $('audioBox').hidden = false;
    $('waveRow').hidden = false;
    $('audioDrop').hidden = true;
    $('tap').disabled = false;
    syncSegInputs();
    state.t = 0;
    restartAudio();
    updateInfo();
    saveSettings();
  } catch (e) {
    msg.textContent = '이 파일은 읽을 수 없습니다. mp3·m4a·wav 파일을 넣어 주세요';
  }
}

function removeAudio() {
  stopAudio();
  state.audio = null;
  $('audioBox').hidden = true;
  $('waveRow').hidden = true;
  $('audioDrop').hidden = false;
  $('tap').disabled = true;
  state.t = 0;
  updateInfo();
}

function levelAt(t) {
  const au = state.audio;
  if (!au || still) return 0.5;
  const i = Math.floor((au.a + t) * ENV_RATE);
  return au.env[Math.max(0, Math.min(au.env.length - 1, i))];
}

// 미리보기 재생: 구간을 반복해서 튼다
let src = null, playStart = 0, playFrom = 0;
function stopAudio() {
  if (src) { try { src.stop(); } catch (e) {} src.disconnect(); src = null; }
}
function restartAudio() {
  stopAudio();
  const au = state.audio;
  if (!au || !state.playing || state.busy) return;
  const ac = audioCtx();
  src = ac.createBufferSource();
  src.buffer = au.buf;
  if (!state.tap) {
    src.loop = true;
    src.loopStart = au.a;
    src.loopEnd = au.b;
  }
  src.connect(ac.destination);
  playFrom = state.t;
  playStart = ac.currentTime;
  src.start(0, au.a + state.t);
}
function audioClock() {
  // 박자 찍기 중에는 구간 끝을 넘어서도 흐른다
  const el = playFrom + (actx.currentTime - playStart);
  return state.tap ? el : el % duration();
}

// ---------- 파형 ----------
const waveCanvas = $('waveCanvas');
function drawWave() {
  const au = state.audio;
  if (!au || $('waveRow').hidden) return;
  const dpr = window.devicePixelRatio || 1;
  const w = waveCanvas.clientWidth * dpr, h = waveCanvas.clientHeight * dpr;
  if (!w) return;
  if (waveCanvas.width !== w || waveCanvas.height !== h) { waveCanvas.width = w; waveCanvas.height = h; }
  const g = waveCanvas.getContext('2d');
  const css = getComputedStyle(document.body);
  const text = css.getPropertyValue('--text').trim();
  const dim = css.getPropertyValue('--line').trim();
  const D = au.buf.duration;
  const xa = (au.a / D) * w, xb = (au.b / D) * w;
  g.clearRect(0, 0, w, h);
  g.fillStyle = text;
  g.globalAlpha = 0.08;
  g.fillRect(xa, 0, xb - xa, h);
  g.globalAlpha = 1;
  const bars = Math.floor(w / (2 * dpr));
  for (let i = 0; i < bars; i++) {
    const p = au.peaks[Math.floor((i / bars) * au.peaks.length)];
    const x = (i / bars) * w;
    const bh = Math.max(dpr, p * h * 0.9);
    g.fillStyle = x >= xa && x <= xb ? text : dim;
    g.fillRect(x, (h - bh) / 2, dpr, bh);
  }
  // 재생 위치
  const xp = ((au.a + Math.min(state.t, au.b - au.a)) / D) * w;
  g.fillStyle = text;
  g.fillRect(xp, 0, dpr * 1.5, h);
}

let drag = null;
waveCanvas.addEventListener('pointerdown', (e) => {
  if (!state.audio || state.tap) return;
  waveCanvas.setPointerCapture(e.pointerId);
  drag = { x0: e.offsetX, moved: false };
});
waveCanvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (Math.abs(e.offsetX - drag.x0) > 3) drag.moved = true;
  if (!drag.moved) return;
  const D = state.audio.buf.duration, w = waveCanvas.clientWidth;
  const t0 = (Math.min(drag.x0, e.offsetX) / w) * D;
  const t1 = (Math.max(drag.x0, e.offsetX) / w) * D;
  setSegment(t0, Math.max(t1, t0 + 0.5), false);
});
waveCanvas.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const au = state.audio;
  if (!drag.moved) {
    // 누른 자리에서 같은 길이로 다시 시작
    const len = au.b - au.a;
    const t0 = (e.offsetX / waveCanvas.clientWidth) * au.buf.duration;
    setSegment(t0, t0 + len, true);
  } else {
    setSegment(au.a, au.b, true);
  }
  drag = null;
});

function setSegment(a, b, restart) {
  const au = state.audio;
  const D = au.buf.duration;
  a = Math.max(0, Math.min(a, D - 0.5));
  b = Math.max(a + 0.5, Math.min(b, D));
  au.a = a; au.b = b;
  syncSegInputs();
  if (restart) {
    state.t = 0;
    restartAudio();
    updateInfo();
  }
}
function syncSegInputs() {
  $('segA').value = fmtTenth(state.audio.a);
  $('segB').value = fmtTenth(state.audio.b);
}
for (const id of ['segA', 'segB']) {
  $(id).addEventListener('change', () => {
    const a = parseTime($('segA').value), b = parseTime($('segB').value);
    if (isNaN(a) || isNaN(b)) { syncSegInputs(); return; }
    setSegment(a, b, true);
  });
}

// ---------- 가사 찾기 ----------
async function findLyrics() {
  const title = $('title').value.trim();
  const artist = $('artist').value.trim();
  const msg = $('lyricMsg');
  if (!title) { msg.textContent = '제목을 먼저 넣어 주세요'; $('title').focus(); return; }
  msg.textContent = '찾는 중';
  try {
    const q = new URLSearchParams({ track_name: title });
    if (artist) q.set('artist_name', artist);
    let list = await (await fetch('https://lrclib.net/api/search?' + q)).json();
    const search = async (params) => (await fetch('https://lrclib.net/api/search?' + new URLSearchParams(params))).json();
    if (!list.length && artist) {
      // "제목 - 가수" 꼴로 올라온 영상은 둘이 뒤바뀌어 있을 수 있다
      list = await search({ track_name: artist, artist_name: title });
      if (list.length) { $('title').value = artist; $('artist').value = title; }
    }
    if (!list.length && artist) list = await search({ q: artist + ' ' + title });
    if (!list.length) list = await search({ track_name: title });
    const D = state.audio ? state.audio.buf.duration : null;
    const near = (x) => (D ? Math.abs((x.duration || 0) - D) : 0);
    // 같은 노래가 여러 판이면 한글이 든 판을 먼저(한국어 노래인데 영어·로마자 판이 먼저 오는 일이 있어서)
    const ko = (x) => (/[가-힣]/.test(x.syncedLyrics || x.plainLyrics || '') ? 1 : 0);
    const wantKo = list.some(ko);
    const synced = list.filter((x) => x.syncedLyrics).sort((x, y) => (wantKo ? ko(y) - ko(x) : 0) || near(x) - near(y));
    const mine = myLines();
    const warnLen = synced.length && D && near(synced[0]) > 3 ? ' — 노래 파일과 길이가 달라 박자가 어긋날 수 있습니다' : '';
    if (synced.length && mine.texts.length) {
      msg.textContent = stampMine(mine, synced[0].syncedLyrics) + warnLen;
    } else if (synced.length) {
      $('lyrics').value = synced[0].syncedLyrics;
      msg.textContent = `${synced[0].artistName} · ${synced[0].trackName}` + warnLen;
    } else if (mine.texts.length) {
      msg.textContent = list.length ? '박자 있는 가사가 없습니다. 박자 찍기로 맞춰 주세요' : '가사를 못 찾았습니다. 제목·가수 철자를 확인해 주세요';
    } else {
      const plain = list.find((x) => x.plainLyrics);
      if (plain) {
        $('lyrics').value = plain.plainLyrics;
        msg.textContent = '박자 없는 가사만 있습니다. 박자 찍기로 맞춰 주세요';
      } else {
        msg.textContent = '가사를 못 찾았습니다. 제목·가수 철자를 확인해 주세요';
      }
    }
    updateInfo();
    saveSettings();
    renderNotes();
  } catch (e) {
    msg.textContent = '가사 사이트에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요';
  }
}

// 가사 칸에 적힌 줄(시간표는 떼고). 빈 줄(문단 나눔) 자리는 기억해 둔다
function myLines() {
  const texts = [], breaks = new Set();
  for (const r of $('lyrics').value.split('\n')) {
    const s = r.replace(/^(\s*\[\d+:\d+(?:\.\d+)?\])+/, '').replace(/^\s*\[\d+(?:\.\d+)?\]/, '').trim();
    if (s) texts.push(s); else if (texts.length) breaks.add(texts.length);
  }
  return { texts, breaks };
}

// 적어 둔 줄에만 받아 온 가사의 시각을 붙인다. 노래가 있으면 구간도 그 부분으로 맞춘다
function stampMine(mine, lrc) {
  const norm = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const src = [];
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\s*\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (m) src.push({ start: parseInt(m[1], 10) * 60 + parseFloat(m[2]), key: norm(m[3]) });
  }
  const same = (a, b) => a && b && (a === b || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b)));
  const keys = mine.texts.map(norm);
  // 후렴처럼 같은 줄이 여러 번 나오면, 이어지는 줄이 가장 많이 맞는 자리를 고른다
  let best = null;
  for (let from = 0; from < src.length; from++) {
    if (!same(keys[0], src[from].key) && from > 0) continue;
    const hits = [];
    let j = from;
    for (const k of keys) {
      let f = -1;
      for (let q = j; q < src.length; q++) if (same(k, src[q].key)) { f = q; break; }
      hits.push(f);
      if (f >= 0) j = f + 1;
    }
    const n = hits.filter((h) => h >= 0).length;
    if (!best || n > best.n) best = { n, hits };
  }
  const hits = best ? best.hits : keys.map(() => -1);
  $('lyrics').value = mine.texts.map((s, i) => (mine.breaks.has(i) ? '\n' : '') + (hits[i] >= 0 ? fmtLrc(src[hits[i]].start) + ' ' : '') + s).join('\n');

  const found = hits.filter((h) => h >= 0);
  if (found.length && state.audio) {
    const first = src[found[0]].start;
    const lastIdx = found[found.length - 1];
    const end = lastIdx + 1 < src.length ? src[lastIdx + 1].start : src[lastIdx].start + num('lineSec', 3);
    setSegment(first - 0.3, end, true);
  }
  const miss = mine.texts.filter((_, i) => hits[i] < 0);
  if (!miss.length) return `${mine.texts.length}줄 모두 시간을 붙였습니다`;
  return `${mine.texts.length}줄 중 ${found.length}줄만 맞췄습니다. 못 맞춘 줄(시간 없음)은 안 보입니다: ${miss.slice(0, 2).join(' / ')}${miss.length > 2 ? ' …' : ''}`;
}

// ---------- 박자 찍기 ----------
// 구간 시작부터 노래를 틀고, 스페이스를 누를 때마다 다음 줄의 시작 시각을 적는다.
function startTap() {
  const { texts, breaks } = myLines();
  if (!texts.length) { $('lyricMsg').textContent = '가사를 먼저 넣어 주세요'; return; }
  document.activeElement?.blur();
  state.tap = { texts, breaks, stamps: [] };
  state.t = 0;
  setPlaying(true);
  $('tap').classList.add('tapping');
  tapMsg();
}
function tapMsg() {
  const { texts, stamps } = state.tap;
  $('tap').textContent = '다음 줄';
  $('lyricMsg').textContent = `${stamps.length} / ${texts.length} — 다음 줄: ${texts[stamps.length]} · 스페이스로 찍기, Esc로 그만`;
}
function tapNext() {
  const tp = state.tap;
  tp.stamps.push(state.audio.a + audioClock());
  if (tp.stamps.length < tp.texts.length) { tapMsg(); return; }
  $('lyrics').value = tp.texts.map((s, i) => (tp.breaks.has(i) ? '\n' : '') + fmtLrc(tp.stamps[i]) + ' ' + s).join('\n');
  $('shift').value = 0;
  endTap(`${tp.texts.length}줄 박자를 찍었습니다`);
  updateInfo();
  renderNotes();
  saveSettings();
}
function endTap(text) {
  state.tap = null;
  $('tap').classList.remove('tapping');
  $('tap').textContent = '박자 찍기';
  $('lyricMsg').textContent = text;
  state.t = 0;
  restartAudio();
}
document.addEventListener('keydown', (e) => {
  if (state.tap) {
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); tapNext(); }
    if (e.code === 'Escape') endTap('박자 찍기를 그만뒀습니다');
    return;
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)
    && !['checkbox', 'range', 'color'].includes(document.activeElement.type);
  if (typing || state.busy || $('help').open) return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    if (!scenes.length) return;
    e.preventDefault();
    const cur = scenes.findIndex((sc) => state.t >= sc.start - 1e-6 && state.t < sc.end);
    const next = Math.max(0, Math.min(scenes.length - 1, (cur < 0 ? 0 : cur) + (e.code === 'ArrowRight' ? 1 : -1)));
    setPlaying(false);
    state.t = sceneShowAt(scenes[next]);
  } else if ((e.code === 'Delete' || e.code === 'Backspace') && selSticker) {
    e.preventDefault();
    removeSticker(selSticker);
  } else if (e.code === 'Escape') {
    if (!$('exportPop').hidden) closeExport();
    else selectSticker(null);
  }
});

// ---------- 색 ----------
function isLight(hex) {
  const v = parseInt(hex.slice(1), 16);
  const r = v >> 16, g = (v >> 8) & 255, b = v & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

// ---------- 그리기 ----------
function wrap(g, text, maxW, maxLines) {
  const lines = [];
  let cur = '';
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    const tryLine = cur + word;
    if (g.measureText(tryLine).width <= maxW) { cur = tryLine; continue; }
    if (cur.trim()) lines.push(cur.trim());
    cur = word.trimStart();
    // 한 단어가 너무 길면 글자 단위로 자른다
    while (g.measureText(cur).width > maxW) {
      let i = cur.length;
      while (i > 1 && g.measureText(cur.slice(0, i)).width > maxW) i--;
      lines.push(cur.slice(0, i));
      cur = cur.slice(i);
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (last.length > 1 && g.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    keep[maxLines - 1] = last + '…';
    return keep;
  }
  return lines;
}

function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function drawBackground(g, W, H, t) {
  const { a, b, p } = imageAt(t);
  if (state.bgMode === 'solid' || !a) {
    g.fillStyle = state.bgMode === 'solid' ? $('bgColor').value : '#232220';
    g.fillRect(0, 0, W, H);
    return;
  }
  g.drawImage(blurredBg(a, W, H), 0, 0);
  if (b && p > 0) {
    g.globalAlpha = p;
    g.drawImage(blurredBg(b, W, H), 0, 0);
    g.globalAlpha = 1;
  }
}

function drawArt(g, x, y, w, h, t) {
  const { a, b, p } = imageAt(t);
  if (!a) {
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(x, y, w, h);
    return;
  }
  const gs = imageGlitchAt(t);
  if (gs <= 0) {
    drawCover(g, srcOf(a), x, y, w, h, a);
    if (b && p > 0) {
      g.globalAlpha = p;
      drawCover(g, srcOf(b), x, y, w, h, b);
      g.globalAlpha = 1;
    }
    return;
  }
  // 글리치: 따로 그린 뒤 색을 가르고 띠를 어긋나게 해서 붙인다
  const W2 = Math.ceil(w), H2 = Math.ceil(h);
  const [c0, c1, c2] = artBufs(W2, H2);
  const g0 = c0.getContext('2d');
  g0.clearRect(0, 0, W2, H2);
  drawCover(g0, srcOf(a), 0, 0, W2, H2, a);
  if (b && p > 0) {
    g0.globalAlpha = p;
    drawCover(g0, srcOf(b), 0, 0, W2, H2, b);
    g0.globalAlpha = 1;
  }
  const seed = Math.floor(t * 12) + (still ? 7 : 0);
  const off = Math.round(w * (0.008 + 0.025 * gs));
  // 빨강·초록·파랑을 따로 떼어 좌우로 민 다음 더한다
  const g2 = c2.getContext('2d');
  g2.globalCompositeOperation = 'source-over';
  g2.fillStyle = '#000';
  g2.fillRect(0, 0, W2, H2);
  const g1 = c1.getContext('2d');
  for (const [col, dx] of [['#f00', -off], ['#0f0', 0], ['#00f', off]]) {
    g1.globalCompositeOperation = 'copy';
    g1.drawImage(c0, 0, 0);
    g1.globalCompositeOperation = 'multiply';
    g1.fillStyle = col;
    g1.fillRect(0, 0, W2, H2);
    g2.globalCompositeOperation = 'lighter';
    g2.drawImage(c1, dx, 0);
  }
  g2.globalCompositeOperation = 'source-over';
  // 색을 민 만큼 생긴 가장자리 줄무늬는 잘라내고 살짝 늘려 붙인다
  const cx0 = off, cw = W2 - off * 2;
  g.drawImage(c2, cx0, 0, cw, H2, x, y, w, h);
  // 가로 띠 몇 개를 옆으로 민다
  const bands = 14;
  const bh = H2 / bands;
  for (let i = 0; i < bands; i++) {
    const r = hash(seed * 31 + i);
    if (r > 0.18 + 0.35 * gs) continue;
    const dx = (hash(seed * 7 + i * 3) - 0.5) * w * 0.12 * gs;
    const hh = bh * (0.3 + hash(seed + i * 5) * 0.9);
    const yy = i * bh;
    g.drawImage(c2, cx0, yy, cw, hh, x + dx, y + yy, w, hh);
  }
}

const artCanvases = [0, 1, 2].map(() => document.createElement('canvas'));
function artBufs(w, h) {
  for (const c of artCanvases) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return artCanvases;
}

// 이미지 글리치 세기(0~1). 이미지가 바뀔 때 세게, 그 밖에는 가끔 짧게
function imageGlitchAt(t) {
  const on = $('imgGlitch').checked;
  if (view.hideFx) return 0;
  if (fxStatic()) return on ? 0.55 : 0;
  let s = 0;
  // 바뀔 때 글리치: 경계 앞뒤로 세게
  if (state.imgTrans === 'glitch' && state.images.length > 1) {
    const { segs, k, tt } = segAt(t);
    const sg = segs[k];
    const d = Math.min(tt - sg.start, sg.end - tt);
    if (d < 0.25) s = 1 - (d / 0.25) * 0.6;
  }
  // 이미지 글리치: 안 바뀌어도 가끔 짧게
  if (on) s = Math.max(s, glitchBurst(t, 99, 0.08));
  return s;
}

// ---------- 보케 ----------
// 이미지에서 밝은 색 몇 개를 뽑아 빛 동그라미 색으로 쓴다
function paletteOf(it) {
  if (!it) return [[255, 244, 230]];
  const key = 'pal' + gmKey();
  if (it.cache[key]) return it.cache[key];
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(srcOf(it), 0, 0, 12, 12);
  const px = g.getImageData(0, 0, 12, 12).data;
  const cols = [];
  for (let i = 0; i < px.length; i += 4) cols.push([px[i], px[i + 1], px[i + 2]]);
  const lum = (c2) => 0.299 * c2[0] + 0.587 * c2[1] + 0.114 * c2[2];
  cols.sort((x, y) => lum(y) - lum(x));
  // 밝은 쪽에서 고르고 흰색을 섞어 빛처럼 보이게
  const pal = [0, 6, 14, 24, 36].map((i) => cols[Math.min(i, cols.length - 1)].map((v) => Math.round(v * 0.6 + 255 * 0.4)));
  it.cache[key] = pal;
  return pal;
}

const BOKEH_N = 16;
function drawBokeh(g, x, y, w, h, t) {
  if (!$('bokeh').checked || view.hideFx) return;
  const pal = paletteOf(imageAt(t).a);
  const T = duration();
  const cyc = Math.max(1, Math.round(T / 10));
  const TAU = Math.PI * 2;
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < BOKEH_N; i++) {
    const k = cyc * (1 + (i % 2));
    const r = w * (0.03 + 0.08 * hash(i * 3.7));
    // 위로 천천히 떠오르고 좌우로 살짝 흔들린다. 전체 길이에 정수 바퀴라 반복이 끊기지 않는다
    let yn = (hash(i * 1.3) - (k * t) / T) % 1;
    if (yn < 0) yn += 1;
    const px = x + (hash(i * 2.1) + 0.04 * Math.sin(TAU * ((k * t) / T + hash(i)))) * w;
    const py = y + (yn * 1.2 - 0.1) * h;
    const a = 0.16 + 0.24 * (0.5 + 0.5 * Math.sin(TAU * ((2 * k * t) / T + hash(i * 5))));
    const [cr, cg, cb] = pal[i % pal.length];
    const grd = g.createRadialGradient(px, py, 0, px, py, r);
    grd.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
    grd.addColorStop(0.62, `rgba(${cr},${cg},${cb},${a * 0.85})`);
    grd.addColorStop(0.82, `rgba(${cr},${cg},${cb},${a * 0.45})`);
    grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.fillStyle = grd;
    g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill();
  }
  g.restore();
}

// 아트(또는 디스크) 뒤에서 번져 나오는 빛. 노래가 있으면 소리 크기를 따라 숨 쉰다
// 화려하게: 그림 가장자리 줄을 바깥으로 길게 늘여 색을 넓게 퍼뜨린 뒤 크게 흐리고 채도·밝기를 올린다
// spreadK: 바깥으로 퍼지는 폭(짧은 변 대비)
function vividGlowImage(it, w, h = w, spreadK = 0.8) {
  const key = 'vglow' + w + 'x' + h + 'k' + spreadK + gmKey() + [it.fx, it.fy, it.zoom].join();
  if (it.cache[key]) return it.cache[key];
  const art = document.createElement('canvas');
  art.width = w; art.height = h;
  drawCover(art.getContext('2d'), srcOf(it), 0, 0, w, h, it);
  const pad = Math.round(Math.min(w, h) * spreadK);
  const SW = w + pad * 2, SH = h + pad * 2;
  const ext = document.createElement('canvas');
  ext.width = SW; ext.height = SH;
  const e = ext.getContext('2d');
  const k = Math.max(2, Math.round(Math.min(w, h) * 0.04)); // 가장자리 줄 두께
  e.drawImage(art, pad, pad);
  e.drawImage(art, 0, 0, w, k, pad, 0, w, pad);                    // 위
  e.drawImage(art, 0, h - k, w, k, pad, pad + h, w, pad);          // 아래
  e.drawImage(art, 0, 0, k, h, 0, pad, pad, h);                    // 왼쪽
  e.drawImage(art, w - k, 0, k, h, pad + w, pad, pad, h);          // 오른쪽
  e.drawImage(art, 0, 0, k, k, 0, 0, pad, pad);                    // 모서리
  e.drawImage(art, w - k, 0, k, k, pad + w, 0, pad, pad);
  e.drawImage(art, 0, h - k, k, k, 0, pad + h, pad, pad);
  e.drawImage(art, w - k, h - k, k, k, pad + w, pad + h, pad, pad);
  const c = document.createElement('canvas');
  c.width = SW; c.height = SH;
  const g = c.getContext('2d');
  g.filter = `blur(${Math.min(w, h) * 0.12}px) saturate(3) brightness(1.45)`;
  g.drawImage(ext, 0, 0);
  // 바깥으로 갈수록 흐려지게 깎는다
  g.filter = 'none';
  g.globalCompositeOperation = 'destination-in';
  g.save();
  g.translate(SW / 2, SH / 2);
  g.scale(SW / SH, 1);
  const fade = g.createRadialGradient(0, 0, SH * 0.25, 0, 0, SH / 2);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(-SH / 2, -SH / 2, SH, SH);
  g.restore();
  it.cache[key] = c;
  return c;
}

// 번짐 범위 슬라이더(0~100). 25가 예전 크기, 100이면 카드를 가득 채운다
function glowSpreadRaw() {
  const v = parseFloat($('glowSpread').value);
  return (isNaN(v) ? 25 : v) / 100;
}
function glowSpread() { return 0.8 + glowSpreadRaw() * 0.8 * 2; }

function drawGlow(g, cx, cy, size, round, u, t) {
  if (state.glow === 'off') return;
  const { a, b, p } = imageAt(t);
  if (!a) return;
  const lv = levelAt(t);
  // 빛 세기: 100% 기준. 넘기면 더 진하고 넓게
  const amt = (parseFloat($('glowAmt').value) || 100) / 100;
  const spread = glowSpread();
  if (state.glow === 'vivid') {
    // 넓게 퍼지는 빛 + 아트 바로 옆의 밝은 빛 두 겹. 소리에 맞춰 더 크게 숨 쉰다
    const wide = (it, w) => {
      const c = vividGlowImage(it, Math.round(size));
      const sc = c.width * (1 + 0.1 * lv) * spread;
      g.globalAlpha = Math.min(1, (0.7 + 0.3 * lv) * amt) * w;
      g.drawImage(c, cx - sc / 2, cy - sc / 2, sc, sc);
    };
    const tight = (it, w) => {
      const c = glowImage(it, Math.round(size), round, u);
      const sc = c.width * (1.04 + 0.08 * lv) * spread;
      g.globalAlpha = Math.min(1, (0.75 + 0.25 * lv) * amt) * w;
      g.drawImage(c, cx - sc / 2, cy - sc / 2, sc, sc);
    };
    g.save();
    g.globalCompositeOperation = 'screen';
    wide(a, 1);
    if (b && p > 0) wide(b, p);
    tight(a, 1);
    if (b && p > 0) tight(b, p);
    g.restore();
    return;
  }
  const scale = (1 + 0.06 * lv) * spread;
  const alpha = Math.min(1, (0.45 + 0.5 * lv) * amt);
  const one = (it, k) => {
    const c = glowImage(it, Math.round(size), round, u);
    const s = c.width * scale;
    g.globalAlpha = alpha * k;
    g.drawImage(c, cx - s / 2, cy - s / 2, s, s);
  };
  g.save();
  g.globalCompositeOperation = 'screen';
  one(a, 1);
  if (b && p > 0) one(b, p);
  g.restore();
}

// 0~1 사이의 고정된 난수. 같은 입력이면 늘 같아서 GIF·MP4가 미리보기와 똑같다
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function anyMarked() {
  for (const k in notes) if (notes[k].gl) return true;
  return false;
}
// 줄마다 설정에서 글리치를 체크한 줄이 있으면, 그 줄이 나오는 동안에만 글리치가 난다
function glitchAllowed(t) {
  if (!anyMarked()) return true;
  const l = lyricAt(t);
  return !!(l && l.text && notes[l.text] && notes[l.text].gl);
}
// 가끔 튀는 글리치 세기(0~1). 박자 맞추기를 켜고 노래가 있으면 박자마다 튄다
function glitchBurst(t, salt, prob = 0.08) {
  if (!glitchAllowed(t)) return 0;
  const au = state.audio;
  if ($('beatSync').checked && au && au.onsets.length) {
    const st = au.a + t, on = au.onsets;
    let lo = 0, hi = on.length - 1, i = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (on[m].t <= st) { i = m; lo = m + 1; } else hi = m - 1;
    }
    return i >= 0 && st - on[i].t < 0.13 ? 0.4 + 0.5 * on[i].s : 0;
  }
  const k = Math.floor(t * 8);
  return hash(k + salt) < prob ? 0.35 + hash(k + salt + 3) * 0.4 : 0;
}

// 가사 글리치 세기(0~1). 줄이 바뀔 때 세게, 그 뒤로는 가끔 짧게 튄다
// 미리보기 보는 방식. frozen: 멈춘 화면·장면 카드는 이미지 저장과 같은 모습(효과 고정),
// hideFx: 눈 아이콘을 끄면 편집 화면에서만 글리치·보케·스티커 움직임을 숨긴다
const view = { frozen: false, hideFx: false };
const fxStatic = () => !!still || view.frozen;

function glitchOf(item, t) {
  if (item.glitch != null) return item.glitch;
  if (view.hideFx) return 0;
  if (anyMarked() && !item.gl) return 0;
  if (view.frozen) return 0.35;
  if (item.since < 0.45) return 1 - item.since / 0.45 * 0.7;
  return glitchBurst(t, 0, 0.06);
}

// 가사 묶음(발음·본문·번역)을 구역 [y0, y1] 가운데에 맞춰 그린다. 넘치면 글씨를 줄인다
function drawLyrics(g, cx, y0, y1, maxW, u, fg, dim, t, opt = {}) {
  let items;
  if (still) items = still.items;
  else {
    const l = lyricAt(t);
    items = l && l.text ? [l] : [];
  }
  if (!items.length) return;
  const glitch = state.fx === 'glitch';
  const align = opt.align || 'center';
  const style = opt.style || 'none';
  const fxc = $('fxColor').value;
  // 색: 직접 고르면 그 색, 아니면 배경에 맞춘 기본 색
  const cMain = state.lyCustom ? $('lyColor').value : fg;
  const cPron = state.lyCustom ? $('pronColor').value : dim;
  const cTrans = state.lyCustom ? $('transColor').value : dim;
  const big = opt.big || 1;
  g.textAlign = align;
  g.textBaseline = 'top';

  let layout, k = 1;
  for (; k >= 0.4; k -= 0.05) {
    const one = items.length === 1;
    const base = opt.size || 17;
    const S = { main: base * u * k * big, pron: base * 0.62 * u * k * big, trans: base * 0.72 * u * k * big };
    let h = 0;
    layout = items.map((it, i) => {
      g.font = `600 ${S.main}px ${LFONT}`;
      const main = wrap(g, it.text, maxW, one ? 2 : 2);
      g.font = `500 ${S.pron}px ${LFONT}`;
      const pron = it.pron ? fitText(g, it.pron, maxW) : '';
      g.font = `500 ${S.trans}px ${LFONT}`;
      const trans = it.trans ? wrap(g, it.trans, maxW, one ? 2 : 1) : [];
      const bh = (pron ? S.pron * 1.5 : 0) + main.length * S.main * 1.38 + trans.length * S.trans * 1.4 + (trans.length ? 3 * u : 0);
      h += bh + (i ? 10 * u * k * big : 0);
      return { it, main, pron, trans, bh };
    });
    layout.S = S;
    layout.h = h;
    if (h <= y1 - y0) break;
  }
  const S = layout.S;
  // 이전 줄·다음 줄: 자리가 남을 때만 흐리게 한 줄씩
  const sideH = S.main * 1.38;
  let next = '', prev = '';
  g.font = `600 ${S.main}px ${LFONT}`;
  if (opt.next && !still && items[0].next && layout.h + sideH <= y1 - y0) next = fitText(g, items[0].next, maxW);
  if (opt.prev && !still && items[0].prev && layout.h + sideH * (next ? 2 : 1) <= y1 - y0) prev = fitText(g, items[0].prev, maxW);
  const preH = prev ? sideH : 0, postH = next ? sideH : 0;
  let y = opt.top ? y0 + preH
    : opt.bottom ? y1 - layout.h - postH
    : y0 + preH + Math.max(0, (y1 - y0 - layout.h - preH - postH) / 2);
  if (prev) {
    g.globalAlpha = 0.32;
    g.fillStyle = cMain;
    g.textAlign = align;
    g.textBaseline = 'top';
    g.fillText(prev, cx, y - sideH);
    g.globalAlpha = 1;
  }
  // 글자 칸(자막을 끌어 옮길 때 잡는 곳, 상자 크기)
  let mwAll = 0;
  for (const L of layout) {
    g.font = `500 ${S.pron}px ${LFONT}`; if (L.pron) mwAll = Math.max(mwAll, g.measureText(L.pron).width);
    g.font = `600 ${S.main}px ${LFONT}`; for (const x of L.main) mwAll = Math.max(mwAll, g.measureText(x).width);
    g.font = `500 ${S.trans}px ${LFONT}`; for (const x of L.trans) mwAll = Math.max(mwAll, g.measureText(x).width);
  }
  if (opt.record) {
    const bx = align === 'left' ? cx : align === 'right' ? cx - mwAll : cx - mwAll / 2;
    opt.record.rect = { x: bx - 7 * u, y: y - 4 * u, w: mwAll + 14 * u, h: layout.h + 8 * u };
  }
  if (style === 'box') {
    // 영상 자막처럼 글자 뒤에 반투명 상자
    const mw = mwAll;
    const px = 7 * u * k, py = 4 * u * k;
    g.globalAlpha = (still ? 1 : layout[0].it.alpha) * 0.75;
    g.fillStyle = fxc;
    const bx = align === 'left' ? cx : align === 'right' ? cx - mw : cx - mw / 2;
    g.beginPath();
    g.roundRect(bx - px, y - py, mw + px * 2, layout.h + py * 2 - S.main * 0.2, 3 * u);
    g.fill();
    g.globalAlpha = 1;
  }
  for (const L of layout) {
    const alpha = still ? 1 : L.it.alpha;
    const gs = glitch ? glitchOf(L.it, t) : 0;
    // 글리치는 나타날 때 깜빡이며 들어온다
    const a = gs > 0 && !fxStatic() && L.it.since < 0.3 ? (hash(Math.floor(L.it.at * 30)) < 0.35 ? 0.15 : 1) : alpha;
    // 글리치 넣을 곳으로 고른 부분만 글리치로 그린다
    const put = (text, size, weight, color, on) => {
      g.font = `${weight} ${size}px ${LFONT}`;
      if (on && gs > 0) {
        const tw = g.measureText(text).width;
        drawGlitchText(g, text, align === 'left' ? cx + tw / 2 : align === 'right' ? cx - tw / 2 : cx, y, size, color, a, gs, u, L.it.at, weight, LFONT);
        g.textAlign = align;
        g.textBaseline = 'top';
      } else {
        g.globalAlpha = a;
        if (style === 'stroke') {
          // 테두리: 글자 바깥에 굵은 선을 먼저
          g.strokeStyle = fxc;
          g.lineWidth = Math.max(1.5, size * 0.18);
          g.lineJoin = 'round';
          g.strokeText(text, cx, y);
        }
        if (style === 'glow') {
          // 빛: 같은 글자를 흐린 빛으로 두 번 깔고 위에 또렷하게
          g.save();
          g.shadowColor = fxc;
          g.shadowBlur = size * 0.7;
          g.fillStyle = color;
          g.fillText(text, cx, y);
          g.shadowBlur = size * 0.3;
          g.fillText(text, cx, y);
          g.restore();
        }
        g.fillStyle = color;
        g.fillText(text, cx, y);
      }
    };
    if (L.pron) {
      put(L.pron, S.pron, 500, cPron, $('gPron').checked);
      y += S.pron * 1.5;
    }
    for (const s of L.main) {
      put(s, S.main, 600, cMain, $('gMain').checked);
      y += S.main * 1.38;
    }
    if (L.trans.length) {
      y += 3 * u;
      for (const s of L.trans) { put(s, S.trans, 500, cTrans, $('gTrans').checked); y += S.trans * 1.4; }
    }
    y += 10 * u * k * big;
  }
  if (next) {
    g.globalAlpha = 0.32;
    g.fillStyle = cMain;
    g.font = `600 ${S.main}px ${LFONT}`;
    g.fillText(next, cx, y - 4 * u);
  }
  g.globalAlpha = 1;
}

// 색이 갈라지고 가로 띠가 어긋나는 글씨
const gBase = document.createElement('canvas');
const gTint = document.createElement('canvas');
function drawGlitchText(g, text, cx, y, size, fg, alpha, s, u, seed, weight = 600, fam = FONT) {
  const font = `${weight} ${size}px ${fam}`;
  const bc = gBase.getContext('2d');
  bc.font = font;
  const pad = Math.ceil(24 * u);
  const w = Math.ceil(bc.measureText(text).width) + pad * 2;
  const h = Math.ceil(size * 1.5);
  if (gBase.width < w || gBase.height < h) { gBase.width = gTint.width = Math.max(gBase.width, w); gBase.height = gTint.height = Math.max(gBase.height, h); }
  bc.clearRect(0, 0, gBase.width, gBase.height);
  bc.font = font;
  bc.textAlign = 'left';
  bc.textBaseline = 'top';
  bc.fillStyle = fg;
  bc.fillText(text, pad, size * 0.15);
  glitchBlit(g, w, h, cx - w / 2, y - size * 0.15, alpha, s, u, seed, 6);
}

// gBase에 그려 둔 것(0,0,w,h)을 색을 가르고 띠를 어긋나게 해서 (x0,y0)에 붙인다
function glitchBlit(g, w, h, x0, y0, alpha, s, u, seed, bands) {
  const tc = gTint.getContext('2d');
  const tint = (color, dx) => {
    tc.globalCompositeOperation = 'copy';
    tc.drawImage(gBase, 0, 0);
    tc.globalCompositeOperation = 'source-in';
    tc.fillStyle = color;
    tc.fillRect(0, 0, gTint.width, gTint.height);
    tc.globalCompositeOperation = 'source-over';
    g.drawImage(gTint, 0, 0, w, h, x0 + dx, y0, w, h);
  };
  const off = (2 + 5 * s) * u;
  g.globalAlpha = alpha * 0.85;
  tint('#ff2d6f', -off * (0.6 + hash(seed * 3.1) * 0.6));
  tint('#22e6ff', off * (0.6 + hash(seed * 5.3) * 0.6));
  // 본문을 가로 띠로 잘라 몇 개를 옆으로 민다
  g.globalAlpha = alpha;
  const bh = h / bands;
  const step = Math.floor(seed * 24);
  for (let i = 0; i < bands; i++) {
    const r = hash(step * 13 + i);
    const dx = r < 0.3 * s + 0.1 ? (hash(step * 17 + i) - 0.5) * 22 * u * s : 0;
    g.drawImage(gBase, 0, i * bh, w, bh, x0 + dx, y0 + i * bh, w, bh);
  }
  g.globalAlpha = 1;
}

function drawProgress(g, x, y, w, u, fg, dim, t, T) {
  // 노래가 있으면 곡 전체에서의 위치를 보여준다
  const now = state.audio ? state.audio.a + t : t;
  const total = state.audio ? state.audio.buf.duration : T;
  const p = total ? Math.min(1, now / total) : 0;
  const h = 4 * u;
  g.fillStyle = dim;
  g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill();
  g.fillStyle = fg;
  g.beginPath(); g.roundRect(x, y, Math.max(h, w * p), h, h / 2); g.fill();
  g.beginPath(); g.arc(x + w * p, y + h / 2, 6 * u, 0, Math.PI * 2); g.fill();
  g.font = `500 ${12 * u}px ${FONT}`;
  g.fillStyle = dim;
  g.textBaseline = 'top';
  g.textAlign = 'left';
  g.fillText(fmt(now), x, y + 14 * u);
  g.textAlign = 'right';
  g.fillText(fmt(total), x + w, y + 14 * u);
}

function drawControls(g, cx, cy, u, fg) {
  g.fillStyle = fg;
  const tri = (x, dir, s) => {
    g.beginPath();
    g.moveTo(x, cy - s); g.lineTo(x + dir * s * 1.2, cy); g.lineTo(x, cy + s); g.closePath(); g.fill();
  };
  const s = 9 * u;
  const px = cx - 80 * u;
  g.fillRect(px - 12 * u, cy - s, 2.5 * u, s * 2);
  tri(px + 2 * u, -1, s);
  tri(px + 13 * u, -1, s);
  const nx = cx + 80 * u;
  g.fillRect(nx + 10 * u, cy - s, 2.5 * u, s * 2);
  tri(nx - 2 * u, 1, s);
  tri(nx - 13 * u, 1, s);
  const ps = 13 * u;
  g.fillRect(cx - ps * 0.6, cy - ps, ps * 0.42, ps * 2);
  g.fillRect(cx + ps * 0.18, cy - ps, ps * 0.42, ps * 2);
}

function lyStyleOf() { return state.lyStyle[state.mode] || 'none'; }

// ---------- 글자 묶음 자리 ----------
// 제목 묶음(제목·가수)과 가사 묶음(가사·발음·번역)의 기본 자리. 옮긴 만큼 더하고 카드 안쪽으로 막는다
function defaultBoxes(W) {
  const u = W / 480;
  return state.mode === 'player'
    ? { title: { x: 84 * u, y: 332 * u, w: 312 * u, h: 50 * u }, lyric: { x: 64 * u, y: 404 * u, w: 352 * u, h: 122 * u } }
    : { title: { x: 50 * u, y: 440 * u, w: 380 * u, h: 50 * u }, lyric: { x: 50 * u, y: 496 * u, w: 380 * u, h: 80 * u } };
}
const EDGE = 16; // 스티커가 움직일 수 있는 영역: 카드 가장자리에서 이만큼 안쪽 (u 단위)
function alignOf(key) {
  const a = state.align[state.mode];
  return (a && a[key]) || 'center';
}
// 묶음 자리는 고정이고 정렬만 바뀐다. ax는 정렬 기준점(왼쪽 정렬이면 왼쪽 끝, 가운데면 가운데)
function blockGeom(W, key) {
  const d = defaultBoxes(W)[key];
  const al = alignOf(key);
  const ax = al === 'left' ? d.x : al === 'right' ? d.x + d.w : d.x + d.w / 2;
  return { ax, y: d.y, w: d.w, h: d.h, al };
}
function layoutBoxes(W) {
  return { title: blockGeom(W, 'title'), lyric: blockGeom(W, 'lyric') };
}
// 정렬 기준점과 글자 폭으로 실제 글자가 차지하는 칸
function textRect(ax, al, tw, y, h) {
  const x = al === 'left' ? ax : al === 'right' ? ax - tw : ax - tw / 2;
  return { x, y, w: tw, h };
}
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// 제목 묶음 글자를 재고 차지하는 칸을 돌려준다
function measureTitle(g, b, u) {
  g.font = `700 ${22 * u}px ${FONT}`;
  const title = fitText(g, $('title').value.trim(), b.w);
  const tw1 = g.measureText(title).width;
  g.font = `500 ${15 * u}px ${FONT}`;
  const artist = fitText(g, $('artist').value.trim(), b.w);
  const tw2 = g.measureText(artist).width;
  const rect = textRect(b.ax, b.al, Math.max(tw1, tw2, 1), b.y, 31 * u + 18 * u);
  return { title, artist, rect };
}
// 아트 위에 얹히면 흰 글씨에 옅은 그림자, 아니면 배경에 맞는 색
function drawTitleBlock(g, b, m, u, fg, dim, onArt) {
  g.save();
  g.textAlign = b.al;
  g.textBaseline = 'top';
  if (onArt) { g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 8 * u; }
  g.fillStyle = onArt ? '#fff' : fg;
  g.font = `700 ${22 * u}px ${FONT}`;
  g.fillText(m.title, b.ax, b.y);
  g.fillStyle = onArt ? 'rgba(255,255,255,0.78)' : dim;
  g.font = `500 ${15 * u}px ${FONT}`;
  g.fillText(m.artist, b.ax, b.y + 31 * u);
  g.restore();
}

function render(g, W, t) {
  const H = heightOf(W);
  const u = W / 480;
  const T = duration();
  const light = state.bgMode === 'solid' && isLight($('bgColor').value);
  const fg = light ? '#161514' : '#ffffff';
  const dim = light ? 'rgba(22,21,20,0.5)' : 'rgba(255,255,255,0.6)';

  g.save();
  g.clearRect(0, 0, W, H);
  if (state.mode === 'yt') {
    drawVideoPage(g, W, H, u, t, T);
    drawStickers(g, W, t);
    g.restore();
    return;
  }
  drawBackground(g, W, H, t);

  if (still && still.items.length > 1) {
    // 문단 이미지: 위에 작은 아트와 제목, 아래를 가사가 채운다
    const s = 76 * u, x = 40 * u, y = 40 * u;
    if (state.mode === 'cd') {
      drawDisc(g, x + s / 2, y + s / 2, s / 2, u * 0.4, t, T);
    } else {
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.3)';
      g.shadowBlur = 16 * u;
      g.shadowOffsetY = 6 * u;
      g.beginPath(); g.roundRect(x, y, s, s, 8 * u); g.fillStyle = '#000'; g.fill();
      g.restore();
      g.save();
      g.beginPath(); g.roundRect(x, y, s, s, 8 * u); g.clip();
      drawArt(g, x, y, s, s, t);
      g.restore();
    }
    const tx = x + s + 18 * u, tw = W - tx - 40 * u;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillStyle = fg;
    g.font = `700 ${21 * u}px ${FONT}`;
    g.fillText(fitText(g, $('title').value.trim(), tw), tx, y + 14 * u);
    g.fillStyle = dim;
    g.font = `500 ${15 * u}px ${FONT}`;
    g.fillText(fitText(g, $('artist').value.trim(), tw), tx, y + 44 * u);
    drawLyrics(g, x, 168 * u, H - 44 * u, W - 80 * u, u, fg, dim, t, { align: 'left', big: 1.35, top: true, style: lyStyleOf() });
  } else if (state.mode === 'player') {
    const s = 352 * u, x = (W - s) / 2, y = 44 * u;
    drawGlow(g, W / 2, y + s / 2, s, false, u, t);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 30 * u;
    g.shadowOffsetY = 12 * u;
    g.beginPath(); g.roundRect(x, y, s, s, 14 * u);
    g.fillStyle = '#000'; g.fill();
    g.restore();
    g.save();
    g.beginPath(); g.roundRect(x, y, s, s, 14 * u); g.clip();
    drawArt(g, x, y, s, s, t);
    drawBokeh(g, x, y, s, s, t);
    const B = layoutBoxes(W);
    const tm = measureTitle(g, B.title, u);
    const onArt = overlaps(tm.rect, { x, y, w: s, h: s });
    // 제목이 아트 위에 있으면 그 뒤만 아래로 갈수록 어둡게 깐다
    if (onArt) {
      // 아래 끝은 이미지 아래 끝까지 닿게 해서 틈이 안 보이게
      const top = tm.rect.y - 40 * u, bot = y + s;
      const grad = g.createLinearGradient(0, top, 0, bot);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.62)');
      g.fillStyle = grad;
      g.fillRect(x, top, s, bot - top);
    }
    g.restore();
    drawTitleBlock(g, B.title, tm, u, fg, dim, onArt);
    drawLyrics(g, B.lyric.ax, B.lyric.y, B.lyric.y + B.lyric.h, B.lyric.w, u, fg, dim, t,
      { align: B.lyric.al, size: 21, next: $('nextLine').checked, prev: $('prevLine').checked, style: lyStyleOf() });
    // 아래 여백을 위 여백(44)과 맞춘다
    drawProgress(g, x, 534 * u, s, u, fg, dim, t, T);
    drawControls(g, W / 2, 583 * u, u, fg);
  } else {
    drawGlow(g, W / 2, 228 * u, 372 * u, true, u, t);
    drawDisc(g, W / 2, 228 * u, 186 * u, u, t, T);
    g.save();
    g.beginPath();
    g.arc(W / 2, 228 * u, 186 * u, 0, Math.PI * 2);
    g.arc(W / 2, 228 * u, 186 * u * 0.075, 0, Math.PI * 2);
    g.clip('evenodd');
    drawBokeh(g, W / 2 - 186 * u, 228 * u - 186 * u, 372 * u, 372 * u, t);
    g.restore();
    const B = layoutBoxes(W);
    const tm = measureTitle(g, B.title, u);
    const onDisc = overlaps(tm.rect, { x: W / 2 - 186 * u, y: 42 * u, w: 372 * u, h: 372 * u });
    drawTitleBlock(g, B.title, tm, u, fg, dim, onDisc);
    drawLyrics(g, B.lyric.ax, B.lyric.y, B.lyric.y + B.lyric.h, B.lyric.w, u, fg, dim, t,
      { align: B.lyric.al, size: 19, next: $('nextLine').checked, prev: $('prevLine').checked, style: lyStyleOf() });
    drawProgress(g, (W - 352 * u) / 2, 586 * u, 352 * u, u, fg, dim, t, T);
  }
  drawStickers(g, W, t);
  g.restore();
}

// ---------- 동영상 페이지 ----------
// 영상(16:9) + 아래쪽 재생바·조작 아이콘, 영상 제목, 채널 줄(프로필·채널 이름·구독자·구독, 좋아요·공유·저장)
// 상표(로고·이름)는 넣지 않고 배치와 버튼 모양만 따른다
const VID = { x: 12, y: 10, w: 456, h: 256.5 };
// 24칸 기준 아이콘. 직접 그린 단순한 모양
const ICONS = {
  play: { fill: 'M8 5v14l11-7z' },
  pause: { fill: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' },
  next: { fill: 'M6 6l8.5 6L6 18zM16 6h2.5v12H16z' },
  volume: { fill: 'M4 9h4l5-4v14l-5-4H4z', stroke: 'M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11' },
  cc: { stroke: 'M3.5 6.5h17v11h-17z' },
  gear: { stroke: 'M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zM12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6' },
  full: { stroke: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' },
  like: { stroke: 'M7.5 10.5V20H4.5V10.5zM7.5 10.5l3.6-6.2c.8-.9 2.4-.4 2.4 1v4.2h5a1.8 1.8 0 0 1 1.8 2.1l-1.3 6.9a1.8 1.8 0 0 1-1.8 1.5H7.5' },
  share: { stroke: 'M14 5l7 7-7 7M21 12H11a7 7 0 0 0-7 7' },
  save: { stroke: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14' },
  more: { fill: 'M12 5.5a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM12 15.3a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z' },
};
const iconPaths = {};
function icon(g, name, cx, cy, size, color, flip = false) {
  const d = ICONS[name];
  if (!iconPaths[name]) iconPaths[name] = { f: d.fill && new Path2D(d.fill), s: d.stroke && new Path2D(d.stroke) };
  const P = iconPaths[name];
  g.save();
  g.translate(cx, cy);
  if (flip) g.rotate(Math.PI);
  g.scale(size / 24, size / 24);
  g.translate(-12, -12);
  g.fillStyle = g.strokeStyle = color;
  g.lineWidth = 1.9;
  g.lineCap = g.lineJoin = 'round';
  if (P.f) g.fill(P.f);
  if (P.s) g.stroke(P.s);
  g.restore();
}

// 글자를 cy 높이에 세로 가운데로. 글꼴마다 위아래 여백이 달라서 실제 글자 높이를 재서 맞춘다
function textMetrics(g) {
  g.textBaseline = 'alphabetic';
  const m = g.measureText('가Ag');
  return { asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent };
}
function midText(g, text, x, cy) {
  const { asc, desc } = textMetrics(g);
  g.textBaseline = 'alphabetic';
  g.fillText(text, x, cy + (asc - desc) / 2);
}

function videoRect(u) { return { x: VID.x * u, y: VID.y * u, w: VID.w * u, h: VID.h * u }; }
// 자막 자리: 가운데 x와 아래 끝 y. 영상 안쪽으로만
function captionGeom(u) {
  const v = videoRect(u);
  const cx = Math.max(v.x + 60 * u, Math.min(v.x + v.w - 60 * u, v.x + v.w / 2 + state.capPos.dx * u));
  const bottom = Math.max(v.y + 34 * u, Math.min(v.y + v.h - 6 * u, v.y + v.h - 34 * u + state.capPos.dy * u));
  const maxW = Math.min(v.w * 0.82, 2 * Math.min(cx - v.x, v.x + v.w - cx) - 16 * u);
  return { cx, bottom, maxW };
}
let capRect = null;  // 미리보기에 그려진 자막 칸

function drawVideoPage(g, W, H, u, t, T) {
  const dark = $('ytDark').checked;
  const page = dark ? '#0f0f0f' : '#ffffff';
  const fg = dark ? '#f1f1f1' : '#0f0f0f';
  const dim = dark ? '#aaaaaa' : '#606060';
  const chip = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
  g.fillStyle = page;
  g.fillRect(0, 0, W, H);

  const v = videoRect(u);
  // 주변 빛: 어두운 화면에서는 영상 뒤로 번지고, 밝은 화면에서는 옅게
  if (state.glow !== 'off') {
    const { a, b, p } = imageAt(t);
    if (a) {
      const lv = levelAt(t);
      const amt = (parseFloat($('glowAmt').value) || 100) / 100;
      // 영상 둘레에만 퍼지게(페이지 배경색은 지킨다)
      // 영상 둘레로 번지는 빛. 번짐 범위를 올리면 페이지 전체로
      const base = (state.glow === 'vivid' ? 1 : 0.75) * (dark ? 1 : 0.45);
      const sc = 1 + 0.05 * lv;
      const one = (it, k) => {
        const sk = Math.round((0.12 + glowSpreadRaw() * 1.1) * 20) / 20;
        const c = vividGlowImage(it, Math.round(v.w), Math.round(v.h), sk);
        const w2 = c.width * sc, h2 = c.height * sc;
        g.globalAlpha = Math.min(1, base * (0.8 + 0.4 * lv) * amt) * k;
        g.drawImage(c, v.x + v.w / 2 - w2 / 2, v.y + v.h / 2 - h2 / 2, w2, h2);
      };
      g.save();
      g.globalCompositeOperation = dark ? 'screen' : 'source-over';
      one(a, 1);
      if (b && p > 0) one(b, p);
      g.restore();
    }
  }

  // 영상
  g.save();
  g.beginPath(); g.roundRect(v.x, v.y, v.w, v.h, 8 * u); g.clip();
  g.fillStyle = '#000';
  g.fillRect(v.x, v.y, v.w, v.h);
  drawArt(g, v.x, v.y, v.w, v.h, t);
  drawBokeh(g, v.x, v.y, v.w, v.h, t);
  // 자막: 아래쪽 가운데가 기본, 끌어서 옮긴 만큼 이동(영상 안에서만)
  const cap = captionGeom(u);
  const rec = {};
  // 가사 정렬: 자막 칸 안에서 왼쪽·가운데·오른쪽
  const cal = alignOf('lyric');
  const cax = cal === 'left' ? cap.cx - cap.maxW / 2 : cal === 'right' ? cap.cx + cap.maxW / 2 : cap.cx;
  drawLyrics(g, cax, v.y + 8 * u, cap.bottom, cap.maxW, u, '#ffffff', 'rgba(255,255,255,0.78)', t,
    { align: cal, size: 12, bottom: true, style: lyStyleOf(), record: rec, prev: $('prevLine').checked, next: $('nextLine').checked });
  if (g === ctx) capRect = rec.rect || null;
  // 아래쪽 조작 막대
  const grad = g.createLinearGradient(0, v.y + v.h - 46 * u, 0, v.y + v.h);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = grad;
  g.fillRect(v.x, v.y + v.h - 46 * u, v.w, 46 * u);
  const now = state.audio ? state.audio.a + t : t;
  const total = state.audio ? state.audio.buf.duration : T;
  const pr = total ? Math.min(1, now / total) : 0;
  const bx = v.x + 8 * u, bw = v.w - 16 * u, by = v.y + v.h - 25 * u;
  g.fillStyle = 'rgba(255,255,255,0.3)';
  g.fillRect(bx, by, bw, 2.4 * u);
  g.fillStyle = '#ff0033';
  g.fillRect(bx, by, bw * pr, 2.4 * u);
  g.beginPath(); g.arc(bx + bw * pr, by + 1.2 * u, 4.5 * u, 0, Math.PI * 2); g.fill();
  const iy = v.y + v.h - 11 * u, isz = 13 * u, white = '#ffffff';
  icon(g, 'pause', v.x + 18 * u, iy, isz, white);
  icon(g, 'next', v.x + 40 * u, iy, isz, white);
  icon(g, 'volume', v.x + 62 * u, iy, isz, white);
  g.fillStyle = white;
  g.font = `500 ${8 * u}px ${FONT}`;
  g.textAlign = 'left';
  midText(g, `${fmt(now)} / ${fmt(total)}`, v.x + 78 * u, iy);
  icon(g, 'full', v.x + v.w - 18 * u, iy, isz, white);
  icon(g, 'gear', v.x + v.w - 40 * u, iy, isz, white);
  icon(g, 'cc', v.x + v.w - 62 * u, iy, isz, white);
  g.font = `700 ${4.6 * u}px ${FONT}`;
  g.textAlign = 'center';
  midText(g, 'CC', v.x + v.w - 62 * u, iy);
  g.restore();

  // 영상 제목
  const artist = $('artist').value.trim(), song = $('title').value.trim();
  const vt = $('vTitle').value.trim() || [artist, song].filter(Boolean).join(' - ');
  g.fillStyle = fg;
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.font = `700 ${12.5 * u}px ${FONT}`;
  g.fillText(fitText(g, vt, v.w), v.x, v.y + v.h + 10 * u);

  // 채널 줄
  const ry = v.y + v.h + 44 * u;           // 줄 가운데
  const ar = 12 * u;
  const ax = v.x + ar;
  g.save();
  g.beginPath(); g.arc(ax, ry, ar, 0, Math.PI * 2); g.clip();
  const chName = $('chName').value.trim() || artist || '채널';
  if (avatar) drawCover(g, avatar.img, ax - ar, ry - ar, ar * 2, ar * 2);
  else {
    g.fillStyle = '#7b6cd9';
    g.fillRect(ax - ar, ry - ar, ar * 2, ar * 2);
    g.fillStyle = '#fff';
    g.font = `600 ${11 * u}px ${FONT}`;
    g.textAlign = 'center';
    midText(g, chName.slice(0, 1).toUpperCase(), ax, ry);
  }
  g.restore();

  const pill = (x, w, label, iconName, flip) => {
    const h = 22 * u;
    g.fillStyle = chip;
    g.beginPath(); g.roundRect(x, ry - h / 2, w, h, h / 2); g.fill();
    let tx = x + 10 * u;
    if (iconName) { icon(g, iconName, tx + 6 * u, ry, 12 * u, fg, flip); tx += 16 * u; }
    if (label) {
      g.fillStyle = fg;
      g.font = `600 ${8 * u}px ${FONT}`;
      g.textAlign = 'left';
      midText(g, label, tx, ry);
    }
  };
  const measure = (label, iconName) => {
    g.font = `600 ${8 * u}px ${FONT}`;
    return 20 * u + (iconName ? 16 * u : 0) + (label ? g.measureText(label).width : 0) - (label ? 0 : 4 * u);
  };

  // 오른쪽부터: ⋯, 오프라인 저장, 공유, 좋아요|싫어요
  const right = v.x + v.w;
  const moreW = 22 * u;
  g.fillStyle = chip;
  g.beginPath(); g.arc(right - moreW / 2, ry, moreW / 2, 0, Math.PI * 2); g.fill();
  icon(g, 'more', right - moreW / 2, ry, 13 * u, fg);
  let rx = right - moreW - 6 * u;
  const saveW = measure('오프라인 저장', 'save');
  const shareW = measure('공유', 'share');
  const likes = $('likes').value.trim();
  g.font = `600 ${8 * u}px ${FONT}`;
  const likeW = 26 * u + (likes ? g.measureText(likes).width + 4 * u : 0) + 30 * u;

  // 왼쪽: 채널 이름·구독자·구독 버튼
  const subs = $('subs').value.trim();
  const nx = ax + ar + 8 * u;
  const nameMax = 120 * u;
  g.textAlign = 'left';
  g.font = `600 ${9.5 * u}px ${FONT}`;
  const nameText = fitText(g, chName, nameMax);
  const nm = textMetrics(g);
  let leftEnd = nx + g.measureText(nameText).width;
  g.fillStyle = fg;
  if (!subs) midText(g, nameText, nx, ry);
  else {
    // 이름과 구독자 두 줄을 한 덩어리로 보고 세로 가운데
    g.font = `400 ${7.5 * u}px ${FONT}`;
    const sm = textMetrics(g);
    const st = fitText(g, subs, nameMax);
    const gapY = 3 * u;
    const total = nm.asc + nm.desc + gapY + sm.asc + sm.desc;
    const top = ry - total / 2;
    g.textBaseline = 'alphabetic';
    g.font = `600 ${9.5 * u}px ${FONT}`;
    g.fillText(nameText, nx, top + nm.asc);
    g.fillStyle = dim;
    g.font = `400 ${7.5 * u}px ${FONT}`;
    g.fillText(st, nx, top + nm.asc + nm.desc + gapY + sm.asc);
    leftEnd = Math.max(leftEnd, nx + g.measureText(st).width);
  }
  const subX = leftEnd + 12 * u;
  g.font = `600 ${8.5 * u}px ${FONT}`;
  const subW = g.measureText('구독').width + 22 * u;
  g.fillStyle = dark ? '#f1f1f1' : '#0f0f0f';
  g.beginPath(); g.roundRect(subX, ry - 11 * u, subW, 22 * u, 11 * u); g.fill();
  g.fillStyle = dark ? '#0f0f0f' : '#ffffff';
  g.textAlign = 'center';
  midText(g, '구독', subX + subW / 2, ry);
  const leftLimit = subX + subW + 10 * u;

  // 자리가 모자라면 오프라인 저장 → 공유 순으로 뺀다
  const fit = (w) => rx - w >= leftLimit;
  if (fit(saveW + 6 * u + shareW + 6 * u + likeW)) { rx -= saveW; pill(rx, saveW, '오프라인 저장', 'save'); rx -= 6 * u; }
  if (fit(shareW + 6 * u + likeW)) { rx -= shareW; pill(rx, shareW, '공유', 'share'); rx -= 6 * u; }
  if (fit(likeW)) {
    rx -= likeW;
    const h = 22 * u;
    g.fillStyle = chip;
    g.beginPath(); g.roundRect(rx, ry - h / 2, likeW, h, h / 2); g.fill();
    icon(g, 'like', rx + 16 * u, ry, 12 * u, fg);
    let tx = rx + 26 * u;
    if (likes) {
      g.fillStyle = fg;
      g.font = `600 ${8 * u}px ${FONT}`;
      g.textAlign = 'left';
      midText(g, likes, tx, ry);
      tx += g.measureText(likes).width + 4 * u;
    }
    g.fillStyle = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)';
    g.fillRect(tx + 4 * u, ry - 7 * u, 1 * u, 14 * u);
    icon(g, 'like', tx + 16 * u, ry, 12 * u, fg, true);
  }
}

// 채널 프로필 사진
let avatar = null;
function setAvatar(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (avatar) URL.revokeObjectURL(avatar.url);
    avatar = { url, img };
    $('avatarDrop').style.backgroundImage = `url("${url}")`;
    $('avatarDrop').classList.add('has');
  };
  img.src = url;
}

// ---------- 스티커 ----------
const STICKER_FX = [['none', '효과 없음'], ['blink', '깜빡'], ['twitch', '움찔'], ['boing', '뽀용'], ['wobble', '까딱'], ['glitch', '글리치']];

async function addStickers(files) {
  for (const f of [...files].filter((x) => x.type.startsWith('image/'))) {
    try {
      // 움직이는 GIF·WebP는 프레임을 다 풀어 둔다. 저장할 때 시각마다 정확한 프레임을 쓰려고
      let frames = null;
      if (window.ImageDecoder && /gif|webp/.test(f.type)) {
        const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: f.type });
        await dec.tracks.ready;
        const n = dec.tracks.selectedTrack.frameCount;
        if (n > 1) {
          frames = [];
          for (let i = 0; i < n; i++) {
            const { image } = await dec.decode({ frameIndex: i });
            frames.push({ bmp: await createImageBitmap(image), dur: Math.max(20, (image.duration || 100000) / 1000) });
            image.close();
          }
        }
        dec.close();
      }
      const url = URL.createObjectURL(f);
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      state.stickers.push({
        url, img, frames, total: frames ? frames.reduce((a, x) => a + x.dur, 0) : 0,
        x: 0.5, y: 0.5, size: 0.3, rot: 0, fx: 'none', seed: Math.floor(Math.random() * 1000),
      });
    } catch (e) {
      $('status').textContent = `스티커로 쓸 수 없는 파일입니다: ${f.name}`;
    }
  }
  renderStickers();
}

// 스티커가 (회전한 모양 그대로) 카드 안쪽 영역에 다 들어가도록 가운데 자리를 막는다.
// 영역보다 크면 그 방향으로는 가운데에 둔다
function clampSticker(st) {
  const W = 480, H = heightOf(480), m = EDGE;
  const { w, h } = stickerSize(st, W);
  const a = (st.rot * Math.PI) / 180;
  const hw = Math.abs((w / 2) * Math.cos(a)) + Math.abs((h / 2) * Math.sin(a));
  const hh = Math.abs((w / 2) * Math.sin(a)) + Math.abs((h / 2) * Math.cos(a));
  const fit = (v, half, size) => (half * 2 > size - m * 2 ? size / 2 : Math.max(m + half, Math.min(size - m - half, v)));
  st.x = fit(st.x * W, hw, W) / W;
  st.y = fit(st.y * H, hh, H) / H;
}

function stickerFrame(st, t) {
  if (!st.frames) return st.img;
  let ms = (t * 1000) % st.total;
  for (const fr of st.frames) { if (ms < fr.dur) return fr.bmp; ms -= fr.dur; }
  return st.frames[0].bmp;
}
function stickerSize(st, W) {
  const w = st.size * W;
  return { w, h: w * (st.img.naturalHeight / st.img.naturalWidth) };
}
// 주기를 전체 길이에 맞춰서 GIF가 처음으로 돌아갈 때 끊기지 않게
function loopFreq(period) {
  const T = duration();
  return Math.max(1, Math.round(T / period)) / T;
}
function stickerPose(st, t, u) {
  const TAU = Math.PI * 2;
  const p = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, alpha: 1, pivot: false, glitch: 0 };
  if (view.hideFx) return p;
  if (fxStatic()) { if (st.fx === 'glitch') p.glitch = 0.5; return p; }
  if (st.fx === 'blink') {
    p.alpha = (t * loopFreq(1.2)) % 1 > 0.82 ? 0 : 1;
  } else if (st.fx === 'twitch') {
    const k = Math.floor(t * 10);
    if (hash(k * 1.7 + st.seed) < 0.18) {
      p.dx = (hash(k + 1) - 0.5) * 10 * u;
      p.dy = (hash(k + 2) - 0.5) * 8 * u;
      p.rot = (hash(k + 3) - 0.5) * 0.12;
      p.sx = p.sy = 1.04;
    }
  } else if (st.fx === 'boing') {
    const ph = TAU * t * loopFreq(0.9);
    p.sx = 1 + 0.08 * Math.sin(ph);
    p.sy = 1 - 0.08 * Math.sin(ph);
    p.dy = -Math.max(0, Math.sin(ph)) * 8 * u;
  } else if (st.fx === 'wobble') {
    p.rot = Math.sin(TAU * t * loopFreq(1.4)) * 0.14;
    p.pivot = true;
  } else if (st.fx === 'glitch') {
    p.glitch = glitchBurst(t, st.seed, 0.15);
  }
  return p;
}
function drawStickers(g, W, t) {
  const u = W / 480, H = heightOf(W);
  for (const st of state.stickers) {
    const { w, h } = stickerSize(st, W);
    const p = stickerPose(st, t, u);
    if (p.alpha <= 0) continue;
    const src = stickerFrame(st, t);
    g.save();
    g.globalAlpha = p.alpha;
    g.translate(st.x * W + p.dx, st.y * H + p.dy);
    g.rotate((st.rot * Math.PI) / 180);
    // 까딱은 아래쪽 가운데를 축으로 흔든다
    if (p.pivot) { g.translate(0, h / 2); g.rotate(p.rot); g.translate(0, -h / 2); } else g.rotate(p.rot);
    g.scale(p.sx, p.sy);
    if (p.glitch > 0) {
      const W2 = Math.ceil(w), H2 = Math.ceil(h);
      if (gBase.width < W2 || gBase.height < H2) {
        gBase.width = gTint.width = Math.max(gBase.width, W2);
        gBase.height = gTint.height = Math.max(gBase.height, H2);
      }
      const bc = gBase.getContext('2d');
      bc.clearRect(0, 0, gBase.width, gBase.height);
      bc.drawImage(src, 0, 0, W2, H2);
      glitchBlit(g, W2, H2, -w / 2, -h / 2, p.alpha, p.glitch, u, t * 12 + st.seed, 10);
    } else {
      g.drawImage(src, -w / 2, -h / 2, w, h);
    }
    g.restore();
  }
}

function renderStickers() {
  const box = $('stickerList');
  box.innerHTML = '';
  state.stickers.forEach((st, i) => {
    const row = document.createElement('div');
    row.className = 'st-row' + (st === selSticker ? ' sel' : '');
    row.addEventListener('pointerdown', () => selectSticker(st, false));
    const im = document.createElement('img');
    im.src = st.url;
    im.alt = '';
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', '스티커 효과');
    for (const [v, label] of STICKER_FX) sel.add(new Option(label, v, false, st.fx === v));
    sel.onchange = () => { st.fx = sel.value; };
    const x = document.createElement('button');
    x.className = 'st-x';
    x.textContent = '×';
    x.setAttribute('aria-label', '스티커 빼기');
    x.onclick = () => removeSticker(st);
    const slider = (label, min, max, val, on) => {
      const wrap2 = document.createElement('label');
      wrap2.className = 'st-ctrl';
      const r = document.createElement('input');
      r.type = 'range'; r.min = min; r.max = max; r.value = val;
      r.oninput = () => on(parseFloat(r.value));
      wrap2.append(label, r);
      return wrap2;
    };
    row.append(im, sel, x,
      slider('크기', 5, 100, Math.round(st.size * 100), (v) => { st.size = v / 100; clampSticker(st); }),
      slider('회전', -180, 180, st.rot, (v) => { st.rot = v; clampSticker(st); }));
    box.append(row);
  });
}

// 스티커 고르기·지우기. 미리보기에서 누르면 스티커 탭을 연다
let selSticker = null;
function selectSticker(st, openTab = true) {
  if (selSticker === st) return;
  selSticker = st;
  if (st && openTab) showTab('sticker');
  // 줄을 다시 만들지 않고 표시만 바꾼다(슬라이더를 잡은 채로 고를 때 끊기지 않게)
  [...$('stickerList').children].forEach((row, i) => row.classList.toggle('sel', state.stickers[i] === st));
  if (st) {
    const row = $('stickerList').children[state.stickers.indexOf(st)];
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
}
function removeSticker(st) {
  URL.revokeObjectURL(st.url);
  state.stickers.splice(state.stickers.indexOf(st), 1);
  if (selSticker === st) selSticker = null;
  renderStickers();
}

let discCanvas = null;
function drawDisc(g, cx, cy, R, u, t, T) {
  const size = Math.ceil(R * 2 + 4);
  if (!discCanvas || discCanvas.width !== size) {
    discCanvas = document.createElement('canvas');
    discCanvas.width = discCanvas.height = size;
  }
  const d = discCanvas.getContext('2d');
  const c = size / 2;
  d.clearRect(0, 0, size, size);

  // 루프가 끊기지 않도록 전체 길이 동안 정수 바퀴만 돈다
  const turns = Math.max(1, Math.round(T / CD_TURN));
  // 디스크 각도: 멈춘 화면·이미지 저장은 정한 각도 그대로, 재생은 그 각도에서 출발해 돈다
  const off = ((parseFloat($('discAngle').value) || 0) * Math.PI) / 180;
  const ang = $('spin').checked && !fxStatic() ? off + (t / T) * turns * Math.PI * 2 : off;

  d.save();
  d.beginPath(); d.arc(c, c, R, 0, Math.PI * 2); d.clip();
  d.translate(c, c); d.rotate(ang); d.translate(-c, -c);
  drawArt(d, c - R, c - R, R * 2, R * 2, t);
  d.restore();

  // 결 (회전해도 똑같아 보이는 동심원)
  d.lineWidth = 1;
  for (let r = R * 0.42; r < R * 0.98; r += R * 0.045) {
    d.strokeStyle = 'rgba(255,255,255,0.05)';
    d.beginPath(); d.arc(c, c, r, 0, Math.PI * 2); d.stroke();
  }
  // 고정된 빛 반사
  d.save();
  d.beginPath(); d.arc(c, c, R, 0, Math.PI * 2); d.clip();
  const sheen = d.createLinearGradient(c - R, c - R, c + R, c + R);
  sheen.addColorStop(0, 'rgba(255,255,255,0.18)');
  sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.65, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.10)');
  d.fillStyle = sheen;
  d.fillRect(0, 0, size, size);
  d.restore();

  // 가운데 투명 허브
  d.fillStyle = 'rgba(235,235,235,0.55)';
  d.beginPath(); d.arc(c, c, R * 0.22, 0, Math.PI * 2); d.fill();
  d.strokeStyle = 'rgba(255,255,255,0.7)';
  d.lineWidth = 1.2 * u;
  d.beginPath(); d.arc(c, c, R * 0.22, 0, Math.PI * 2); d.stroke();
  d.strokeStyle = 'rgba(0,0,0,0.12)';
  d.beginPath(); d.arc(c, c, R * 0.15, 0, Math.PI * 2); d.stroke();
  // 구멍
  d.globalCompositeOperation = 'destination-out';
  d.beginPath(); d.arc(c, c, R * 0.075, 0, Math.PI * 2); d.fill();
  d.globalCompositeOperation = 'source-over';
  // 테두리
  d.strokeStyle = 'rgba(255,255,255,0.35)';
  d.lineWidth = 1.2 * u;
  d.beginPath(); d.arc(c, c, R - 0.6 * u, 0, Math.PI * 2); d.stroke();

  g.save();
  g.shadowColor = 'rgba(0,0,0,0.4)';
  g.shadowBlur = 34 * u;
  g.shadowOffsetY = 14 * u;
  g.drawImage(discCanvas, cx - c, cy - c);
  g.restore();
}

// ---------- 미리보기 ----------
// 화면 비율(세로/가로). 동영상 페이지는 가로라서 저장 크기도 1.6배로 잡는다
function ratio() { return state.mode === 'yt' ? 0.72 : 4 / 3; }
function heightOf(W) { return Math.round(W * ratio()); }
function exportWidth() { return Math.round(parseInt($('size').value, 10) * (state.mode === 'yt' ? 1.6 : 1)); }
function syncSizeLabels() {
  for (const o of $('size').options) {
    const w = Math.round(parseInt(o.value, 10) * (state.mode === 'yt' ? 1.6 : 1));
    o.textContent = `${w} × ${heightOf(w)}`;
  }
}

function sizeStage() {
  const W = exportWidth(), H = heightOf(W);
  if (stage.width !== W || stage.height !== H) { stage.width = W; stage.height = H; }
}

// 트위터 GIF 한도(350장) 안에 들도록 초당 장 수를 낮춘다
// 내보낼 구간(미리보기 시간 기준 [s, e]). 구간만 저장을 끄면 전체
// 칸에는 노래가 있으면 원곡 시각, 없으면 미리보기 시각을 쓴다
function songOffset() { return state.audio ? state.audio.a : 0; }
function exportRange() {
  const T = duration();
  if (!$('rangeOn').checked) return { s: 0, e: T };
  const off = songOffset();
  let a = parseTime($('rangeA').value), b = parseTime($('rangeB').value);
  a = isNaN(a) ? 0 : a - off;
  b = isNaN(b) ? T : b - off;
  a = Math.max(0, Math.min(T - 0.2, a));
  b = Math.max(a + 0.2, Math.min(T, b));
  return { s: a, e: b };
}
function syncRange() {
  const on = $('rangeOn').checked;
  $('rangeRow').hidden = $('rangeBtns').hidden = !on;
  if (on && !$('rangeA').value) {
    const off = songOffset();
    $('rangeA').value = fmtTenth(off);
    $('rangeB').value = fmtTenth(off + duration());
  }
  updateInfo();
}

function gifPlan() {
  const R = exportRange();
  const T = R.e - R.s;
  const want = parseInt($('fps').value, 10);
  let fps = want;
  for (const f of [25, 20, 10, 5]) {
    if (f > want) continue;
    fps = f;
    if (Math.round(T * f) <= GIF_MAX_FRAMES) break;
  }
  const frames = Math.max(1, Math.round(T * fps));
  return { T, start: R.s, fps, frames, lowered: fps < want, over: frames > GIF_MAX_FRAMES };
}

function updateInfo() {
  const T = duration();
  $('seek').max = T;
  refreshThumbSecs();
  if (state.t > T && !state.tap) state.t = 0;
  const p = gifPlan();
  let s = `${$('rangeOn').checked ? '구간 ' : ''}${fmt(p.T)} · GIF ${p.frames}장`;
  if (p.over) s += ' — 트위터 GIF는 350장까지라 구간을 줄여야 합니다';
  else if (p.lowered) s += ` · 트위터 350장 한도라 초당 ${p.fps}장으로 낮춤`;
  if (view.hideFx) s += ' · 효과 숨김 상태로 저장됩니다';
  $('exportInfo').textContent = s;
}


let last = performance.now();
function tick(now) {
  const dt = (now - last) / 1000;
  last = now;
  const T = duration();
  if (state.playing && !state.busy) {
    if (state.audio && src && actx) state.t = audioClock();
    else state.t = (state.t + dt) % T;
  }
  sizeStage();
  view.frozen = !state.playing && !state.tap;
  render(ctx, stage.width, state.t);
  view.frozen = false;
  drawGuides();
  drawWave();
  sceneTick();
  markNowLine();
  stageWash(now);
  $('seek').value = Math.min(state.t, T);
  // 노래가 있으면 원곡 시각으로(가사 카드의 시각과 같은 기준)
  $('time').textContent = state.audio
    ? `${fmtTenth(state.audio.a + Math.min(state.t, T))} / ${fmt(state.audio.buf.duration)}`
    : `${fmt(Math.min(state.t, T))} / ${fmt(T)}`;
  requestAnimationFrame(tick);
}

function setPlaying(v) {
  state.playing = v;
  $('play').textContent = v ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', v ? '일시정지' : '재생');
  if (v) restartAudio(); else stopAudio();
}

// 무대 배경이 지금 그림의 밝은 색으로 은은하게 물든다(편집 화면만, 저장과는 무관)
let washAt = 0, washKey = '';
function stageWash(now) {
  document.body.classList.toggle('playing', state.playing && !state.busy);
  if (now - washAt < 300) return;
  washAt = now;
  const it = imageAt(state.t).a;
  const pal = it ? paletteOf(it) : null;
  const key = pal ? pal.join() : '';
  if (key === washKey) return;
  washKey = key;
  const wrap = document.querySelector('.canvas-wrap');
  if (!pal) { for (const k of ['--amb1', '--amb2', '--amb3']) wrap.style.removeProperty(k); return; }
  const c = (rgb) => `rgb(${rgb.join(',')})`;
  wrap.style.setProperty('--amb1', c(pal[0]));
  wrap.style.setProperty('--amb2', c(pal[2 % pal.length]));
  wrap.style.setProperty('--amb3', c(pal[4 % pal.length]));
}

// 가사 카드에서 지금 나오는 줄을 표시
let nowKey = null;
function markNowLine() {
  const l = lyricAt(state.t);
  const key = l && l.text ? l.text : '';
  if (key === nowKey) return;
  nowKey = key;
  let done = false;
  for (const row of document.querySelectorAll('.lrow')) {
    const on = !done && key && row.dataset.text === key;
    row.classList.toggle('now', !!on);
    if (on) done = true;
  }
}

// ---------- 장면 카드: 이미지나 가사 줄이 바뀌는 순간마다 한 장 ----------
const SCENE_MAX = 200;
function sceneList() {
  const T = duration();
  const cuts = new Set([0]);
  // 이미지가 바뀌는 순간 (초마다는 한 바퀴를 길이만큼 되풀이)
  if (state.images.length > 1) {
    const sc = imageSchedule();
    if (sc.period > 0) {
      for (let base = 0; base < T && cuts.size < SCENE_MAX; base += sc.period) {
        for (const sg of sc.segs) if (base + sg.start < T) cuts.add(Math.round((base + sg.start) * 100) / 100);
      }
    }
  }
  // 가사 줄이 바뀌는 순간
  const lyr = parseLyrics();
  if (lyr.lines.length) {
    const base = lyr.timed ? songBase(lyr) : 0;
    const shift = parseFloat($('shift').value) || 0;
    for (const l of lyr.lines) {
      const at = l.start - base + shift;
      if (at > 0 && at < T) cuts.add(Math.round(at * 100) / 100);
    }
  }
  const list = [...cuts].sort((a, b) => a - b).slice(0, SCENE_MAX);
  // 거의 붙은 경계(0.15초 안)는 하나로
  const out = [];
  for (const c of list) if (!out.length || c - out[out.length - 1] > 0.15) out.push(c);
  return out.map((start, i) => ({ start, end: i + 1 < out.length ? out[i + 1] : T }));
}
// 카드를 눌렀을 때 보여 줄 시각: 전환·가사 페이드가 끝난 뒤
function sceneShowAt(sc) {
  return sc.start + Math.min(0.45, (sc.end - sc.start) / 2);
}

let sceneSig = '', scenes = [], sceneCheck = 0, sceneOn = -1;
function sceneSignature() {
  const imgs = state.images.map((it) => [it.url, it.fx, it.fy, it.zoom, it.sec, it.lsec].join());
  const sts = state.stickers.map((st) => [st.url, st.x, st.y, st.size, st.rot, st.fx].join());
  const au = state.audio ? [state.audio.a, state.audio.b].join() : '';
  return JSON.stringify([settingsObj(), imgs, sts, au, FONT]);
}
function buildScenes() {
  const box = $('scenes');
  scenes = sceneList();
  box.innerHTML = '';
  sceneOn = -1;
  const TW = 84;
  scenes.forEach((sc, i) => {
    const b = document.createElement('button');
    b.className = 'scene';
    const c = document.createElement('canvas');
    c.width = TW; c.height = heightOf(TW);
    view.frozen = true;
    render(c.getContext('2d'), TW, sceneShowAt(sc));
    view.frozen = false;
    const tm = document.createElement('span');
    tm.className = 'sc-time';
    tm.textContent = fmtTenth((state.audio ? state.audio.a : 0) + sc.start);
    const l = lyricAt(sceneShowAt(sc));
    const tx = document.createElement('span');
    tx.className = 'sc-text';
    tx.textContent = l && l.text ? l.text : ' ';
    b.append(c, tm, tx);
    b.setAttribute('aria-label', `${fmtTenth(sc.start)} 장면`);
    b.onclick = () => {
      setPlaying(false);
      state.t = sceneShowAt(sc);
    };
    box.append(b);
  });
}
function sceneTick() {
  // 바뀐 게 있으면 카드를 다시 그린다. 매 장면마다 그리지 않게 0.5초에 한 번만 본다
  const now = performance.now();
  if (!state.busy && !sdrag && now - sceneCheck > 500) {
    sceneCheck = now;
    const sig = sceneSignature();
    if (sig !== sceneSig) { sceneSig = sig; buildScenes(); }
  }
  // 지금 보고 있는 장면 표시
  let on = -1;
  for (let i = 0; i < scenes.length; i++) if (state.t >= scenes[i].start - 1e-6 && state.t < scenes[i].end) { on = i; break; }
  if (on !== sceneOn) {
    const cards = $('scenes').children;
    if (cards[sceneOn]) cards[sceneOn].classList.remove('on');
    if (cards[on]) {
      cards[on].classList.add('on');
      const box = $('scenes'), el = cards[on];
      // 줄 안에서만 옆으로 넘긴다(페이지는 안 움직이게)
      if (el.offsetLeft < box.scrollLeft || el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth) {
        box.scrollLeft = el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2;
      }
    }
    sceneOn = on;
  }
}

// ---------- 저장 ----------
function fileBase() {
  const s = [$('artist').value.trim(), $('title').value.trim()].filter(Boolean).join(' - ');
  return (s || 'spincard').replace(/[\\/:*?"<>|]/g, '_');
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- 이미지 저장: 줄(문단) × 이미지 조합 중에서 골라 저장 ----------
function stillUnits() {
  const lyr = parseLyrics();
  const base = lyr.timed ? songBase(lyr) : 0;
  const lines = lyr.lines.filter((l) => l.text);
  const marked = anyMarked();
  const item = (l, i) => ({ text: l.text, ...noteOf(l.text), glitch: marked && !noteOf(l.text).gl ? 0 : 0.35, at: i + 1 });
  if (!lines.length) return [{ label: '', t: state.t, items: [] }];
  if (state.unit === 'para') {
    const groups = [];
    for (const l of lines) {
      const g = groups[groups.length - 1];
      if (g && g.para === l.para) g.lines.push(l); else groups.push({ para: l.para, lines: [l] });
    }
    // 한 문단이 너무 길면 카드 한 장에 다 안 들어가서 4줄씩 나눈다
    const chunks = [];
    for (const g of groups) {
      if (g.lines.length <= 6) chunks.push(g.lines);
      else for (let i = 0; i < g.lines.length; i += 4) chunks.push(g.lines.slice(i, i + 4));
    }
    return chunks.map((ls, i) => ({ label: ls[0].text, t: ls[0].start - base, items: ls.map((l, j) => item(l, i * 50 + j)) }));
  }
  return lines.map((l, i) => ({ label: l.text, t: l.start - base, items: [item(l, i)] }));
}

let picks = [];
function renderStill(g, W, pk) {
  if (pk.now) { render(g, W, state.t); return; }
  still = { img: pk.img, items: pk.unit.items };
  try { render(g, W, pk.unit.t); } finally { still = null; }
}

let pickJob = 0;
async function openPicker() {
  $('picker').hidden = false;
  const job = ++pickJob;
  const grid = $('pickGrid');
  grid.innerHTML = '';
  const imgs = state.images.length ? state.images : [null];
  picks = [{ now: true, label: '지금 장면', sel: false }];
  stillUnits().forEach((unit, ui) => imgs.forEach((img, ii) => {
    picks.push({ unit, img, label: unit.label, name: `${String(ui + 1).padStart(2, '0')}${imgs.length > 1 ? '-' + (ii + 1) : ''}`, sel: false });
  }));
  updatePickCount();
  const TW = 180;
  for (let i = 0; i < picks.length; i++) {
    if (job !== pickJob) return;
    const pk = picks[i];
    const b = document.createElement('button');
    b.className = 'pick';
    b.setAttribute('aria-pressed', 'false');
    const c = document.createElement('canvas');
    c.width = TW; c.height = heightOf(TW);
    renderStill(c.getContext('2d'), TW, pk);
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = '✓';
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = pk.label || ' ';
    b.append(c, mark, cap);
    b.onclick = () => {
      pk.sel = !pk.sel;
      b.setAttribute('aria-pressed', String(pk.sel));
      updatePickCount();
    };
    pk.el = b;
    grid.append(b);
    if (i % 6 === 5) await nextTick();
  }
}
function updatePickCount() {
  const n = picks.filter((p) => p.sel).length;
  $('pickCount').textContent = n ? `${n}장 고름` : '';
  $('pickSave').disabled = !n;
  $('pickAll').textContent = n === picks.length ? '모두 풀기' : '모두 고르기';
}
async function savePicks() {
  const type = $('stillFmt').value === 'jpg' ? 'image/jpeg' : 'image/png';
  const ext = type === 'image/png' ? '.png' : '.jpg';
  const W = exportWidth();
  const chosen = picks.filter((p) => p.sel);
  for (const pk of chosen) {
    const c = document.createElement('canvas');
    c.width = W; c.height = heightOf(W);
    const g = c.getContext('2d');
    if (type === 'image/jpeg') { g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); }
    renderStill(g, W, pk);
    const blob = await new Promise((r) => c.toBlob(r, type, 0.92));
    download(blob, fileBase() + (pk.now ? '' : ' ' + pk.name) + ext);
    // 여러 장을 한꺼번에 받으면 브라우저가 막을 수 있어 조금씩 띄운다
    await new Promise((r) => setTimeout(r, 250));
  }
  $('status').textContent = `이미지 ${chosen.length}장 저장됨`;
}

// ---------- 가사 카드 ----------
// 글자 칸(#lyrics)이 원본이다. 카드는 그걸 문단·줄로 나눠 보여 주고, 고치면 원본에 다시 쓴다
const STAMP_RE = /^(\s*\[\d+:\d+(?:\.\d+)?\])+/;
const DUR_RE = /^\s*\[\d+(?:\.\d+)?\]/;
const lsel = new Set();   // 고른 줄(원본 줄 번호)
let lopen = -1;           // 펼친 줄
function rawRows() {
  return $('lyrics').value.split('\n').map((raw, i) => {
    let prefix = '', rest = raw;
    const m = raw.match(STAMP_RE);
    if (m) { prefix = m[0]; rest = raw.slice(prefix.length); } else {
      const d = raw.match(DUR_RE);
      if (d) { prefix = d[0]; rest = raw.slice(prefix.length); }
    }
    return { i, raw, prefix: prefix.trim(), text: rest.trim() };
  });
}
// 빈 줄(또는 글자 없는 시간표 줄)에서 문단을 나눈다
function rawParagraphs(rows) {
  const paras = [];
  let cur = null;
  for (const r of rows) {
    if (!r.text) { cur = null; continue; }
    if (!cur) { cur = []; paras.push(cur); }
    cur.push(r);
  }
  return paras;
}
function stampSec(prefix) {
  const m = prefix.match(/\[(\d+):(\d+(?:\.\d+)?)\]/);
  return m ? parseInt(m[1], 10) * 60 + parseFloat(m[2]) : null;
}
// [번역]·[발음] 줄은 바로 위 가사 줄에 붙이고 가사에서는 뺀다.
// graft: 위 가사가 시간 없는 줄이고 이미 들어 있는 가사에 같은 줄이 있으면 새로 넣지 않고 기존 줄에 옮겨 붙인다
const NOTE_RE = /^\s*\[(번역|발음)\]\s*(.*)$/;
const normLine = (x) => x.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
function absorbNotes(text, graft) {
  const existing = new Map();
  if (graft) for (const r of rawRows()) if (r.text && r.prefix && STAMP_RE.test(r.prefix)) existing.set(normLine(r.text), r.text);
  const out = [];
  let last = null;       // { idx(out 위치), text, target(노트를 붙일 글자), drop }
  let grafted = 0;
  for (const line of text.split('\n')) {
    const m = line.match(NOTE_RE);
    if (m) {
      if (last && m[2].trim()) {
        noteSet(last.target, m[1] === '번역' ? 'tr' : 'p', m[2].trim());
        if (last.drop && !last.counted) { grafted++; last.counted = true; }
      }
      continue;
    }
    const st = line.match(STAMP_RE);
    const body = (st ? line.slice(st[0].length) : line).trim();
    if (!body) { out.push(line); last = null; continue; }
    const hit = !st && graft ? existing.get(normLine(body)) : null;
    last = { target: hit || body, drop: !!hit };
    if (!hit) out.push(line);
  }
  // 옮겨 붙인 줄만 있던 자리에 빈 줄이 몰리지 않게 정리
  const cleaned = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned, grafted };
}
// 입력된 그대로 복사. 발음·번역이 있으면 그 줄 아래 [번역]·[발음]으로 같이(다시 붙여넣으면 그대로 돌아온다)
function lyricsForCopy() {
  const out = [];
  for (const r of rawRows()) {
    out.push(r.raw);
    const n = r.text && notes[r.text];
    if (n && n.tr) out.push(`[번역] ${n.tr}`);
    if (n && n.p) out.push(`[발음] ${n.p}`);
  }
  return out.join('\n');
}

function setLyricsRaw(text) {
  $('lyrics').value = text;
  updateInfo();
  saveSettings();
  renderNotes();
}
// 그 줄이 나오는 미리보기 시각
function rowClipTime(r) {
  const lyr = parseLyrics();
  const shift = parseFloat($('shift').value) || 0;
  let start;
  if (lyr.timed) {
    const s0 = stampSec(r.prefix);
    if (s0 == null) return null;
    start = s0 - songBase(lyr) + shift;
  } else {
    const k = rawRows().filter((x) => x.text && x.i < r.i).length;
    const l = lyr.lines[k];
    if (!l) return null;
    start = l.start + shift;
  }
  return start;
}
function noteSet(text, key, val) {
  notes[text] = { ...(notes[text] || {}), [key]: val };
  const n = notes[text];
  if (!n.p && !n.tr && !n.gl) delete notes[text];
  saveSettings();
}

const lfold = new Set();  // 접은 문단(첫 줄 번호)
function renderNotes() {
  const box = $('lyricCards');
  if (!box) return;
  const rows = rawRows();
  const paras = rawParagraphs(rows);
  for (const i of [...lsel]) if (!rows[i] || !rows[i].text) lsel.delete(i);
  const q = $('lyricSearch').value.trim().toLowerCase();
  box.innerHTML = '';
  $('selBar').hidden = !paras.length;
  $('lyricTools').hidden = !paras.length;
  $('foldAll').textContent = paras.length && paras.every((pa) => lfold.has(pa[0].i)) ? '모두 펴기' : '모두 접기';
  const match = (r) => {
    if (!q) return true;
    const n = notes[r.text] || {};
    return [r.text, n.p, n.tr].some((x) => x && x.toLowerCase().includes(q));
  };
  let shown = 0;
  paras.forEach((para) => {
    const hits = para.filter(match);
    if (!hits.length) return;
    const folded = !q && lfold.has(para[0].i);
    const card = document.createElement('div');
    card.className = 'lcard' + (folded ? ' folded' : '');
    // 머리줄: 시각 · 첫 줄 · 줄 수. 누르면 접기
    const head = document.createElement('button');
    head.className = 'lhead';
    head.setAttribute('aria-expanded', String(!folded));
    const t0 = stampSec(para[0].prefix);
    head.innerHTML = '<span class="chev">▾</span><span class="lh-time"></span><span class="lh-text"></span><span class="lh-count"></span>';
    head.querySelector('.lh-time').textContent = t0 == null ? '' : fmt(t0);
    head.querySelector('.lh-text').textContent = para[0].text;
    head.querySelector('.lh-count').textContent = `${para.length}줄`;
    head.addEventListener('click', () => {
      if (lfold.has(para[0].i)) lfold.delete(para[0].i); else lfold.add(para[0].i);
      renderNotes();
    });
    card.append(head);
    if (!folded) for (const r of (q ? hits : para)) {
      shown++;
      const n = notes[r.text] || {};
      const row = document.createElement('div');
      row.className = 'lrow' + (lsel.has(r.i) ? ' sel' : '') + (lopen === r.i ? ' open' : '');
      row.dataset.text = r.text;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = lsel.has(r.i);
      cb.setAttribute('aria-label', '줄 고르기');
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => { if (cb.checked) lsel.add(r.i); else lsel.delete(r.i); row.classList.toggle('sel', cb.checked); syncSelBar(); });
      const tm = document.createElement('span');
      tm.className = 'ltime';
      const sec = stampSec(r.prefix);
      tm.textContent = sec == null ? '' : fmt(sec);
      const tx = document.createElement('span');
      tx.className = 'ltext';
      if (q && r.text.toLowerCase().includes(q)) {
        // 찾은 글자 표시
        const k = r.text.toLowerCase().indexOf(q);
        const mk = document.createElement('mark');
        mk.textContent = r.text.slice(k, k + q.length);
        tx.append(r.text.slice(0, k), mk, r.text.slice(k + q.length));
      } else tx.textContent = r.text;
      const badges = document.createElement('span');
      badges.className = 'lbadges';
      for (const [k, label] of [['p', '발음'], ['tr', '번역'], ['gl', '글리치']]) {
        if (!n[k]) continue;
        const b = document.createElement('i');
        b.textContent = label;
        badges.append(b);
      }
      row.append(cb, tm, tx, badges);
      row.addEventListener('click', () => {
        lopen = lopen === r.i ? -1 : r.i;
        if (lopen === r.i) goToRow(r);
        renderNotes();
      });
      card.append(row);
      if (lopen === r.i) card.append(lineEditor(r));
    }
    box.append(card);
  });
  if (q && !shown && !box.children.length) {
    const e = document.createElement('div');
    e.className = 'msg';
    e.textContent = `"${$('lyricSearch').value.trim()}"이(가) 든 줄이 없습니다`;
    box.append(e);
  }
  syncSelBar();
}
// 그 줄이 보이는 시각으로 미리보기 이동
function goToRow(r) {
  const at = rowClipTime(r);
  if (at == null) return;
  setPlaying(false);
  state.t = Math.max(0, Math.min(duration() - 0.01, at + 0.45));
}

// 펼친 줄의 편집: 가사 글자, 발음, 번역, 이 줄에만 글리치
function lineEditor(r) {
  const ed = document.createElement('div');
  ed.className = 'ledit';
  const mk = (val, ph, label, on) => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = val || '';
    if (ph) inp.placeholder = ph;
    inp.setAttribute('aria-label', label);
    inp.addEventListener('input', () => on(inp.value));
    return inp;
  };
  const text = mk(r.text, '', '가사', () => {});
  text.addEventListener('change', () => {
    const v = text.value.trim();
    if (!v || v === r.text) return;
    // 줄 글자가 바뀌면 그 줄의 발음·번역·글리치도 따라간다
    if (notes[r.text] && !notes[v]) { notes[v] = notes[r.text]; delete notes[r.text]; }
    const rows = $('lyrics').value.split('\n');
    rows[r.i] = (r.prefix ? r.prefix + ' ' : '') + v;
    setLyricsRaw(rows.join('\n'));
  });
  // 시간: 원곡 기준. 직접 고치거나 0.1초씩 앞뒤로
  const setTime = (sec) => {
    const rows = $('lyrics').value.split('\n');
    const pre = sec == null ? '' : fmtLrc(Math.max(0, sec)) + ' ';
    rows[r.i] = pre + r.text;
    setLyricsRaw(rows.join('\n'));
    const nr = rawRows()[r.i];
    if (nr) goToRow(nr);
    renderNotes();
  };
  const cur = stampSec(r.prefix);
  const trow = document.createElement('div');
  trow.className = 'row';
  const back = document.createElement('button');
  back.className = 'btn sm';
  back.textContent = '◀ 0.1초';
  back.setAttribute('aria-label', '0.1초 앞으로');
  const time = document.createElement('input');
  time.type = 'text';
  time.value = cur == null ? '' : fmtLrc(cur).slice(1, -1);
  time.placeholder = '0:00.00';
  time.setAttribute('aria-label', '시작 시각');
  time.className = 'ltime-in';
  const fwd = document.createElement('button');
  fwd.className = 'btn sm';
  fwd.textContent = '0.1초 ▶';
  fwd.setAttribute('aria-label', '0.1초 뒤로');
  back.onclick = () => setTime((stampSec(r.prefix) ?? rowClipTime(r) ?? 0) - 0.1);
  fwd.onclick = () => setTime((stampSec(r.prefix) ?? rowClipTime(r) ?? 0) + 0.1);
  time.addEventListener('change', () => {
    const v = time.value.trim();
    if (!v) { setTime(null); return; }
    const sec = parseTime(v);
    if (!isNaN(sec)) setTime(sec);
  });
  trow.append(back, time, fwd);
  const n = notes[r.text] || {};
  const pron = mk(n.p, '발음', '발음', (v) => noteSet(r.text, 'p', v));
  const trans = mk(n.tr, '번역', '번역', (v) => noteSet(r.text, 'tr', v));
  [pron, trans].forEach((x) => x.addEventListener('change', renderNotes));
  const gl = document.createElement('label');
  gl.className = 'check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!n.gl;
  cb.addEventListener('change', () => { noteSet(r.text, 'gl', cb.checked); renderNotes(); });
  gl.append(cb, '이 줄에만 글리치');
  ed.append(trow, text, pron, trans, gl);
  return ed;
}

function syncSelBar() {
  const rows = rawRows().filter((r) => r.text);
  const n = lsel.size;
  $('selAll').checked = n > 0 && n === rows.length;
  $('selAll').indeterminate = n > 0 && n < rows.length;
  $('selCount').textContent = n ? `${n}줄` : '';
  for (const id of ['selKeep', 'selDel', 'selGlitch']) $(id).disabled = !n;
  const texts = rows.filter((r) => lsel.has(r.i)).map((r) => r.text);
  const allOn = texts.length && texts.every((t) => notes[t] && notes[t].gl);
  $('selGlitch').textContent = allOn ? '글리치 끄기' : '글리치 켜기';
}
// 고른 줄만 남기거나 지운다. 문단 나눔은 남은 줄 사이에서 지킨다
function editSelected(keep) {
  const rows = rawRows();
  const out = [];
  for (const para of rawParagraphs(rows)) {
    const left = para.filter((r) => lsel.has(r.i) === keep);
    if (!left.length) continue;
    if (out.length) out.push('');
    for (const r of left) out.push(r.raw);
  }
  lsel.clear();
  lopen = -1;
  setLyricsRaw(out.join('\n'));
}

// 붙여넣기 칸: 붙여넣거나 Ctrl+Enter, 또는 칸을 벗어나면 카드로 넣는다
function commitLyricInput() {
  const inp = $('lyricInput');
  const raw = inp.value.trim();
  if (!raw) return;
  inp.value = '';
  const { text, grafted } = absorbNotes(raw, true);
  const cur = $('lyrics').value.replace(/\s+$/, '');
  if (text) setLyricsRaw(cur ? cur + '\n\n' + text : text);
  else renderNotes();
  if (grafted) $('lyricMsg').textContent = `${grafted}줄에 번역·발음을 붙였습니다`;
}

const saveLabels = {};
function beginBusy(which) {
  state.busy = true;
  state.cancel = false;
  stopAudio();
  if (state.tap) endTap('');
  saveLabels[which] = $(which).innerHTML;
  $(which).textContent = '멈추기';
  for (const id of ['saveMp4', 'saveGif', 'saveStill']) if (id !== which) $(id).disabled = true;
}
function endBusy(which) {
  state.busy = false;
  $(which).innerHTML = saveLabels[which];
  for (const id of ['saveMp4', 'saveGif', 'saveStill']) $(id).disabled = false;
  restartAudio();
}
const nextTick = () => new Promise((r) => setTimeout(r, 0));

async function saveGif() {
  if (state.busy) { state.cancel = true; return; }
  const { GIFEncoder, quantize, applyPalette } = window.gifenc;
  const W = exportWidth(), H = heightOf(W);
  const { T, start, fps, frames } = gifPlan();
  const delay = 1000 / fps;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  const gif = GIFEncoder();
  beginBusy('saveGif');

  // 앞 장과 똑같은 장면은 합쳐서 보이는 시간만 늘린다
  let prev = null, prevDelay = 0;
  const flush = () => {
    if (!prev) return;
    const palette = quantize(prev, 256);
    const index = applyPalette(prev, palette);
    gif.writeFrame(index, W, H, { palette, delay: prevDelay });
  };

  try {
    for (let i = 0; i < frames; i++) {
      if (state.cancel) { $('status').textContent = 'GIF 저장을 멈췄습니다'; return; }
      render(g, W, start + (i / frames) * T);
      const data = g.getImageData(0, 0, W, H).data;
      if (prev && sameFrame(prev, data)) {
        prevDelay += delay;
      } else {
        flush();
        prev = data;
        prevDelay = delay;
      }
      if (i % 2 === 0) {
        $('status').textContent = `GIF 만드는 중 ${Math.round((i / frames) * 100)}%`;
        await nextTick();
      }
    }
    flush();
    gif.finish();
    const blob = new Blob([gif.bytes()], { type: 'image/gif' });
    download(blob, fileBase() + '.gif');
    const mb = blob.size / 1024 / 1024;
    $('status').textContent = `GIF 저장됨 · ${mb.toFixed(1)}MB`
      + (mb > GIF_MAX_MB ? ` — 트위터 GIF는 ${GIF_MAX_MB}MB까지라 크기나 초당 장 수를 줄여야 합니다` : '');
  } finally {
    endBusy('saveGif');
  }
}

function sameFrame(a, b) {
  const x = new Uint32Array(a.buffer), y = new Uint32Array(b.buffer);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

// 장면을 한 장씩 그려 H.264로, 노래 구간은 AAC로 넣는다
async function saveMp4() {
  if (state.busy) { state.cancel = true; return; }
  if (!window.VideoEncoder || !window.Mp4Muxer) {
    $('status').textContent = '이 브라우저는 MP4 저장을 못 합니다. 크롬이나 엣지에서 열어 주세요';
    return;
  }
  const W = exportWidth(), H = heightOf(W);
  // 구간만 저장이면 그 구간만(소리도 그 구간만 잘라 넣는다)
  const R = exportRange();
  const T = R.e - R.s;
  const frames = Math.max(1, Math.round(T * MP4_FPS));
  const au = state.audio;

  const vcfg = { codec: 'avc1.640028', width: W, height: H, bitrate: 8e6, framerate: MP4_FPS };
  const acfg = au && { codec: 'mp4a.40.2', sampleRate: au.buf.sampleRate, numberOfChannels: Math.min(2, au.buf.numberOfChannels), bitrate: 192000 };
  if (!(await VideoEncoder.isConfigSupported(vcfg)).supported
    || (acfg && !(await AudioEncoder.isConfigSupported(acfg)).supported)) {
    $('status').textContent = '이 컴퓨터에서는 MP4 인코딩을 쓸 수 없습니다';
    return;
  }

  beginBusy('saveMp4');
  let failed = null;
  try {
    const { Muxer, ArrayBufferTarget } = window.Mp4Muxer;
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H, frameRate: MP4_FPS },
      audio: acfg ? { codec: 'aac', sampleRate: acfg.sampleRate, numberOfChannels: acfg.numberOfChannels } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    const ve = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: (e) => { failed = e; } });
    ve.configure(vcfg);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    for (let i = 0; i < frames; i++) {
      if (state.cancel) { $('status').textContent = 'MP4 저장을 멈췄습니다'; ve.close(); return; }
      if (failed) throw failed;
      render(g, W, R.s + i / MP4_FPS);
      const vf = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / MP4_FPS), duration: Math.round(1e6 / MP4_FPS) });
      ve.encode(vf, { keyFrame: i % (MP4_FPS * 2) === 0 });
      vf.close();
      if (ve.encodeQueueSize > 8 || i % 4 === 0) {
        $('status').textContent = `MP4 만드는 중 ${Math.round((i / frames) * (acfg ? 90 : 100))}%`;
        while (ve.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
        await nextTick();
      }
    }
    await ve.flush();
    ve.close();

    if (acfg) {
      const ae = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: (e) => { failed = e; } });
      ae.configure(acfg);
      const sr = acfg.sampleRate, nch = acfg.numberOfChannels;
      const s0 = Math.floor((au.a + R.s) * sr), total = Math.floor(T * sr);
      const fadeIn = Math.floor(0.05 * sr), fadeOut = Math.floor(0.4 * sr);
      const chans = [];
      for (let k = 0; k < nch; k++) chans.push(au.buf.getChannelData(k));
      const CH = 4096;
      for (let off = 0; off < total; off += CH) {
        if (failed) throw failed;
        const n = Math.min(CH, total - off);
        const data = new Float32Array(n * nch);
        for (let k = 0; k < nch; k++) {
          const src = chans[k];
          for (let j = 0; j < n; j++) {
            const pos = off + j;
            // 구간 앞뒤가 툭 끊기지 않게 살짝 줄였다 키운다
            const gain = Math.min(1, pos / fadeIn, (total - pos) / fadeOut);
            data[k * n + j] = (src[s0 + pos] || 0) * gain;
          }
        }
        const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: nch, timestamp: Math.round((off * 1e6) / sr), data });
        ae.encode(ad);
        ad.close();
      }
      await ae.flush();
      ae.close();
    }
    if (failed) throw failed;

    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    download(blob, fileBase() + '.mp4');
    $('status').textContent = `MP4 저장됨 · ${(blob.size / 1024 / 1024).toFixed(1)}MB · ${fmt(T)}`;
  } catch (e) {
    $('status').textContent = 'MP4를 만들지 못했습니다: ' + (e && e.message ? e.message : e);
  } finally {
    endBusy('saveMp4');
  }
}

// ---------- 연결 ----------
for (const id of ['mode', 'bgMode', 'fx', 'imgTrans', 'imgMode', 'glow']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setSeg(id, b.dataset.v);
    syncFx();
    syncAlign();
    syncImgMode();
    saveSettings();
  });
}
// 초마다일 때만 초 칸을 보인다
function syncImgMode() {
  $('secRow').hidden = state.imgMode !== 'sec';
  $('refitRow').hidden = state.imgMode !== 'lyric';
  refreshThumbSecs();
}
// 가사 효과가 글리치일 때만 넣을 곳을 고르게 한다
function syncFx() {
  $('gTargets').hidden = state.fx !== 'glitch';
  $('cdGroup').hidden = state.mode !== 'cd';
  // 동영상은 페이지 색만 고르고, 이미지 흐리게·단색 배경은 쓰지 않는다
  $('bgRow').hidden = state.mode === 'yt';
  $('ytDarkRow').hidden = state.mode !== 'yt';
  // 동영상은 제목·가수 정렬을 쓰지 않는다
  $('alignTitleRow').hidden = state.mode === 'yt';
  $('glowSpreadRow').hidden = state.glow === 'off';
  if ($('lyStyle')) syncLyStyle();
  $('chGroup').hidden = state.mode !== 'yt';
  syncSizeLabels();
  $('glowAmtRow').hidden = state.glow === 'off';
}
for (const id of ['bokeh', 'gMain', 'gPron', 'gTrans', 'nextLine', 'prevLine', 'beatSync', 'spin', 'ytDark', 'gapCalc']) $(id).addEventListener('change', saveSettings);

// 가사 스타일은 모양마다 기억한다. 색 칸 이름은 스타일을 따라 바뀐다
function syncLyStyle() {
  const st = lyStyleOf();
  for (const b of $('lyStyle').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === st));
  $('fxColorRow').hidden = st === 'none';
  $('fxColorLbl').textContent = { box: '상자 색', stroke: '테두리 색', glow: '빛 색' }[st] || '';
}
$('lyStyle').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.lyStyle[state.mode] = b.dataset.v;
  syncLyStyle();
  saveSettings();
});
// 글자색을 하나라도 고르면 그때부터 직접 고른 색을 쓴다
for (const id of ['lyColor', 'pronColor', 'transColor']) $(id).addEventListener('input', () => { state.lyCustom = true; saveSettings(); });
$('lyColorReset').addEventListener('click', () => {
  state.lyCustom = false;
  $('lyColor').value = '#ffffff';
  $('pronColor').value = $('transColor').value = '#d9d9d9';
  $('fxColor').value = '#000000';
  saveSettings();
});

// 글자 정렬은 묶음마다, 모양(플레이어/CD)마다 따로 기억한다
const ALIGN_SEGS = { alignTitle: 'title', alignLyric: 'lyric' };
function syncAlign() {
  for (const [id, key] of Object.entries(ALIGN_SEGS)) {
    for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === alignOf(key)));
  }
}
for (const [id, key] of Object.entries(ALIGN_SEGS)) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.align[state.mode][key] = b.dataset.v;
    syncAlign();
    saveSettings();
  });
}

$('stickerFile').addEventListener('change', (e) => { addStickers(e.target.files); e.target.value = ''; });
const stickerDrop = $('stickerDrop');
stickerDrop.addEventListener('dragover', (e) => { e.preventDefault(); stickerDrop.classList.add('over'); });
stickerDrop.addEventListener('dragleave', () => stickerDrop.classList.remove('over'));
stickerDrop.addEventListener('drop', (e) => { e.preventDefault(); stickerDrop.classList.remove('over'); addStickers(e.dataTransfer.files); });
for (const f of FIELDS) $(f).addEventListener('input', () => { updateInfo(); saveSettings(); });

$('imgGlitch').addEventListener('change', saveSettings);

// 그라디언트 맵: 직접 고르기일 때만 색 칸을 보인다
function syncGmap() {
  const custom = $('gmap').value === 'custom';
  $('gmA').hidden = $('gmB').hidden = !custom;
}
$('gmap').addEventListener('change', syncGmap);

// 글꼴: 캔버스는 글꼴이 다 받아진 뒤에야 그 글꼴로 그린다
async function applyFont() {
  const name = $('font').value;
  FONT = `"${name}", ${BASE_FONT}`;
  const ly = $('lyFont').value;
  LFONT = ly ? `"${ly}", ${BASE_FONT}` : FONT;
  try {
    await Promise.all(['500', '600', '700'].flatMap((w) => [name, ly].filter(Boolean).map((n) => document.fonts.load(`${w} 20px "${n}"`, '가A'))));
  } catch (e) {}
}
$('font').addEventListener('change', applyFont);
$('lyFont').addEventListener('change', applyFont);

// ---------- 미리보기 위에서 끌기·휠: 스티커 > 이미지 ----------
function artRect() {
  const u = stage.width / 480;
  if (state.mode === 'yt') return videoRect(u);
  if (state.mode === 'player') { const s2 = 352 * u; return { x: (stage.width - s2) / 2, y: 44 * u, w: s2, h: s2 }; }
  const R = 186 * u;
  return { x: stage.width / 2 - R, y: 228 * u - R, w: R * 2, h: R * 2 };
}
function stagePoint(e) {
  const r = stage.getBoundingClientRect();
  const k = stage.width / r.width;
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k };
}
const inBox = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
function hitAt(e) {
  const p = stagePoint(e);
  const W = stage.width, H = stage.height;
  for (let i = state.stickers.length - 1; i >= 0; i--) {
    const st = state.stickers[i];
    const { w, h } = stickerSize(st, W);
    const a = (-st.rot * Math.PI) / 180;
    const dx = p.x - st.x * W, dy = p.y - st.y * H;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return { type: 'sticker', st, p };
  }
  if (state.mode === 'yt' && capRect && inBox(p, capRect)) return { type: 'caption', p };
  if (currentImage() && inBox(p, artRect())) return { type: 'art', p };
  return null;
}
function currentImage() { return imageAt(state.t).a; }
function dropFitCache(it) {
  for (const k of Object.keys(it.cache)) if (k.startsWith('glow') || k.startsWith('vglow')) delete it.cache[k];
}
// 모든 이미지 같이: 지금 이미지의 위치·확대를 나머지에도 똑같이 넣는다
function syncFit(it) {
  if (!$('fitAll').checked) return;
  for (const o of state.images) {
    if (o === it) continue;
    o.fx = it.fx; o.fy = it.fy; o.zoom = it.zoom;
  }
}
function dropAllFitCache(it) {
  for (const o of $('fitAll').checked ? state.images : [it]) dropFitCache(o);
}

let sdrag = null, hover = null;
stage.addEventListener('pointerdown', (e) => {
  const hit = hitAt(e);
  if (!hit || hit.type !== 'sticker') selectSticker(null);
  if (!hit) return;
  stage.setPointerCapture(e.pointerId);
  const p = hit.p;
  if (hit.type === 'sticker') { selectSticker(hit.st); sdrag = { ...hit, x0: hit.st.x, y0: hit.st.y }; }
  else if (hit.type === 'caption') sdrag = { ...hit, dx0: state.capPos.dx, dy0: state.capPos.dy };
  else {
    const it = currentImage();
    sdrag = { ...hit, it, fx: it.fx ?? 0.5, fy: it.fy ?? 0.5 };
  }
  sdrag.sx = p.x; sdrag.sy = p.y;
  stage.classList.add('panning');
});
stage.addEventListener('pointermove', (e) => {
  if (!sdrag) {
    hover = hitAt(e);
    showHint(hover);
    stage.classList.toggle('can-pan', !!hover);
    return;
  }
  const p = stagePoint(e);
  const W = stage.width, H = stage.height, u = W / 480;
  const mx = p.x - sdrag.sx, my = p.y - sdrag.sy;
  if (sdrag.type === 'sticker') {
    sdrag.st.x = sdrag.x0 + mx / W;
    sdrag.st.y = sdrag.y0 + my / H;
    clampSticker(sdrag.st);
  } else if (sdrag.type === 'caption') {
    state.capPos.dx = sdrag.dx0 + mx / u;
    state.capPos.dy = sdrag.dy0 + my / u;
    // 영상 밖으로 나간 만큼은 저장하지 않는다
    const v = videoRect(u), cap = captionGeom(u);
    state.capPos.dx = (cap.cx - (v.x + v.w / 2)) / u;
    state.capPos.dy = (cap.bottom - (v.y + v.h - 34 * u)) / u;
  } else {
    const it = sdrag.it, a = artRect();
    const img = srcOf(it);
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const sc = Math.max(a.w / iw, a.h / ih) * (it.zoom || 1);
    const ox = iw * sc - a.w, oy = ih * sc - a.h;
    // CD는 돌고 있어서 끈 방향과 그림이 움직이는 방향이 어긋날 수 있다
    if (ox > 0) it.fx = Math.max(0, Math.min(1, sdrag.fx - mx / ox));
    if (oy > 0) it.fy = Math.max(0, Math.min(1, sdrag.fy - my / oy));
    syncFit(it);
  }
});
const endDrag = () => {
  if (!sdrag) return;
  if (sdrag.type === 'art') dropAllFitCache(sdrag.it);
  if (sdrag.type === 'caption') saveSettings();
  sdrag = null;
  stage.classList.remove('panning');
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('pointerleave', () => { if (!sdrag) { hover = null; showHint(null); } });
const HINTS = {
  art: '끌어서 이동 · 휠로 확대 · 두 번 눌러 되돌리기',
  sticker: '끌어서 이동 · 휠로 크기 · Delete로 지우기',
  caption: '끌어서 자막 옮기기 · 두 번 눌러 되돌리기',
};
function showHint(h) {
  const el = $('canvasHint');
  const text = h ? HINTS[h.type] : '';
  el.hidden = !text;
  if (text) el.textContent = text;
}
stage.addEventListener('wheel', (e) => {
  const hit = hitAt(e);
  if (!hit || hit.type === 'caption') return;
  e.preventDefault();
  const k = e.deltaY < 0 ? 1.08 : 1 / 1.08;
  if (hit.type === 'sticker') {
    hit.st.size = Math.max(0.05, Math.min(1, hit.st.size * k));
    clampSticker(hit.st);
    renderStickers();
    return;
  }
  const it = currentImage();
  it.zoom = Math.max(1, Math.min(4, (it.zoom || 1) * k));
  syncFit(it);
  dropAllFitCache(it);
}, { passive: false });
stage.addEventListener('dblclick', (e) => {
  const hit = hitAt(e);
  if (!hit) return;
  if (hit.type === 'caption') {
    state.capPos.dx = state.capPos.dy = 0;
    saveSettings();
  } else if (hit.type === 'art') {
    const it = currentImage();
    it.fx = it.fy = 0.5;
    it.zoom = 1;
    syncFit(it);
    dropAllFitCache(it);
  }
});

// 미리보기에만 그리는 안내선: 스티커가 움직일 수 있는 영역과 지금 잡은 스티커
function drawGuides() {
  const t0 = sdrag || hover;
  if (t0 && t0.type === 'caption' && capRect) {
    const u = stage.width / 480;
    ctx.save();
    ctx.lineWidth = Math.max(1, 1.2 * u);
    ctx.setLineDash([5 * u, 4 * u]);
    if (sdrag) {
      const v = videoRect(u);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.strokeRect(v.x + 4 * u, v.y + 4 * u, v.w - 8 * u, v.h - 8 * u);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeRect(capRect.x, capRect.y, capRect.w, capRect.h);
    ctx.restore();
    return;
  }
  const tgt = t0 && t0.type === 'sticker' ? t0 : selSticker ? { type: 'sticker', st: selSticker } : null;
  if (!tgt || !state.stickers.includes(tgt.st)) return;
  const W = stage.width, H = stage.height, u = W / 480, m = EDGE * u;
  ctx.save();
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.setLineDash([5 * u, 4 * u]);
  if (sdrag) {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.strokeRect(m, m, W - m * 2, H - m * 2);
  }
  ctx.strokeStyle = tgt.st === selSticker ? '#a593ff' : 'rgba(255,255,255,0.9)';
  if (tgt.st === selSticker) ctx.setLineDash([]);
  const st = tgt.st, { w, h } = stickerSize(st, W);
  ctx.translate(st.x * W, st.y * H);
  ctx.rotate((st.rot * Math.PI) / 180);
  ctx.strokeRect(-w / 2 - 3 * u, -h / 2 - 3 * u, w + 6 * u, h + 6 * u);
  ctx.restore();
}
$('bgColor').addEventListener('input', () => setSeg('bgMode', 'solid'));

$('file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addFiles(files);
});

$('audioFile').addEventListener('change', (e) => { if (e.target.files[0]) loadAudio(e.target.files[0]); e.target.value = ''; });
const audioDrop = $('audioDrop');
audioDrop.addEventListener('dragover', (e) => { e.preventDefault(); audioDrop.classList.add('over'); });
audioDrop.addEventListener('dragleave', () => audioDrop.classList.remove('over'));
audioDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  audioDrop.classList.remove('over');
  const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('audio/'));
  if (f) loadAudio(f);
});
$('audioRemove').addEventListener('click', removeAudio);

$('findLyrics').addEventListener('click', findLyrics);
$('discAngle').addEventListener('input', () => { $('discAngleVal').textContent = `${$('discAngle').value}°`; });
$('avatarFile').addEventListener('change', (e) => { setAvatar(e.target.files[0]); e.target.value = ''; });
$('refit').addEventListener('click', () => {
  for (const it of state.images) it.lsec = undefined;
  updateInfo();
});
$('tap').addEventListener('click', () => (state.tap ? tapNext() : startTap()));

$('play').addEventListener('click', () => setPlaying(!state.playing));
$('seek').addEventListener('input', (e) => {
  state.t = parseFloat(e.target.value);
  if (state.playing) restartAudio();
});
$('saveMp4').addEventListener('click', saveMp4);
$('saveGif').addEventListener('click', saveGif);
$('saveStill').addEventListener('click', () => { closeExport(); openPicker(); });

// ---------- 눈 아이콘: 편집 화면에서만 효과 보이기·숨기기 ----------
let fxVisible = true;
$('eyeBtn').addEventListener('click', () => {
  fxVisible = !fxVisible;
  // 저장도 보이는 대로: 눈을 감으면 이미지·GIF·MP4 모두 효과 없이
  view.hideFx = !fxVisible;
  updateInfo();
  $('eyeBtn').setAttribute('aria-pressed', String(fxVisible));
  $('eyeBtn').setAttribute('aria-label', fxVisible ? '효과 숨기기' : '효과 보이기');
});

// ---------- 사용법 ----------
$('helpBtn').addEventListener('click', () => $('help').showModal());
$('helpClose').addEventListener('click', () => $('help').close());
// 창 바깥(어두운 막)을 누르면 닫는다
$('help').addEventListener('click', (e) => {
  const r = $('help').getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('help').close();
});

// ---------- 화이트 모드 ----------
$('themeBtn').addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  if (light) document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  $('themeBtn').setAttribute('aria-label', light ? '다크 모드' : '화이트 모드');
  try { localStorage.setItem('spincard:theme', light ? 'light' : 'dark'); } catch (e) {}
});
if (document.documentElement.dataset.theme === 'light') $('themeBtn').setAttribute('aria-label', '다크 모드');

// ---------- 웹폰트 추가 ----------
// 구글 폰트·웹폰트 CSS 주소나 글꼴 파일(woff2·ttf·otf) 주소. <link>나 @import 코드를 붙여넣어도 주소만 골라낸다
const WEBFONT_KEY = 'spincard:webfonts';
let webFonts = [];   // { url, families: [이름] }
function saveWebFonts() { try { localStorage.setItem(WEBFONT_KEY, JSON.stringify(webFonts)); } catch (e) {} }
function addFontOption(name) {
  for (const sel of [$('font'), $('lyFont')]) {
    if ([...sel.options].some((o) => o.value === name)) continue;
    sel.add(new Option(name, name));
  }
}
function removeFontOption(name) {
  for (const sel of [$('font'), $('lyFont')]) {
    const o = [...sel.options].find((x) => x.value === name);
    if (o) o.remove();
  }
  if (!$('font').value) $('font').value = 'Noto Sans KR';
  if (!$('lyFont').value && $('lyFont').selectedIndex < 0) $('lyFont').value = '';
}
// 주소를 실제로 불러온다. 성공하면 글꼴 이름들을 돌려준다
async function loadWebFont(url) {
  const file = /\.(woff2?|ttf|otf)(\?|#|$)/i.test(url);
  if (file) {
    const name = decodeURIComponent(url.split('/').pop().split(/[?#]/)[0].replace(/\.[^.]+$/, '')).replace(/[-_]+/g, ' ').trim() || '웹폰트';
    const face = new FontFace(name, `url("${url}")`);
    await face.load();
    document.fonts.add(face);
    return [name];
  }
  let families = [];
  try {
    const u = new URL(url);
    if (/fonts\.googleapis\.com$/.test(u.hostname)) {
      families = u.searchParams.getAll('family').map((f) => f.split(':')[0].replace(/\+/g, ' ').trim());
    }
  } catch (e) { throw new Error('주소 형식'); }
  if (!families.length) {
    const css = await (await fetch(url)).text();
    families = [...css.matchAll(/font-family\s*:\s*['"]?([^;'"]+)['"]?/gi)].map((m) => m[1].trim());
  }
  families = [...new Set(families)].filter(Boolean);
  if (!families.length) throw new Error('이름 없음');
  if (![...document.querySelectorAll('link[data-webfont]')].some((l) => l.href === url)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.webfont = '1';
    document.head.append(link);
    await new Promise((res) => { link.onload = res; link.onerror = res; });
  }
  return families;
}
function renderWebFonts() {
  const box = $('webFontList');
  box.innerHTML = '';
  for (const wf of webFonts) {
    for (const name of wf.families) {
      const row = document.createElement('div');
      row.className = 'font-item';
      const sp = document.createElement('span');
      sp.textContent = name;
      sp.style.fontFamily = `"${name}", ${BASE_FONT}`;
      const x = document.createElement('button');
      x.className = 'x';
      x.textContent = '×';
      x.setAttribute('aria-label', `${name} 빼기`);
      x.onclick = () => {
        wf.families = wf.families.filter((f) => f !== name);
        if (!wf.families.length) webFonts = webFonts.filter((w) => w !== wf);
        removeFontOption(name);
        saveWebFonts();
        renderWebFonts();
        applyFont();
      };
      row.append(sp, x);
      box.append(row);
    }
  }
}
async function addWebFont() {
  const raw = $('webFontUrl').value.trim();
  const m = raw.match(/https?:\/\/[^\s"'()<>]+/);
  const msg = $('webFontMsg');
  if (!m) { msg.textContent = '웹폰트 주소를 넣어 주세요'; return; }
  const url = m[0].replace(/&amp;/g, '&');
  msg.textContent = '불러오는 중';
  try {
    const families = await loadWebFont(url);
    for (const f of families) addFontOption(f);
    if (!webFonts.some((w) => w.url === url)) webFonts.push({ url, families });
    saveWebFonts();
    renderWebFonts();
    $('webFontUrl').value = '';
    msg.textContent = `${families.join(', ')} 추가됨`;
  } catch (e) {
    msg.textContent = '글꼴을 불러오지 못했습니다. 구글 폰트 주소나 글꼴 파일(woff2·ttf·otf) 주소인지 확인해 주세요';
  }
}
function restoreWebFonts() {
  try { webFonts = JSON.parse(localStorage.getItem(WEBFONT_KEY) || '[]'); } catch (e) { webFonts = []; }
  for (const wf of webFonts) {
    for (const f of wf.families) addFontOption(f);
    loadWebFont(wf.url).then(() => applyFont()).catch(() => {});
  }
  renderWebFonts();
}
$('webFontAdd').addEventListener('click', addWebFont);
$('webFontUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') addWebFont(); });

// ---------- 탭 ----------
const TAB_KEY = 'spincard:tab';
function showTab(name) {
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('.pane')) p.hidden = p.dataset.pane !== name;
  if (name === 'lyric') renderNotes();
  try { localStorage.setItem(TAB_KEY, name); } catch (e) {}
}
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => showTab(b.dataset.tab));
try { const t = localStorage.getItem(TAB_KEY); if (t && document.querySelector(`.pane[data-pane="${t}"]`)) showTab(t); } catch (e) {}

// ---------- 내보내기 창 ----------
function closeExport() {
  $('exportPop').hidden = true;
  $('exportBtn').setAttribute('aria-expanded', 'false');
}
$('rangeOn').addEventListener('change', syncRange);
for (const id of ['rangeA', 'rangeB']) $(id).addEventListener('change', updateInfo);
$('rangeFromNow').addEventListener('click', () => { $('rangeA').value = fmtTenth(songOffset() + state.t); updateInfo(); });
$('rangeToNow').addEventListener('click', () => { $('rangeB').value = fmtTenth(songOffset() + state.t); updateInfo(); });
$('exportBtn').addEventListener('click', () => {
  const open = $('exportPop').hidden;
  $('exportPop').hidden = !open;
  $('exportBtn').setAttribute('aria-expanded', String(open));
  if (open) updateInfo();
});
document.addEventListener('pointerdown', (e) => {
  if (!$('exportPop').hidden && !e.target.closest('.export')) closeExport();
});
$('pickClose').addEventListener('click', () => { pickJob++; $('picker').hidden = true; });
$('pickSave').addEventListener('click', savePicks);
$('pickAll').addEventListener('click', () => {
  const all = !picks.every((p) => p.sel);
  for (const p of picks) { p.sel = all; p.el && p.el.setAttribute('aria-pressed', String(all)); }
  updatePickCount();
});
$('unit').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setSeg('unit', b.dataset.v);
  openPicker();
});
$('lyricInput').addEventListener('paste', () => setTimeout(commitLyricInput, 0));
$('lyricInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitLyricInput(); } });
$('lyricInput').addEventListener('blur', commitLyricInput);
$('selAll').addEventListener('change', () => {
  lsel.clear();
  if ($('selAll').checked) for (const r of rawRows()) if (r.text) lsel.add(r.i);
  renderNotes();
});
$('selKeep').addEventListener('click', () => editSelected(true));
$('lyricSearch').addEventListener('input', renderNotes);
$('foldAll').addEventListener('click', () => {
  const paras = rawParagraphs(rawRows());
  const all = paras.every((pa) => lfold.has(pa[0].i));
  lfold.clear();
  if (!all) for (const pa of paras) lfold.add(pa[0].i);
  renderNotes();
});
$('copyLyrics').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(lyricsForCopy());
    $('lyricMsg').textContent = '가사를 복사했습니다';
  } catch (e) {
    $('lyricMsg').textContent = '복사하지 못했습니다. 텍스트로 편집에서 직접 복사해 주세요';
  }
});
// 텍스트로 편집에서 [번역]·[발음] 줄을 쓰면 위 줄에 붙이고 가사에서는 뺀다
$('lyrics').addEventListener('change', () => {
  if (!/\[(번역|발음)\]/.test($('lyrics').value)) return;
  setLyricsRaw(absorbNotes($('lyrics').value, false).text);
});
$('selDel').addEventListener('click', () => editSelected(false));
$('selGlitch').addEventListener('click', () => {
  const texts = rawRows().filter((r) => r.text && lsel.has(r.i)).map((r) => r.text);
  const allOn = texts.every((t) => notes[t] && notes[t].gl);
  for (const t of texts) noteSet(t, 'gl', !allOn);
  renderNotes();
});
// 텍스트로 편집 ↔ 카드로 보기
$('rawToggle').addEventListener('click', () => {
  const raw = $('lyrics').hidden;
  $('lyrics').hidden = !raw;
  $('lyricCards').hidden = raw;
  $('selBar').hidden = raw || !rawRows().some((r) => r.text);
  $('lyricInput').hidden = raw;
  $('rawToggle').textContent = raw ? '카드로 보기' : '텍스트로 편집';
  if (!raw) renderNotes();
});
let notesTimer = 0;
$('lyrics').addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(renderNotes, 400); });

restoreWebFonts();
loadSettings();
// 예전에 고른 글꼴이 목록에 없으면 본고딕으로
if (!$('font').value) $('font').value = 'Noto Sans KR';
if ([...$('lyFont').options].every((o) => o.value !== $('lyFont').value)) $('lyFont').value = '';
$('discAngleVal').textContent = `${$('discAngle').value}°`;
syncLyStyle();
syncImgMode();
syncFx();
syncAlign();
syncGmap();
applyFont();
updateInfo();
requestAnimationFrame(tick);
