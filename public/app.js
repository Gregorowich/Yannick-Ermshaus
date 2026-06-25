// J.A.R.V.I.S. – Frontend-Logik + HUD
// Ablauf: einmal antippen zum Starten (schaltet auf iOS Mikrofon + Ton frei),
//         dann Weckwort "Jarvis" (Porcupine) ODER Klick -> Aufnahme bis Stille
//         -> Upload an /api/chat -> Antwort anzeigen + vorlesen.
// Zusätzlich: animiertes HUD im Hintergrund + Kugel reagiert auf die Lautstärke.

import { PorcupineWorker, BuiltInKeyword } from
  "https://cdn.jsdelivr.net/npm/@picovoice/porcupine-web@3.0.3/dist/esm/index.js";
import { WebVoiceProcessor } from
  "https://cdn.jsdelivr.net/npm/@picovoice/web-voice-processor@4.0.9/dist/esm/index.js";

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
let porcupine = null;
let audioCtx = null;     // gemeinsamer, per Geste freigeschalteter Audio-Kontext
let started = false;     // wurde die Start-Geste schon ausgeführt?
let busy = false;        // Aufnahme/Verarbeitung/Sprechen läuft

// Stimm-Reaktivität: aktiver Analyser (Mikro beim Zuhören, Wiedergabe beim Sprechen)
let activeAnalyser = null;
let activeData = null;
let level = 0; // geglättete Lautstärke 0..1, steuert die Kugel

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

// ---- Start (einmalige Geste) -----------------------------------------
async function start() {
  if (started) return;
  try {
    await ensureAudio(); // Ton auf iOS freischalten
    // kurze Boot-Sequenz (Flavor)
    await bootSequence();
    await initWakeWord(); // Mikrofon + Weckwort aktivieren
    started = true;
    greet(); // Begrüßung + Wetter (läuft im Hintergrund weiter)
  } catch (err) {
    console.error(err);
    setState("error", "Mikrofon nicht verfügbar. Bitte erlauben und Seite neu laden.");
  }
}

// ---- Begrüßung beim Öffnen (mit Wetter, wenn Standort erlaubt) --------
function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null), // Ablehnung/Fehler -> ohne Wetter begrüßen
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
      body: JSON.stringify({
        lat: pos?.lat, lon: pos?.lon, hour: new Date().getHours(),
      }),
    });
    if (!res.ok) throw new Error("greeting " + res.status);
    const { text, weather, audio } = await res.json();
    fillWeather(weather);
    if (sysStatusEl) sysStatusEl.textContent = "System bereit";
    if (busy) return; // falls der Nutzer schon spricht: Gruß nicht überlagern
    if (text) showBubble(jarvisEl, text);
    if (audio) {
      setState("speaking", "");
      try { await playAudioBase64(audio); } catch (e) { console.warn(e); }
      if (!busy) setState("sleeping", porcupine ? 'Bereit. Sag „Jarvis" …' : "Tippe die Kugel zum Sprechen.");
    }
  } catch (err) {
    console.warn("Begrüßung übersprungen:", err);
    if (sysStatusEl) sysStatusEl.textContent = "System bereit";
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function bootSequence() {
  setState("thinking", "Systeme online …");
  await delay(450);
  setState("thinking", "Stimme kalibriert …");
  await delay(450);
}

// ---- Weckwort (Porcupine) --------------------------------------------
async function initWakeWord() {
  let accessKey = "";
  try {
    const res = await fetch("/api/config");
    accessKey = (await res.json()).picovoiceAccessKey || "";
  } catch { /* ignoriert */ }

  if (!accessKey) {
    setState("sleeping", "Tippe die Kugel zum Sprechen.");
    return;
  }

  // Weckwort ist optional: scheitert die Einrichtung, NICHT abbrechen.
  try {
    porcupine = await PorcupineWorker.create(
      accessKey,
      [BuiltInKeyword.Jarvis],
      onWakeWord,
      { publicPath: "/models/porcupine_params.pv" },
    );
    await WebVoiceProcessor.subscribe(porcupine);
    setState("sleeping", 'Bereit. Sag „Jarvis" …');
  } catch (err) {
    console.warn("Weckwort nicht verfügbar, nutze Tippen:", err);
    porcupine = null;
    setState("sleeping", "Tippe die Kugel zum Sprechen.");
  }
}

async function onWakeWord() {
  if (busy) return;
  if (porcupine) await WebVoiceProcessor.unsubscribe(porcupine);
  try {
    await recordAndRespond();
  } finally {
    if (porcupine) await WebVoiceProcessor.subscribe(porcupine);
    if (!busy) setState("sleeping", 'Bereit. Sag „Jarvis" …');
  }
}

// ---- Aufnahme mit Stille-Erkennung -----------------------------------
async function recordCommand() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  await ensureAudio();

  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);

  // Kugel reagiert nun auf das Mikrofon
  activeAnalyser = analyser;
  activeData = data;

  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

  return new Promise((resolve) => {
    const SILENCE = 0.012;
    const SILENCE_MS = 1200;
    const MAX_MS = 9000;
    let lastLoud = Date.now();
    const startedAt = Date.now();

    recorder.onstop = () => {
      clearInterval(timer);
      activeAnalyser = null;
      activeData = null;
      stream.getTracks().forEach((t) => t.stop());
      try { source.disconnect(); } catch { /* egal */ }
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };

    const timer = setInterval(() => {
      const rms = rmsFrom(analyser, data);
      const now = Date.now();
      if (rms > SILENCE) lastLoud = now;
      if (now - lastLoud > SILENCE_MS || now - startedAt > MAX_MS) {
        if (recorder.state !== "inactive") recorder.stop();
      }
    }, 100);

    recorder.start();
  });
}

