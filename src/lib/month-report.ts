import { format } from "date-fns";
import { it } from "date-fns/locale";

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
  rest: boolean;
};

export type MonthReport = {
  rows: ReportRow[];
  /** Solo i giorni con straordinario. */
  otRows: { label: string; hours: string }[];
  totalHours: string;
  otHours: string;
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

export function buildMonthReport(days: MonthRow[]): MonthReport {
  let total = 0;
  let otTotal = 0;
  const rows: ReportRow[] = [];
  const otRows: { label: string; hours: string }[] = [];
  for (const { date, data } of days) {
    const label = cap(format(date, "EEE d", { locale: it }));
    if (!data) {
      rows.push({ label, times: "—", hours: "", ot: "", isOt: false, rest: true });
      continue;
    }
    const { start, end } = overallTimes(data);
    const ot = overtimeMinutes(data);
    total += parseHours(data.total);
    otTotal += ot;
    if (ot > 0) otRows.push({ label, hours: formatHours(ot) });
    rows.push({
      label,
      times: `${start} – ${end}`,
      hours: data.total ?? "",
      ot: ot > 0 ? formatHours(ot) : "",
      isOt: ot > 0,
      rest: false,
    });
  }
  return { rows, otRows, totalHours: formatHours(total), otHours: formatHours(otTotal) };
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
  const rule = (top: number, width: number, gray: number, x1 = 40, x2 = PAGE_W - 40) => {
    ops.push(`${gray} G ${width} w ${x1} ${y(top).toFixed(2)} m ${x2} ${y(top).toFixed(2)} l S`);
  };

  const X_DAY = 46;
  const X_TIMES = 108;
  const X_HOURS = 440;
  const X_OT = PAGE_W - 46;

  text("CALENDARIO TURNI", 40, 50, 8, false, 0.4);
  text(`Orari · ${monthLabel}`, 40, 72, 19, true);
  text(person, 40, 90, 12, false, 0.27);
  textRight("In grassetto i giorni con straordinario", PAGE_W - 40, 90, 8, false, 0.4);
  rule(100, 1.5, 0);

  text("GIORNO", X_DAY, 114, 7.5, false, 0.4);
  text("ORARIO", X_TIMES, 114, 7.5, false, 0.4);
  textRight("ORE", X_HOURS, 114, 7.5, false, 0.4);
  textRight("STRAORD.", X_OT, 114, 7.5, false, 0.4);

  const ROW_H = 17;
  let top = 120;
  for (const r of report.rows) {
    if (r.isOt) ops.push(`0.94 0.94 0.95 rg 40 ${y(top + ROW_H).toFixed(2)} ${PAGE_W - 80} ${ROW_H} re f`);
    const base = top + 12;
    const gray = r.rest ? 0.6 : 0;
    text(r.label, X_DAY, base, 10, r.isOt, gray);
    text(r.times, X_TIMES, base, 10, r.isOt, gray);
    if (r.hours) textRight(r.hours, X_HOURS, base, 10, r.isOt, gray);
    if (r.ot) textRight(r.ot, X_OT, base, 10, true);
    rule(top + ROW_H, 0.5, 0.89);
    top += ROW_H;
  }

  top += 8;
  rule(top, 1.5, 0);
  text("Ore totali", X_DAY, top + 20, 11);
  textRight(report.totalHours, X_OT, top + 20, 11, true);
  text("Straordinari", X_DAY, top + 40, 14, true);
  textRight(report.otHours, X_OT, top + 40, 14, true);
  if (note) text(note, X_DAY, top + 58, 9, false, 0.4);
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
