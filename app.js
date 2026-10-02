'use strict';

const FONT = '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif';
const FADE = 0.35;        // 이미지·가사 전환에 걸리는 초
const CD_TURN = 4;        // CD 한 바퀴 대략 몇 초 (루프가 끊기지 않게 정수 바퀴로 맞춤)
const STORE = 'spincard:v1';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const ctx = stage.getContext('2d');

const state = {
  mode: 'player',
  bgMode: 'blur',
  images: [],              // { url, img }
  playing: true,
  t: 0,
  exporting: false,
  cancel: false,
};

// ---------- 설정 저장 (텍스트만) ----------
const FIELDS = ['title', 'artist', 'lyrics', 'lineSec', 'imgSec', 'bgColor', 'size', 'fps'];
function saveSettings() {
  try {
    const o = { mode: state.mode, bgMode: state.bgMode };
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
  } catch (e) {}
}

function setSeg(id, v) {
  for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
  state[id] = v;
}

// ---------- 시간 계산 ----------
function num(id, fallback) {
  const v = parseFloat($(id).value);
  return v > 0 ? v : fallback;
}

function parseLyrics() {
  const base = num('lineSec', 3);
  const out = [];
  let at = 0;
  for (const raw of $('lyrics').value.split('\n')) {
    const s = raw.trim();
    if (!s) continue;
    const m = s.match(/^\[(\d+(?:\.\d+)?)\]\s*(.*)$/);
    const dur = m && parseFloat(m[1]) > 0 ? parseFloat(m[1]) : base;
    const text = m ? m[2] : s;
    out.push({ text, start: at, dur });
    at += dur;
  }
  return out;
}

function duration() {
  const lines = parseLyrics();
  if (lines.length) {
    const last = lines[lines.length - 1];
    return last.start + last.dur;
  }
  const n = Math.max(state.images.length, 1);
  return Math.max(n * num('imgSec', 3), 3);
}

// ---------- 이미지 ----------
function addFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  // 고른 순서를 지키도록 다 읽은 뒤 한꺼번에 넣는다
  return Promise.all(list.map((f) => new Promise((resolve) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => resolve({ url, img, blurCache: {} });
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
    d.append(im, x);
    box.append(d);
  });
  updateInfo();
}

// 지금 시각에 보일 이미지와 다음 이미지로 넘어가는 정도(0~1)
function imageAt(t) {
  const n = state.images.length;
  if (!n) return { a: null, b: null, p: 0 };
  if (n === 1) return { a: state.images[0], b: null, p: 0 };
  const sec = num('imgSec', 3);
  const k = Math.floor(t / sec);
  const into = t - k * sec;
  const a = state.images[k % n];
  const b = state.images[(k + 1) % n];
  const p = into > sec - FADE ? (into - (sec - FADE)) / FADE : 0;
  return { a, b, p: Math.min(1, Math.max(0, p)) };
}

// 흐린 배경은 무거워서 크기별로 한 번만 만든다
function blurredBg(it, W, H) {
  const key = W + 'x' + H;
  if (it.blurCache[key]) return it.blurCache[key];
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = W * 0.06;
  g.filter = `blur(${r}px) saturate(1.2)`;
  drawCover(g, it.img, -r * 2, -r * 2, W + r * 4, H + r * 4);
  g.filter = 'none';
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fillRect(0, 0, W, H);
  it.blurCache[key] = c;
  return c;
}

