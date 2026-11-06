import { format } from "date-fns";
import { it } from "date-fns/locale";

import { weekdayIndex } from "@/lib/hours";
import { formatHours, netMinutes, overallTimes, toMinutes, type DayData } from "@/lib/shifts";

/** Un giorno del mese con il suo turno (straordinario compreso), o null se a riposo. */
export type MonthRow = { date: Date; data: DayData };

export type ReportRow = {
  /** Es. "Mer 14". */
  label: string;
  times: string;
  hours: string;
  /** Ore di straordinario del giorno, vuoto se non ce ne sono. */
  ot: string;
  isOt: boolean;
  /** Ore di ferie/ROL del giorno, vuoto se non ce ne sono. */
  perm: string;
  /** Lettera davanti alle ore di ferie/ROL: F = ferie, R = ROL. */
  permKind: string;
  rest: boolean;
  /** Chiusura: il turno finisce all'orario di chiusura del giorno (Orari di esercizio) o più tardi. */
  closing: boolean;
  /** Turno lungo: 8 ore o più. */
  long: boolean;
  /** Ultimo giorno della settimana (domenica): sotto la riga di separazione è più scura. */
  weekEnd: boolean;
};

export type MonthReport = {
  rows: ReportRow[];
  /** Solo i giorni con straordinario. */
  otRows: { label: string; hours: string }[];
  /** Ore totali del mese: lavorate più ferie/ROL. */
  totalHours: string;
  otHours: string;
  /** Ore di ferie/ROL del mese. */
  permHours: string;
};

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/** "8h30" -> 510. */
function parseHours(total: string | null): number {
  const m = total?.match(/^(\d+)h(?:(\d{2}))?$/);
  return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : 0;
}

/** Minuti di straordinario di un giorno: il blocco aggiunto, oppure tutto il turno. */
function overtimeMinutes(data: DayData): number {
  if (!data?.ot) return 0;
  const s = toMinutes(data.ot.start);
  const e = toMinutes(data.ot.end);
  if (s === null || e === null) return 0;
  if (data.ot.side === "all") return netMinutes(s, e);
  return (((e - s) % 1440) + 1440) % 1440;
}

/** `closeMinutes`: orario di chiusura per giorno della settimana (stesso indice di weekdayIndex), dagli Orari di esercizio. */
export function buildMonthReport(days: MonthRow[], closeMinutes: number[] = []): MonthReport {
  let total = 0;
  let otTotal = 0;
  let permTotal = 0;
  const rows: ReportRow[] = [];
  const otRows: { label: string; hours: string }[] = [];
  for (const { date, data } of days) {
    const label = cap(format(date, "EEE d", { locale: it }));
    if (!data) {
      rows.push({ label, times: "—", hours: "", ot: "", isOt: false, perm: "", permKind: "", rest: true, closing: false, long: false, weekEnd: date.getDay() === 0 });
      continue;
    }
    const { start, end } = overallTimes(data);
    const ot = overtimeMinutes(data);
    const perm = data.leave?.min ?? 0;
    // Le ore di ROL contano nel totale come se fossero lavorate; il giorno mostra solo le ore lavorate.
    total += parseHours(data.total) + perm;
    otTotal += ot;
    permTotal += perm;
    if (ot > 0) otRows.push({ label, hours: formatHours(ot) });
    rows.push({
      label,
      // Ferie/ROL in un giorno vuoto: nessun orario né ore lavorate
      times: start ? `${start} – ${end}` : "—",
      hours: start ? (data.total ?? "") : "",
      ot: ot > 0 ? formatHours(ot) : "",
      isOt: ot > 0,
      perm: perm > 0 ? formatHours(perm) : "",
      permKind: perm > 0 ? (data.leave?.kind === "ferie" ? "F" : "R") : "",
      rest: false,
      // Chi è in ferie tutto il giorno non chiude; con un ROL a fine turno conta l'ultima uscita lavorata.
      closing: data.leave?.side !== "all" && toMinutes(end) !== null && closeMinutes[weekdayIndex(date)] !== undefined && toMinutes(end)! >= closeMinutes[weekdayIndex(date)]!,
      // Conta solo le ore lavorate: un turno da 8 ore con 2 di ROL diventa corto
      long: parseHours(data.total ?? null) >= 8 * 60,
      weekEnd: date.getDay() === 0,
    });
  }
  return { rows, otRows, totalHours: formatHours(total), otHours: formatHours(otTotal), permHours: formatHours(permTotal) };
}

/* ------------------------------------------------------------------ */
/* PDF minimale (una pagina A4, Helvetica), generato nel browser.       */
/* ------------------------------------------------------------------ */

const PAGE_W = 595;
const PAGE_H = 842;

/** Testo -> byte WinAnsi (Latin-1 più trattini lunghi); il resto diventa "?". */
function winAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (ch === "–") out += "\x96";
    else if (ch === "—") out += "\x97";
    else if (c < 256) out += ch;
    else out += "?";
  }
  return out.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Larghezza approssimata del testo in Helvetica: basta per allineare a destra cifre e "h". */
function textWidth(text: string, size: number, bold: boolean): number {
  let w = 0;
  for (const ch of text) {
    if (ch === " ") w += 278;
    else if (ch === "h") w += bold ? 611 : 556;
    else w += 556;
  }
  return (w / 1000) * size;
}

