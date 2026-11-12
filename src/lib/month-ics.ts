import { autoBreakMin, formatHours, grossMinutes, overallTimes, toMinutes, type DayData } from "@/lib/shifts";

/**
 * Esportazione del mese nel calendario del telefono: genera un file .ics (iCalendar) con un evento per
 * ogni giorno di turno, ferie o ROL. Gli orari sono "flottanti" (senza fuso): l'evento resta alle stesse
 * ore indicate dal turno ovunque ci si trovi. Ogni evento ha un codice fisso (giorno + nominativo),
 * così riesportando dopo una modifica il calendario aggiorna gli eventi invece di duplicarli.
 */

export type IcsDay = { date: Date; data: DayData };

const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const dateTimeStr = (d: Date, min: number) => {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min);
  return `${dateStr(day)}T${pad(day.getHours())}${pad(day.getMinutes())}00`;
};
const stampStr = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** Testo per iCalendar: virgole, punti e virgola, barre e a capo vanno protetti. */
const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Le righe del file non devono superare i 75 byte: le più lunghe si spezzano e continuano con uno spazio. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) {
      parts.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // lo spazio iniziale delle righe di continuazione conta
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "turni";

/** Durata per le note: sotto l'ora "30 min", altrimenti nel formato dell'app ("2h", "2h30"). */
const durLabel = (m: number) => (m < 60 ? `${m} min` : formatHours(m));

function overtimeNote(d: NonNullable<DayData>): string | null {
  if (!d.ot) return null;
  if (d.ot.side === "all") return "Straordinario: intero turno";
  const s = toMinutes(d.ot.start);
  const e = toMinutes(d.ot.end);
  if (s === null || e === null) return null;
  const min = (((e - s) % 1440) + 1440) % 1440;
  return `Straordinario: ${durLabel(min)} ${d.ot.side === "before" ? "prima del turno" : "dopo il turno"}`;
}

/** Evento di un giorno, come righe iCalendar; array vuoto se non c'è nulla da segnare. */
function dayEvent(person: string, { date, data }: IcsDay, stamp: string): string[] {
  if (!data) return [];
  const lines = ["BEGIN:VEVENT", `UID:turni-${dateStr(date)}-${slug(person)}@calendario-turni`, `DTSTAMP:${stamp}`];
  const notes: string[] = [];
  const leave = data.leave;
  if (leave?.side === "all") {
    // Ferie o ROL sull'intero turno, o ore sole in un giorno vuoto: evento a giornata intera
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${dateStr(date)}`, `DTEND;VALUE=DATE:${dateStr(next)}`);
    lines.push(`SUMMARY:${leave.kind === "ferie" ? "Ferie" : "ROL"}`);
    notes.push(`Ore: ${durLabel(leave.min)}`);
  } else {
    let start: string;
    let end: string;
    if (leave) {
      // ROL a inizio o fine turno: l'evento dura quanto il turno intero
      start = leave.side === "start" ? leave.start : data.start;
      end = leave.side === "start" ? data.end : leave.end;
    } else {
      ({ start, end } = overallTimes(data));
    }
    const s = toMinutes(start);
    const e = toMinutes(end);
    if (s === null || e === null) return [];
    lines.push(`DTSTART:${dateTimeStr(date, s)}`, `DTEND:${dateTimeStr(date, e <= s ? e + 1440 : e)}`);
    lines.push("SUMMARY:Turno");
    notes.push(`Ore lavorate: ${data.total ?? "0h"}`);
    if (leave) notes.push(`ROL ${durLabel(leave.min)} ${leave.side === "start" ? "a inizio" : "a fine"} turno`);
    const ot = overtimeNote(data);
    if (ot) notes.push(ot);
    // Pausa: quella scelta a mano o la regola automatica (con un ROL a metà non è ricostruibile dagli orari)
    if (!leave) {
      const os = toMinutes(data.start);
      const oe = toMinutes(data.end);
      if (os !== null && oe !== null) {
        const brk = data.brk ?? autoBreakMin(grossMinutes(os, oe));
        if (brk > 0) notes.push(`Pausa ${durLabel(brk)}`);
      }
    }
  }
  lines.push(`DESCRIPTION:${escapeText(notes.join("\n"))}`, "END:VEVENT");
  return lines;
}

/** Numero di eventi che il file conterrà. */
export function countIcsEvents(days: IcsDay[]): number {
  return days.filter((d) => d.data && (d.data.leave?.side === "all" || toMinutes(overallTimes(d.data).start) !== null)).length;
}

/** Contenuto del file .ics per i giorni dati (di solito un mese). */
export function buildMonthIcs(person: string, days: IcsDay[], now: Date = new Date()): string {
  const stamp = stampStr(now);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Calendario Turni//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Turni"];
  for (const day of days) lines.push(...dayEvent(person, day, stamp));
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Salva il file: sui telefoni apre il foglio di condivisione (con "Calendario" tra le scelte), altrimenti lo scarica. */
export async function saveIcs(text: string, filename: string): Promise<void> {
  const blob = new Blob([text], { type: "text/calendar" });
  const file = new File([blob], filename, { type: "text/calendar" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      // Solo il file: con `title` o `text` iOS salva anche un secondo file di testo.
      await nav.share({ files: [file] });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
