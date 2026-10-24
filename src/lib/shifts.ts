import { BREAK_AFTER_MIN, BREAK_MIN, SHORT_SHIFT_MIN } from "@/lib/constants";

export type OvertimeSide = "before" | "after";

/**
 * Straordinario: un blocco di durata `min` prima o dopo l'orario ordinario, oppure ("all")
 * l'intero turno considerato straordinario.
 */
export type Overtime = { side: OvertimeSide; min: number } | { side: "all" };

export type DayData = {
  /** Orario ordinario. */
  start: string;
  end: string;
  total: string | null;
  /**
   * Minuti dalla mezzanotte a cui finisce davvero il turno (straordinario "dopo" compreso, senza
   * ritorno a 0 oltre la mezzanotte). Il turno è "tardo" se è >= alla chiusura del giorno (hours.ts).
   */
  endMin: number | null;
  shortShift: boolean;
  /** Orari dello straordinario, se presente. */
  ot?: { side: OvertimeSide | "all"; start: string; end: string; otTotal: string };
} | null;

export function toMinutes(value: string): number | null {
  const m = value.match(/^(\d{1,2})[:.,]?(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Minuti -> "HH:MM", il formato richiesto dai campi orario. */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Ore nette di un turno: fine prima dell'inizio = oltre la mezzanotte; oltre 8h si toglie 1h di pausa. */
export function netMinutes(startMin: number, endMin: number): number {
  let diff = endMin - startMin;
  if (diff < 0) diff += 24 * 60;
  if (diff > BREAK_AFTER_MIN) diff -= BREAK_MIN;
  return Math.max(diff, 0);
}

/** Costruisce il turno (con totale, fine in minuti e "corto") a partire da inizio e fine. */
export function shiftFromTimes(start: string, end: string): DayData {
  const s = toMinutes(start);
  const e = toMinutes(end);
  let total: string | null = null;
  let shortShift = false;
  if (s !== null && e !== null) {
    const net = netMinutes(s, e);
    shortShift = net < SHORT_SHIFT_MIN;
    total = formatHours(net);
  }
  // Orari mostrati sempre come HH:MM, qualunque formato abbia la cella del file (es. "10.00").
  const label = (raw: string, min: number | null) =>
    min === null ? raw : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  return { start: label(start, s), end: label(end, e), total, endMin: e, shortShift };
}

/**
 * Aggiunge lo straordinario a un turno: prima = finisce dove comincia l'ordinario, dopo = comincia
 * dove finisce. Il totale è ordinario netto + straordinario, senza ricalcolare la pausa.
 */
export function shiftWithOvertime(base: DayData, ot: Overtime | undefined): DayData {
  if (!base || !ot) return base;
  const s = toMinutes(base.start);
  const e = toMinutes(base.end);
  if (s === null || e === null) return base;
  if (ot.side === "all") {
    // Tutto il turno è straordinario: orari e totale restano quelli del turno.
    return { ...base, ot: { side: "all", start: base.start, end: base.end, otTotal: formatHours(netMinutes(s, e)) } };
  }
  if (ot.min <= 0) return base;
  const day = 24 * 60;
  const otStart = ot.side === "before" ? (((s - ot.min) % day) + day) % day : e;
  const otEnd = ot.side === "before" ? s : (e + ot.min) % day;
  const endMin = ot.side === "after" ? e + ot.min : base.endMin;
  return {
    ...base,
    total: formatHours(netMinutes(s, e) + ot.min),
    endMin,
    shortShift: false,
    ot: {
      side: ot.side,
      start: minutesToTime(otStart),
      end: minutesToTime(otEnd),
      otTotal: formatHours(ot.min),
    },
  };
}

/** Primo ingresso e ultima uscita del giorno, straordinario compreso. */
export function overallTimes(d: NonNullable<DayData>): { start: string; end: string } {
  if (!d.ot || d.ot.side === "all") return { start: d.start, end: d.end };
  return d.ot.side === "before" ? { start: d.ot.start, end: d.end } : { start: d.start, end: d.ot.end };
}