export function buildMonthPdf(args: {
  monthLabel: string;
  person: string;
  report: MonthReport;
  generatedOn: string;
  /** Avviso se il totale è parziale (mancano giorni). */
  note?: string;
}): Uint8Array {
  const { monthLabel, person, report, generatedOn, note } = args;
  const ops: string[] = [];
  const y = (top: number) => PAGE_H - top;
  const text = (s: string, x: number, top: number, size: number, bold = false, gray = 0) => {
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${gray} g ${x.toFixed(2)} ${y(top).toFixed(2)} Td (${winAnsi(s)}) Tj ET`);
  };
  const textRight = (s: string, xRight: number, top: number, size: number, bold = false, gray = 0) =>
    text(s, xRight - textWidth(s, size, bold), top, size, bold, gray);
  const textCenter = (s: string, xMid: number, top: number, size: number, bold = false, gray = 0) =>
    text(s, xMid - textWidth(s, size, bold) / 2, top, size, bold, gray);
  /** Lucchetto chiuso (disegnato: corpo pieno e archetto), centrato in (xMid, riga a distanza `mid` dall'alto). */
  const lock = (xMid: number, mid: number) => {
    const cy = y(mid);
    const f = (n: number) => n.toFixed(2);
    ops.push(
      `0.15 g 0.15 G 1 w ${f(xMid - 3.5)} ${f(cy - 4.2)} 7 5 re f ` +
        `${f(xMid - 2.2)} ${f(cy + 0.8)} m ${f(xMid - 2.2)} ${f(cy + 2.4)} l ` +
        `${f(xMid - 2.2)} ${f(cy + 5.2)} ${f(xMid + 2.2)} ${f(cy + 5.2)} ${f(xMid + 2.2)} ${f(cy + 2.4)} c ` +
        `${f(xMid + 2.2)} ${f(cy + 0.8)} l S`,
    );
  };
  const rule = (top: number, width: number, gray: number, x1 = 40, x2 = PAGE_W - 40) => {
    ops.push(`${gray} G ${width} w ${x1} ${y(top).toFixed(2)} m ${x2} ${y(top).toFixed(2)} l S`);
  };

  const X_DAY = 46;
  const X_TIMES = 108;
  const X_HOURS = 276;
  const X_OT = PAGE_W - 46;
  const X_CLOSE = 306;
  const X_LONG = 336;
  const X_PERM = 492;

  text("CALENDARIO TURNI", 40, 50, 8, false, 0.4);
  text(`Orari · ${monthLabel}`, 40, 72, 19, true);
  text(person, 40, 90, 12, false, 0.27);
  textRight("In grassetto i giorni con straordinario", PAGE_W - 40, 90, 8, false, 0.4);
  rule(100, 1.5, 0);

  text("GIORNO", X_DAY, 114, 7.5, false, 0.4);
  text("ORARIO", X_TIMES, 114, 7.5, false, 0.4);
  textRight("ORE", X_HOURS, 114, 7.5, false, 0.4);
  textCenter("CHIUSURA", X_CLOSE, 114, 7.5, false, 0.4);
  text("TURNO CORTO/LUNGO", X_LONG, 114, 7.5, false, 0.4);
  textRight("FERIE/ROL", X_PERM, 114, 7.5, false, 0.4);
  textRight("STRAORD.", X_OT, 114, 7.5, false, 0.4);

  const ROW_H = 17;
  let top = 120;
  for (const r of report.rows) {
    if (r.isOt) ops.push(`0.94 0.94 0.95 rg 40 ${y(top + ROW_H).toFixed(2)} ${PAGE_W - 80} ${ROW_H} re f`);
    const base = top + 12;
    const noTimes = r.times === "—";
    const gray = noTimes ? 0.6 : 0;
    text(r.label, X_DAY, base, 10, r.isOt, gray);
    text(r.times, X_TIMES, base, 10, r.isOt, gray);
    if (r.hours) textRight(r.hours, X_HOURS, base, 10, r.isOt, gray);
    // Segno pieno al centro della colonna (• in WinAnsi)
    if (r.closing) lock(X_CLOSE, top + ROW_H / 2);
    // Barra di durata, sempre allineata a sinistra: turno breve 15x8 grigio medio, turno lungo 30x8 grigio scuro
    if (!noTimes) {
      ops.push(`${r.long ? 0.3 : 0.65} g ${X_LONG} ${y(top + ROW_H / 2 + 4).toFixed(2)} ${r.long ? 30 : 15} 8 re f`);
    }
    if (r.perm) textRight(`${r.permKind} ${r.perm}`, X_PERM, base, 10, true);
    if (r.ot) textRight(r.ot, X_OT, base, 10, true);
    // Dopo la domenica la riga è più scura e più spessa: separa le settimane (non dopo l'ultimo giorno del mese)
    if (r.weekEnd && r !== report.rows[report.rows.length - 1]) rule(top + ROW_H, 1, 0.45);
    else rule(top + ROW_H, 0.5, 0.89);
    top += ROW_H;
  }

  top += 8;
  rule(top, 1.5, 0);
  text("Ore totali", X_DAY, top + 20, 14, true);
  textRight(report.totalHours, X_OT, top + 20, 14, true);
  text("Straordinari", X_DAY, top + 40, 11);
  textRight(report.otHours, X_OT, top + 40, 11, true);
  text("Ferie/ROL", X_DAY, top + 58, 11);
  textRight(report.permHours, X_OT, top + 58, 11, true);
  text("F = ferie · R = ROL", X_DAY + 62, top + 58, 8, false, 0.5);
  if (note) text(note, X_DAY, top + 76, 9, false, 0.4);
  text(`Generato il ${generatedOn}`, 40, PAGE_H - 28, 8, false, 0.5);

  const content = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  // Ogni carattere è un byte (tutto < 256).
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

/** Scarica il PDF; sui telefoni apre prima il foglio di condivisione ("Salva su File"), se c'è. */
export async function savePdf(bytes: Uint8Array, filename: string): Promise<void> {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const file = new File([blob], filename, { type: "application/pdf" });
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