function drawCover(g, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s, sh = h / s;
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

// ---------- 색 ----------
function isLight(hex) {
  const v = parseInt(hex.slice(1), 16);
  const r = v >> 16, g = (v >> 8) & 255, b = v & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

// ---------- 그리기 ----------
function fmt(s) {
  s = Math.max(0, Math.floor(s + 1e-6));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function wrap(g, text, maxW, maxLines) {
  const lines = [];
  let cur = '';
  // 한글은 글자 단위, 영문은 단어 단위로 끊기도록 공백을 경계로 먼저 나눈다
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
  g.globalAlpha = 1;
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
  drawCover(g, a.img, x, y, w, h);
  if (b && p > 0) {
    g.globalAlpha = p;
    drawCover(g, b.img, x, y, w, h);
    g.globalAlpha = 1;
  }
}

function lyricAt(t) {
  const lines = parseLyrics();
  for (const l of lines) {
    if (t >= l.start && t < l.start + l.dur) {
      const fade = Math.min(FADE, l.dur / 3);
      const alpha = Math.min(1, (t - l.start) / fade, (l.start + l.dur - t) / fade);
      return { text: l.text, alpha: Math.max(0, alpha) };
    }
  }
  return null;
}

function drawLyric(g, cx, top, maxW, size, fg, t) {
  const l = lyricAt(t);
  if (!l || !l.text) return;
  g.font = `600 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const lines = wrap(g, l.text, maxW, 2);
  g.globalAlpha = l.alpha;
  g.fillStyle = fg;
  lines.forEach((s, i) => g.fillText(s, cx, top + i * size * 1.4));
  g.globalAlpha = 1;
}

function drawProgress(g, x, y, w, u, fg, dim, t, T) {
  const p = T ? Math.min(1, t / T) : 0;
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
  g.fillText(fmt(t), x, y + 14 * u);
  g.textAlign = 'right';
  g.fillText(fmt(T), x + w, y + 14 * u);
}

function drawControls(g, cx, cy, u, fg) {
  g.fillStyle = fg;
  const tri = (x, dir, s) => {
    g.beginPath();
    g.moveTo(x, cy - s); g.lineTo(x + dir * s * 1.2, cy); g.lineTo(x, cy + s); g.closePath(); g.fill();
  };
  const s = 9 * u;
  // 이전
  const px = cx - 80 * u;
  g.fillRect(px - 12 * u, cy - s, 2.5 * u, s * 2);
  tri(px + 2 * u, -1, s);
  tri(px + 13 * u, -1, s);
  // 다음
  const nx = cx + 80 * u;
  g.fillRect(nx + 10 * u, cy - s, 2.5 * u, s * 2);
  tri(nx - 2 * u, 1, s);
  tri(nx - 13 * u, 1, s);
  // 일시정지(재생 중)
  const ps = 13 * u;
  g.fillRect(cx - ps * 0.6, cy - ps, ps * 0.42, ps * 2);
  g.fillRect(cx + ps * 0.18, cy - ps, ps * 0.42, ps * 2);
}

function drawTitles(g, cx, y, maxW, u, fg, dim) {
  const title = $('title').value.trim();
  const artist = $('artist').value.trim();
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillStyle = fg;
  g.font = `700 ${24 * u}px ${FONT}`;
  g.fillText(fitText(g, title, maxW), cx, y);
  g.fillStyle = dim;
  g.font = `500 ${16 * u}px ${FONT}`;
  g.fillText(fitText(g, artist, maxW), cx, y + 34 * u);
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

  if (state.mode === 'player') {
    const s = 352 * u, x = (W - s) / 2, y = 44 * u;
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
    g.restore();

    drawTitles(g, W / 2, 422 * u, s, u, fg, dim);
    drawLyric(g, W / 2, 486 * u, s, 17 * u, fg, t);
    drawProgress(g, x, 558 * u, s, u, fg, dim, t, T);
    drawControls(g, W / 2, 606 * u, u, fg);
  } else {
    drawDisc(g, W / 2, 228 * u, 186 * u, u, t, T);
    drawTitles(g, W / 2, 440 * u, 380 * u, u, fg, dim);
    drawLyric(g, W / 2, 506 * u, 380 * u, 17 * u, fg, t);
    drawProgress(g, (W - 352 * u) / 2, 586 * u, 352 * u, u, fg, dim, t, T);
  }
  g.restore();
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
  const ang = (t / T) * turns * Math.PI * 2;

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

function updateInfo() {
  const T = duration();
  $('seek').max = T;
  if (state.t > T) state.t = 0;
  if (!state.exporting) {
    const frames = Math.ceil(T * parseInt($('fps').value, 10));
    $('status').textContent = `GIF ${fmt(T)} · ${frames}장`;
  }
}

let last = performance.now();
function tick(now) {
  const dt = (now - last) / 1000;
  last = now;
  const T = duration();
  if (state.playing && !state.exporting) state.t = (state.t + dt) % T;
  sizeStage();
  render(ctx, stage.width, state.t);
  $('seek').value = state.t;
  $('time').textContent = `${fmt(state.t)} / ${fmt(T)}`;
  requestAnimationFrame(tick);
}

function setPlaying(v) {
  state.playing = v;
  $('play').textContent = v ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', v ? '일시정지' : '재생');
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

function saveStill(type) {
  const W = exportWidth();
  const c = document.createElement('canvas');
  c.width = W; c.height = Math.round(W * 4 / 3);
  const g = c.getContext('2d');
  if (type === 'image/jpeg') { g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); }
  render(g, W, state.t);
  c.toBlob((b) => download(b, fileBase() + (type === 'image/png' ? '.png' : '.jpg')), type, 0.92);
}

async function saveGif() {
  if (state.exporting) { state.cancel = true; return; }
  const { GIFEncoder, quantize, applyPalette } = window.gifenc;
  const W = exportWidth(), H = Math.round(W * 4 / 3);
  const fps = parseInt($('fps').value, 10);
  const T = duration();
  const frames = Math.max(1, Math.round(T * fps));
  const delay = 1000 / fps;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  const gif = GIFEncoder();

  state.exporting = true;
  state.cancel = false;
  $('saveGif').textContent = '멈추기';
  for (const id of ['savePng', 'saveJpg']) $(id).disabled = true;

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
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    flush();
    gif.finish();
    const blob = new Blob([gif.bytes()], { type: 'image/gif' });
    download(blob, fileBase() + '.gif');
    $('status').textContent = `GIF 저장됨 · ${(blob.size / 1024 / 1024).toFixed(1)}MB`;
  } finally {
    state.exporting = false;
    $('saveGif').textContent = 'GIF 저장';
    for (const id of ['savePng', 'saveJpg']) $(id).disabled = false;
  }
}

function sameFrame(a, b) {
  const x = new Uint32Array(a.buffer), y = new Uint32Array(b.buffer);
  for (let i = 0; i < x.length; i += 7) if (x[i] !== y[i]) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

// ---------- 연결 ----------
for (const id of ['mode', 'bgMode']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setSeg(id, b.dataset.v);
    saveSettings();
  });
}
for (const f of FIELDS) $(f).addEventListener('input', () => { updateInfo(); saveSettings(); });
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

$('play').addEventListener('click', () => setPlaying(!state.playing));
$('seek').addEventListener('input', (e) => { setPlaying(false); state.t = parseFloat(e.target.value); });
$('saveGif').addEventListener('click', saveGif);
$('savePng').addEventListener('click', () => saveStill('image/png'));
$('saveJpg').addEventListener('click', () => saveStill('image/jpeg'));

loadSettings();
updateInfo();
requestAnimationFrame(tick);
