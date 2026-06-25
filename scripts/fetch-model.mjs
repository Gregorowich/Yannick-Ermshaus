// Lädt das Weckwort-Modell (porcupine_params.pv) nach public/models/,
// falls es noch nicht vorhanden ist. Läuft als npm "postinstall".
// Wichtig: bricht die Installation NICHT ab, wenn der Download fehlschlägt –
// dann kann das Modell weiterhin manuell abgelegt werden (siehe README).

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "public", "models", "porcupine_params.pv");
const url =
  "https://github.com/Picovoice/porcupine/raw/master/lib/common/porcupine_params.pv";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

try {
  if (await exists(target)) {
    console.log("✓ Weckwort-Modell bereits vorhanden – überspringe Download.");
    process.exit(0);
  }
  console.log("⤓ Lade Weckwort-Modell (porcupine_params.pv) …");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("Datei verdächtig klein");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buf);
  console.log(`✓ Weckwort-Modell gespeichert (${(buf.length / 1024).toFixed(0)} KB).`);
} catch (err) {
  console.warn(
    "⚠ Weckwort-Modell konnte nicht automatisch geladen werden:",
    err?.message ?? err,
  );
  console.warn(
    "  Das ist kein Abbruchgrund. Lege porcupine_params.pv bei Bedarf manuell\n" +
      "  unter public/models/ ab (siehe README). Die App läuft auch ohne Weckwort\n" +
      "  (Kugel antippen zum Sprechen).",
  );
  process.exit(0); // Installation nicht abbrechen
}
