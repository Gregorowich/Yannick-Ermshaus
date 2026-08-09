// Wetter über Open-Meteo – kostenlos und ohne API-Schlüssel.
// Liefert strukturierte Wetterdaten (für die Anzeige) und einen deutschen
// Begrüßungstext (für die Sprachausgabe).

export type Weather = {
  tempC: number;
  feelsC: number;
  humidity: number;
  windKmh: number;
  description: string;
  code: number;
  maxC: number;
  minC: number;
  sunrise: string; // "HH:MM"
  sunset: string; // "HH:MM"
};

// WMO-Wettercodes -> deutsche Beschreibung
const CODE_TEXT: Record<number, string> = {
  0: "klarer Himmel",
  1: "überwiegend klar",
  2: "teils bewölkt",
  3: "bedeckt",
  45: "neblig",
  48: "Nebel mit Reif",
  51: "leichter Nieselregen",
  53: "Nieselregen",
  55: "dichter Nieselregen",
  56: "gefrierender Nieselregen",
  57: "dichter gefrierender Nieselregen",
  61: "leichter Regen",
  63: "Regen",
  65: "starker Regen",
  66: "gefrierender Regen",
  67: "starker gefrierender Regen",
  71: "leichter Schneefall",
  73: "Schneefall",
  75: "starker Schneefall",
  77: "Schneegriesel",
  80: "leichte Regenschauer",
  81: "Regenschauer",
  82: "heftige Regenschauer",
  85: "Schneeschauer",
  86: "starke Schneeschauer",
  95: "Gewitter",
  96: "Gewitter mit Hagel",
  99: "schweres Gewitter mit Hagel",
};

function hhmm(iso: string): string {
  // Open-Meteo liefert lokale Zeit als "2026-06-25T20:15"
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "";
}

export async function getWeather(lat: number, lon: number): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&timezone=auto&forecast_days=1`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Wetterdienst HTTP " + res.status);
  const d: any = await res.json();

  const code = Math.round(d.current.weather_code);
  return {
    tempC: Math.round(d.current.temperature_2m),
    feelsC: Math.round(d.current.apparent_temperature),
    humidity: Math.round(d.current.relative_humidity_2m),
    windKmh: Math.round(d.current.wind_speed_10m),
    code,
    description: CODE_TEXT[code] ?? "wechselhaft",
    maxC: Math.round(d.daily.temperature_2m_max[0]),
    minC: Math.round(d.daily.temperature_2m_min[0]),
    sunrise: hhmm(d.daily.sunrise[0]),
    sunset: hhmm(d.daily.sunset[0]),
  };
}

// Tageszeit-abhängige Anrede.
function greetingWord(hour: number): string {
  if (hour >= 5 && hour < 11) return "Guten Morgen";
  if (hour >= 11 && hour < 17) return "Guten Tag";
  if (hour >= 17 && hour < 22) return "Guten Abend";
  return "Schönen späten Abend";
}

// Baut den gesprochenen Begrüßungstext im Jarvis-Ton.
export function buildGreeting(hour: number, weather: Weather | null): string {
  const hello = greetingWord(Number.isFinite(hour) ? hour : 12);
  if (!weather) {
    return `${hello}. J.A.R.V.I.S. ist einsatzbereit. Wie kann ich behilflich sein?`;
  }
  return (
    `${hello}. Schön, Sie zu sehen. ` +
    `Es sind aktuell ${weather.tempC} Grad bei ${weather.description}, ` +
    `gefühlt ${weather.feelsC} Grad. ` +
    `Im Tagesverlauf werden bis zu ${weather.maxC} Grad erreicht, ` +
    `der Sonnenuntergang ist um ${weather.sunset} Uhr. ` +
    `Womit darf ich beginnen?`
  );
}
