import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Trash2, Users, Keyboard, Plus, ChevronDown, ChevronLeft, ChevronRight, Check, Sun, Moon, Monitor, Settings, FileText, ArrowRight, ArrowLeftRight, X } from "lucide-react";
import { format, addDays, isToday, startOfMonth, endOfMonth, isSameMonth, startOfWeek, getDay, differenceInCalendarWeeks, differenceInCalendarDays, getDaysInMonth, subMonths } from "date-fns";
import { it } from "date-fns/locale";

import { aliasLookup, loadAliases, saveAliases, similarNames, withAlias, type Alias } from "@/lib/aliases";
import {
  CLOSE_RANGE,
  HOURS_STEP,
  OPEN_RANGE,
  effectiveHours,
  inferHours,
  loadHoursOverrides,
  saveHoursOverrides,
  weekdayIndex,
  type HoursOverrides,
} from "@/lib/hours";
import { Button } from "@/components/ui/button";


import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useThemePref, type ThemePref } from "@/lib/theme";
import { DayEditPanels } from "@/components/shift-editor";
import { buildBackup, countOverrides, mergeOverrides, parseBackup, saveJson } from "@/lib/backup";
import { buildMonthPdf, buildMonthReport, savePdf, type MonthRow } from "@/lib/month-report";
import { fileAnchor, loadFiles, saveFiles, trimFiles, type FileStore } from "@/lib/files";
import {
  dayKey,
  getOverride,
  hasShiftOverride,
  loadOverrides,
  monthKey,
  saveOverrides,
  renameOverrides,
  updateOverride,
  type DayOverride,
  type OverrideStore,
} from "@/lib/overrides";
import { formatHours, minutesToTime, overallTimes, shiftFromTimes, shiftWithOvertime, toMinutes, type DayData, type Overtime } from "@/lib/shifts";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Calendario Turni — Orari e ore lavorate da Excel" },
      {
        name: "description",
        content:
          "Carica il file Excel dei turni, scegli la domenica di riferimento e consulta orari e ore lavorate in un calendario in stile iOS, anche offline.",
      },
      { property: "og:title", content: "Calendario Turni — Orari e ore lavorate da Excel" },
      {
        property: "og:description",
        content:
          "Carica il file Excel dei turni, scegli la domenica di riferimento e consulta orari e ore lavorate in un calendario in stile iOS, anche offline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

/** Quadrato aperto in alto con freccia: in su = esporta (come la condivisione di iOS), in giù = porta dentro. */
function BoxArrowIcon({ direction, className, size = 16, strokeWidth = 1.8 }: { direction: "up" | "down"; className?: string; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 9H6.5A2.5 2.5 0 0 0 4 11.5V18.5A2.5 2.5 0 0 0 6.5 21H17.5A2.5 2.5 0 0 0 20 18.5V11.5A2.5 2.5 0 0 0 17.5 9H16" />
      <path d={direction === "up" ? "M12 15V3M8 7L12 3L16 7" : "M12 3V15M8 11L12 15L16 11"} />
    </svg>
  );
}

const STORAGE_KEY = "turni.voci";
// Sessione persistente: nominativo scelto, ripristinato alla riapertura (i file stanno in "orari.files")
const SELECTED_KEY = "turni.selected";
// Indice della coppia di colori scelta (vedi ACCENT_PAIRS); vale per entrambi i temi.
const ACCENT_KEY = "turni.accentIndex";

const THEME_OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "Auto", Icon: Monitor },
  { value: "light", label: "Chiaro", Icon: Sun },
  { value: "dark", label: "Scuro", Icon: Moon },
];

/**
 * Colori d'accento per badge ore e barre del popup: cinque coppie "agganciate" al tema.
 * Si salva solo quale coppia è scelta; il colore mostrato dipende dal tema attivo
 * (light = tema chiaro, dark = tema scuro).
 */
const ACCENT_PAIRS: { light: string; dark: string }[] = [
  { light: "#00701F", dark: "#6CBD00" },
  { light: "#007499", dark: "#52B3AD" },
  { light: "#0055B6", dark: "#4496FF" },
  { light: "#900006", dark: "#EF3C2C" },
  { light: "#FEC200", dark: "#F6DC7D" },
];

const DAY_LABELS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
// 1-based CSV column numbers per day (Mon..Sun)
const DAY_BLOCKS: number[][] = [
  [8, 9, 10, 11],
  [13, 14, 15, 16],
  [18, 19, 20, 21],
  [23, 24, 25, 26],
  [28, 29, 30, 31],
  [33, 34, 35, 36],
  [3, 4, 5, 6],
];

const TARGET_TABLE = "inserimento orari";

const MONTH_NAMES = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

/** Estrae mese e anno di riferimento dal nome del file (es. "Turni Ottobre 2026.xlsx"). */
function monthYearFromFileName(name: string | null): Date | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  const monthIdx = MONTH_NAMES.findIndex((m) => lower.includes(m));
  if (monthIdx === -1) return undefined;

  const yearMatch = lower.match(/(19|20)\d{2}/) ?? lower.match(/\b\d{2}\b/);
  let year = new Date().getFullYear();
  if (yearMatch) {
    const raw = yearMatch[0];
    year = raw.length === 2 ? 2000 + Number(raw) : Number(raw);
  }
  return new Date(year, monthIdx, 1);
}

