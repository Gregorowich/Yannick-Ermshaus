# J.A.R.V.I.S. 🤖

Ein Sprachassistent im Iron-Man-Stil: Sag **„Jarvis"**, stelle deine Frage auf
Deutsch – und er antwortet mit einer menschlich klingenden Stimme.

## Wie es funktioniert

| Baustein | Technologie |
|---|---|
| Weckwort „Jarvis" + Aufnahme | Picovoice Porcupine (im Browser) |
| Spracherkennung (Deutsch) | OpenAI Whisper |
| Antworten / „Gehirn" | Claude (`claude-opus-4-8`) |
| Stimme | OpenAI Text-to-Speech |

Ablauf: Browser hört auf das Weckwort → nimmt deine Frage auf → schickt sie an
den Server → Whisper macht Text daraus → Claude denkt sich eine Antwort aus →
OpenAI macht daraus Sprache → der Browser liest sie vor.

## Voraussetzungen

- [Node.js](https://nodejs.org/) (Version 18 oder neuer)
- Drei API-Schlüssel:
  - **Anthropic** (Claude) – https://console.anthropic.com/
  - **OpenAI** (Whisper + Stimme) – https://platform.openai.com/
  - **Picovoice** (Weckwort, kostenloses Kontingent) – https://console.picovoice.ai/

## Einrichtung

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Konfiguration anlegen und Schlüssel eintragen
cp .env.example .env
#   -> .env öffnen und ANTHROPIC_API_KEY, OPENAI_API_KEY, PICOVOICE_ACCESS_KEY ausfüllen

# 3. Weckwort-Modell bereitstellen (für "Jarvis")
#    Lade porcupine_params.pv herunter und lege es unter public/models/ ab:
mkdir -p public/models
#    Download:
#    https://github.com/Picovoice/porcupine/raw/master/lib/common/porcupine_params.pv
#    -> speichern als public/models/porcupine_params.pv

# 4. Starten
npm run dev
```

Dann im Browser öffnen: **http://localhost:3000**

Beim ersten Start fragt der Browser nach Mikrofon-Zugriff – bitte erlauben.

> 💡 **Auch ohne Weckwort nutzbar:** Wenn das Picovoice-Modell noch nicht
> eingerichtet ist, kannst du die leuchtende Kugel anklicken, um zu sprechen.

## Bedienung

1. Sag **„Jarvis"** (oder klicke die Kugel).
2. Die Kugel leuchtet auf – stelle deine Frage.
3. Nach kurzer Stille verarbeitet Jarvis sie und antwortet mit Stimme.
4. Folgefragen mit Bezug funktionieren (der Gesprächsverlauf bleibt erhalten).

## Hinweise

- Mikrofon im Browser benötigt `localhost` oder HTTPS.
- Die Stimme lässt sich in `src/speech.ts` ändern (`voice`-Feld, z. B. `nova`,
  `alloy`, `echo`).
- Die Persönlichkeit von Jarvis steckt im System-Prompt in `src/jarvis.ts`.

## Projektstruktur

```
src/
  server.ts   – Express-Server, Routen /api/chat, /api/config, /api/reset
  jarvis.ts   – Claude-Aufruf + Gesprächsverlauf (deutsche Jarvis-Persona)
  speech.ts   – Whisper (Spracherkennung) + OpenAI TTS (Stimme)
public/
  index.html  – Oberfläche
  app.js      – Weckwort, Aufnahme, Wiedergabe
  style.css   – Jarvis-Optik
```
