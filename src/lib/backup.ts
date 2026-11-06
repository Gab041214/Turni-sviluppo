import type { DayOverride, OverrideStore } from "@/lib/overrides";
import type { Leave, Overtime } from "@/lib/shifts";

/** Esportazione e importazione delle modifiche manuali (turni cambiati, straordinari, ferie e ROL) tra dispositivi. */

const BACKUP_APP = "orari-modifiche";
const BACKUP_VERSION = 1;

const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Numero di modifiche (giorno + nominativo) contenute in un archivio. */
export function countOverrides(store: OverrideStore): number {
  let n = 0;
  for (const days of Object.values(store)) for (const names of Object.values(days)) n += Object.keys(names).length;
  return n;
}

/** Contenuto del file da esportare. */
export function buildBackup(store: OverrideStore, exportedAt: Date = new Date()): string {
  return JSON.stringify({ app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: exportedAt.toISOString(), overrides: store });
}

function cleanOvertime(raw: unknown): Overtime | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.side === "all") return { side: "all" };
  if ((raw.side === "before" || raw.side === "after") && typeof raw.min === "number" && Number.isFinite(raw.min) && raw.min > 0) {
    return { side: raw.side, min: raw.min };
  }
  return undefined;
}

const TIME_RE = /^\d{2}:\d{2}$/;

function cleanLeave(raw: unknown): Leave | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.all === true) return { all: true };
  if (typeof raw.start === "string" && typeof raw.end === "string" && TIME_RE.test(raw.start) && TIME_RE.test(raw.end)) {
    return { start: raw.start, end: raw.end };
  }
  return undefined;
}

function cleanOverride(raw: unknown): DayOverride | undefined {
  if (!isRecord(raw)) return undefined;
  const out: DayOverride = {};
  if (typeof raw.rest === "boolean") {
    out.rest = raw.rest;
    if (!raw.rest) {
      if (typeof raw.start !== "string" || typeof raw.end !== "string") return undefined;
      out.start = raw.start;
      out.end = raw.end;
    }
  }
  const ot = cleanOvertime(raw.ot);
  if (ot) out.ot = ot;
  // Straordinario e ROL non stanno insieme nello stesso giorno: se ci sono entrambi vale lo straordinario.
  const perm = ot ? undefined : cleanLeave(raw.perm);
  if (perm) out.perm = perm;
  return out.rest !== undefined || out.ot || out.perm ? out : undefined;
}

/** Legge un file esportato: restituisce le modifiche valide, oppure null se non è un file di Orari. */
export function parseBackup(text: string): OverrideStore | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.app !== BACKUP_APP || !isRecord(data.overrides)) return null;
  const store: OverrideStore = {};
  for (const [month, days] of Object.entries(data.overrides)) {
    if (!MONTH_RE.test(month) || !isRecord(days)) continue;
    for (const [day, names] of Object.entries(days)) {
      if (!DAY_RE.test(day) || !isRecord(names)) continue;
      for (const [name, raw] of Object.entries(names)) {
        const ov = cleanOverride(raw);
        if (!ov || !name) continue;
        store[month] ??= {};
        store[month]![day] ??= {};
        store[month]![day]![name] = ov;
      }
    }
  }
  return store;
}

const sameOverride = (a: DayOverride, b: DayOverride) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Unisce le modifiche importate a quelle presenti. Per lo stesso giorno e nominativo vince l'importata,
 * anche se sul dispositivo stava sotto un altro mese (un giorno a cavallo di due file).
 */
export function mergeOverrides(
  current: OverrideStore,
  incoming: OverrideStore,
): { store: OverrideStore; added: number; replaced: number; unchanged: number } {
  const store: OverrideStore = {};
  for (const [m, days] of Object.entries(current)) {
    store[m] = {};
    for (const [d, names] of Object.entries(days)) store[m]![d] = { ...names };
  }
  let added = 0;
  let replaced = 0;
  let unchanged = 0;
  for (const [month, days] of Object.entries(incoming)) {
    for (const [day, names] of Object.entries(days)) {
      for (const [name, ov] of Object.entries(names)) {
        let existing: DayOverride | undefined;
        for (const [m, cDays] of Object.entries(store)) {
          const found = cDays[day]?.[name];
          if (!found) continue;
          existing = found;
          if (m !== month) {
            delete cDays[day]![name];
            if (Object.keys(cDays[day]!).length === 0) delete cDays[day];
          }
        }
        if (!existing) added++;
        else if (sameOverride(existing, ov)) unchanged++;
        else replaced++;
        store[month] ??= {};
        store[month]![day] ??= {};
        store[month]![day]![name] = ov;
      }
    }
  }
  for (const m of Object.keys(store)) if (Object.keys(store[m]!).length === 0) delete store[m];
  return { store, added, replaced, unchanged };
}

/** Salva il file: sui telefoni apre il foglio di condivisione ("Salva su File", AirDrop...), altrimenti lo scarica. */
export async function saveJson(text: string, filename: string): Promise<void> {
  const blob = new Blob([text], { type: "application/json" });
  const file = new File([blob], filename, { type: "application/json" });
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
