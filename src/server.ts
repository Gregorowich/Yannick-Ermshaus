import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askJarvis, resetHistory } from "./jarvis.js";
import { transcribe, synthesize } from "./speech.js";

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

app.listen(PORT, () => {
  console.log(`\n🤖 Jarvis läuft auf http://localhost:${PORT}\n`);
});
