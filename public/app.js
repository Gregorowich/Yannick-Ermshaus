// J.A.R.V.I.S. – Frontend-Logik + HUD
// Freihändiger Gesprächsmodus: einmal antippen zum Starten (schaltet auf iOS
// Mikrofon + Ton frei). Danach hört Jarvis DURCHGEHEND zu – einfach drauflos
// reden, er antwortet, und es geht weiter. Tippen pausiert/setzt fort.

const orb = document.getElementById("orb");
const statusEl = document.getElementById("status");
const youEl = document.getElementById("you");
const jarvisEl = document.getElementById("jarvis");
const canvas = document.getElementById("hud");
const waveCanvas = document.getElementById("wave");
const sysStatusEl = document.getElementById("sysStatus");
const weatherPanel = document.getElementById("weatherPanel");

// ---- Live-Uhr (oben rechts) ------------------------------------------
const clockEl = document.getElementById("clock");
const dateEl = document.getElementById("date");
function tickClock() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  clockEl.textContent = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  dateEl.textContent = now.toLocaleDateString("de-DE", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "numeric",
  });
}
tickClock();
setInterval(tickClock, 1000);

const sessionId = crypto.randomUUID();
let audioCtx = null;     // gemeinsamer, per Geste freigeschalteter Audio-Kontext
let started = false;     // wurde die Start-Geste schon ausgeführt?

// Gesprächsmodus
let micStream = null;    // dauerhaft offenes Mikrofon
let vad = null;          // Analyser für Sprach-Erkennung (VAD)
let vadData = null;
let convoOn = false;     // Gesprächsmodus aktiv (hört zu)
let capturing = false;   // nimmt gerade eine Äußerung auf
let speaking = false;    // Jarvis gibt gerade Audio aus
let busy = false;        // Verarbeitung läuft
let onsetAt = 0;         // Zeitpunkt des Sprechbeginns
let cooldownUntil = 0;   // kurz nach dem Sprechen nicht sofort wieder zuhören

// Stimm-Reaktivität: aktiver Analyser steuert Kugel + Waveform
let activeAnalyser = null;
let activeData = null;
let level = 0;

const HINT_LISTEN = "Sprich einfach – ich höre zu.";
const HINT_PAUSED = "Pausiert – tippe zum Fortsetzen.";

// ---- Zustands-Anzeige -------------------------------------------------
function setState(state, text) {
  orb.className = "orb " + state;
  if (text !== undefined) statusEl.textContent = text;
}
function showBubble(el, text) {
  el.textContent = text;
  el.classList.remove("hidden");
}

// ---- Audio-Kontext (iOS: muss aus einer Nutzer-Geste heraus laufen) ---
async function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") await audioCtx.resume();
}

function rmsFrom(analyser, data) {
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---- Start (einmalige Geste) -----------------------------------------
async function start() {
  if (started) return;
  try {
    await ensureAudio();
    setState("thinking", "Systeme online …");
    await delay(450);
    setState("thinking", "Stimme kalibriert …");
    await delay(350);
    await startConversation(); // Mikrofon dauerhaft öffnen
    started = true;
    greet(); // Begrüßung + Wetter (läuft nebenher)
  } catch (err) {
    console.error(err);
    setState("error", "Mikrofon nicht verfügbar. Bitte erlauben und Seite neu laden.");
  }
}

// ---- Gesprächsmodus: dauerhaft zuhören -------------------------------
async function startConversation() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const src = audioCtx.createMediaStreamSource(micStream);
  vad = audioCtx.createAnalyser();
  vad.fftSize = 2048;
  src.connect(vad);
  vadData = new Uint8Array(vad.fftSize);

  activeAnalyser = vad; // Kugel reagiert auf deine Stimme
  activeData = vadData;
  convoOn = true;
  setState("sleeping", HINT_LISTEN);
  monitorLoop();
}

function monitorLoop() {
  if (!convoOn) return;
  if (!capturing && !speaking && !busy && Date.now() > cooldownUntil) {
    const rms = rmsFrom(vad, vadData);
    const now = Date.now();
    if (rms > 0.03) {
      if (!onsetAt) onsetAt = now;
      else if (now - onsetAt > 120) { onsetAt = 0; captureUtterance(); }
    } else {
      onsetAt = 0;
    }
  }
  setTimeout(monitorLoop, 60);
}

