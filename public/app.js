// J.A.R.V.I.S. – Frontend-Logik
// Ablauf: Weckwort "Jarvis" (Porcupine) ODER Klick -> Aufnahme bis Stille
//         -> Upload an /api/chat -> Antwort anzeigen + vorlesen.

import { PorcupineWorker, BuiltInKeyword } from
  "https://cdn.jsdelivr.net/npm/@picovoice/porcupine-web@3.0.3/dist/esm/index.js";
import { WebVoiceProcessor } from
  "https://cdn.jsdelivr.net/npm/@picovoice/web-voice-processor@4.0.9/dist/esm/index.js";

const orb = document.getElementById("orb");
const statusEl = document.getElementById("status");
const youEl = document.getElementById("you");
const jarvisEl = document.getElementById("jarvis");
const player = document.getElementById("player");

const sessionId = crypto.randomUUID();
let porcupine = null;
let busy = false; // true während Aufnahme/Verarbeitung/Sprechen

// ---- Zustands-Anzeige -------------------------------------------------
function setState(state, text) {
  orb.className = "orb " + state;
  if (text !== undefined) statusEl.textContent = text;
}

function showBubble(el, text) {
  el.textContent = text;
  el.classList.remove("hidden");
}

// ---- Weckwort (Porcupine) --------------------------------------------
async function initWakeWord() {
  try {
    const res = await fetch("/api/config");
    const { picovoiceAccessKey } = await res.json();
    if (!picovoiceAccessKey) throw new Error("Kein Picovoice-Schlüssel konfiguriert.");

    porcupine = await PorcupineWorker.create(
      picovoiceAccessKey,
      [BuiltInKeyword.Jarvis],
      onWakeWord,
      { publicPath: "/models/porcupine_params.pv" },
    );

    await WebVoiceProcessor.subscribe(porcupine);
    setState("sleeping", 'Bereit. Sag „Jarvis" …');
  } catch (err) {
    console.warn("Weckwort nicht verfügbar:", err);
    // Fallback: App funktioniert weiter per Klick auf die Kugel.
    setState("sleeping", "Klicke die Kugel zum Sprechen (Weckwort nicht aktiv).");
  }
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

  // Stille-Erkennung über die Web-Audio-API.
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);

  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

  return new Promise((resolve) => {
    const SILENCE = 0.012; // Schwelle für "leise"
    const SILENCE_MS = 1200; // so lange Stille -> Ende
    const MAX_MS = 9000; // Sicherheitslimit
    let lastLoud = Date.now();
    const started = Date.now();

    recorder.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      await audioCtx.close();
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

      if (now - lastLoud > SILENCE_MS || now - started > MAX_MS) {
        if (recorder.state !== "inactive") recorder.stop();
      }
    }, 100);

    recorder.start();
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
    form.append("audio", blob, "aufnahme.webm");
    form.append("sessionId", sessionId);

    const res = await fetch("/api/chat", { method: "POST", body: form });
    if (!res.ok) throw new Error("Serverfehler " + res.status);
    const { transcript, reply, audio, audioMime } = await res.json();

    if (!transcript) {
      setState("sleeping", "Ich habe nichts verstanden.");
      return;
    }
    showBubble(youEl, transcript);
    showBubble(jarvisEl, reply);

    if (audio) {
      setState("speaking", "");
      player.src = `data:${audioMime};base64,${audio}`;
      await player.play().catch(() => {});
      await new Promise((r) => (player.onended = r));
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

// Klick auf die Kugel = manuelles Auslösen (Fallback / ohne Weckwort).
orb.addEventListener("click", () => {
  if (!busy) recordAndRespond();
});

initWakeWord();
