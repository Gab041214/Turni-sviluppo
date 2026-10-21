/**
 * Orari di esercizio: apertura e chiusura per ogni giorno della settimana (lunedì = 0 … domenica = 6).
 * Decidono chi compare in "Apertura" e in "Chiusura" nel pop-up del giorno. L'apertura parte da
 * è dedotta dai file (ingresso più frequente tra i turni della mattina di quel giorno della settimana),
 * la chiusura pure (ultima uscita giornaliera più frequente). Le correzioni dell'utente si ricordano su questo dispositivo.
 */

export type DayHours = { open: number; close: number };
/** Solo i valori corretti a mano: indice del giorno (0-6) -> campi cambiati. */
export type HoursOverrides = Record<string, Partial<DayHours>>;

export const DEFAULT_OPEN = 10 * 60;
export const DEFAULT_CLOSE = 20 * 60;
export const HOURS_STEP = 30;
export const OPEN_RANGE: [number, number] = [6 * 60, 14 * 60];
export const CLOSE_RANGE: [number, number] = [16 * 60, 24 * 60];

/** Per dedurre l'apertura contano solo i turni che cominciano la mattina (prima di quest'ora). */
const OPEN_INFER_LIMIT = 12 * 60;

const HOURS_KEY = "orari.hours";

export function loadHoursOverrides(): HoursOverrides {
  try {
    const raw = localStorage.getItem(HOURS_KEY);
    if (!raw) return {};
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: HoursOverrides = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (!/^[0-6]$/.test(k) || !v || typeof v !== "object") continue;
      const { open, close } = v as Partial<DayHours>;
      const entry: Partial<DayHours> = {};
      if (typeof open === "number") entry.open = open;
      if (typeof close === "number") entry.close = close;
      if (entry.open !== undefined || entry.close !== undefined) out[k] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveHoursOverrides(value: HoursOverrides): void {
  try {
    if (Object.keys(value).length === 0) localStorage.removeItem(HOURS_KEY);
    else localStorage.setItem(HOURS_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Indice del giorno della settimana con lunedì = 0 (da Date.getDay(), domenica = 0). */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Valore più frequente; a parità vince il più tardo. */
function mostCommon(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  for (const [v, c] of counts) {
    if (best === null || c > counts.get(best)! || (c === counts.get(best) && v > best)) best = v;
  }
  return best;
}

/** Apertura e chiusura dedotte per giorno della settimana: ingressi di tutti i turni e ultima uscita di ogni giorno (null = nessun dato). */
export function inferHours(
  startsByWeekday: number[][],
  lastEndsByWeekday: number[][],
): { open: number | null; close: number | null }[] {
  return Array.from({ length: 7 }, (_, i) => ({
    open: mostCommon((startsByWeekday[i] ?? []).filter((m) => m >= OPEN_RANGE[0] && m < OPEN_INFER_LIMIT)),
    close: mostCommon((lastEndsByWeekday[i] ?? []).filter((m) => m >= CLOSE_RANGE[0])),
  }));
}

/** Orari effettivi: correzioni dell'utente, altrimenti valori dedotti, altrimenti i valori base. */
export function effectiveHours(overrides: HoursOverrides, inferred: { open: number | null; close: number | null }[]): DayHours[] {
  return Array.from({ length: 7 }, (_, i) => ({
    open: overrides[String(i)]?.open ?? inferred[i]?.open ?? DEFAULT_OPEN,
    close: overrides[String(i)]?.close ?? inferred[i]?.close ?? DEFAULT_CLOSE,
  }));
}