// Nimmt eine Äußerung auf (bis Stille) und verarbeitet sie.
async function captureUtterance() {
  if (capturing || busy || speaking) return;
  capturing = true;
  busy = true;
  youEl.classList.add("hidden");
  jarvisEl.classList.add("hidden");
  setState("listening", "Ich höre …");

  try {
    const blob = await recordUntilSilence();
    capturing = false;
    setState("thinking", "Einen Moment …");
    await sendAndRespond(blob);
  } catch (err) {
    console.error(err);
    setState("error", "Entschuldigung, etwas ist schiefgelaufen.");
    await delay(2000);
  } finally {
    capturing = false;
    busy = false;
    if (convoOn) setState("sleeping", HINT_LISTEN);
  }
}

function recordUntilSilence() {
  const recorder = new MediaRecorder(micStream);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

  return new Promise((resolve) => {
    const SILENCE = 0.02;
    const SILENCE_MS = 600; // schneller reagieren, sobald du fertig bist
    const MIN_MS = 300;
    const MAX_MS = 12000;
    let lastLoud = Date.now();
    const startedAt = Date.now();

    recorder.onstop = () => {
      clearInterval(timer);
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
    const timer = setInterval(() => {
      const rms = rmsFrom(vad, vadData);
      const now = Date.now();
      if (rms > SILENCE) lastLoud = now;
      const longEnough = now - startedAt > MIN_MS;
      if ((longEnough && now - lastLoud > SILENCE_MS) || now - startedAt > MAX_MS) {
        if (recorder.state !== "inactive") recorder.stop();
      }
    }, 80);
    recorder.start();
  });
}

async function sendAndRespond(blob) {
  const form = new FormData();
  form.append("audio", blob, "aufnahme");
  form.append("sessionId", sessionId);

  const res = await fetch("/api/chat", { method: "POST", body: form });
  if (!res.ok) throw new Error("Serverfehler " + res.status);
  const { transcript, reply, audio } = await res.json();

  if (!transcript) {
    // nichts Verständliches gehört – einfach weiter zuhören
    return;
  }
  showBubble(youEl, transcript);
  showBubble(jarvisEl, reply);
  if (audio) {
    setState("speaking", "");
    try { await playAudioBase64(audio); } catch (e) { console.warn("Wiedergabe:", e); }
  }
}

// ---- Antwort-Audio abspielen (iOS-sicher) + reaktiv -------------------
async function playAudioBase64(b64) {
  await ensureAudio();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const buffer = await audioCtx.decodeAudioData(bytes.buffer);

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  const data = new Uint8Array(analyser.fftSize);

  speaking = true;
  await new Promise((resolve) => {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
    activeAnalyser = analyser; // Kugel reagiert auf Jarvis' Stimme
    activeData = data;
    src.onended = resolve;
    src.start();
  });
  speaking = false;
  cooldownUntil = Date.now() + 450; // kurze Pause, damit er sich nicht selbst hört
  // Kugel wieder auf Mikro (im Gesprächsmodus), sonst aus
  activeAnalyser = convoOn ? vad : null;
  activeData = convoOn ? vadData : null;
}

// ---- Begrüßung beim Öffnen (mit Wetter, wenn Standort erlaubt) --------
function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 600000 },
    );
  });
}

function fillWeather(w) {
  if (!w) return;
  document.getElementById("wxTemp").textContent = w.tempC;
  document.getElementById("wxDesc").textContent = w.description;
  document.getElementById("wxFeels").textContent = w.feelsC + "°";
  document.getElementById("wxHum").textContent = w.humidity + "%";
  document.getElementById("wxMax").textContent = w.maxC + "°";
  document.getElementById("wxWind").textContent = w.windKmh + " km/h";
  document.getElementById("wxSunrise").textContent = w.sunrise;
  document.getElementById("wxSunset").textContent = w.sunset;
  weatherPanel.classList.remove("hidden");
}

async function greet() {
  try {
    if (sysStatusEl) sysStatusEl.textContent = "Standort wird ermittelt …";
    const pos = await getPosition();
    const res = await fetch("/api/greeting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: pos?.lat, lon: pos?.lon, hour: new Date().getHours() }),
    });
    if (!res.ok) throw new Error("greeting " + res.status);
    const { text, weather, audio } = await res.json();
    fillWeather(weather);
    if (sysStatusEl) sysStatusEl.textContent = "System bereit";
    if (capturing || busy) return; // falls der Nutzer schon spricht: nicht überlagern
    if (text) showBubble(jarvisEl, text);
    if (audio) {
      setState("speaking", "");
      try { await playAudioBase64(audio); } catch (e) { console.warn(e); }
      if (convoOn && !busy) setState("sleeping", HINT_LISTEN);
    }
  } catch (err) {
    console.warn("Begrüßung übersprungen:", err);
    if (sysStatusEl) sysStatusEl.textContent = "System bereit";
  }
}