// ---- Antwort-Audio über Web Audio abspielen (iOS-sicher) + reaktiv ----
async function playAudioBase64(b64) {
  await ensureAudio();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const buffer = await audioCtx.decodeAudioData(bytes.buffer);

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  const data = new Uint8Array(analyser.fftSize);

  await new Promise((resolve) => {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
    activeAnalyser = analyser;
    activeData = data;
    src.onended = () => {
      activeAnalyser = null;
      activeData = null;
      resolve();
    };
    src.start();
  });
}

async function recordAndRespond() {
  if (busy) return;
  busy = true;
  youEl.classList.add("hidden");
  jarvisEl.classList.add("hidden");

  try {
    setState("listening", "Ich höre …");
    const blob = await recordCommand();

    setState("thinking", "Einen Moment …");
    const form = new FormData();
    form.append("audio", blob, "aufnahme");
    form.append("sessionId", sessionId);

    const res = await fetch("/api/chat", { method: "POST", body: form });
    if (!res.ok) throw new Error("Serverfehler " + res.status);
    const { transcript, reply, audio } = await res.json();

    if (!transcript) {
      setState("sleeping", "Ich habe nichts verstanden.");
      return;
    }
    showBubble(youEl, transcript);
    showBubble(jarvisEl, reply);

    if (audio) {
      setState("speaking", "");
      try { await playAudioBase64(audio); } catch (e) { console.warn("Wiedergabe:", e); }
    }
    setState("sleeping", 'Bereit. Sag „Jarvis" …');
  } catch (err) {
    console.error(err);
    setState("error", "Entschuldigung, etwas ist schiefgelaufen.");
    setTimeout(() => setState("sleeping", 'Bereit. Sag „Jarvis" …'), 2500);
  } finally {
    busy = false;
  }
}

// Klick auf die Kugel: erst Start-Geste, danach manuelles Auslösen.
orb.addEventListener("click", () => {
  if (!started) { start(); return; }
  if (!busy) recordAndRespond();
});

setState("sleeping", "Zum Starten antippen");

// =====================================================================
//  HUD-Hintergrund (Canvas) + Lautstärke-Glättung für die Kugel
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

// Voice-reaktive Waveform am unteren Rand.
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
      // Ruhepuls: feine, langsam wandernde Sinuswelle
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

// Partikelfeld
for (let i = 0; i < 64; i++) {
  particles.push({
    x: Math.random() * W,
    y: Math.random() * H,
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

  // dezentes Partikelfeld
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = W; else if (p.x > W) p.x = 0;
    if (p.y < 0) p.y = H; else if (p.y > H) p.y = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(125, 211, 252, ${p.a * (0.5 + level * 0.5)})`;
    ctx.fill();
  }

  // konzentrische, rotierende HUD-Bögen um die Kugel
  const intensity = 0.12 + level * 0.5;
  const rings = [
    { r: base * 0.30, speed: 0.00008, dash: [6 * DPR, 26 * DPR], width: 1.2 * DPR, span: Math.PI * 1.4 },
    { r: base * 0.37, speed: -0.00005, dash: [40 * DPR, 18 * DPR], width: 1 * DPR, span: Math.PI * 0.5 },
    { r: base * 0.44, speed: 0.00003, dash: [2 * DPR, 14 * DPR], width: 1 * DPR, span: Math.PI * 2 },
  ];
  for (const ring of rings) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((t * ring.speed) % (Math.PI * 2));
    ctx.beginPath();
    ctx.setLineDash(ring.dash);
    ctx.arc(0, 0, ring.r, 0, ring.span);
    ctx.strokeStyle = `rgba(56, 189, 248, ${intensity})`;
    ctx.lineWidth = ring.width;
    ctx.stroke();
    ctx.restore();
  }
  ctx.setLineDash([]);

  // Eck-Klammern (HUD-Rahmen)
  drawCorners(28 * DPR, 26 * DPR, 0.22);

  // langsam wandernde Scan-Linie
  const scanY = (Math.sin(t * 0.00018) * 0.5 + 0.5) * H;
  const grd = ctx.createLinearGradient(0, scanY - 40 * DPR, 0, scanY + 40 * DPR);
  grd.addColorStop(0, "rgba(56,189,248,0)");
  grd.addColorStop(0.5, `rgba(56,189,248,${0.05 + level * 0.05})`);
  grd.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, scanY - 40 * DPR, W, 80 * DPR);
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

function loop(t) {
  // Ziel-Lautstärke: aus aktivem Analyser, sonst sanfter Ruhepuls
  let target;
  if (activeAnalyser && activeData) {
    target = Math.min(1, rmsFrom(activeAnalyser, activeData) * 4);
  } else {
    target = 0.06 + Math.sin(t * 0.002) * 0.04; // „atmet" leicht
  }
  level += (target - level) * 0.2;
  document.documentElement.style.setProperty("--level", level.toFixed(3));

  drawHud(t);
  drawWave(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
