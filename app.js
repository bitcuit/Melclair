'use strict';

const BASE_FONT = '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif';
let FONT = BASE_FONT;
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
  // 글자 정렬. 모양마다, 묶음(제목·가사)마다 따로
  align: { player: { title: 'left', lyric: 'left' }, cd: { title: 'center', lyric: 'center' } },
  stickers: [],
  unit: 'line',      // 이미지 저장 단위
};
// 이미지 저장용 한 장을 그릴 때만 채운다: { img, items }
let still = null;

// ---------- 설정 저장 (텍스트만) ----------
const FIELDS = ['title', 'artist', 'lyrics', 'lineSec', 'shift', 'imgSec', 'bgColor', 'size', 'fps', 'gmap', 'gmA', 'gmB', 'font'];
function saveSettings() {
  try {
    const o = { mode: state.mode, bgMode: state.bgMode, fx: state.fx, glowOn: $('glowOn').checked, imgGlitch: $('imgGlitch').checked, notes, imgTrans: state.imgTrans,
      bokeh: $('bokeh').checked, gMain: $('gMain').checked, gPron: $('gPron').checked, gTrans: $('gTrans').checked,
      align: state.align, nextLine: $('nextLine').checked, beatSync: $('beatSync').checked, spin: $('spin').checked };
    for (const f of FIELDS) o[f] = $(f).value;
    localStorage.setItem(STORE, JSON.stringify(o));
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
    if (o.glowOn != null) $('glowOn').checked = o.glowOn;
    if (o.imgGlitch != null) $('imgGlitch').checked = o.imgGlitch;
    if (o.imgTrans) setSeg('imgTrans', o.imgTrans);
    for (const id of ['bokeh', 'gMain', 'gPron', 'gTrans', 'nextLine', 'beatSync', 'spin']) if (o[id] != null) $(id).checked = o[id];
    // 예전 저장값(모양마다 정렬 하나)은 두 묶음에 같이 넣는다
    if (o.align) for (const m of ['player', 'cd']) {
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
    lines.forEach((l, i) => { l.end = i + 1 < lines.length ? lines[i + 1].start : l.start + num('lineSec', 3); });
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
  return Math.max(n * num('imgSec', 3), 3);
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
      const alpha = Math.min(1, (at - l.start) / fade, (l.end - at) / fade);
      const nx = lyr.lines.slice(i + 1).find((x) => x.text);
      return { text: l.text, alpha: Math.max(0, alpha), since: at - l.start, at, next: nx ? nx.text : '', ...noteOf(l.text) };
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
      for (const el of box.children) el.classList.remove('dragging', 'before', 'after');
    });
    d.addEventListener('dragover', (e) => {
      if (thumbFrom < 0) return;
      e.preventDefault();
      const r = d.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      for (const el of box.children) el.classList.remove('before', 'after');
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
    box.append(d);
  });
  updateInfo();
}
let thumbFrom = -1;

// 지금 시각에 보일 이미지와 다음 이미지로 넘어가는 정도(0~1)
function imageAt(t) {
  if (still) return { a: still.img, b: null, p: 0 };
  const n = state.images.length;
  if (!n) return { a: null, b: null, p: 0 };
  if (n === 1) return { a: state.images[0], b: null, p: 0 };
  const sec = num('imgSec', 3);
  const k = Math.floor(t / sec);
  const into = t - k * sec;
  const a = state.images[k % n];
  const b = state.images[(k + 1) % n];
  // 페이드일 때만 겹쳐 넘어가고, 글리치·바로는 경계에서 딱 바뀐다
  const p = state.imgTrans === 'fade' && into > sec - FADE ? (into - (sec - FADE)) / FADE : 0;
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
  const key = 'bg' + W;
  if (it.cache[key]) return it.cache[key];
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = W * 0.06;
  g.filter = `blur(${r}px) saturate(1.2)`;
  drawCover(g, it.img, -r * 2, -r * 2, W + r * 4, H + r * 4);
  g.filter = 'none';
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fillRect(0, 0, W, H);
  it.cache[key] = c;
  return c;
}

