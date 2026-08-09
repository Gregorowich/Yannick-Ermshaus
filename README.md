# J.A.R.V.I.S. 🤖

Ein Sprachassistent im Iron-Man-Stil: Sag **„Jarvis"**, stelle deine Frage auf
Deutsch – und er antwortet mit einer menschlich klingenden Stimme.

## Zwei Wege, Jarvis zu nutzen

- **Variante B – direkt in der Claude-App (am einfachsten, empfohlen fürs Handy):**
  Kein Server, keine Schlüssel, keine Webseite. Du legst in der Claude-App ein
  Projekt mit der Jarvis-Persönlichkeit an und redest über den Sprachmodus direkt
  mit ihm. → siehe unten „Variante B".
- **Variante A – selbst gehostete Web-App:** Das fertige Programm in diesem
  Repository. Mehr Kontrolle (eigene Stimme, eigenes Weckwort), aber du brauchst
  Node.js und drei API-Schlüssel. → siehe „Variante A".

---

# Variante B: Jarvis direkt in der Claude-App (ohne Server)

So hast du Jarvis einfach immer dabei – du öffnest Claude und redest los.

1. **Claude-App** öffnen (iOS/Android).
2. Ein neues **Projekt** anlegen und „Jarvis" nennen.
3. Den Text aus der Datei [`JARVIS_PERSONA.md`](./JARVIS_PERSONA.md) in die
   **Projektanweisungen** des Projekts einfügen.
4. Im Projekt ein neues Gespräch starten, den **Sprachmodus** (Mikrofon)
   antippen – und auf Deutsch losreden.

Claude übernimmt dann selbst das Verstehen, Antworten und die Stimme. Die
Persönlichkeit ist dieselbe wie in der Web-App.

> 💡 **Falls dein Tarif keine „Projekte" hat:** Trage den Persona-Text
> stattdessen in die Personalisierung ein (Einstellungen → Profil/„Custom
> Instructions") oder füge ihn einfach am Anfang eines Chats einmal ein.

> ℹ️ Sprachmodus und Projekte hängen von App-Version und Tarif ab. Es entstehen
> keine Extrakosten über dein normales Claude-Abo hinaus – kein OpenAI-/
> Picovoice-Schlüssel nötig.

---

# Variante A: Selbst gehostete Web-App

## 📱 Online stellen fürs iPad (ohne eigenen Computer)

So bekommst du den echten Jarvis (leuchtende Kugel + Weckwort „Jarvis") in den
**Safari auf dem iPad** – komplett vom iPad-Browser aus eingerichtet.

**Schritt 1 – Drei Schlüssel anlegen** (jeweils Konto erstellen, Schlüssel kopieren):
- **Anthropic** (das „Gehirn"): https://console.anthropic.com/ → *API Keys* → *Create Key*
- **OpenAI** (Stimme + Verstehen): https://platform.openai.com/ → *API keys* → *Create*
- **Picovoice** (Weckwort, kostenlos): https://console.picovoice.ai/ → *AccessKey* kopieren

> 💳 Anthropic und OpenAI brauchen eine hinterlegte Zahlungsmethode. Die Kosten
> sind klein (meist Cent-Beträge pro Gespräch), aber nicht null. Picovoice ist
> kostenlos.

**Schritt 2 – Online stellen mit Render (kostenlos):**
1. Geh auf **https://render.com** und melde dich an (am einfachsten „Sign in with GitHub").
2. Klicke **New → Blueprint**.
3. Verbinde dein GitHub-Konto und wähle das Repository **`Yannick-Ermshaus`**,
   Branch **`claude/ai-voice-assistant-22w2kv`**. Render erkennt die Datei
   `render.yaml` automatisch.
4. Render fragt nach den drei Schlüsseln aus Schritt 1 – trage sie ein
   (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PICOVOICE_ACCESS_KEY`).
5. Klicke **Apply** / **Deploy** und warte, bis der Status **„Live"** ist.
   Du bekommst eine Adresse wie `https://jarvis-xxxx.onrender.com`.

**Schritt 3 – Auf dem iPad benutzen:**
1. Öffne die Render-Adresse in **Safari**.
2. Tippe einmal auf die **Kugel** (das schaltet Mikrofon und Ton frei) und
   **erlaube den Mikrofon-Zugriff**.
3. Sag **„Jarvis"** und stelle deine Frage – er antwortet mit Stimme. 🎙️

**Schritt 4 – Als App ablegen:** In Safari auf **Teilen → „Zum Home-Bildschirm"**.
Dann hast du ein Jarvis-Symbol wie eine echte App.

> ℹ️ **Ehrlich:** Das Weckwort hört nur, solange die Jarvis-Seite **offen und im
> Vordergrund** ist – ein Browser darf auf dem iPad nicht im Hintergrund
> dauerhaft mithören. Auf dem kostenlosen Render-Tarif „schläft" der Dienst bei
> Nichtnutzung; der erste Aufruf danach dauert dann ein paar Sekunden länger.

---

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
# 1. Abhängigkeiten installieren (lädt auch das Weckwort-Modell automatisch)
npm install

# 2. Konfiguration anlegen und Schlüssel eintragen
cp .env.example .env
#   -> .env öffnen und ANTHROPIC_API_KEY, OPENAI_API_KEY, PICOVOICE_ACCESS_KEY ausfüllen

# 3. Starten
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
