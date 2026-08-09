import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askJarvis, resetHistory } from "./jarvis.js";
import { transcribe, synthesize } from "./speech.js";
import { getWeather, buildGreeting, type Weather } from "./weather.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// --- Schlüssel-Prüfung beim Start (frühe, klare Fehlermeldung) ---
const missing = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PICOVOICE_ACCESS_KEY"].filter(
  (key) => !process.env[key],
);
if (missing.length > 0) {
  console.warn(
    `\n⚠  Fehlende Umgebungsvariablen: ${missing.join(", ")}\n` +
      `   Lege eine .env-Datei an (siehe .env.example).\n`,
  );
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Statisches Frontend
app.use(express.static(path.join(__dirname, "..", "public")));

// Gibt dem Frontend den Porcupine-AccessKey (clientseitig benötigt).
app.get("/api/config", (_req, res) => {
  res.json({ picovoiceAccessKey: process.env.PICOVOICE_ACCESS_KEY ?? "" });
});

// Hauptroute: Audio rein -> Transkript, Antworttext und Antwort-Audio raus.
app.post("/api/chat", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Kein Audio empfangen." });
    }
    const sessionId = (req.body.sessionId as string) || "default";

    const transcript = await transcribe(req.file.buffer, req.file.mimetype);
    if (!transcript) {
      return res.json({ transcript: "", reply: "", audio: null });
    }

    const reply = await askJarvis(sessionId, transcript);
    const audio = await synthesize(reply);

    res.json({
      transcript,
      reply,
      audio: audio.toString("base64"),
      audioMime: "audio/mpeg",
    });
  } catch (err) {
    console.error("Fehler in /api/chat:", err);
    res.status(500).json({ error: "Interner Fehler bei der Verarbeitung." });
  }
});

// Verlauf zurücksetzen.
app.post("/api/reset", express.json(), (req, res) => {
  resetHistory((req.body?.sessionId as string) || "default");
  res.json({ ok: true });
});

// Begrüßung beim Öffnen: Wetter holen (optional, via Standort) und als
// gesprochenen Jarvis-Gruß zurückgeben.
app.post("/api/greeting", express.json(), async (req, res) => {
  try {
    const lat = Number(req.body?.lat);
    const lon = Number(req.body?.lon);
    const hour = Number(req.body?.hour);

    let weather: Weather | null = null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      try {
        weather = await getWeather(lat, lon);
      } catch (e) {
        console.warn("Wetter konnte nicht geladen werden:", e);
      }
    }

    const text = buildGreeting(hour, weather);
    const audio = await synthesize(text);
    res.json({ text, weather, audio: audio.toString("base64") });
  } catch (err) {
    console.error("Fehler in /api/greeting:", err);
    res.status(500).json({ error: "Begrüßung fehlgeschlagen." });
  }
});

// Lebenszeichen (für den "Wachhalter" unten und Health-Checks).
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n🤖 Jarvis läuft auf http://localhost:${PORT}\n`);
});

// --- Wachhalter gegen Render-Kaltstart -------------------------------------
// Der kostenlose Render-Dienst "schläft" nach ~15 Min ohne Anfragen ein; der
// nächste Aufruf dauert dann ~50 s. Solange RENDER_EXTERNAL_URL gesetzt ist
// (von Render automatisch), pingt sich der Dienst alle 10 Min selbst wach.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  const TEN_MINUTES = 10 * 60 * 1000;
  setInterval(() => {
    fetch(`${SELF_URL}/healthz`).catch(() => {
      /* Netzwerkfehler ignorieren – nächster Versuch in 10 Min */
    });
  }, TEN_MINUTES).unref();
  console.log("⏰ Wachhalter aktiv (Selbst-Ping alle 10 Min).");
}