function norm(v: string): string {
  return v.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Estrae la data esatta dalla cella E7 del foglio "SETUP": è la domenica della prima settimana. */
function setupSunday(XLSX: typeof import("xlsx"), wb: import("xlsx").WorkBook): Date | undefined {
  const name = wb.SheetNames.find((n) => norm(n) === "setup");
  if (!name) return undefined;
  const cell = wb.Sheets[name]?.["E7"];
  if (!cell) return undefined;
  if (cell.v instanceof Date) return cell.v;
  if (typeof cell.v === "number") {
    const p = XLSX.SSF.parse_date_code(cell.v);
    if (p) return new Date(p.y, p.m - 1, p.d);
  }
  const s = String(cell.w ?? cell.v ?? "").trim();
  const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const year = Number(m[3]!.length === 2 ? `20${m[3]}` : m[3]);
    return new Date(year, Number(m[2]) - 1, Number(m[1]));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Legge la sola tabella "Inserimento Orari" dal file Excel. */
async function parseExcel(
  file: File,
): Promise<{ rows: string[][]; month: Date | undefined; fileSunday: Date | undefined }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  // Domenica esatta della prima settimana, letta da SETUP!E7 (es. 30/08 per un file di settembre).
  const fileSunday = setupSunday(XLSX, wb);
  // Priorità al mese/anno nel nome del file; altrimenti il mese in cui cade la metà del file (domenica + 14 giorni).
  const month = monthYearFromFileName(file.name) ?? (fileSunday ? startOfMonth(addDays(fileSunday, 14)) : undefined);

  const toRows = (name: string): string[][] =>
    (
      XLSX.utils.sheet_to_json(wb.Sheets[name]!, {
        header: 1,
        raw: false,
        defval: "",
        blankrows: false,
      }) as unknown[][]
    ).map((r) => {
      const cells = r.map((c) => String(c ?? "").trim());
      // Le celle vuote in coda non servono: si tolgono per occupare meno spazio.
      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      return cells;
    });

  // 1) foglio chiamato "Inserimento Orari"
  const sheetName = wb.SheetNames.find((n) => norm(n) === TARGET_TABLE);
  if (sheetName) return { rows: toRows(sheetName).filter((r) => r.some((c) => c !== "")), month, fileSunday };

  // 2) tabella identificata da una cella "Inserimento Orari": prendi le righe sotto
  for (const name of wb.SheetNames) {
    const rows = toRows(name);
    const idx = rows.findIndex((r) => r.some((c) => norm(c) === TARGET_TABLE));
    if (idx !== -1) {
      return { rows: rows.slice(idx + 1).filter((r) => r.some((c) => c !== "")), month, fileSunday };
    }
  }

  return { rows: [], month, fileSunday };
}


/** Restituisce nero o bianco per il massimo contrasto rispetto al colore esadecimale dato. */
type ShiftEntry = { name: string; startLabel: string; endLabel: string; startMin: number; endMin: number; modified: boolean };

/**
 * Calcola posizione e larghezza (in %) del tratto colorato di un turno, sul range
 * [rangeStart, rangeEnd] passato da chi chiama: l'apertura e la chiusura del giorno della settimana
 * (Orari di esercizio), con la fine estesa se quel giorno c'è un turno che finisce dopo.
 */
function barMetrics(
  startMin: number,
  endMin: number,
  rangeStart: number,
  rangeEnd: number,
): { left: number; width: number } {
  const span = rangeEnd - rangeStart;
  const clamp = (v: number) => Math.min(Math.max(v, rangeStart), rangeEnd);
  const left = ((clamp(startMin) - rangeStart) / span) * 100;
  const right = ((clamp(endMin) - rangeStart) / span) * 100;
  return { left, width: Math.max(right - left, 3) };
}

function contrastTextColor(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

/** Totale settimanale (da domenica a sabato, come nel file Excel). `missing` = primo giorno non coperto da alcun file. */
type WeekTotal = { sunday: Date; saturday: Date; missing: Date | null; total: number; ordinary: number; overtime: number };
type WeekData = { monday: Date | undefined; days: DayData[]; mods: boolean[]; files: DayData[]; tot: WeekTotal | null };

/** "7h30" / "6h" -> minuti (formato prodotto da formatHours). */
function labelToMinutes(label: string | null | undefined): number {
  const m = (label ?? "").match(/^(\d+)h(\d{2})?$/);
  return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : 0;
}

/** Minuti ordinari e di straordinario di un giorno; il totale del turno comprende già lo straordinario. */
function dayMinutes(d: DayData): { ordinary: number; overtime: number } {
  if (!d) return { ordinary: 0, overtime: 0 };
  const total = labelToMinutes(d.total);
  const overtime = d.ot ? Math.min(labelToMinutes(d.ot.otTotal), total) : 0;
  return { ordinary: total - overtime, overtime };
}

/**
 * Confronta il nominativo del calendario con il valore della cella Excel: stessa scrittura
 * (senza distinguere maiuscole e spazi multipli) oppure grafia associata dall'utente a quel nome
 * ("Rosi" -> "Rossi"). Niente corrispondenze parziali: "Rossi" e "Rossi M." sono due persone.
 */
function nameMatches(cellValue: string, selected: string, aliases?: Map<string, string>): boolean {
  const cell = norm(cellValue);
  const sel = norm(selected);
  if (!sel || !cell) return false;
  return cell === sel || aliases?.get(cell) === sel;
}

/**
 * Distingue un nominativo vero da tutto il resto che compare nella colonna B
 * (intestazioni, etichette "Settimana N", testo del template, celle vuote/numeriche):
 * i nomi veri sono scritti "Nome Proprio" (iniziale maiuscola, resto minuscolo),
 * mentre le etichette da scartare sono o tutte in MAIUSCOLO o senza lettere.
 */
function looksLikeRealName(raw: string): boolean {
  const v = raw.trim();
  if (!v) return false;
  if (!/[a-zà-ÿ]/i.test(v)) return false; // nessuna lettera (es. "0")
  if (/^settimana(\s*\d+)?$/i.test(v)) return false; // "Settimana", "Settimana 1", "Settimana 2"...
  if (v === v.toUpperCase()) return false; // tutto maiuscolo = intestazione/ruolo, non un nome
  return true;
}

/** Riga di intestazione di una settimana ("Settimana 1", ... anche senza numero). */
function isWeekHeader(row: string[]): boolean {
  return norm(row[1] ?? "").startsWith("settimana");
}

/** Numero di settimane (blocchi) di un file: quante intestazioni "Settimana" contiene. */
function weeksInFile(rows: string[][]): number {
  const n = rows.filter(isWeekHeader).length;
  return n > 0 ? n : 5;
}

/**
 * Ricostruisce la mappa offset -> turno (Sunday=0, Mon..Sat=1..6, poi +7 per ogni settimana) per un nominativo.
 * La settimana di una riga è quella dell'intestazione "Settimana" che la precede: così un collega che
 * compare solo in alcune settimane (o entra a metà mese) resta sui giorni giusti. Se il file non ha
 * intestazioni si contano le righe in cui compare il nome.
 */
function offsetMapForName(rows: string[][], name: string, aliases?: Map<string, string>): Map<number, DayData> {
  const byOffset = new Map<number, DayData>();
  const put = (row: string[], base: number) => {
    byOffset.set(base, blockData(row, DAY_BLOCKS[6]!));
    for (let d = 0; d < 6; d++) {
      byOffset.set(base + 1 + d, blockData(row, DAY_BLOCKS[d]!));
    }
  };

  if (!rows.some(isWeekHeader)) {
    rows.filter((r) => nameMatches(r[1] ?? "", name, aliases)).forEach((row, i) => put(row, i * 7));
    return byOffset;
  }

  // Per ogni settimana si tiene una sola riga: preferita quella con il nome identico.
  const best = new Map<number, { row: string[]; exact: boolean }>();
  let week = -1;
  for (const r of rows) {
    if (isWeekHeader(r)) {
      week++;
      continue;
    }
    if (week < 0 || !nameMatches(r[1] ?? "", name, aliases)) continue;
    const exact = norm(r[1] ?? "") === norm(name);
    const cur = best.get(week);
    if (!cur || (exact && !cur.exact)) best.set(week, { row: r, exact });
  }
  for (const [w, { row }] of best) put(row, w * 7);
  return byOffset;
}

/**
 * Applica le modifiche manuali al turno del file: prima l'orario ordinario inserito a mano
 * (nessun turno se "a riposo"), poi l'eventuale straordinario agganciato all'ordinario.
 * Con `withOvertime = false` restituisce solo l'ordinario.
 */
function applyOverride(base: DayData, ov: DayOverride | undefined, withOvertime = true): DayData {
  if (!ov) return base;
  let data = base;
  if (hasShiftOverride(ov)) data = ov.rest ? null : shiftFromTimes(ov.start ?? "", ov.end ?? "");
  return withOvertime ? shiftWithOvertime(data, ov.ot) : data;
}

function blockData(row: string[], cols: number[]): DayData {
  const values: string[] = [];
  for (const c of cols) {
    const v = (row[c - 1] ?? "").trim();
    if (v !== "") values.push(v);
  }
  if (values.length === 0) return null;
  return shiftFromTimes(values[0] ?? "", values[values.length - 1] ?? "");
}

const SWIPE_PILL = 80; // larghezza della pillola con l'icona
const SWIPE_REST = 100; // posizione di riposo: 10px + pillola + 10px. A sinistra "modifica", a destra "elimina"
const SWIPE_RUBBER = 24; // corsa elastica oltre il punto di riposo
const SWIPE_OPEN_FROM_CLOSED = SWIPE_REST * 0.4; // da chiusa: basta poco per aprire
const SWIPE_CLOSE_FROM_OPEN = SWIPE_REST * 0.75; // da aperta: va riportata quasi al bordo per richiudere
const SWIPE_EASE = "cubic-bezier(.2,1.1,.3,1)";

/** Riga voce con swipe stile Mail: verso destra compare "modifica" (blu), verso sinistra "elimina" (rosso). Tocco semplice = seleziona. */
function EntryRow({
  name,
  selected,
  onSelect,
  onDelete,
  onRename,
  tag,
  deleteLabel,
}: {
  name: string;
  selected?: boolean;
  onSelect?: () => void;
  /** Se manca, lo swipe verso sinistra non fa comparire "elimina". */
  onDelete?: () => void;
  /** Se manca, lo swipe verso destra non fa comparire "modifica". */
  onRename?: (newName: string) => void;
  /** Etichetta a destra del nome (usata dall'elenco dei mesi). */
  tag?: string;
  deleteLabel?: string;
}) {
  const [reveal, setReveal] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const startX = useRef(0);
  const startReveal = useRef(0);
  const moved = useRef(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (editing) return;
    setDragging(true);
    moved.current = false;
    startX.current = e.clientX;
    startReveal.current = reveal;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const delta = startX.current - e.clientX;
    if (Math.abs(delta) > 4) moved.current = true;
    // Se la riga parte aperta da un lato, si ferma sul bordo originale: l'altro pulsante non compare per sbaglio.
    const start = startReveal.current;
    const lo = start > 0 || !onRename ? 0 : -SWIPE_REST * 2;
    const hi = start < 0 || !onDelete ? 0 : SWIPE_REST * 2;
    let v = Math.min(hi, Math.max(lo, start + delta));
    if (Math.abs(v) > SWIPE_REST) {
      v = Math.sign(v) * (SWIPE_REST + Math.min(SWIPE_RUBBER, (Math.abs(v) - SWIPE_REST) * 0.25));
    }
    setReveal(v);
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (!moved.current) {
      // Tocco semplice (nessun trascinamento reale): se era chiusa, seleziona; se era aperta, richiudi.
      if (reveal === 0) onSelect?.();
      else setReveal(0);
      return;
    }
    const threshold = startReveal.current === 0 ? SWIPE_OPEN_FROM_CLOSED : SWIPE_CLOSE_FROM_OPEN;
    setReveal((current) => (Math.abs(current) < threshold ? 0 : Math.sign(current) * SWIPE_REST));
  };

  // Pillola che si allarga man mano che la riga scorre e si ferma a SWIPE_PILL quando è esposta del tutto.
  const pillStyle = (amount: number, side: "left" | "right"): CSSProperties => {
    const p = Math.min(1, amount / SWIPE_REST);
    return {
      [side]: 10,
      width: amount > 0 ? Math.min(SWIPE_PILL, Math.max(40, amount - 20)) : 40,
      opacity: Math.min(1, p * 1.4),
      transform: `scale(${0.4 + 0.6 * p})`,
      pointerEvents: p >= 1 ? "auto" : "none",
      transition: dragging
        ? "none"
        : `width .42s ${SWIPE_EASE}, opacity .3s, transform .42s ${SWIPE_EASE}`,
    };
  };
  const editAmount = reveal < 0 ? -reveal : 0;
  const deleteAmount = reveal > 0 ? reveal : 0;

  const confirmRename = () => {
    const v = draft.trim();
    if (v && v !== name) onRename?.(v);
    setEditing(false);
  };

  return (
    <li className="relative h-11 shrink-0 overflow-hidden rounded-[14px]">
      {/* Scorrendo la riga verso destra compare "modifica" a sinistra; verso sinistra "elimina" a destra.
          Le righe sono trasparenti: le pillole si mostrano solo quando la riga è scorsa. */}
      {onRename && (
      <button
        type="button"
        aria-label={`Modifica ${name}`}
        aria-hidden={editAmount === 0}
        tabIndex={editAmount === 0 ? -1 : 0}
        className="absolute top-1/2 -mt-5 flex h-10 items-center justify-center rounded-full bg-[#0A84FF] text-white"
        style={pillStyle(editAmount, "left")}
        onClick={() => {
          setDraft(name);
          setEditing(true);
          setReveal(0);
        }}
      >
        <Keyboard className="size-5" />
      </button>
      )}
      {onDelete && (
      <button
        type="button"
        aria-label={deleteLabel ?? `Elimina ${name}`}
        aria-hidden={deleteAmount === 0}
        tabIndex={deleteAmount === 0 ? -1 : 0}
        className="absolute top-1/2 -mt-5 flex h-10 items-center justify-center rounded-full bg-[#FF3B30] text-white"
        style={pillStyle(deleteAmount, "right")}
        onClick={onDelete}
      >
        <Trash2 className="size-5" />
      </button>
      )}
      <div
        className={cn(
          "relative flex h-11 w-full touch-pan-y cursor-pointer items-center overflow-hidden rounded-[14px] px-3",
          (selected || dragging || reveal !== 0) && "bg-[var(--glass-chip)]",
        )}
        style={{
          transform: `translateX(${-reveal}px)`,
          transition: dragging ? "none" : `transform .42s ${SWIPE_EASE}, background-color .25s`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmRename();
              else if (e.key === "Escape") setEditing(false);
            }}
            onBlur={confirmRename}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-[16px] text-foreground outline-none"
          />
        ) : (
          <>
            <span
              className={cn(
                "flex-1 truncate text-foreground",
                tag === undefined ? "text-base" : cn("text-[15px]", selected ? "font-semibold" : "font-medium"),
              )}
            >
              {name}
            </span>
            {tag && <span className="mr-2 shrink-0 text-xs font-normal text-muted-foreground">{tag}</span>}
            {selected && <Check className="size-4 shrink-0 text-foreground" />}
          </>
        )}
      </div>
    </li>
  );
}