// ---- Tippen: starten, bzw. Gesprächsmodus pausieren/fortsetzen --------
orb.addEventListener("click", () => {
  if (!started) { start(); return; }
  if (convoOn) {
    convoOn = false;
    activeAnalyser = null;
    activeData = null;
    setState("sleeping", HINT_PAUSED);
  } else {
    convoOn = true;
    activeAnalyser = vad;
    activeData = vadData;
    setState("sleeping", HINT_LISTEN);
    monitorLoop();
  }
});

setState("sleeping", "Zum Starten antippen");

// =====================================================================
//  HUD-Hintergrund (Canvas) + Waveform + Lautstärke-Glättung
// =====================================================================
const ctx = canvas.getContext("2d");
const wctx = waveCanvas.getContext("2d");
let W = 0, H = 0, DPR = 1;
let WW = 0, WH = 0;
const particles = [];

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.width = Math.floor(window.innerWidth * DPR);
  H = canvas.height = Math.floor(window.innerHeight * DPR);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";

  WW = waveCanvas.width = Math.floor(waveCanvas.clientWidth * DPR);
  WH = waveCanvas.height = Math.floor(46 * DPR);
}
window.addEventListener("resize", resize);
resize();

const waveData = new Uint8Array(256);
function drawWave(t) {
  if (!WW) return;
  wctx.clearRect(0, 0, WW, WH);
  const mid = WH / 2;
  wctx.beginPath();
  const N = waveData.length;
  for (let i = 0; i < N; i++) {
    let v;
    if (activeAnalyser) {
      activeAnalyser.getByteTimeDomainData(waveData);
      v = (waveData[i] - 128) / 128;
    } else {
      v = Math.sin(i * 0.18 + t * 0.004) * (0.06 + level * 0.1);
    }
    const x = (i / (N - 1)) * WW;
    const y = mid + v * mid * 0.9;
    i === 0 ? wctx.moveTo(x, y) : wctx.lineTo(x, y);
  }
  wctx.strokeStyle = `rgba(56, 189, 248, ${0.5 + level * 0.5})`;
  wctx.lineWidth = 1.5 * DPR;
  wctx.shadowBlur = 8 * DPR;
  wctx.shadowColor = "rgba(56, 189, 248, 0.6)";
  wctx.stroke();
  wctx.shadowBlur = 0;
}

for (let i = 0; i < 64; i++) {
  particles.push({
    x: Math.random() * W, y: Math.random() * H,
    r: (Math.random() * 1.4 + 0.3) * DPR,
    vx: (Math.random() - 0.5) * 0.15 * DPR,
    vy: (Math.random() - 0.5) * 0.15 * DPR,
    a: Math.random() * 0.4 + 0.1,
  });
}

function drawHud(t) {
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H * 0.46;
  const base = Math.min(W, H);
  const intensity = 0.12 + level * 0.55;

  drawGrid();
  drawParticles();
  drawRadarSweep(cx, cy, base * 0.47, t);
  drawReactorRings(cx, cy, base, t, intensity);
  drawEqBars(t);
  drawReadouts(t);
  drawCorners(30 * DPR, 22 * DPR, 0.25);
  drawScan(t);
}

function drawGrid() {
  const step = 48 * DPR;
  ctx.strokeStyle = "rgba(56,189,248,0.045)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
}