// 아트 뒤로 번지는 빛. 모양(네모·원)과 크기별로 한 번만 만든다
function glowImage(it, size, round, u) {
  const key = 'glow' + size + (round ? 'o' : 's') + [it.fx, it.fy, it.zoom].join();
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
  drawCover(sg, it.img, pad, pad, size, size, it);
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

    $('audioName').textContent = file.name;
    $('audioBox').hidden = false;
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
  if (!au || $('audioBox').hidden) return;
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
    if (!list.length && artist) {
      list = await (await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ q: artist + ' ' + title }))).json();
    }
    const D = state.audio ? state.audio.buf.duration : null;
    const near = (x) => (D ? Math.abs((x.duration || 0) - D) : 0);
    const synced = list.filter((x) => x.syncedLyrics).sort((x, y) => near(x) - near(y));
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
  if (!state.tap) return;
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); tapNext(); }
  if (e.code === 'Escape') endTap('박자 찍기를 그만뒀습니다');
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
  if (still) return on ? 0.55 : 0;
  let s = 0;
  // 바뀔 때 글리치: 경계 앞뒤로 세게
  if (state.imgTrans === 'glitch' && state.images.length > 1) {
    const sec = num('imgSec', 3);
    const into = t - Math.floor(t / sec) * sec;
    const d = Math.min(into, sec - into);
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
  if (!$('bokeh').checked) return;
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
function drawGlow(g, cx, cy, size, round, u, t) {
  if (!$('glowOn').checked) return;
  const { a, b, p } = imageAt(t);
  if (!a) return;
  const lv = levelAt(t);
  const scale = 1 + 0.06 * lv;
  const alpha = 0.45 + 0.5 * lv;
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
function glitchOf(item, t) {
  if (item.glitch != null) return item.glitch;
  if (anyMarked() && !item.gl) return 0;
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
      g.font = `600 ${S.main}px ${FONT}`;
      const main = wrap(g, it.text, maxW, one ? 2 : 2);
      g.font = `500 ${S.pron}px ${FONT}`;
      const pron = it.pron ? fitText(g, it.pron, maxW) : '';
      g.font = `500 ${S.trans}px ${FONT}`;
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
  // 다음 줄: 자리가 남을 때만 흐리게 한 줄
  let next = '';
  if (opt.next && !still && items[0].next && layout.h + S.main * 1.5 <= y1 - y0) {
    g.font = `600 ${S.main}px ${FONT}`;
    next = fitText(g, items[0].next, maxW);
  }
  let y = opt.top ? y0 : y0 + Math.max(0, (y1 - y0 - layout.h) / 2);
  for (const L of layout) {
    const alpha = still ? 1 : L.it.alpha;
    const gs = glitch ? glitchOf(L.it, t) : 0;
    // 글리치는 나타날 때 깜빡이며 들어온다
    const a = gs > 0 && !still && L.it.since < 0.3 ? (hash(Math.floor(L.it.at * 30)) < 0.35 ? 0.15 : 1) : alpha;
    // 글리치 넣을 곳으로 고른 부분만 글리치로 그린다
    const put = (text, size, weight, color, on) => {
      g.font = `${weight} ${size}px ${FONT}`;
      if (on && gs > 0) {
        const tw = g.measureText(text).width;
        drawGlitchText(g, text, align === 'left' ? cx + tw / 2 : align === 'right' ? cx - tw / 2 : cx, y, size, color, a, gs, u, L.it.at, weight);
        g.textAlign = align;
        g.textBaseline = 'top';
      } else {
        g.globalAlpha = a;
        g.fillStyle = color;
        g.fillText(text, cx, y);
      }
    };
    if (L.pron) {
      put(L.pron, S.pron, 500, dim, $('gPron').checked);
      y += S.pron * 1.5;
    }
    for (const s of L.main) {
      put(s, S.main, 600, fg, $('gMain').checked);
      y += S.main * 1.38;
    }
    if (L.trans.length) {
      y += 3 * u;
      for (const s of L.trans) { put(s, S.trans, 500, dim, $('gTrans').checked); y += S.trans * 1.4; }
    }
    y += 10 * u * k * big;
  }
  if (next) {
    g.globalAlpha = 0.32;
    g.fillStyle = fg;
    g.font = `600 ${S.main}px ${FONT}`;
    g.fillText(next, cx, y - 4 * u);
  }
  g.globalAlpha = 1;
}

// 색이 갈라지고 가로 띠가 어긋나는 글씨
const gBase = document.createElement('canvas');
const gTint = document.createElement('canvas');
function drawGlitchText(g, text, cx, y, size, fg, alpha, s, u, seed, weight = 600) {
  const font = `${weight} ${size}px ${FONT}`;
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

// ---------- 글자 묶음 자리 ----------
// 제목 묶음(제목·가수)과 가사 묶음(가사·발음·번역)의 기본 자리. 옮긴 만큼 더하고 카드 안쪽으로 막는다
function defaultBoxes(W) {
  const u = W / 480;
  return state.mode === 'player'
    ? { title: { x: 84 * u, y: 332 * u, w: 312 * u, h: 50 * u }, lyric: { x: 64 * u, y: 404 * u, w: 352 * u, h: 146 * u } }
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
  const H = Math.round(W * 4 / 3);
  const u = W / 480;
  const T = duration();
  const light = state.bgMode === 'solid' && isLight($('bgColor').value);
  const fg = light ? '#161514' : '#ffffff';
  const dim = light ? 'rgba(22,21,20,0.5)' : 'rgba(255,255,255,0.6)';

  g.save();
  g.clearRect(0, 0, W, H);
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
    drawLyrics(g, x, 168 * u, H - 44 * u, W - 80 * u, u, fg, dim, t, { align: 'left', big: 1.35, top: true });
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
      { align: B.lyric.al, size: 21, next: $('nextLine').checked });
    drawProgress(g, x, 558 * u, s, u, fg, dim, t, T);
    drawControls(g, W / 2, 606 * u, u, fg);
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
      { align: B.lyric.al, size: 19, next: $('nextLine').checked });
    drawProgress(g, (W - 352 * u) / 2, 586 * u, 352 * u, u, fg, dim, t, T);
  }
  drawStickers(g, W, t);
  g.restore();
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
  if (still) { if (st.fx === 'glitch') p.glitch = 0.5; return p; }
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
  const u = W / 480, H = Math.round(W * 4 / 3);
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
    row.className = 'st-row';
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
    x.onclick = () => { URL.revokeObjectURL(st.url); state.stickers.splice(i, 1); renderStickers(); };
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
      slider('크기', 5, 100, Math.round(st.size * 100), (v) => { st.size = v / 100; }),
      slider('회전', -180, 180, st.rot, (v) => { st.rot = v; }));
    box.append(row);
  });
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
  const ang = $('spin').checked ? (t / T) * turns * Math.PI * 2 : 0;

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
function exportWidth() { return parseInt($('size').value, 10); }

