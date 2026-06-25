import OpenAI, { toFile } from "openai";

// Client erst bei Bedarf erzeugen, damit der Server auch ohne gesetzten
// OPENAI_API_KEY startet (das Frontend lädt dann trotzdem).
let _openai: OpenAI | null = null;
function openaiClient(): OpenAI {
  if (!_openai) _openai = new OpenAI(); // liest OPENAI_API_KEY aus der Umgebung
  return _openai;
}

/**
 * Wandelt aufgenommenes Audio (z. B. webm/opus aus dem Browser) in deutschen Text um.
 * Nutzt OpenAI Whisper.
 */
export async function transcribe(audio: Buffer, mimeType = "audio/webm"): Promise<string> {
  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("wav") ? "wav" : "webm";
  const file = await toFile(audio, `aufnahme.${ext}`, { type: mimeType });

  const result = await openaiClient().audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "de",
  });

  return result.text.trim();
}

/**
 * Erzeugt aus Text gesprochenes Audio mit einer menschlich klingenden Stimme.
 * Liefert MP3-Daten als Buffer zurück.
 */
export async function synthesize(text: string): Promise<Buffer> {
  const speech = await openaiClient().audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "onyx", // tiefe, ruhige Stimme – passt zur Jarvis-Persona
    input: text,
    response_format: "mp3",
  });

  const arrayBuffer = await speech.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