function drawParticles() {
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) p.x = W; else if (p.x > W) p.x = 0;
    if (p.y < 0) p.y = H; else if (p.y > H) p.y = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(125, 211, 252, ${p.a * (0.45 + level * 0.55)})`;
    ctx.fill();
  }
}

// rotierender Radar-Sweep um den Reaktor
function drawRadarSweep(cx, cy, r, t) {
  const ang = (t * 0.0006) % (Math.PI * 2);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  const g = ctx.createLinearGradient(0, 0, r, 0);
  g.addColorStop(0, "rgba(56,189,248,0)");
  g.addColorStop(1, `rgba(56,189,248,${0.10 + level * 0.12})`);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, -0.32, 0);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

// segmentierte Reaktor-Ringe + Tick-Skala + Mittendreieck
function drawReactorRings(cx, cy, base, t, intensity) {
  drawSegments(cx, cy, base * 0.30, 48, t * 0.00006, 0.05, intensity);
  drawSegments(cx, cy, base * 0.375, 72, -t * 0.00004, 0.04, intensity * 0.8);

  // Tick-Skala
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((t * 0.00002) % (Math.PI * 2));
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    const major = i % 5 === 0;
    const r1 = base * 0.43;
    const r2 = base * 0.45 + (major ? base * 0.012 : 0);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    ctx.strokeStyle = `rgba(56,189,248,${(major ? 0.28 : 0.1) + intensity * 0.1})`;
    ctx.lineWidth = (major ? 1.6 : 1) * DPR;
    ctx.stroke();
  }
  ctx.restore();

  // Mittendreieck (Reaktor-Andeutung)
  ctx.save();
  ctx.translate(cx, cy);
  const tr = base * 0.13;
  ctx.beginPath();
  ctx.moveTo(0, -tr);
  ctx.lineTo(tr * 0.87, tr * 0.5);
  ctx.lineTo(-tr * 0.87, tr * 0.5);
  ctx.closePath();
  ctx.strokeStyle = `rgba(125,211,252,${0.2 + intensity * 0.35})`;
  ctx.lineWidth = 1.2 * DPR;
  ctx.stroke();
  ctx.restore();
}

function drawSegments(cx, cy, r, count, rot, gap, intensity) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot % (Math.PI * 2));
  const seg = (Math.PI * 2) / count;
  for (let i = 0; i < count; i++) {
    const a0 = i * seg;
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a0 + seg - gap);
    ctx.strokeStyle = `rgba(56,189,248,${(i % 3 === 0 ? 0.26 : 0.1) + intensity * 0.1})`;
    ctx.lineWidth = 2 * DPR;
    ctx.stroke();
  }
  ctx.restore();
}

// Telemetrie-/Equalizer-Balken links und rechts
function drawEqBars(t) {
  const n = 22;
  const h = H * 0.5;
  const y0 = H * 0.25;
  drawEqColumn(W * 0.05, y0, h, n, t, 1);
  drawEqColumn(W * 0.95, y0, h, n, t, -1);
}
function drawEqColumn(x, y0, h, n, t, dir) {
  const gap = h / n;
  for (let i = 0; i < n; i++) {
    const amp = (Math.sin(i * 0.5 + t * 0.004) * 0.5 + 0.5) * (0.3 + level * 0.7);
    const w = (8 + amp * 46) * DPR;
    const yy = y0 + i * gap;
    ctx.fillStyle = `rgba(56,189,248,${0.07 + amp * 0.22})`;
    ctx.fillRect(dir > 0 ? x : x - w, yy, w, gap * 0.55);
  }
}

// Daten-Readouts in den unteren Ecken (über dem Footer)
function drawReadouts(t) {
  ctx.fillStyle = "rgba(125,211,252,0.45)";
  ctx.font = `${11 * DPR}px "Rajdhani", "Courier New", monospace`;
  const load = 60 + Math.round(Math.sin(t * 0.001) * 8 + 18);
  const y1 = H - 96 * DPR;
  const y2 = H - 80 * DPR;
  ctx.textAlign = "left";
  ctx.fillText(`SYS LOAD ${load}%`, 22 * DPR, y1);
  ctx.fillText(`SECURE LINK · ACTIVE`, 22 * DPR, y2);
  ctx.textAlign = "right";
  ctx.fillText(`UPLINK ${(0.9 + Math.random() * 0.09).toFixed(2)} Gb/s`, W - 22 * DPR, y1);
  ctx.fillText(`CORE TEMP ${36 + Math.round(level * 8)}°`, W - 22 * DPR, y2);
  ctx.textAlign = "left";
}

function drawCorners(len, pad, alpha) {
  ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
  ctx.lineWidth = 1.5 * DPR;
  const corners = [
    [pad, pad, 1, 1], [W - pad, pad, -1, 1],
    [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + sx * len, y);
    ctx.stroke();
  }
}

function drawScan(t) {
  const scanY = (Math.sin(t * 0.00018) * 0.5 + 0.5) * H;
  const grd = ctx.createLinearGradient(0, scanY - 40 * DPR, 0, scanY + 40 * DPR);
  grd.addColorStop(0, "rgba(56,189,248,0)");
  grd.addColorStop(0.5, `rgba(56,189,248,${0.05 + level * 0.06})`);
  grd.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, scanY - 40 * DPR, W, 80 * DPR);
}

function loop(t) {
  let target;
  if (activeAnalyser && activeData) {
    target = Math.min(1, rmsFrom(activeAnalyser, activeData) * 4);
  } else {
    target = 0.06 + Math.sin(t * 0.002) * 0.04;
  }
  level += (target - level) * 0.2;
  document.documentElement.style.setProperty("--level", level.toFixed(3));

  drawHud(t);
  drawWave(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