function sizeStage() {
  const W = exportWidth(), H = Math.round(W * 4 / 3);
  if (stage.width !== W || stage.height !== H) { stage.width = W; stage.height = H; }
}

// 트위터 GIF 한도(350장) 안에 들도록 초당 장 수를 낮춘다
function gifPlan() {
  const T = duration();
  const want = parseInt($('fps').value, 10);
  let fps = want;
  for (const f of [25, 20, 10, 5]) {
    if (f > want) continue;
    fps = f;
    if (Math.round(T * f) <= GIF_MAX_FRAMES) break;
  }
  const frames = Math.max(1, Math.round(T * fps));
  return { T, fps, frames, lowered: fps < want, over: frames > GIF_MAX_FRAMES };
}

function updateInfo() {
  const T = duration();
  $('seek').max = T;
  if (state.t > T && !state.tap) state.t = 0;
  if (state.busy) return;
  const p = gifPlan();
  let s = `${fmt(T)} · GIF 초당 ${p.fps}장 ${p.frames}장`;
  if (p.over) s += ' — 트위터 GIF는 350장까지라 구간을 줄여야 합니다';
  else if (p.lowered) s += ' (트위터 350장 한도에 맞춰 낮춤)';
  $('status').textContent = s;
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
  render(ctx, stage.width, state.t);
  drawGuides();
  drawWave();
  $('seek').value = Math.min(state.t, T);
  $('time').textContent = `${fmt(Math.min(state.t, T))} / ${fmt(T)}`;
  requestAnimationFrame(tick);
}

