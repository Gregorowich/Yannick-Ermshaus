import Anthropic from "@anthropic-ai/sdk";

// Client erst bei Bedarf erzeugen, damit der Server auch ohne gesetzten
// ANTHROPIC_API_KEY startet.
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic(); // liest ANTHROPIC_API_KEY aus der Umgebung
  return _client;
}

const SYSTEM_PROMPT = `Du bist J.A.R.V.I.S., der persönliche Sprachassistent aus Iron Man –
hier im Dienst deines Nutzers. Du sprichst Deutsch.

Persönlichkeit:
- Höflich, loyal und äußerst kompetent.
- Ruhig und souverän, mit einem Hauch trockenem, britischem Humor.
- Du sprichst den Nutzer respektvoll an (z. B. "Sir" sparsam, sonst neutral).

Stil – sehr wichtig, denn deine Antworten werden vorgelesen:
- Antworte KURZ und in natürlich gesprochener Sprache, meist 1–3 Sätze.
- Keine Aufzählungen, keine Markdown-Formatierung, keine Emojis, keine Codeblöcke –
  reiner Fließtext, den man laut vorlesen kann.
- Schreibe Zahlen und Abkürzungen so, wie man sie spricht.
- Wenn etwas unklar ist, frage knapp nach, statt zu raten.`;

export type Turn = { role: "user" | "assistant"; content: string };

// Einfacher In-Memory-Verlauf pro Session-ID.
const histories = new Map<string, Turn[]>();
const MAX_TURNS = 20; // letzte 20 Beiträge behalten (10 Runden)

/**
 * Schickt die Nutzeräußerung mit dem bisherigen Verlauf an Claude
 * und gibt die deutsche Antwort als Text zurück.
 */
export async function askJarvis(sessionId: string, userText: string): Promise<string> {
  const history = histories.get(sessionId) ?? [];
  history.push({ role: "user", content: userText });

  const response = await client().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    // Niedrige Latenz für ein flüssiges Sprachgespräch: kein langes "Nachdenken",
    // Jarvis antwortet direkt.
    thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    messages: history.map((t) => ({ role: t.role, content: t.content })),
  });

  const reply =
    response.content.find((block) => block.type === "text")?.text.trim() ??
    "Verzeihung, dazu kann ich gerade nichts sagen.";

  history.push({ role: "assistant", content: reply });

  // Verlauf begrenzen, damit er nicht unbegrenzt wächst.
  histories.set(sessionId, history.slice(-MAX_TURNS));

  return reply;
}

/** Setzt den Gesprächsverlauf einer Session zurück. */
export function resetHistory(sessionId: string): void {
  histories.delete(sessionId);
}
