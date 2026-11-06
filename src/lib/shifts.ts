import { BREAK_AFTER_MIN, BREAK_MIN, SHORT_SHIFT_MIN } from "@/lib/constants";

export type OvertimeSide = "before" | "after";

/**
 * Straordinario: un blocco di durata `min` prima o dopo l'orario ordinario, oppure ("all")
 * l'intero turno considerato straordinario.
 */
export type Overtime = { side: OvertimeSide; min: number } | { side: "all" };

/**
 * Ferie/ROL: tutto il turno, oppure una fascia che coincide con l'inizio o con la fine del turno
 * (`start` e `end` in "HH:MM"). Le ore di ROL si tolgono dal giorno ma contano nei totali.
 */
export type LeaveKind = "ferie" | "rol";
/** Ferie/ROL in un giorno vuoto (senza turno): solo le ore, tra `LEAVE_STEP_MIN` e `LEAVE_MAX_MIN` minuti. */
export type Leave = { all: true; kind?: LeaveKind } | { min: number; kind: LeaveKind } | { start: string; end: string };

export const LEAVE_MAX_MIN = 12 * 60;
export const LEAVE_STEP_MIN = 30;

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
  /**
   * Ferie/ROL, se presente. Con un ROL parziale `start`/`end` e `total` descrivono la parte
   * lavorata; `leave.start`/`leave.end` la fascia di ROL e `leave.min` i minuti di ROL
   * (con "all" l'intero turno, `total` è 0h).
   */
  leave?: { side: "all" | "start" | "end"; start: string; end: string; min: number; kind: LeaveKind };
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

/**
 * Applica ferie/ROL a un turno. Il ROL deve coincidere con l'inizio o con la fine del turno
 * (se non è così, o se non c'è un turno, il turno resta com'è). Il giorno conta le ore lavorate
 * (turno meno ROL); le ore di ROL stanno in `leave.min` e vanno sommate ai totali.
 */
export function shiftWithLeave(base: DayData, leave: Leave | undefined): DayData {
  if (!leave) return base;
  if ("min" in leave) {
    // Solo ore, in un giorno senza turno: l'orario non c'è, il giorno conta 0 ore lavorate.
    if (base) return base;
    return {
      start: "",
      end: "",
      total: formatHours(0),
      endMin: null,
      shortShift: false,
      leave: { side: "all", start: "", end: "", min: leave.min, kind: leave.kind },
    };
  }
  if (!base) return base;
  const s = toMinutes(base.start);
  const e = toMinutes(base.end);
  if (s === null || e === null) return base;
  const net = netMinutes(s, e);
  const wholeShift = (kind: LeaveKind): DayData => ({
    ...base,
    total: formatHours(0),
    endMin: null,
    leave: { side: "all", start: base.start, end: base.end, min: net, kind },
  });
  if ("all" in leave) return wholeShift(leave.kind ?? "rol");
  const ls = toMinutes(leave.start);
  const le = toMinutes(leave.end);
  if (ls === null || le === null) return base;
  const span = (a: number, b: number) => (((b - a) % 1440) + 1440) % 1440;
  const gross = span(s, e);
  const min = span(ls, le);
  if (min <= 0) return base;
  if (ls === s && le === e) return wholeShift("rol");
  const worked = formatHours(Math.max(net - min, 0));
  if (ls === s && min < gross) {
    return { ...base, start: minutesToTime(le), total: worked, leave: { side: "start", start: minutesToTime(ls), end: minutesToTime(le), min, kind: "rol" } };
  }
  if (le === e && min < gross) {
    return { ...base, end: minutesToTime(ls), endMin: ls, total: worked, leave: { side: "end", start: minutesToTime(ls), end: minutesToTime(le), min, kind: "rol" } };
  }
  return base;
}

/** Primo ingresso e ultima uscita del giorno, straordinario compreso. */
export function overallTimes(d: NonNullable<DayData>): { start: string; end: string } {
  if (!d.ot || d.ot.side === "all") return { start: d.start, end: d.end };
  return d.ot.side === "before" ? { start: d.ot.start, end: d.end } : { start: d.start, end: d.ot.end };
}
