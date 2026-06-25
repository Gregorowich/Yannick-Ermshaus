// J.A.R.V.I.S. – Frontend-Logik
// Ablauf: einmal antippen zum Starten (schaltet auf iOS Mikrofon + Ton frei),
//         dann Weckwort "Jarvis" (Porcupine) ODER Klick -> Aufnahme bis Stille
//         -> Upload an /api/chat -> Antwort anzeigen + vorlesen.

import { PorcupineWorker, BuiltInKeyword } from
  "https://cdn.jsdelivr.net/npm/@picovoice/porcupine-web@3.0.3/dist/esm/index.js";
import { WebVoiceProcessor } from
  "https://cdn.jsdelivr.net/npm/@picovoice/web-voice-processor@4.0.9/dist/esm/index.js";

const orb = document.getElementById("orb");
const statusEl = document.getElementById("status");
const youEl = document.getElementById("you");
const jarvisEl = document.getElementById("jarvis");

const sessionId = crypto.randomUUID();
let porcupine = null;
let audioCtx = null;     // gemeinsamer, per Geste freigeschalteter Audio-Kontext
let started = false;     // wurde die Start-Geste schon ausgeführt?
let busy = false;        // Aufnahme/Verarbeitung/Sprechen läuft

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

// ---- Start (einmalige Geste) -----------------------------------------
async function start() {
  if (started) return;
  setState("thinking", "Starte …");
  try {
    await ensureAudio();      // Ton auf iOS freischalten
    await initWakeWord();     // Mikrofon + Weckwort aktivieren
    started = true;
  } catch (err) {
    console.error(err);
    setState("error", "Mikrofon nicht verfügbar. Bitte erlauben und Seite neu laden.");
  }
}

// ---- Weckwort (Porcupine) --------------------------------------------
async function initWakeWord() {
  let accessKey = "";
  try {
    const res = await fetch("/api/config");
    accessKey = (await res.json()).picovoiceAccessKey || "";
  } catch { /* ignoriert */ }

  if (!accessKey) {
    // Kein Weckwort konfiguriert – App funktioniert per Klick weiter.
    setState("sleeping", "Tippe die Kugel zum Sprechen.");
    return;
  }

  porcupine = await PorcupineWorker.create(
    accessKey,
    [BuiltInKeyword.Jarvis],
    onWakeWord,
    { publicPath: "/models/porcupine_params.pv" },
  );
  await WebVoiceProcessor.subscribe(porcupine);
  setState("sleeping", 'Bereit. Sag „Jarvis" …');
}

async function onWakeWord() {
  if (busy) return;
  // Mikrofon für die Aufnahme freigeben: Porcupine kurz pausieren.
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

  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

  return new Promise((resolve) => {
    const SILENCE = 0.012;    // Schwelle für "leise"
    const SILENCE_MS = 1200;  // so lange Stille -> Ende
    const MAX_MS = 9000;      // Sicherheitslimit
    let lastLoud = Date.now();
    const startedAt = Date.now();

    recorder.onstop = () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      try { source.disconnect(); } catch { /* egal */ }
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };

    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = Date.now();
      if (rms > SILENCE) lastLoud = now;
      if (now - lastLoud > SILENCE_MS || now - startedAt > MAX_MS) {
        if (recorder.state !== "inactive") recorder.stop();
      }
    }, 100);

    recorder.start();
  });
}

// ---- Antwort-Audio über Web Audio abspielen (iOS-sicher) -------------
async function playAudioBase64(b64) {
  await ensureAudio();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const buffer = await audioCtx.decodeAudioData(bytes.buffer);
  await new Promise((resolve) => {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx.destination);
    src.onended = resolve;
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