function setPlaying(v) {
  state.playing = v;
  $('play').textContent = v ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', v ? '일시정지' : '재생');
  if (v) restartAudio(); else stopAudio();
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
    c.width = TW; c.height = Math.round(TW * 4 / 3);
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
    c.width = W; c.height = Math.round(W * 4 / 3);
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

// ---------- 발음 · 번역 ----------
function renderNotes() {
  if (!$('notesBox').open) return;
  const list = $('noteList');
  const seen = new Set();
  const texts = parseLyrics().lines.map((l) => l.text).filter((t) => t && !seen.has(t) && seen.add(t));
  list.innerHTML = '';
  if (!texts.length) {
    list.innerHTML = '<span class="hint">가사를 먼저 넣어 주세요</span>';
    return;
  }
  for (const text of texts) {
    const row = document.createElement('div');
    row.className = 'note-row';
    const src = document.createElement('span');
    src.className = 'src';
    src.textContent = text;
    const mk = (key, ph) => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = ph;
      inp.setAttribute('aria-label', `${text} ${ph}`);
      inp.value = (notes[text] && notes[text][key]) || '';
      inp.addEventListener('input', () => {
        notes[text] = { ...(notes[text] || {}), [key]: inp.value };
        if (!notes[text].p && !notes[text].tr && !notes[text].gl) delete notes[text];
        saveSettings();
      });
      return inp;
    };
    const gl = document.createElement('label');
    gl.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!(notes[text] && notes[text].gl);
    cb.addEventListener('change', () => {
      notes[text] = { ...(notes[text] || {}), gl: cb.checked };
      if (!notes[text].p && !notes[text].tr && !notes[text].gl) delete notes[text];
      saveSettings();
    });
    gl.append(cb, '이 줄에만 글리치');
    row.append(src, mk('p', '발음'), mk('tr', '번역'), gl);
    list.append(row);
  }
}

const SAVE_BUTTONS = { saveMp4: 'MP4 저장', saveGif: 'GIF 저장' };
function beginBusy(which) {
  state.busy = true;
  state.cancel = false;
  stopAudio();
  if (state.tap) endTap('');
  $(which).textContent = '멈추기';
  for (const id of ['saveMp4', 'saveGif', 'saveStill']) if (id !== which) $(id).disabled = true;
}
function endBusy(which) {
  state.busy = false;
  $(which).textContent = SAVE_BUTTONS[which];
  for (const id of ['saveMp4', 'saveGif', 'saveStill']) $(id).disabled = false;
  restartAudio();
}
const nextTick = () => new Promise((r) => setTimeout(r, 0));

