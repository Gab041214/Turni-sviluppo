import { addDays, startOfMonth, startOfWeek } from "date-fns";

import { monthKey } from "@/lib/overrides";

/** File Excel dei turni già letto: solo le celle che servono, una voce per mese. */
export type StoredFile = {
  name: string;
  /** Primo giorno del mese del file (ISO). */
  month: string;
  /** Domenica della prima settimana, da SETUP!E7 (ISO), se presente. */
  sunday?: string;
  rows: string[][];
};

/** mese (yyyy-MM) -> file */
export type FileStore = Record<string, StoredFile>;

const FILES_KEY = "orari.files";
/** Si ricordano al massimo gli ultimi 12 mesi. */
export const MAX_FILES = 12;

// Chiavi del vecchio salvataggio a file singolo (solo per portare i dati nel nuovo).
const LEGACY_ROWS_KEY = "turni.file.rows";
const LEGACY_NAME_KEY = "turni.file.name";
const LEGACY_MONTH_KEY = "turni.month";
const LEGACY_SUNDAY_KEY = "turni.fileSunday";

/** Tiene solo gli ultimi MAX_FILES mesi. */
export function trimFiles(store: FileStore): FileStore {
  const keys = Object.keys(store).sort();
  if (keys.length <= MAX_FILES) return store;
  const next: FileStore = {};
  for (const k of keys.slice(keys.length - MAX_FILES)) next[k] = store[k]!;
  return next;
}

export function loadFiles(): FileStore {
  try {
    const raw = localStorage.getItem(FILES_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as FileStore;
    }
    // Migrazione: il file singolo delle versioni precedenti diventa il file del suo mese.
    const rawRows = localStorage.getItem(LEGACY_ROWS_KEY);
    const rawMonth = localStorage.getItem(LEGACY_MONTH_KEY);
    if (rawRows && rawMonth) {
      const month = startOfMonth(new Date(rawMonth));
      if (!Number.isNaN(month.getTime())) {
        const sunday = localStorage.getItem(LEGACY_SUNDAY_KEY) ?? undefined;
        const store: FileStore = {
          [monthKey(month)]: {
            name: localStorage.getItem(LEGACY_NAME_KEY) ?? "",
            month: month.toISOString(),
            sunday,
            rows: JSON.parse(rawRows) as string[][],
          },
        };
        saveFiles(store);
        for (const k of [LEGACY_ROWS_KEY, LEGACY_NAME_KEY, LEGACY_MONTH_KEY, LEGACY_SUNDAY_KEY]) {
          localStorage.removeItem(k);
        }
        return store;
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function saveFiles(store: FileStore) {
  try {
    if (Object.keys(store).length === 0) localStorage.removeItem(FILES_KEY);
    else localStorage.setItem(FILES_KEY, JSON.stringify(store));
  } catch {
    /* quota superata: ignora */
  }
}

/** Domenica da cui partono le righe del file (la prima giornata coperta). */
export function fileAnchor(file: StoredFile): Date {
  if (file.sunday) {
    const d = new Date(file.sunday);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return addDays(startOfWeek(startOfMonth(new Date(file.month)), { weekStartsOn: 1 }), -1);
}
