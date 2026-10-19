import { format } from "date-fns";

import type { Overtime } from "@/lib/shifts";

/**
 * Modifiche manuali di un giorno per un nominativo:
 * - turno: `rest` è definito (true = giorno a riposo, false = orario `start`–`end` inserito a mano);
 * - straordinario: `ot`, agganciato all'orario ordinario (quello del file o quello modificato).
 */
export type DayOverride = { rest?: boolean; start?: string; end?: string; ot?: Overtime };

/** mese (yyyy-MM) -> giorno (yyyy-MM-dd) -> nominativo -> modifiche */
export type OverrideStore = Record<string, Record<string, Record<string, DayOverride>>>;

const OVERRIDES_KEY = "orari.overrides";

export const monthKey = (d: Date) => format(d, "yyyy-MM");
export const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

export function loadOverrides(): OverrideStore {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as OverrideStore) : {};
  } catch {
    return {};
  }
}

export function saveOverrides(store: OverrideStore) {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

export function getOverride(
  store: OverrideStore,
  month: string,
  day: string,
  name: string,
): DayOverride | undefined {
  return store[month]?.[day]?.[name];
}

/** True se il giorno ha un turno inserito a mano (anche "a riposo"). */
export const hasShiftOverride = (ov: DayOverride | undefined): boolean => ov?.rest !== undefined;

/** Restituisce un nuovo store con le modifiche del giorno cambiate da `change`; le voci vuote spariscono. */
export function updateOverride(
  store: OverrideStore,
  month: string,
  day: string,
  name: string,
  change: (current: DayOverride) => DayOverride,
): OverrideStore {
  const next: OverrideStore = { ...store };
  const days = { ...(next[month] ?? {}) };
  const names = { ...(days[day] ?? {}) };
  const updated = change({ ...(names[name] ?? {}) });
  if (updated.rest !== undefined || updated.ot) names[name] = updated;
  else delete names[name];
  if (Object.keys(names).length > 0) days[day] = names;
  else delete days[day];
  if (Object.keys(days).length > 0) next[month] = days;
  else delete next[month];
  return next;
}

/** Sposta le modifiche del nominativo `from` su `to` (se `to` ha già modifiche nello stesso giorno, restano le sue). */
export function renameOverrides(store: OverrideStore, from: string, to: string): OverrideStore {
  if (from === to) return store;
  const next: OverrideStore = {};
  for (const [month, days] of Object.entries(store)) {
    const nextDays: Record<string, Record<string, DayOverride>> = {};
    for (const [day, names] of Object.entries(days)) {
      const moved: Record<string, DayOverride> = {};
      for (const [name, ov] of Object.entries(names)) {
        if (name === from) continue;
        moved[name] = ov;
      }
      if (names[from] && !moved[to]) moved[to] = names[from]!;
      if (Object.keys(moved).length > 0) nextDays[day] = moved;
    }
    if (Object.keys(nextDays).length > 0) next[month] = nextDays;
  }
  return next;
}