/** Riga del popup: nominativo, orari e barra; con il pallino se il turno è stato modificato a mano. */
function ShiftRow({
  entry,
  range,
  accent,
}: {
  entry: ShiftEntry;
  range: { start: number; end: number };
  accent: string;
}) {
  const { left, width } = barMetrics(entry.startMin, entry.endMin, range.start, range.end);
  return (
    <li
      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-foreground"
      style={{ backgroundColor: "var(--app-chip)" }}
    >
      <span className="flex-1 truncate">{entry.name}</span>
      {entry.modified && (
        <span
          role="img"
          aria-label="Turno modificato"
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
      )}
      <span className="text-[10px] text-muted-foreground">{entry.startLabel}</span>
      <div className="relative h-1.5 w-14 shrink-0 overflow-hidden rounded-full" style={{ backgroundColor: "var(--app-track)" }}>
        <div
          className="absolute inset-y-0 rounded-full"
          style={{ left: `${left}%`, width: `${width}%`, backgroundColor: accent }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">{entry.endLabel}</span>
    </li>
  );
}

function Index() {
  // File dei turni ricordati (uno per mese, al massimo 12) e mese mostrato (all'apertura: quello di oggi).
  const [files, setFiles] = useState<FileStore>({});
  const [month, setMonth] = useState<Date | undefined>(undefined);
  // Esito dell'ultimo caricamento (file non riconosciuti).
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" })),
    [options],
  );
  const [namesOpen, setNamesOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overtimeOpen, setOvertimeOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // "Gestione nomi" (nomi associati): contratta a ogni apertura del menu.
  const [moreOpen, setMoreOpen] = useState(false);
  // "Orari di esercizio": correzioni dell'utente (il resto è dedotto dai file) e sezione aperta/chiusa.
  const [hoursOverrides, setHoursOverrides] = useState<HoursOverrides>({});
  const [hoursOpen, setHoursOpen] = useState(false);
  // Una sola sezione aperta alla volta: Report e backup, Orari di esercizio e Gestione nomi sono alla pari,
  // aprirne una chiude le altre ("Straordinari" è dentro Report e backup).
  const toggleOvertime = () => setOvertimeOpen((o) => !o);
  const toggleAdvanced = () => {
    setAdvancedOpen((o) => !o);
    setOvertimeOpen(false);
    setMoreOpen(false);
    setHoursOpen(false);
  };
  const toggleHours = () => {
    setHoursOpen((o) => !o);
    setAdvancedOpen(false);
    setOvertimeOpen(false);
    setMoreOpen(false);
  };
  const toggleMore = () => {
    setMoreOpen((o) => !o);
    setAdvancedOpen(false);
    setOvertimeOpen(false);
    setHoursOpen(false);
  };
  // Nomi collegati (grafia nel file -> nome in elenco) e relativi pannelli.
  const [aliases, setAliases] = useState<Alias[]>([]);
  const aliasMap = useMemo(() => aliasLookup(aliases), [aliases]);
  const commitAliases = (next: Alias[]) => {
    setAliases(next);
    saveAliases(next);
  };
  // Nome nuovo per cui si sta chiedendo "è lo stesso di…?", e nome scelto.
  const [linking, setLinking] = useState<string | null>(null);
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  // Modulo "Associa due nomi" nelle opzioni avanzate.
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [linkFrom, setLinkFrom] = useState("");
  const [linkTo, setLinkTo] = useState("");
  const clearLinkForm = () => {
    setLinkFrom("");
    setLinkTo("");
    setLinkFormOpen(false);
  };
  // Il modulo si svuota anche quando "Gestione nomi" si chiude (o si chiude il menu Impostazioni).
  useEffect(() => {
    if (!moreOpen) clearLinkForm();
  }, [moreOpen]);
  // Esito dell'ultima esportazione/importazione delle modifiche, mostrato sotto i pulsanti.
  const [backupNote, setBackupNote] = useState<{ title: string; body: string } | null>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const [popupDate, setPopupDate] = useState<Date | null>(null);
  // Tessera di cui è aperto il riquadro "Turno originale" (toccando il pallino): "settimana-giorno".
  const [peekKey, setPeekKey] = useState<string | null>(null);
  // Turni modificati a mano (per mese del file, giorno e nominativo); restano solo su questo dispositivo.
  const [overrides, setOverrides] = useState<OverrideStore>({});
  const [newOption, setNewOption] = useState("");
  // Nominativi suggeriti dall'ultimo file caricato ma non ancora in elenco; "Ignora" li nasconde
  // finché non si carica un nuovo file (vedi reset in handleFile).
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [accentIdx, setAccentIdx] = useState(0);
  const setAccentIndex = (i: number) => {
    setAccentIdx(i);
    try {
      localStorage.setItem(ACCENT_KEY, String(i));
    } catch {
      /* ignore */
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const [themePref, setThemePref, isDark] = useThemePref();
  // Colore d'accento effettivo: la coppia scelta, nella variante del tema attivo.
  const accentPair = ACCENT_PAIRS[accentIdx] ?? ACCENT_PAIRS[0]!;
  const accent = isDark ? accentPair.dark : accentPair.light;

  // Blocca lo scroll della pagina sottostante mentre il menu nomi è aperto: il Popover, a
  // differenza del Dialog, non lo fa in automatico, quindi senza questo il gesto di scorrimento
  // sulla lista "sfugge" e scorre tutta la schermata invece della sola lista interna.
  useEffect(() => {
    if (!namesOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [namesOpen]);

  // Il riquadro "Turno originale" si chiude toccando fuori dal pallino e dal riquadro stesso.
  useEffect(() => {
    if (!peekKey) return;
    const onDown = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-peek]")) setPeekKey(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [peekKey]);

  // Finestre aperte sopra il calendario (menu mese, nomi, impostazioni, riquadri dei pallini): il tocco che
  // le chiude non deve arrivare anche alla tessera sotto. Prima del tocco si memorizza se ce n'era una
  // aperta; il clic sulla tessera, se sì, viene ignorato. Dal tocco dopo le tessere rispondono di nuovo.
  const overlayOpenRef = useRef(false);
  const ignoreTileClickRef = useRef(false);
  overlayOpenRef.current = monthMenuOpen || namesOpen || settingsOpen || peekKey !== null;
  useEffect(() => {
    const onDown = () => {
      ignoreTileClickRef.current = overlayOpenRef.current;
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // Pop-up del giorno: con "Modifica" o "Straordinario" aperto la scheda Apertura/Chiusura si riduce alla sola
  // data, così tutto sta nello schermo senza scorrimento (un contenitore scorrevole con vetro sfocato fa
  // comparire su Safari un rettangolo grigio attorno al pop-up).
  const [panelOpen, setPanelOpen] = useState(false);

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setOptions(JSON.parse(raw));
      const acc = Number(localStorage.getItem(ACCENT_KEY));
      if (Number.isInteger(acc) && acc >= 0 && acc < ACCENT_PAIRS.length) setAccentIdx(acc);
      setOverrides(loadOverrides());
      setAliases(loadAliases());
      setHoursOverrides(loadHoursOverrides());
      setFiles(loadFiles());
      const sel = localStorage.getItem(SELECTED_KEY);
      if (sel) setSelected(sel);
    } catch {
      /* ignore */
    }
    setMonth(startOfMonth(new Date()));
    setHydrated(true);
  }, []);

  // Salva stato per la prossima apertura della PWA
  useEffect(() => {
    if (!hydrated) return;
    saveFiles(files);
  }, [hydrated, files]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (selected) localStorage.setItem(SELECTED_KEY, selected);
      else localStorage.removeItem(SELECTED_KEY);
    } catch {
      /* ignore */
    }
  }, [hydrated, selected]);

  const persist = (next: string[]) => {
    setOptions(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  // Carica uno o più file: ognuno va al suo mese (quello nel nome del file) e sostituisce l'eventuale file dello stesso mese.
  const handleFiles = async (list: File[]) => {
    setDismissedSuggestions(new Set());
    setUploadNote(null);
    const unknown: string[] = [];
    let next: FileStore = { ...files };
    let lastMonth: Date | undefined;
    for (const file of list) {
      try {
        const parsed = await parseExcel(file);
        if (!parsed.month || parsed.rows.length === 0) {
          unknown.push(file.name);
          continue;
        }
        next[monthKey(parsed.month)] = {
          name: file.name,
          month: parsed.month.toISOString(),
          sunday: parsed.fileSunday?.toISOString(),
          rows: parsed.rows,
        };
        if (!lastMonth || parsed.month > lastMonth) lastMonth = parsed.month;
      } catch {
        unknown.push(file.name);
      }
    }
    next = trimFiles(next);
    setFiles(next);
    if (lastMonth) setMonth(startOfMonth(lastMonth));
    if (unknown.length > 0) {
      setUploadNote(`Non riesco a capire il mese di: ${unknown.join(", ")}. Controlla che nel nome ci sia il mese e l'anno.`);
    }
  };

  const monthK = month ? monthKey(month) : null;
  const hasFiles = Object.keys(files).length > 0;
  // File del mese mostrato (o, se manca, l'ultimo caricato): da qui vengono nominativi suggeriti e nome del file.
  const currentFile = useMemo(() => {
    if (monthK && files[monthK]) return files[monthK];
    const keys = Object.keys(files).sort();
    return keys.length > 0 ? files[keys[keys.length - 1]!] : undefined;
  }, [files, monthK]);
  const rows = useMemo(() => currentFile?.rows ?? [], [currentFile]);

  // Nomi da mostrare nel menu: quelli in elenco che compaiono nel file del mese mostrato (anche senza
  // turni), più quello selezionato. Senza file si vede l'elenco completo.
  const menuOptions = useMemo(() => {
    if (!currentFile) return sortedOptions;
    return sortedOptions.filter(
      (o) =>
        o === selected ||
        currentFile.rows.some((r) => looksLikeRealName(r[1] ?? "") && nameMatches(r[1] ?? "", o, aliasMap)),
    );
  }, [currentFile, sortedOptions, selected, aliasMap]);

  // File ordinati con la loro domenica di partenza.
  const fileList = useMemo(
    () =>
      Object.entries(files).map(([key, f]) => ({ key, rows: f.rows, anchor: fileAnchor(f), weeks: weeksInFile(f.rows) })),
    [files],
  );
  // Per ogni file e nominativo: giorno (offset dalla domenica di partenza) -> turno.
  const mapsByFile = useMemo(() => {
    const names = selected && !options.includes(selected) ? [...options, selected] : options;
    const all = new Map<string, Map<string, Map<number, DayData>>>();
    for (const f of fileList) {
      const perName = new Map<string, Map<number, DayData>>();
      for (const name of names) perName.set(name, offsetMapForName(f.rows, name, aliasMap));
      all.set(f.key, perName);
    }
    return all;
  }, [fileList, options, selected, aliasMap]);

  // Turno di un nominativo in una data, preso dal file giusto: prima quello del mese della data, poi gli altri.
  const resolveDay = useMemo(
    () =>
      (name: string, date: Date): { data: DayData; fileKey: string } | null => {
        const dk = monthKey(date);
        let best: { data: DayData; fileKey: string; rank: number; anchor: number } | null = null;
        for (const f of fileList) {
          const map = mapsByFile.get(f.key)?.get(name);
          const off = differenceInCalendarDays(date, f.anchor);
          if (!map || !map.has(off)) continue;
          const rank = f.key === dk ? 1 : 0;
          const anchor = f.anchor.getTime();
          if (!best || rank > best.rank || (rank === best.rank && anchor > best.anchor)) {
            best = { data: map.get(off) ?? null, fileKey: f.key, rank, anchor };
          }
        }
        return best ? { data: best.data, fileKey: best.fileKey } : null;
      },
    [fileList, mapsByFile],
  );

  // Modifiche manuali: stanno sotto il mese del file da cui viene il giorno; se non ci sono lì si cerca negli altri.
  const overrideFor = useMemo(
    () => (date: Date, name: string): DayOverride | undefined => {
      const day = dayKey(date);
      const own = resolveDay(name, date)?.fileKey ?? monthKey(date);
      const found = getOverride(overrides, own, day, name);
      if (found) return found;
      for (const k of Object.keys(overrides)) {
        const other = getOverride(overrides, k, day, name);
        if (other) return other;
      }
      return undefined;
    },
    [overrides, resolveDay],
  );

  // Calendario del mese mostrato: settimane da lunedì a domenica, giorno per giorno dal file giusto.
  const gridStart = useMemo(
    () => (month ? startOfWeek(startOfMonth(month), { weekStartsOn: 1 }) : undefined),
    [month],
  );
  const weeks: WeekData[] = useMemo(() => {
    if (!selected || !month || !gridStart || fileList.length === 0) return [];
    const weekCount = differenceInCalendarWeeks(endOfMonth(month), gridStart, { weekStartsOn: 1 }) + 1;
    return Array.from({ length: weekCount }, (_, w) => {
      const monday = addDays(gridStart, w * 7);
      const mods: boolean[] = [];
      const fileShifts: DayData[] = [];
      const days = Array.from({ length: 7 }, (_, i) => {
        const date = addDays(monday, i);
        const fromFile = resolveDay(selected, date)?.data ?? null;
        const ov = overrideFor(date, selected);
        // Il pallino sulla tessera segnala solo il turno ordinario modificato a mano: lo
        // straordinario si riconosce già dai quattro orari.
        mods.push(hasShiftOverride(ov));
        fileShifts.push(fromFile);
        return applyOverride(fromFile, ov);
      });
      // Totale da domenica a sabato: la domenica che lo apre sta nella riga sopra (o nel mese prima).
      const covered = (d: Date) =>
        fileList.some((f) => {
          const off = differenceInCalendarDays(d, f.anchor);
          return off >= 0 && off < f.weeks * 7;
        });
      const sunday = addDays(monday, -1);
      const span = [sunday, ...days.slice(0, 6).map((_, i) => addDays(monday, i))];
      const missingDays = span.filter((d) => !covered(d));
      let tot: WeekTotal | null = null;
      if (missingDays.length < span.length) {
        const sundayData = applyOverride(resolveDay(selected, sunday)?.data ?? null, overrideFor(sunday, selected));
        let ordinary = 0;
        let overtime = 0;
        for (const d of [sundayData, ...days.slice(0, 6)]) {
          const m = dayMinutes(d);
          ordinary += m.ordinary;
          overtime += m.overtime;
        }
        tot = { sunday, saturday: addDays(monday, 5), missing: missingDays[0] ?? null, total: ordinary + overtime, ordinary, overtime };
      }
      return { monday, days, mods, files: fileShifts, tot };
    });
  }, [selected, month, gridStart, fileList, resolveDay, overrideFor]);

  // Mesi selezionabili dal titolo: quelli con un file in memoria più il mese di oggi, dal più recente.
  const monthChoices = useMemo(() => {
    const today = startOfMonth(new Date());
    const keys = new Set([...Object.keys(files), monthKey(today)]);
    return [...keys]
      .sort()
      .reverse()
      .map((key) => {
        const [y, m] = key.split("-").map(Number);
        const date = new Date(y!, m! - 1, 1);
        const isToday = key === monthKey(today);
        const hasFile = !!files[key];
        return {
          key,
          date,
          label: format(date, "MMMM yyyy", { locale: it }).replace(/^./, (c) => c.toUpperCase()),
          tag: [isToday ? "oggi" : null, hasFile ? "file" : "senza file"].filter(Boolean).join(" · "),
        };
      });
  }, [files]);

  // Avvisi sui file mancanti: manca il file del mese, oppure ci sono i giorni iniziali non coperti da nessun file.
  const notice = useMemo(() => {
    if (!month || !monthK || !selected || !hasFiles) return null;
    const monthName = format(month, "MMMM", { locale: it });
    if (!files[monthK]) {
      return {
        text: `Manca il file di ${monthName}. Carica il file per vedere tutti i turni del mese.`,
        partial: `Totale parziale: manca il file di ${monthName}.`,
      };
    }
    // Giorni iniziali del mese non coperti da nessun file (indipendentemente dal nominativo).
    let missing = 0;
    const days = getDaysInMonth(month);
    for (let d = 1; d <= days; d++) {
      const date = new Date(month.getFullYear(), month.getMonth(), d);
      if (fileList.some((f) => {
        const off = differenceInCalendarDays(date, f.anchor);
        return off >= 0 && off < f.weeks * 7;
      })) break;
      missing++;
    }
    if (missing === 0 || missing === days) return null;
    const prev = format(subMonths(month, 1), "MMMM", { locale: it });
    const range = missing === 1 ? "il giorno 1" : `i giorni 1–${missing}`;
    return {
      text: `Mancano ${range} ${monthName}: ${missing === 1 ? "è" : "sono"} nel file di ${prev}.`,
      partial: `Totale parziale: mancano ${range}.`,
    };
  }, [month, monthK, selected, hasFiles, files, fileList]);

  // Nominativi trovati nella colonna B del file ma non ancora presenti nell'elenco voci
  // (né coperti, anche parzialmente, da uno già presente) e non ignorati dall'utente.
  const suggestedNames = useMemo(() => {
    if (rows.length === 0) return [];
    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const r of rows) {
      const raw = (r[1] ?? "").trim();
      if (!looksLikeRealName(raw)) continue;
      const key = norm(raw);
      if (seen.has(key) || dismissedSuggestions.has(key)) continue;
      seen.add(key);
      candidates.push(raw);
    }
    return candidates.filter((name) => !options.some((o) => nameMatches(name, o, aliasMap)));
  }, [rows, options, dismissedSuggestions, aliasMap]);

  // Nome nuovo di cui si chiede se è lo stesso di uno in elenco (sparisce se non è più proposto).
  const linkingName = linking && suggestedNames.includes(linking) ? linking : null;
  const similarOptions = useMemo(
    () => (linkingName ? similarNames(linkingName, options).slice(0, 8) : []),
    [linkingName, options],
  );
  const openLink = (name: string) => {
    // La domanda compare solo se in elenco c'è un nome simile; altrimenti il nome si aggiunge subito.
    const best = similarNames(name, options)[0];
    if (!best) {
      persist([...options, name]);
      return;
    }
    setLinking(name);
    setLinkTarget(best);
  };
  // Nomi scritti nei file che non sono in elenco né già collegati: suggerimenti per "Associa due nomi".
  const fileNameChoices = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of fileList) {
      for (const r of f.rows) {
        const raw = (r[1] ?? "").trim();
        const key = norm(raw);
        if (!looksLikeRealName(raw) || seen.has(key)) continue;
        seen.add(key);
        if (aliasMap.has(key)) continue;
        out.push(raw);
      }
    }
    return out.sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
  }, [fileList, options, aliasMap]);
  const linkFromKey = norm(linkFrom);
  const linkFormError = !linkFromKey
    ? null
    : linkTo && norm(linkTo) === linkFromKey
      ? "Scegli due nomi diversi."
      : null;
  const canLink = !!linkFromKey && !!linkTo && !linkFormError;

  // Il nome in elenco `name` passa a `to`: le sue modifiche manuali lo seguono e, se serve, anche la selezione.
  const moveOverrides = (name: string, to: string) => {
    const next = renameOverrides(overrides, name, to);
    setOverrides(next);
    saveOverrides(next);
    if (selected === name) setSelected(to);
  };
  // Collega la grafia `from` al nome `to`; se `from` era già stato aggiunto in elenco ne esce.
  const linkNames = (from: string, to: string) => {
    commitAliases(withAlias(aliases, from, to));
    const added = options.find((o) => norm(o) === norm(from));
    if (added) {
      persist(options.filter((o) => o !== added));
      moveOverrides(added, to);
    }
  };
  // Scambia il collegamento: il nome giusto diventa la grafia (prima sbagliata) e viceversa.
  const swapAlias = (a: Alias) => {
    const oldName = options.find((o) => norm(o) === norm(a.to)) ?? a.to;
    const rest = aliases
      .filter((x) => x.from !== a.from)
      .map((x) => (norm(x.to) === norm(a.to) ? { ...x, to: a.from } : x));
    commitAliases(withAlias(rest, a.to, a.from));
    const newInList = options.find((o) => norm(o) === norm(a.from));
    persist(
      newInList
        ? options.filter((o) => o !== oldName)
        : options.some((o) => o === oldName)
          ? options.map((o) => (o === oldName ? a.from : o))
          : [...options, a.from],
    );
    moveOverrides(oldName, newInList ?? a.from);
  };


  const openDayPopup = (date: Date | undefined) => {
    if (!date || !hasFiles) return;
    setPopupDate(date);
  };

  // Apertura e chiusura dedotte dai file: per ogni giorno dei file il primo ingresso e l'ultima uscita, raccolti per giorno della settimana.
  const inferredHours = useMemo(() => {
    const lastEnd = new Map<string, { weekday: number; starts: number[]; end: number }>();
    for (const f of fileList) {
      const perName = mapsByFile.get(f.key);
      if (!perName) continue;
      for (let off = 0; off < f.weeks * 7; off++) {
        let end = 0;
        const dayStarts: number[] = [];
        for (const map of perName.values()) {
          const data = map.get(off);
          if (!data) continue;
          const t = overallTimes(data);
          const s = toMinutes(t.start);
          const e = toMinutes(t.end);
          if (s !== null) dayStarts.push(s);
          if (e !== null && e > end) end = e;
        }
        if (end === 0 || dayStarts.length === 0) continue;
        const date = addDays(f.anchor, off);
        lastEnd.set(dayKey(date), { weekday: weekdayIndex(date), starts: dayStarts, end });
      }
    }
    const starts: number[][] = Array.from({ length: 7 }, () => []);
    const ends: number[][] = Array.from({ length: 7 }, () => []);
    for (const { weekday, starts: dayStarts, end } of lastEnd.values()) {
      starts[weekday].push(...dayStarts);
      ends[weekday].push(end);
    }
    return inferHours(starts, ends);
  }, [fileList, mapsByFile]);
  const hours = useMemo(() => effectiveHours(hoursOverrides, inferredHours), [hoursOverrides, inferredHours]);
  // Attivo solo se qualche orario è diverso da quello dedotto dai file.
  const hoursModified = useMemo(() => {
    const base = effectiveHours({}, inferredHours);
    return hours.some((h, i) => h.open !== base[i].open || h.close !== base[i].close);
  }, [hours, inferredHours]);
  const changeHours = (day: number, field: "open" | "close", delta: number) => {
    const [lo, hi] = field === "open" ? OPEN_RANGE : CLOSE_RANGE;
    const value = Math.min(hi, Math.max(lo, hours[day][field] + delta));
    const next = { ...hoursOverrides, [String(day)]: { ...hoursOverrides[String(day)], [field]: value } };
    setHoursOverrides(next);
    saveHoursOverrides(next);
  };
  const resetHours = () => {
    setHoursOverrides({});
    saveHoursOverrides({});
  };

  // Elenchi "Apertura"/"Chiusura" del giorno aperto, ricalcolati anche quando cambia una modifica manuale.
  const dayPopup = useMemo(() => {
    if (!popupDate) return null;
    const dayEntries: ShiftEntry[] = [];
    for (const name of options) {
      const ov = overrideFor(popupDate, name);
      const data = applyOverride(resolveDay(name, popupDate)?.data ?? null, ov);
      if (!data) continue;
      // Con lo straordinario contano il primo ingresso e l'ultima uscita del giorno.
      const { start, end } = overallTimes(data);
      const s = toMinutes(start);
      const e = toMinutes(end);
      if (s === null || e === null) continue;
      dayEntries.push({ name, startLabel: start, endLabel: end, startMin: s, endMin: e, modified: !!ov });
    }

    // Apertura e chiusura del giorno della settimana (Orari di esercizio): in "Apertura" chi comincia
    // entro l'orario di apertura, in "Chiusura" chi finisce all'orario di chiusura o più tardi.
    const { open, close } = hours[weekdayIndex(popupDate)];
    const apre = dayEntries.filter((entry) => entry.startMin <= open);
    const maxEnd = dayEntries.reduce((max, entry) => Math.max(max, entry.endMin), 0);
    const chiude = dayEntries.filter((entry) => entry.endMin >= close);

    // Range della barra: parte dall'apertura del giorno (un turno che comincia prima resta comunque
    // segnalato in lista, ma sulla barra parte dal bordo sinistro) e finisce alla chiusura, o più tardi
    // se quel giorno c'è un turno che finisce dopo.
    const barRange = { start: open, end: Math.max(close, maxEnd) };
    return { date: popupDate, apre, chiude, barRange };
  }, [popupDate, options, resolveDay, overrideFor, hours]);

  // Turno del nominativo selezionato come scritto nel file, per il giorno aperto.
  const selectedFileShift: DayData = useMemo(() => {
    if (!popupDate || !selected) return null;
    return resolveDay(selected, popupDate)?.data ?? null;
  }, [popupDate, selected, resolveDay]);

  // Le modifiche si salvano sotto il mese del file da cui viene il giorno, e si tolgono dagli altri mesi.
  const changeOverride = (change: (current: DayOverride) => DayOverride) => {
    if (!popupDate || !selected) return;
    const day = dayKey(popupDate);
    const current = overrideFor(popupDate, selected) ?? {};
    const key = resolveDay(selected, popupDate)?.fileKey ?? monthKey(popupDate);
    let next = overrides;
    for (const k of Object.keys(next)) {
      if (getOverride(next, k, day, selected)) next = updateOverride(next, k, day, selected, () => ({}));
    }
    next = updateOverride(next, key, day, selected, () => change({ ...current }));
    setOverrides(next);
    saveOverrides(next);
  };

  const canEditShift = hasFiles && !!selected;

  // Tutti i giorni del mese mostrato, con il turno finale (modifiche e straordinari compresi).
  const monthReport = useMemo(() => {
    const days: MonthRow[] = [];
    if (month && selected) {
      const count = getDaysInMonth(month);
      for (let d = 1; d <= count; d++) {
        const date = new Date(month.getFullYear(), month.getMonth(), d);
        days.push({ date, data: applyOverride(resolveDay(selected, date)?.data ?? null, overrideFor(date, selected)) });
      }
    }
    return buildMonthReport(days);
  }, [month, selected, resolveDay, overrideFor]);
  // Se mancano dei giorni il totale è parziale.
  const partialNote = notice?.partial ?? null;
  const monthLabel = month ? format(month, "MMMM yyyy", { locale: it }).replace(/^./, (c) => c.toUpperCase()) : "";
  const hasMonth = !!month && !!selected && hasFiles;
  const generatePdf = () => {
    if (!hasMonth) return;
    setSettingsOpen(false);
    setOvertimeOpen(false);
    const bytes = buildMonthPdf({
      monthLabel,
      person: selected,
      report: monthReport,
      generatedOn: format(new Date(), "dd/MM/yyyy"),
      note: partialNote ?? undefined,
    });
    const safeName = selected.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "turni";
    void savePdf(bytes, `Turni-${safeName}-${format(month!, "yyyy-MM")}.pdf`);
  };
  // Esporta le modifiche di tutti i mesi in un file; sui telefoni si apre la condivisione.
  const exportBackup = () => {
    const n = countOverrides(overrides);
    if (n === 0) {
      setBackupNote({ title: "Nessuna modifica da esportare", body: "Non hai ancora modificato nessun turno." });
      return;
    }
    const filename = `orari-modifiche-${format(new Date(), "yyyy-MM-dd")}.json`;
    void saveJson(buildBackup(overrides), filename);
    setBackupNote({
      title: "Modifiche esportate",
      body: `${n} ${n === 1 ? "modifica" : "modifiche"} in "${filename}". Salvalo in File o mandalo all'altro dispositivo.`,
    });
  };
  // Importa un file esportato e lo unisce alle modifiche presenti: sullo stesso giorno e nominativo vince il file.
  const importBackup = async (file: File) => {
    let incoming: ReturnType<typeof parseBackup> = null;
    try {
      incoming = parseBackup(await file.text());
    } catch {
      incoming = null;
    }
    if (!incoming) {
      setBackupNote({
        title: "File non valido",
        body: "Questo file non contiene modifiche di Orari. Scegli un file \"orari-modifiche-….json\" esportato dall'app.",
      });
      return;
    }
    if (countOverrides(incoming) === 0) {
      setBackupNote({ title: "Nessuna modifica da importare", body: "Il file è valido ma è vuoto." });
      return;
    }
    const { store, added, replaced, unchanged } = mergeOverrides(overrides, incoming);
    setOverrides(store);
    saveOverrides(store);
    const total = added + replaced;
    const parts = [
      added > 0 ? `${added} ${added === 1 ? "nuova" : "nuove"}` : null,
      replaced > 0 ? `${replaced} ${replaced === 1 ? "sostituita" : "sostituite"}` : null,
      unchanged > 0 ? `${unchanged} già ${unchanged === 1 ? "presente" : "presenti"}` : null,
    ].filter(Boolean);
    setBackupNote({
      title: total > 0 ? `Importate ${total} ${total === 1 ? "modifica" : "modifiche"}` : "Nessuna novità",
      body: `${parts.join(", ")}. Le altre modifiche già presenti sono rimaste.`.replace(/^./, (c) => c.toUpperCase()),
    });
  };
  const dateCapitalized = (d: Date, pattern: string) =>
    format(d, pattern, { locale: it }).replace(/^./, (c) => c.toUpperCase());

  return (
    <main className="min-h-screen pb-16" style={{ backgroundColor: "var(--app-bg)" }}>
      <div className="mx-auto max-w-6xl px-4 pt-6">
        {/* Titolo + toolbar + giorno in testata (sticky, tutto opaco) */}
        <section className="sticky top-0 z-20" style={{ backgroundColor: "var(--app-bg)" }}>
          <header className="mb-4">
            {month ? (
              <Popover open={monthMenuOpen} onOpenChange={setMonthMenuOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Scegli il mese"
                    className="inline-flex items-center gap-2 rounded-md text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <h1 className="text-3xl font-bold tracking-tight">
                      {format(month, "MMMM yyyy", { locale: it }).replace(/^./, (c) => c.toUpperCase())}
                    </h1>
                    <ChevronDown
                      className={cn("size-6 shrink-0 transition-transform duration-200", monthMenuOpen && "rotate-180")}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[300px] p-2.5">
                  <ul className="space-y-1">
                    {monthChoices.map((m) => (
                      <EntryRow
                        key={`${m.key}-${files[m.key] ? "file" : "vuoto"}`}
                        name={m.label}
                        tag={m.tag}
                        selected={m.key === monthK}
                        onSelect={() => {
                          setMonth(m.date);
                          setMonthMenuOpen(false);
                          setPeekKey(null);
                        }}
                        deleteLabel={`Elimina il file di ${m.label}`}
                        onDelete={
                          files[m.key]
                            ? () =>
                                setFiles((prev) => {
                                  const next = { ...prev };
                                  delete next[m.key];
                                  return next;
                                })
                            : undefined
                        }
                      />
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            ) : (
              <h1 className="text-3xl font-bold tracking-tight text-foreground">Calendario Turni</h1>
            )}
          </header>

          <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  if (list.length > 0) void handleFiles(list);
                  e.target.value = "";
                }}
              />
                <Popover
                  open={namesOpen}
                  onOpenChange={(o) => {
                    setNamesOpen(o);
                    if (!o) {
                      setAdding(false);
                      setNewOption("");
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-9 w-full min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-card px-2 text-[19px]"
                      aria-label="Filtra per voce"
                    >
                      <Users className="size-[26px] shrink-0 text-muted-foreground" />
                      <span className={cn("flex-1 truncate text-left", !selected && "text-muted-foreground")}>
                        {selected || "Nome"}
                      </span>
                      <ChevronDown className="size-[22px] shrink-0 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 p-3.5">
                    {/* Riga fissa: pulsante "+" e casella di inserimento (Opzione A: non scorre con la lista) */}
                    <div className="mb-2 flex shrink-0 items-center gap-2">
                      {adding ? (
                        <input
                          autoFocus
                          value={newOption}
                          onChange={(e) => setNewOption(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const v = newOption.trim();
                              if (v && !options.includes(v)) {
                                persist([...options, v]);
                                setSelected(v);
                              }
                              setNewOption("");
                            } else if (e.key === "Escape") {
                              setAdding(false);
                              setNewOption("");
                            }
                          }}
                          placeholder="Nuovo nome"
                          className="h-9 flex-1 rounded-xl border border-border bg-card px-3 text-[16px] text-foreground outline-none"
                        />
                      ) : (
                        <span className="flex-1 truncate text-sm text-muted-foreground">Aggiungi nome</span>
                      )}
                      <button
                        type="button"
                        aria-label="Aggiungi nome"
                        onClick={() => setAdding((a) => !a)}
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#34C759] text-white"
                      >
                        <Plus className="size-5" />
                      </button>
                    </div>

                    {/* Lista scrollabile: la riga sopra resta fissa anche con la tastiera aperta */}
                    <ul className="max-h-64 space-y-1 overflow-y-auto overscroll-contain">
                      {menuOptions.length === 0 && (
                        <li className="py-4 text-center text-sm text-muted-foreground">
                          {options.length > 0 ? "Nessun nome in questo mese." : "Nessun nome."}
                        </li>
                      )}
                      {menuOptions.map((o) => (
                        <EntryRow
                          key={o}
                          name={o}
                          selected={o === selected}
                          onSelect={() => {
                            setSelected(o);
                            setNamesOpen(false);
                          }}
                          onDelete={() => {
                            persist(options.filter((x) => x !== o));
                            if (aliases.some((a) => a.to === o)) commitAliases(aliases.filter((a) => a.to !== o));
                            if (selected === o) setSelected("");
                          }}
                          onRename={(newName) => {
                            if (options.includes(newName)) return;
                            persist(options.map((x) => (x === o ? newName : x)));
                            if (aliases.some((a) => a.to === o)) {
                              commitAliases(aliases.map((a) => (a.to === o ? { ...a, to: newName } : a)));
                            }
                            if (selected === o) setSelected(newName);
                          }}
                        />
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>
              <Button
                className="h-9 w-11 shrink-0 rounded-xl border-0 px-0 text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-foreground [&_svg]:size-[26px]"
                style={{ backgroundColor: "var(--app-upload)" }}
                onClick={() => fileRef.current?.click()}
                aria-label="Carica file Excel"
                title="Carica file Excel"
              >
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                  aria-hidden="true"
                >
                  <rect x="2.5" y="3" width="15.5" height="15.5" rx="2.5" />
                  <path d="M2.5 8.5H18M2.5 13.5H10.5M7.5 3V18.5" />
                  {/* Cerchio dello stesso colore del pulsante: stacca la freccia dal foglio */}
                  <circle cx="17.5" cy="17.5" r="5.4" stroke="none" style={{ fill: "var(--app-upload)" }} />
                  <path d="M17.5 20.4V14.6M15 17L17.5 14.5L20 17" />
                </svg>
              </Button>
                <Popover
                  open={settingsOpen}
                  onOpenChange={(o) => {
                    setSettingsOpen(o);
                    if (!o) {
                      setOvertimeOpen(false);
                      setAdvancedOpen(false);
                      setMoreOpen(false);
                      setHoursOpen(false);
                      setBackupNote(null);
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Impostazioni"
                      title="Impostazioni"
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground shadow-sm"
                    >
                      <Settings className="size-[26px]" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[300px] max-w-[calc(100vw-1.5rem)] p-3.5">
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Tema</p>
                    <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1">
                      {THEME_OPTIONS.map(({ value, label, Icon }) => (
                        <button
                          key={value}
                          type="button"
                          aria-label={`Tema ${label.toLowerCase()}`}
                          aria-pressed={themePref === value}
                          onClick={() => setThemePref(value)}
                          className={cn(
                            "flex h-8 items-center justify-center gap-1 rounded-lg text-xs text-foreground",
                            themePref === value ? "bg-card shadow-sm" : "opacity-70",
                          )}
                        >
                          <Icon className="size-3.5 shrink-0" />
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Colore</p>
                    <div className="grid grid-cols-5 gap-2">
                      {ACCENT_PAIRS.map((pair, i) => (
                        <button
                          key={pair.light}
                          type="button"
                          aria-label={`Colore ${i + 1}`}
                          aria-pressed={i === accentIdx}
                          onClick={() => setAccentIndex(i)}
                          className={cn(
                            "size-8 rounded-full border transition-transform hover:scale-110",
                            i === accentIdx ? "border-foreground ring-2 ring-foreground/40" : "border-border",
                          )}
                          style={{ backgroundColor: isDark ? pair.dark : pair.light }}
                        />
                      ))}
                    </div>
                    <div className="-mx-3.5 mt-3 mb-0.5 h-px bg-[var(--glass-sep)]" />
                    <button
                      type="button"
                      aria-expanded={advancedOpen}
                      onClick={toggleAdvanced}
                      className="flex min-h-11 w-full items-center justify-start gap-1 whitespace-nowrap px-2.5 text-[13px] font-semibold text-foreground"
                    >
                      Report e backup
                      <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-200", advancedOpen && "rotate-180")} />
                    </button>
                    {advancedOpen && (
                      <div className="animate-in fade-in-0 slide-in-from-top-1 pt-1 duration-200 motion-reduce:animate-none">
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Mese</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!hasMonth}
                        aria-expanded={overtimeOpen}
                        onClick={toggleOvertime}
                        className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-1 rounded-[14px] px-2.5 text-left text-sm font-semibold text-foreground disabled:opacity-40"
                        style={{ backgroundColor: "var(--glass-chip)" }}
                      >
                        Straordinari
                        <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-200", overtimeOpen && "rotate-180")} />
                      </button>
                      <button
                        type="button"
                        disabled={!hasMonth}
                        onClick={generatePdf}
                        className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] px-2 text-sm font-semibold text-foreground disabled:opacity-40"
                        style={{ backgroundColor: "var(--glass-chip)" }}
                      >
                        <FileText className="size-4 shrink-0" />
                        Genera PDF
                      </button>
                    </div>
                      {overtimeOpen && hasMonth && (
                        <div
                          className="animate-in fade-in-0 slide-in-from-top-1 mt-1.5 rounded-[14px] px-2.5 py-2 duration-200 motion-reduce:animate-none"
                          style={{ backgroundColor: "var(--glass-chip)" }}
                        >
                          <p className="pb-0.5 text-xs text-muted-foreground">
                            {selected} · {month ? format(month, "MMMM", { locale: it }).replace(/^./, (c) => c.toUpperCase()) : ""}
                          </p>
                          {monthReport.otRows.length > 0 ? (
                            <>
                              <ul>
                                {monthReport.otRows.map((r) => (
                                  <li
                                    key={r.label}
                                    className="flex min-h-8 items-center justify-between border-t border-border/60 text-sm text-foreground"
                                  >
                                    <span>{r.label}</span>
                                    <span className="font-semibold">{r.hours}</span>
                                  </li>
                                ))}
                              </ul>
                              <div className="flex items-baseline justify-between border-t border-border/60 pt-2 text-foreground">
                                <span className="text-sm font-semibold">Totale</span>
                                <span className="text-base font-bold">{monthReport.otHours}</span>
                              </div>
                              {partialNote && <p className="pt-1.5 text-xs leading-snug text-muted-foreground">{partialNote}</p>}
                            </>
                          ) : (
                            <p className="border-t border-border/60 pt-2 text-sm text-muted-foreground">
                              Nessuno straordinario in questo mese.
                            </p>
                          )}
                        </div>
                      )}
                        <div className="-mx-3.5 my-2.5 h-px bg-[var(--glass-sep)]" />
                        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Modifiche e straordinari</p>
                        <input
                          ref={backupRef}
                          type="file"
                          accept=".json,application/json"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void importBackup(f);
                            e.target.value = "";
                          }}
                        />
                        <button
                          type="button"
                          onClick={exportBackup}
                          className="flex min-h-11 w-full items-center gap-2 rounded-[14px] px-2.5 text-left text-sm font-semibold text-foreground"
                          style={{ backgroundColor: "var(--glass-chip)" }}
                        >
                          <BoxArrowIcon direction="up" className="shrink-0" />
                          Esporta modifiche
                        </button>
                        <button
                          type="button"
                          onClick={() => backupRef.current?.click()}
                          className="mt-1.5 flex min-h-11 w-full items-center gap-2 rounded-[14px] px-2.5 text-left text-sm font-semibold text-foreground"
                          style={{ backgroundColor: "var(--glass-chip)" }}
                        >
                          <BoxArrowIcon direction="down" className="shrink-0" />
                          Importa modifiche
                        </button>
                        {backupNote && (
                          <div className="animate-in fade-in-0 slide-in-from-top-1 mt-2 rounded-[14px] border border-border px-2.5 py-2 text-xs leading-snug duration-200 motion-reduce:animate-none">
                            <p className="mb-0.5 font-semibold text-foreground">{backupNote.title}</p>
                            <p className="text-muted-foreground">{backupNote.body}</p>
                          </div>
                        )}
                      </div>
                    )}
                        <div className="-mx-3.5 mt-2.5 mb-0.5 h-px bg-[var(--glass-sep)]" />
                        <button
                          type="button"
                          aria-expanded={hoursOpen}
                          onClick={toggleHours}
                          className="flex min-h-11 w-full items-center justify-start gap-1 whitespace-nowrap px-2.5 text-[13px] font-semibold text-foreground"
                        >
                          Orari di esercizio
                          <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-200", hoursOpen && "rotate-180")} />
                        </button>
                        {hoursOpen && (
                          <div className="animate-in fade-in-0 slide-in-from-top-1 pt-1 duration-200 motion-reduce:animate-none">
                            <div className="mb-1.5 flex gap-1.5 pl-2.5 pr-1.5 text-xs font-medium text-muted-foreground">
                              <span className="flex-1" />
                              <span className="w-[88px] text-center">Apertura</span>
                              <span className="w-1.5" />
                              <span className="w-[88px] text-center">Chiusura</span>
                            </div>
                            {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((label, i) => (
                              <div
                                key={label}
                                className="mb-1 flex min-h-10 items-center gap-1.5 rounded-[14px] pl-2.5 pr-1.5 text-sm text-foreground"
                                style={{ backgroundColor: "var(--glass-chip)" }}
                              >
                                <span className="flex-1 font-semibold">{label}</span>
                                {(["open", "close"] as const).map((field, j) => (
                                  <span key={field} className="contents">
                                    {j === 1 && <span className="text-muted-foreground">–</span>}
                                    <span className="flex items-center rounded-lg bg-card shadow-sm">
                                      <button
                                        type="button"
                                        aria-label={`${label}, ${field === "open" ? "apertura" : "chiusura"}: 30 minuti prima`}
                                        onClick={() => changeHours(i, field, -HOURS_STEP)}
                                        className="flex h-[30px] w-6 items-center justify-center"
                                      >
                                        <ChevronLeft className="size-3.5" />
                                      </button>
                                      <span className="min-w-10 text-center tabular-nums">{minutesToTime(hours[i][field])}</span>
                                      <button
                                        type="button"
                                        aria-label={`${label}, ${field === "open" ? "apertura" : "chiusura"}: 30 minuti dopo`}
                                        onClick={() => changeHours(i, field, HOURS_STEP)}
                                        className="flex h-[30px] w-6 items-center justify-center"
                                      >
                                        <ChevronRight className="size-3.5" />
                                      </button>
                                    </span>
                                  </span>
                                ))}
                              </div>
                            ))}
                            <Button
                              disabled={!hoursModified}
                              className="mt-0.5 w-full rounded-xl text-[13px] text-white hover:opacity-90"
                              style={{ backgroundColor: "var(--app-upload)" }}
                              onClick={resetHours}
                            >
                              Ripristina orari
                            </Button>
                          </div>
                        )}
                        <div className="-mx-3.5 mt-2.5 mb-0.5 h-px bg-[var(--glass-sep)]" />
                        <button
                          type="button"
                          aria-expanded={moreOpen}
                          onClick={toggleMore}
                          className={cn(
                            "flex min-h-11 w-full items-center justify-start gap-1 whitespace-nowrap px-2.5 text-[13px] font-semibold text-foreground",
                            !moreOpen && "-mb-1",
                          )}
                        >
                          Gestione nomi
                          <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-200", moreOpen && "rotate-180")} />
                        </button>
                        {moreOpen && (
                        <div className="animate-in fade-in-0 slide-in-from-top-1 pt-1 duration-200 motion-reduce:animate-none">
                        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Nomi associati</p>
                        {aliases.length === 0 && (
                          <p className="mb-1.5 text-xs text-muted-foreground">Nessun nome associato.</p>
                        )}
                        {aliases.map((a) => (
                          <div
                            key={a.from}
                            className="mb-1.5 flex min-h-11 items-center gap-2 rounded-[14px] px-2.5 text-sm text-foreground"
                            style={{ backgroundColor: "var(--glass-chip)" }}
                          >
                            <span className="min-w-0 truncate">{a.from}</span>
                            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate font-semibold">{a.to}</span>
                            <button
                              type="button"
                              aria-label={`Usa «${a.from}» come nome giusto`}
                              title="Scambia: il nome giusto diventa quello a sinistra"
                              onClick={() => swapAlias(a)}
                              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground"
                            >
                              <ArrowLeftRight className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Separa ${a.from}`}
                              onClick={() => commitAliases(aliases.filter((x) => x.from !== a.from))}
                              className="-mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          aria-expanded={linkFormOpen}
                          onClick={() => setLinkFormOpen((o) => !o)}
                          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[14px] px-2.5 text-sm font-semibold text-foreground"
                          style={{ backgroundColor: "var(--glass-chip)" }}
                        >
                          <Plus className="size-4 shrink-0" />
                          Associa due nomi
                        </button>
                        {linkFormOpen && (
                          <div className="animate-in fade-in-0 slide-in-from-top-1 mt-2 rounded-[14px] border border-border p-2.5 duration-200 motion-reduce:animate-none">
                            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="link-from">
                              Nome scritto male (come nel file)
                            </label>
                            <input
                              id="link-from"
                              list="orari-file-names"
                              value={linkFrom}
                              onChange={(e) => setLinkFrom(e.target.value)}
                              autoComplete="off"
                              className="mb-2.5 h-9 w-full rounded-xl border border-border bg-card px-2.5 text-[16px] text-foreground"
                            />
                            <datalist id="orari-file-names">
                              {fileNameChoices.map((n) => (
                                <option key={n} value={n} />
                              ))}
                            </datalist>
                            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="link-to">
                              Si legge come (nome in elenco)
                            </label>
                            <select
                              id="link-to"
                              value={linkTo}
                              onChange={(e) => setLinkTo(e.target.value)}
                              className="mb-2.5 h-9 w-full rounded-xl border border-border bg-card px-2 text-[16px] text-foreground"
                            >
                              <option value="">Scegli…</option>
                              {sortedOptions.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                            {linkFormError && <p className="mb-2 text-xs text-destructive">{linkFormError}</p>}
                            <div className="flex gap-2">
                              <Button
                                disabled={!canLink}
                                className="flex-1 rounded-xl text-[13px] text-white hover:opacity-90"
                                style={{ backgroundColor: "var(--app-upload)" }}
                                onClick={() => {
                                  linkNames(linkFrom.trim(), linkTo);
                                  setLinkFrom("");
                                  setLinkTo("");
                                  setLinkFormOpen(false);
                                }}
                              >
                                Associa
                              </Button>
                              <button
                                type="button"
                                onClick={clearLinkForm}
                                className="rounded-xl border border-border bg-card px-3.5 py-2 text-[13px] text-foreground"
                              >
                                Annulla
                              </button>
                            </div>
                          </div>
                        )}
                        </div>
                        )}
                  </PopoverContent>
                </Popover>
            </div>


            {uploadNote && <p className="mt-2 text-xs text-destructive">{uploadNote}</p>}

            {suggestedNames.length > 0 && (
              <div className="mt-2 rounded-xl border border-border/60 bg-secondary/60 p-2.5">
                {linkingName ? (
                  <div>
                    <p className="text-sm font-semibold text-foreground">«{linkingName}» è lo stesso di…?</p>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Scegli il nome giusto: da ora «{linkingName}» sarà letto come quel nome.
                    </p>
                    <div className="mb-2.5 flex flex-wrap gap-1.5">
                      {similarOptions.map((o) => (
                        <button
                          key={o}
                          type="button"
                          aria-pressed={linkTarget === o}
                          onClick={() => setLinkTarget(o)}
                          className={cn(
                            "rounded-full border bg-card px-2.5 py-1 text-xs text-foreground",
                            linkTarget === o ? "border-foreground font-semibold ring-1 ring-foreground" : "border-border",
                          )}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        disabled={!linkTarget}
                        className="min-w-0 flex-1 truncate rounded-xl text-[13px] text-white hover:opacity-90"
                        style={{ backgroundColor: "var(--app-upload)" }}
                        onClick={() => {
                          if (linkTarget) linkNames(linkingName, linkTarget);
                          setLinking(null);
                        }}
                      >
                        {linkTarget ? `Associa a ${linkTarget}` : "Associa"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => {
                          persist([...options, linkingName]);
                          setLinking(null);
                        }}
                        className="shrink-0 rounded-xl border border-border bg-card px-2.5 py-2 text-[13px] text-foreground"
                      >
                        È un collega nuovo
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLinking(null)}
                      className="mt-2 w-full text-center text-xs text-muted-foreground underline"
                    >
                      Annulla
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Nominativi trovati nel file, non in elenco:</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDismissedSuggestions(
                            (prev) => new Set([...prev, ...suggestedNames.map((n) => norm(n))]),
                          )
                        }
                        className="shrink-0 text-xs text-muted-foreground underline"
                      >
                        Ignora
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestedNames.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => openLink(name)}
                          className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground"
                        >
                          <Plus className="size-3" />
                          {name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          {notice && (
            <div className="mt-2 flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
              <p className="flex-1 text-sm leading-snug text-foreground">{notice.text}</p>
              <Button
                className="shrink-0 rounded-xl px-3.5 text-sm text-white hover:opacity-90"
                style={{ backgroundColor: "var(--app-upload)" }}
                onClick={() => fileRef.current?.click()}
              >
                Carica file
              </Button>
            </div>
          )}
          {weeks.length > 0 && (
            <div
              className="mt-2 grid grid-cols-7 gap-1 px-1 py-2 sm:gap-2"
              style={{ backgroundColor: "var(--app-bg)" }}
            >
              {DAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="truncate text-center text-[13px] font-extrabold uppercase tracking-wide text-foreground sm:text-base"
                >
                  {label.slice(0, 3)}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Month: one week per row, ciascuna settimana inscritta in una cornice */}
        <section className="mt-3 space-y-5">
          {weeks.map((week, weekIdx) => (
            <div
              key={weekIdx}
              className="relative rounded-2xl border border-border/60 p-1.5 pb-2 sm:rounded-3xl sm:p-2"
              style={{ backgroundColor: "var(--app-week)" }}
            >
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {DAY_LABELS.map((label, i) => {
                  const date = week.monday ? addDays(week.monday, i) : undefined;
                  const data = week.days[i];
                  // Straordinario a blocco (prima/dopo): ha orari propri; "tutto il turno" no.
                  const otBlock = !!data?.ot && data.ot.side !== "all";
                  // Giorni dei mesi vicini (stessa settimana): tinte attenuate, tranne con un riquadro aperto.
                  const outside = !!date && !!month && !isSameMonth(date, month);
                  const peekOpen = peekKey === `${weekIdx}-${i}` || peekKey === `ot-${weekIdx}-${i}`;
                  const today = date ? isToday(date) : false;
                  return (
                    <div
                      key={`${weekIdx}-${label}`}
                      className={cn(
                        "@container relative h-24 cursor-pointer transition-opacity duration-200 sm:h-[148px]",
                        outside && !peekOpen && "opacity-50",
                      )}
                      onClick={() => {
                        if (ignoreTileClickRef.current) {
                          ignoreTileClickRef.current = false;
                          return;
                        }
                        openDayPopup(date);
                      }}
                    >
                      {/* Data: posizione fissa, indipendente dall'altezza della tessera */}
                      <div className="absolute inset-x-0 top-1 z-10 pb-1 text-center sm:top-2">
                        <div
                          className={cn(
                            "block truncate rounded-full px-2 text-[12px] sm:text-[16px]",
                            today && !data && "border-2 border-foreground",
                          )}
                          style={{ color: "var(--app-date)" }}
                        >
                          {date ? format(date, "d", { locale: it }) : "—"}
                        </div>
                      </div>
                      {week.mods[i] && (
                        <>
                          <span
                            role="img"
                            aria-label="Turno modificato"
                            className="pointer-events-none absolute right-[8px] top-[9px] z-20 size-[9px] rounded-full @max-[45px]:right-[3px] @max-[45px]:size-[8px] sm:right-[14px] sm:top-[16px]"
                            style={{ backgroundColor: accent, boxShadow: "0 0 0 1.5px var(--app-week)" }}
                          />
                          {/* Zona di tocco più ampia del pallino: mostra il turno scritto nel file */}
                          <button
                            type="button"
                            data-peek
                            aria-label="Mostra il turno originale"
                            aria-expanded={peekKey === `${weekIdx}-${i}`}
                            className="absolute right-0 top-[3px] z-30 size-[30px] rounded-lg sm:right-[6px] sm:top-[6px] sm:size-9"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPeekKey(peekKey === `${weekIdx}-${i}` ? null : `${weekIdx}-${i}`);
                            }}
                          />
                          {peekKey === `${weekIdx}-${i}` && (
                            <div
                              data-peek
                              role="status"
                              className={cn(
                                "ios-in glass absolute top-[36px] z-40 rounded-[14px] px-2.5 py-2 text-foreground sm:top-[46px]",
                                i < 3 ? "left-0" : "right-0",
                              )}
                              style={{ transformOrigin: i < 3 ? "14px 0" : "calc(100% - 14px) 0" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="text-[10px] leading-tight text-muted-foreground">Turno originale</div>
                              <div className="whitespace-nowrap text-[13px] font-bold leading-snug">
                                {week.files[i] ? `${week.files[i]!.start} – ${week.files[i]!.end}` : "nessun turno"}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      {data && (
                        <>
                          <article
                            className={cn(
                              "absolute inset-x-0 bottom-0 flex flex-col items-center justify-end rounded-xl bg-[var(--app-tile)] p-1 shadow-sm sm:rounded-2xl sm:p-2",
                              otBlock && "sm:pb-1.5",
                              today ? "border-2 border-foreground" : "border border-border/60",
                            )}
                            style={{ height: data.shortShift ? "70%" : "100%" }}
                          >
                            {data.total && (
                              <span
                                className={cn(
                                  "flex w-full items-center justify-center gap-[3px] whitespace-nowrap rounded-md px-1 py-[2px] text-center text-[10px] font-medium leading-none sm:gap-1 sm:rounded-xl sm:px-2 sm:py-[3px] sm:text-xs",
                                  data.late ? undefined : "bg-[var(--app-tile-chip)] text-foreground",
                                  data.ot && "gap-[2px] px-0.5 text-[9px]",
                                )}
                                style={data.late ? { backgroundColor: accent, color: contrastTextColor(accent) } : undefined}
                              >
                                {data.ot && (
                                  // Pallino: nella pillola colorata è "in sottrazione" (colore del fondo)
                                  <span
                                    aria-hidden
                                    className="size-[5px] shrink-0 rounded-full sm:size-[7px]"
                                    style={{ backgroundColor: data.late ? "var(--app-tile)" : accent }}
                                  />
                                )}
                                <span>{data.total}</span>
                              </span>
                            )}
                          </article>
                          {data.ot && (
                            <>
                              {/* Zona di tocco del pallino: mostra le ore di straordinario */}
                              <button
                                type="button"
                                data-peek
                                aria-label="Mostra le ore di straordinario"
                                aria-expanded={peekKey === `ot-${weekIdx}-${i}`}
                                className="absolute bottom-0 left-0 z-30 h-[28px] w-1/2 rounded-lg sm:h-10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPeekKey(peekKey === `ot-${weekIdx}-${i}` ? null : `ot-${weekIdx}-${i}`);
                                }}
                              />
                              {peekKey === `ot-${weekIdx}-${i}` && (
                                <div
                                  data-peek
                                  role="status"
                                  className={cn(
                                    "ios-in glass absolute bottom-[34px] z-40 rounded-[14px] px-2.5 py-2 text-foreground sm:bottom-[48px]",
                                    i < 3 ? "left-0" : "right-0",
                                  )}
                                  style={{ transformOrigin: i < 3 ? "14px 100%" : "calc(100% - 14px) 100%" }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="text-[10px] leading-tight text-muted-foreground">Straordinario</div>
                                  <div className="whitespace-nowrap text-[13px] font-bold leading-snug">
                                    {data.ot.side === "all" ? `Tutto il turno · ${data.ot.otTotal}` : data.ot.otTotal}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                          {/* Orari: posizione fissa, poco sotto al bordo superiore della tessera bassa */}
                          <div
                            className={cn(
                              "absolute inset-x-0 z-10 flex flex-col items-center px-1 text-center sm:px-2",
                              otBlock ? "top-[21px] gap-px sm:top-[38px] sm:gap-0.5" : "top-[36px] gap-0.5 sm:top-[55px] sm:gap-1",
                            )}
                          >
                            {/* Straordinario aggiunto prima: sta sopra l'ordinario, con la linea sotto */}
                            {otBlock && data.ot?.side === "before" && (
                              <div className="mb-px flex w-[70%] flex-col items-center border-b pb-px text-[9px] font-medium leading-[1.1] sm:mb-0.5 sm:pb-0.5 sm:text-[13px]" style={{ color: accent, borderColor: accent }}>
                                <span>{data.ot.start}</span>
                                <span>{data.ot.end}</span>
                              </div>
                            )}
                            <span
                              className={cn(
                                "text-[12px] font-bold sm:text-base",
                                otBlock ? "leading-[1.1]" : "leading-tight",
                                data.ot?.side !== "all" && "text-foreground",
                              )}
                              style={data.ot?.side === "all" ? { color: accent } : undefined}
                            >
                              {data.start}
                            </span>
                            <span
                              className={cn(
                                "text-[12px] font-bold sm:text-base",
                                otBlock ? "leading-[1.1]" : "leading-tight",
                                data.ot?.side !== "all" && "text-foreground",
                              )}
                              style={data.ot?.side === "all" ? { color: accent } : undefined}
                            >
                              {data.end}
                            </span>
                            {/* Straordinario aggiunto dopo: corpo più piccolo, sotto una linea sottile */}
                            {otBlock && data.ot?.side === "after" && (
                              <div className="mt-px flex w-[70%] flex-col items-center border-t pt-px text-[9px] font-medium leading-[1.1] sm:mt-0.5 sm:pt-0.5 sm:text-[13px]" style={{ color: accent, borderColor: accent }}>
                                <span>{data.ot.start}</span>
                                <span>{data.ot.end}</span>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {week.tot && (() => {
                const t = week.tot;
                const key = `tot-${weekIdx}`;
                const open = peekKey === key;
                const upward = weekIdx === weeks.length - 1;
                const sameMonth = isSameMonth(t.sunday, t.saturday);
                const range = sameMonth
                  ? `${dateCapitalized(t.sunday, "EEE d")} – ${dateCapitalized(t.saturday, "EEE d MMMM")}`
                  : `${dateCapitalized(t.sunday, "EEE d MMMM")} – ${dateCapitalized(t.saturday, "EEE d MMMM")}`;
                const label = t.missing ? "–" : formatHours(t.total);
                return (
                  <>
                    {/* Pillola a cavallo del bordo inferiore: il totale della settimana, senza togliere spazio alle tessere */}
                    <button
                      type="button"
                      data-peek
                      aria-label={`Totale da ${range}: ${t.missing ? "incompleto" : label}`}
                      aria-expanded={open}
                      className="absolute -bottom-[14px] right-0.5 z-20 flex h-6 w-16 items-center justify-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPeekKey(open ? null : key);
                      }}
                    >
                      <span className="flex h-[14px] items-center rounded-[7px] border border-border/60 bg-[var(--app-tile)] px-1.5 text-[9px] font-normal leading-none text-foreground shadow-sm">
                        {label}
                      </span>
                    </button>
                    {open && (
                      <div
                        data-peek
                        role="status"
                        className={cn(
                          "ios-in glass absolute right-0.5 z-40 w-56 rounded-[22px] px-3.5 py-3 text-foreground",
                          // L'ultima settimana si apre verso l'alto: sotto non c'è spazio nello schermo.
                          upward ? "bottom-[12px]" : "top-[calc(100%+18px)]",
                        )}
                        style={{ transformOrigin: upward ? "100% 100%" : "100% 0" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="text-xs text-muted-foreground">{range}</div>
                        {t.missing ? (
                          <>
                            <p className="mt-2 text-[13px] leading-snug">
                              {`Manca ${getDay(t.missing) === 0 ? "la domenica" : "il giorno"} ${format(t.missing, "d MMMM", { locale: it })}: carica il file di ${format(t.missing, "MMMM", { locale: it })} per avere il totale.`}
                            </p>
                            <Button
                              className="mt-2.5 h-9 w-full rounded-xl text-sm text-white hover:opacity-90"
                              style={{ backgroundColor: "var(--app-upload)" }}
                              onClick={() => {
                                setPeekKey(null);
                                fileRef.current?.click();
                              }}
                            >
                              Carica file
                            </Button>
                          </>
                        ) : (
                          <>
                            <div className="mt-1 flex items-baseline justify-between">
                              <span className="text-[13px] font-semibold">Totale</span>
                              <span className="text-xl font-bold">{formatHours(t.total)}</span>
                            </div>
                            <div className="my-2 h-px bg-border" />
                            <div className="flex justify-between text-[13px]">
                              <span className="text-muted-foreground">Ordinario</span>
                              <span className="font-semibold">{formatHours(t.ordinary)}</span>
                            </div>
                            <div className="mt-0.5 flex justify-between text-[13px]">
                              <span className="text-muted-foreground">Straordinario</span>
                              <span className="font-semibold">{formatHours(t.overtime)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          ))}
        </section>

        {!hasFiles && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Carica il file Excel degli orari e seleziona un nome per iniziare.
          </p>
        )}
      </div>

      <Dialog open={!!dayPopup} onOpenChange={(o) => !o && setPopupDate(null)}>
        <DialogContent
          className="top-[max(1rem,calc(50dvh-380px))] max-h-[calc(100dvh-2rem)] w-[360px] max-w-[calc(100vw-1rem)] translate-y-0 gap-3.5 border-0 bg-transparent px-2 pb-3 pt-0 shadow-none sm:rounded-none"
          showCloseButton={false}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="ios-card glass rounded-[28px] p-5">
            <DialogTitle className="whitespace-nowrap text-lg font-semibold leading-tight tracking-normal">
              {dayPopup ? dateCapitalized(dayPopup.date, "EEEE d MMMM") : ""}
            </DialogTitle>

            {/* Le righe si chiudono (altezza e dissolvenza) quando si apre un pannello di modifica */}
            <div
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                panelOpen ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
              )}
              aria-hidden={panelOpen}
              inert={panelOpen}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="pt-3">
                  <h3 className="mb-1.5 text-base font-normal text-foreground">Apertura</h3>
                  {dayPopup && dayPopup.apre.length > 0 ? (
                    <ul className="mb-4 space-y-1">
                      {dayPopup.apre.map((entry) => (
                        <ShiftRow key={entry.name} entry={entry} range={dayPopup.barRange} accent={accent} />
                      ))}
                    </ul>
                  ) : (
                    <p className="mb-4 text-sm text-muted-foreground">Nessuno.</p>
                  )}

                  <h3 className="mb-1.5 text-base font-normal text-foreground">Chiusura</h3>
                  {dayPopup && dayPopup.chiude.length > 0 ? (
                    <ul className="space-y-1">
                      {dayPopup.chiude.map((entry) => (
                        <ShiftRow key={entry.name} entry={entry} range={dayPopup.barRange} accent={accent} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nessuno.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {dayPopup && canEditShift && (
            <DayEditPanels
              key={`${dayKey(dayPopup.date)}|${selected}`}
              subtitle={`${selected} · ${dateCapitalized(dayPopup.date, "EEE d MMM")}`}
              fileShift={selectedFileShift}
              ordinary={applyOverride(selectedFileShift, overrideFor(dayPopup.date, selected), false)}
              override={overrideFor(dayPopup.date, selected)}
              accent={accent}
              accentText={contrastTextColor(accent)}
              onSaveShift={(shift) =>
                changeOverride((cur) => ({
                  rest: shift.rest,
                  start: shift.start,
                  end: shift.end,
                  // Se il giorno passa a riposo lo straordinario non ha più un ordinario a cui agganciarsi.
                  ot: shift.rest ? undefined : cur.ot,
                }))
              }
              onResetShift={() => changeOverride((cur) => ({ ot: cur.ot }))}
              onSaveOvertime={(ot: Overtime) => changeOverride((cur) => ({ ...cur, ot }))}
              onRemoveOvertime={() => changeOverride((cur) => ({ rest: cur.rest, start: cur.start, end: cur.end }))}
              onOpenChange={setPanelOpen}
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