async function saveGif() {
  if (state.busy) { state.cancel = true; return; }
  const { GIFEncoder, quantize, applyPalette } = window.gifenc;
  const W = exportWidth(), H = Math.round(W * 4 / 3);
  const { T, fps, frames } = gifPlan();
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
      render(g, W, (i / frames) * T);
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
  const W = exportWidth(), H = Math.round(W * 4 / 3);
  const T = duration();
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
      render(g, W, i / MP4_FPS);
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
      const s0 = Math.floor(au.a * sr), total = Math.floor(T * sr);
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
for (const id of ['mode', 'bgMode', 'fx', 'imgTrans']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setSeg(id, b.dataset.v);
    syncFx();
    syncAlign();
    saveSettings();
  });
}
// 가사 효과가 글리치일 때만 넣을 곳을 고르게 한다
function syncFx() {
  $('gTargets').hidden = state.fx !== 'glitch';
  $('spinRow').hidden = state.mode !== 'cd';
}
for (const id of ['bokeh', 'gMain', 'gPron', 'gTrans', 'nextLine', 'beatSync', 'spin']) $(id).addEventListener('change', saveSettings);

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
$('glowOn').addEventListener('change', saveSettings);
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
  try {
    await Promise.all(['500', '600', '700'].map((w) => document.fonts.load(`${w} 20px "${name}"`, '가A')));
  } catch (e) {}
}
$('font').addEventListener('change', applyFont);

// ---------- 미리보기 위에서 끌기·휠: 스티커 > 이미지 ----------
function artRect() {
  const u = stage.width / 480;
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
  if (currentImage() && inBox(p, artRect())) return { type: 'art', p };
  return null;
}
function currentImage() { return imageAt(state.t).a; }
function dropFitCache(it) {
  for (const k of Object.keys(it.cache)) if (k.startsWith('glow')) delete it.cache[k];
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
  if (!hit) return;
  stage.setPointerCapture(e.pointerId);
  const p = hit.p;
  if (hit.type === 'sticker') sdrag = { ...hit, x0: hit.st.x, y0: hit.st.y };
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
    stage.classList.toggle('can-pan', !!hover);
    return;
  }
  const p = stagePoint(e);
  const W = stage.width, H = stage.height, u = W / 480;
  const mx = p.x - sdrag.sx, my = p.y - sdrag.sy;
  if (sdrag.type === 'sticker') {
    // 스티커 가운데가 카드 안쪽 영역을 벗어나지 않게
    const m = EDGE * u;
    sdrag.st.x = Math.max(m / W, Math.min(1 - m / W, sdrag.x0 + mx / W));
    sdrag.st.y = Math.max(m / H, Math.min(1 - m / H, sdrag.y0 + my / H));
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
  sdrag = null;
  stage.classList.remove('panning');
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('pointerleave', () => { if (!sdrag) hover = null; });
stage.addEventListener('wheel', (e) => {
  const hit = hitAt(e);
  if (!hit) return;
  e.preventDefault();
  const k = e.deltaY < 0 ? 1.08 : 1 / 1.08;
  if (hit.type === 'sticker') {
    hit.st.size = Math.max(0.05, Math.min(1, hit.st.size * k));
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
  if (hit.type === 'art') {
    const it = currentImage();
    it.fx = it.fy = 0.5;
    it.zoom = 1;
    syncFit(it);
    dropAllFitCache(it);
  }
});

// 미리보기에만 그리는 안내선: 스티커가 움직일 수 있는 영역과 지금 잡은 스티커
function drawGuides() {
  const tgt = sdrag || hover;
  if (!tgt || tgt.type === 'art') return;
  const W = stage.width, H = stage.height, u = W / 480, m = EDGE * u;
  ctx.save();
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.setLineDash([5 * u, 4 * u]);
  if (sdrag) {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.strokeRect(m, m, W - m * 2, H - m * 2);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
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
$('tap').addEventListener('click', () => (state.tap ? tapNext() : startTap()));

$('play').addEventListener('click', () => setPlaying(!state.playing));
$('seek').addEventListener('input', (e) => {
  state.t = parseFloat(e.target.value);
  if (state.playing) restartAudio();
});
$('saveMp4').addEventListener('click', saveMp4);
$('saveGif').addEventListener('click', saveGif);
$('saveStill').addEventListener('click', openPicker);
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
$('notesBox').addEventListener('toggle', renderNotes);
let notesTimer = 0;
$('lyrics').addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(renderNotes, 400); });

loadSettings();
syncFx();
syncAlign();
syncGmap();
applyFont();
updateInfo();
requestAnimationFrame(tick);
